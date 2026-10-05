/** Own cancellable piano transport using an injected audio clock; never change musical or document state. */
import type { Score } from '../core'
import { compilePerformance, quarterBeats } from './timeline'
import type { Performance, PerformanceNote, MeasureVisit } from './timeline'

/** A scheduled attack owns its own source, even when another voice has the same pitch. */
export interface AudioAttack {
  readonly note: PerformanceNote
  readonly start: number
  readonly end: number
  readonly offset: number
}

/** Narrow resource boundary implemented by the sampled piano and deterministic test clocks. */
export interface PianoAudio {
  prepare(): Promise<void>
  now(): number
  running(): boolean
  schedule(attack: AudioAttack): void
  silence(): void
  dispose(): void
}

/** Cached transport state suitable for subscriptions without rerendering the editor. */
export interface PlaybackSnapshot {
  readonly status: 'stopped' | 'loading' | 'playing' | 'paused' | 'error'
  readonly bpm: number
  readonly position: number
  readonly visit: MeasureVisit | null
  readonly activeEventIds: readonly string[]
  readonly follow: boolean
  readonly error: string | null
}

interface TempoSegment {
  beat: number
  secondsPerBeat: number
}

const LEAD_SECONDS = 0.04
const HORIZON_SECONDS = 0.12

/** Find the first sorted item at or after a musical position in logarithmic time. */
function lowerBound<T>(
  items: readonly T[],
  beat: number,
  start: (item: T) => number,
): number {
  let low = 0
  let high = items.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (start(items[middle]) < beat) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return low
}

/** Schedule a bounded lookahead, invalidate async starts, and reconstruct held samples after pause or tempo changes. */
export class PlaybackController {
  #snapshot: PlaybackSnapshot = {
    status: 'stopped',
    bpm: 120,
    position: 0,
    visit: null,
    activeEventIds: [],
    follow: true,
    error: null,
  }
  #listeners = new Set<() => void>()
  #audio: PianoAudio | null = null
  #generation = 0
  #timer: ReturnType<typeof globalThis.setInterval> | undefined
  #performance: Performance | null = null
  #score: Score | null = null
  #nextNote = 0
  #originTime = 0
  #originBeat = 0
  #lastTick = 0
  #maxEventDuration = 0
  #segments: TempoSegment[] = []
  readonly #factory: () => Promise<PianoAudio>

  /** Inject the asynchronous resource factory so compilation and transport can be tested without speakers. */
  constructor(factory: () => Promise<PianoAudio>) {
    this.#factory = factory
  }

  /** Return a stable snapshot until a real transport update occurs. */
  getSnapshot = (): PlaybackSnapshot => this.#snapshot

  /** Register a UI or lifecycle observer and return its teardown. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Publish transport-only state, preserving the native score and undo history. */
  private publish(change: Partial<PlaybackSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...change }
    for (const listener of this.#listeners) {
      listener()
    }
  }

  /** Compile fresh music or resume the unchanged paused performance; stale resource completion cannot restart playback. */
  async play(score: Score): Promise<void> {
    if (
      this.#snapshot.status === 'playing' ||
      this.#snapshot.status === 'loading'
    ) {
      return
    }
    const generation = ++this.#generation
    const resume = this.#snapshot.status === 'paused' && this.#score === score
    this.publish({ status: 'loading', error: null })
    try {
      if (!resume) {
        this.#performance = compilePerformance(score)
        this.#score = score
        this.#originBeat = 0
        this.#segments = [{ beat: 0, secondsPerBeat: 60 / this.#snapshot.bpm }]
        this.#maxEventDuration = this.#performance.events.reduce(
          (maximum, event) =>
            Math.max(
              maximum,
              quarterBeats(event.end) - quarterBeats(event.start),
            ),
          0,
        )
      }
      if (!this.#performance!.notes.length) {
        throw new Error('当前乐谱没有可试听的音符。')
      }
      if (!this.#audio) {
        const audio = await this.#factory()
        if (generation !== this.#generation) {
          audio.dispose()
          return
        }
        this.#audio = audio
      }
      await this.#audio.prepare()
      if (generation !== this.#generation) {
        return
      }
      this.restart(resume ? this.#snapshot.position : 0)
    } catch (error) {
      if (generation !== this.#generation) {
        return
      }
      this.clearTimer()
      this.#audio?.dispose()
      this.#audio = null
      this.publish({
        status: 'error',
        activeEventIds: [],
        error:
          error instanceof Error
            ? error.message
            : '钢琴音频初始化失败，请重试。',
      })
    }
  }

  /** Rebase the audio clock and queue each future attack exactly once. */
  private restart(position: number): void {
    const audio = this.#audio!
    audio.silence()
    this.#originBeat = position
    this.#originTime = audio.now() + LEAD_SECONDS
    this.#lastTick = audio.now()
    this.#nextNote = lowerBound(this.#performance!.notes, position, (note) =>
      quarterBeats(note.start),
    )
    // Only notes whose keys or pedal are still held resume; their sample phase includes earlier tempo segments.
    for (let index = 0; index < this.#nextNote; index++) {
      const note = this.#performance!.notes[index]
      if (quarterBeats(note.end) > position) {
        this.schedule(note, position)
      }
    }
    this.publish({ status: 'playing', position, error: null })
    this.clearTimer()
    this.#timer = globalThis.setInterval(() => this.tick(), 25)
    this.tick()
  }

  /** Integrate performed seconds across tempo changes, excluding time spent paused. */
  private elapsed(start: number, end: number): number {
    let result = 0
    for (let index = 0; index < this.#segments.length; index++) {
      const segment = this.#segments[index]
      const stop = this.#segments[index + 1]?.beat ?? end
      const from = Math.max(start, segment.beat)
      const to = Math.min(end, stop)
      if (to > from) {
        result += (to - from) * segment.secondsPerBeat
      }
    }
    return result
  }

  /** Translate one occurrence into absolute audio times, independently from notation geometry. */
  private schedule(note: PerformanceNote, position: number): void {
    const start = quarterBeats(note.start)
    const seconds = 60 / this.#snapshot.bpm
    this.#audio!.schedule({
      note,
      start:
        this.#originTime +
        (Math.max(position, start) - this.#originBeat) * seconds,
      end:
        this.#originTime +
        (quarterBeats(note.end) - this.#originBeat) * seconds,
      offset: this.elapsed(start, Math.max(position, start)),
    })
  }

  /** Read musical progress from the audio clock rather than accumulated timer intervals. */
  private position(): number {
    return Math.max(
      this.#originBeat,
      this.#originBeat +
        ((this.#audio!.now() - this.#originTime) * this.#snapshot.bpm) / 60,
    )
  }

  /** Maintain lookahead and emit only the small range of events near the current position. */
  private tick(): void {
    try {
      const audio = this.#audio!
      const now = audio.now()
      if (!audio.running() || now - this.#lastTick > HORIZON_SECONDS) {
        this.freeze(this.#snapshot.position)
        this.publish({ error: '音频被系统暂停或调度中断，请点击播放继续。' })
        return
      }
      this.#lastTick = now
      const performance = this.#performance!
      const position = this.position()
      if (position >= quarterBeats(performance.duration)) {
        this.stop()
        return
      }
      const horizon = position + (HORIZON_SECONDS * this.#snapshot.bpm) / 60
      while (
        this.#nextNote < performance.notes.length &&
        quarterBeats(performance.notes[this.#nextNote].start) <= horizon
      ) {
        this.schedule(performance.notes[this.#nextNote++], this.#originBeat)
      }
      const from = lowerBound(
        performance.events,
        position - this.#maxEventDuration,
        (event) => quarterBeats(event.start),
      )
      const activeEventIds: string[] = []
      for (let index = from; index < performance.events.length; index++) {
        const event = performance.events[index]
        if (quarterBeats(event.start) > position) {
          break
        }
        if (quarterBeats(event.end) > position) {
          activeEventIds.push(event.eventId)
        }
      }
      const visitIndex =
        lowerBound(
          performance.visits,
          position + Number.EPSILON * Math.max(1, position),
          (visit) => quarterBeats(visit.start),
        ) - 1
      this.publish({
        position,
        activeEventIds,
        visit: performance.visits[Math.max(0, visitIndex)],
      })
    } catch (error) {
      this.stop()
      this.publish({
        status: 'error',
        error: error instanceof Error ? error.message : '音频调度失败。',
      })
    }
  }

  /** Freeze musical position and silence all current and queued sources. */
  pause(): void {
    if (this.#snapshot.status === 'loading') {
      this.stop()
      return
    }
    if (this.#snapshot.status !== 'playing') {
      return
    }
    this.freeze(this.position())
  }

  /** Preserve the last confirmed position when scheduling has stalled, avoiding silently skipped music. */
  private freeze(position: number): void {
    this.clearTimer()
    this.#audio?.silence()
    this.publish({ status: 'paused', position, activeEventIds: [] })
  }

  /** Invalidate pending starts and return to the beginning without touching the document. */
  stop(): void {
    ++this.#generation
    this.clearTimer()
    this.#audio?.silence()
    this.publish({
      status: 'stopped',
      position: 0,
      visit: null,
      activeEventIds: [],
      error: null,
    })
  }

  /** Change quarter-note BPM and reschedule outstanding sources at the current musical position. */
  setTempo(bpm: number): void {
    if (
      !Number.isInteger(bpm) ||
      bpm < 30 ||
      bpm > 240 ||
      bpm === this.#snapshot.bpm
    ) {
      return
    }
    const playing = this.#snapshot.status === 'playing'
    const position = playing ? this.position() : this.#snapshot.position
    this.#segments = this.#segments.filter((segment) => segment.beat < position)
    this.#segments.push({ beat: position, secondsPerBeat: 60 / bpm })
    this.publish({ bpm })
    if (playing) {
      try {
        this.restart(position)
      } catch (error) {
        this.stop()
        this.publish({
          status: 'error',
          error: error instanceof Error ? error.message : '速度调整失败。',
        })
      }
    }
  }

  /** Enable or disable viewport following independently from playback highlighting. */
  setFollow(follow: boolean): void {
    this.publish({ follow })
  }

  /** Cancel the owned scheduler before lifecycle transitions. */
  private clearTimer(): void {
    if (this.#timer !== undefined) {
      globalThis.clearInterval(this.#timer)
      this.#timer = undefined
    }
  }

  /** Release resources on unmount; subsequent mounting may lazily initialize a fresh backend. */
  dispose(): void {
    this.stop()
    this.#audio?.dispose()
    this.#audio = null
  }
}
