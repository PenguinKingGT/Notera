// @vitest-environment node
/** Exercise transport races and timing using a separately controlled audio clock and recorded attacks. */
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { pianoScore } from '../core/test-fixtures'
import { createPianoScore } from '../core'
import { PlaybackController } from './controller'
import type { PianoAudio, AudioAttack } from './controller'

/** Record per-occurrence source commands and expose clock movement independently of JavaScript timers. */
class FakeAudio implements PianoAudio {
  time = 0
  attacks: AudioAttack[] = []
  cancelled: AudioAttack[] = []
  disposed = false
  active = true
  prepare = vi.fn(async () => {})
  /** Supply the deterministic audio clock. */
  now() {
    return this.time
  }
  /** Model hardware suspension. */
  running() {
    return this.active
  }
  /** Record a uniquely owned attack. */
  schedule(attack: AudioAttack) {
    this.attacks.push(attack)
  }
  /** Cancel all queued attacks as well as currently sounding notes. */
  silence() {
    this.cancelled.push(...this.attacks)
    this.attacks = []
  }
  /** Track closure for async teardown assertions. */
  dispose() {
    this.silence()
    this.disposed = true
  }
}

let audio: FakeAudio
let playback: PlaybackController
beforeEach(() => {
  vi.useFakeTimers()
  audio = new FakeAudio()
  playback = new PlaybackController(async () => audio)
})
afterEach(() => {
  playback.dispose()
  vi.useRealTimers()
})

/** Advance audio and callback clocks together in bounded steps, reproducing an uninterrupted scheduler. */
function advance(seconds: number) {
  const count = Math.round(seconds / 0.025)
  for (let index = 0; index < count; index++) {
    audio.time += 0.025
    vi.advanceTimersByTime(25)
  }
}

test('schedules simultaneous attacks once and pauses/resumes held notes at the sample phase', async () => {
  const score = pianoScore()
  await playback.play(score)
  expect(audio.attacks).toHaveLength(5)
  expect(audio.attacks.every((attack) => attack.start === 0.04)).toBe(true)
  advance(0.5)
  expect(audio.attacks).toHaveLength(5)
  const position = playback.getSnapshot().position
  playback.pause()
  expect(audio.attacks).toEqual([])
  advance(1)
  expect(playback.getSnapshot().position).toBe(position)
  await playback.play(score)
  expect(audio.attacks).toHaveLength(5)
  expect(audio.attacks[0].offset).toBeCloseTo(0.46)
  playback.stop()
  advance(2)
  expect(audio.attacks).toEqual([])
  expect(playback.getSnapshot().position).toBe(0)
})

test('tempo change cancels old scheduling and retains earlier sample age', async () => {
  const score = pianoScore()
  await playback.play(score)
  advance(0.5)
  playback.setTempo(60)
  expect(playback.getSnapshot().bpm).toBe(60)
  expect(audio.attacks[0].offset).toBeCloseTo(0.46)
  const chord = audio.attacks.find(
    (attack) => attack.note.noteId === 'note-chord-c',
  )!
  expect(chord.end - chord.start).toBeCloseTo(0.58)
  advance(0.25)
  playback.pause()
  await playback.play(score)
  expect(audio.attacks[0].offset).toBeCloseTo(0.67)
})

test('stop during asynchronous initialization cannot resurrect transport', async () => {
  let resolve!: (value: PianoAudio) => void
  playback = new PlaybackController(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const pending = playback.play(pianoScore())
  playback.stop()
  resolve(audio)
  await pending
  expect(playback.getSnapshot().status).toBe('stopped')
  expect(audio.disposed).toBe(true)
  expect(audio.prepare).not.toHaveBeenCalled()
})

test('resource errors are recoverable, and empty music never initializes audio', async () => {
  await playback.play(createPianoScore({ id: 'empty' }))
  expect(playback.getSnapshot().error).toContain('没有可试听')
  expect(audio.prepare).not.toHaveBeenCalled()
  audio.prepare.mockRejectedValueOnce(new Error('decode failed'))
  await playback.play(pianoScore())
  expect(playback.getSnapshot().status).toBe('error')
  expect(audio.disposed).toBe(true)
  audio = new FakeAudio()
  await playback.play(pianoScore())
  expect(playback.getSnapshot().status).toBe('playing')
})

test('repeat visits and tied written events follow native identities; ending clears all sources', async () => {
  await playback.play(pianoScore())
  advance(2.1)
  expect(playback.getSnapshot().activeEventIds).toContain('event-tie-end')
  expect(playback.getSnapshot().visit?.index).toBe(1)
  advance(2)
  expect(playback.getSnapshot().visit).toMatchObject({ index: 0, pass: 2 })
  advance(4)
  expect(playback.getSnapshot().status).toBe('stopped')
  expect(audio.attacks).toEqual([])
})

test('suspension and timer stalls pause instead of emitting missed attacks in a burst', async () => {
  await playback.play(pianoScore())
  audio.active = false
  advance(0.025)
  expect(playback.getSnapshot().status).toBe('paused')
  expect(audio.attacks).toEqual([])
  audio.active = true
  await playback.play(pianoScore())
  audio.time += 1
  vi.advanceTimersByTime(25)
  expect(playback.getSnapshot().status).toBe('paused')
})
