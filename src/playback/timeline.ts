/** Compile exact musical time into bounded piano performance occurrences, independent of audio and layout. */
import {
  add,
  compare,
  durationTime,
  fraction,
  parseScore,
  soundingPitch,
  subtract,
} from '../core'
import type { Fraction, Score } from '../core'

/** One attack, possibly sustained by ties/pedal; repeated occurrences remain independently addressable. */
export interface PerformanceNote {
  readonly occurrenceId: string
  readonly noteId: string
  readonly pitch: number
  readonly velocity: number
  readonly start: Fraction
  readonly keyEnd: Fraction
  readonly end: Fraction
  readonly staffId: string
}

/** All musical events, including rests, retain written durations for playhead highlighting. */
export interface PerformanceEvent {
  readonly eventId: string
  readonly start: Fraction
  readonly end: Fraction
}

/** One performed visit to a source measure, including repeat passes and silent gaps. */
export interface MeasureVisit {
  readonly measureId: string
  readonly index: number
  readonly pass: number
  readonly beatType: number
  readonly start: Fraction
  readonly end: Fraction
}

/** Tempo-free score projection; seconds are derived only at the audio boundary. */
export interface Performance {
  readonly notes: readonly PerformanceNote[]
  readonly events: readonly PerformanceEvent[]
  readonly visits: readonly MeasureVisit[]
  readonly duration: Fraction
}

const VELOCITIES = {
  ppp: 0.18,
  pp: 0.27,
  p: 0.38,
  mp: 0.5,
  mf: 0.65,
  f: 0.78,
  ff: 0.9,
  fff: 1,
} as const
const MAX_VISITS = 20_000
const MAX_NOTES = 200_000

/** Convert whole-note fractions into quarter beats without introducing rounding into musical compilation. */
export function quarterBeats(time: Fraction): number {
  return (4 * time.numerator) / time.denominator
}

/** Find the last mark at or before exact musical time without scanning every preceding mark. */
function markAt<T extends { time: Fraction }>(
  marks: readonly T[],
  time: Fraction,
): T | undefined {
  let low = 0
  let high = marks.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (compare(marks[middle].time, time) <= 0) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return marks[low - 1]
}

/** Compile supported repeats, staff dynamics, per-note ties and pedal release times without mutating the native score. */
export function compilePerformance(input: Score): Performance {
  const score = parseScore(input)
  const measureIndices = new Map(
    score.measures.map((measure, index) => [measure.id, index]),
  )
  const staffByVoice = new Map(
    score.voices.map((voice) => [voice.id, voice.staffId]),
  )
  const offsets: Fraction[] = []
  const locations = new Map<string, { time: Fraction; staff: string }>()
  let sourceEnd = fraction(0)
  for (const measure of score.measures) {
    offsets.push(sourceEnd)
    for (const lane of measure.voices) {
      for (const event of lane.events) {
        locations.set(event.id, {
          time: add(sourceEnd, event.onset),
          staff: staffByVoice.get(lane.voiceId)!,
        })
      }
    }
    sourceEnd = add(
      sourceEnd,
      fraction(measure.timeSignature.beats, measure.timeSignature.beatType),
    )
  }
  const dynamicChanges = score.marks
    .filter((mark) => mark.kind === 'dynamic')
    .map((mark) => ({
      ...locations.get(mark.eventId)!,
      velocity: VELOCITIES[mark.value],
    }))
    .sort((a, b) => compare(a.time, b.time))
  const dynamicsByStaff = new Map(
    score.staves.map((staff) => [
      staff.id,
      dynamicChanges.filter((change) => change.staff === staff.id),
    ]),
  )
  const pedals = score.marks
    .filter((mark) => mark.kind === 'pedal')
    .map((mark) => ({
      start: locations.get(mark.startEventId)!.time,
      end: locations.get(mark.endEventId)!.time,
      staff: locations.get(mark.startEventId)!.staff,
    }))
  const tieFrom = new Map(
    score.marks
      .filter((mark) => mark.kind === 'tie')
      .map((mark) => [mark.startNoteId, mark.endNoteId]),
  )
  const repeats = new Map(
    score.marks
      .filter((mark) => mark.kind === 'repeat')
      .map((mark) => [
        measureIndices.get(mark.startMeasureId)!,
        { end: measureIndices.get(mark.endMeasureId)!, times: mark.times },
      ]),
  )
  const order: { index: number; pass: number }[] = []
  for (let index = 0; index < score.measures.length; index++) {
    const repeat = repeats.get(index)
    if (repeat) {
      for (let pass = 1; pass <= repeat.times; pass++) {
        for (let source = index; source <= repeat.end; source++) {
          if (order.length >= MAX_VISITS) {
            throw new Error('反复展开后超过 20,000 小节，暂时无法试听。')
          }
          order.push({ index: source, pass })
        }
      }
      index = repeat.end
    } else {
      order.push({ index, pass: 1 })
    }
    if (order.length > MAX_VISITS) {
      throw new Error('反复展开后超过 20,000 小节，暂时无法试听。')
    }
  }

  const notes: {
    occurrenceId: string
    noteId: string
    pitch: number
    velocity: number
    start: Fraction
    keyEnd: Fraction
    end: Fraction
    staffId: string
  }[] = []
  const events: PerformanceEvent[] = []
  const visits: MeasureVisit[] = []
  const pedalOccurrences: { start: Fraction; end: Fraction; staff: string }[] =
    []
  const pendingTies = new Map<string, (typeof notes)[number]>()
  let position = fraction(0)
  let blockStart = 0

  /** Project pedal intervals into a contiguous performed run, clipping at repeat jumps to prevent hanging sustain. */
  function finishBlock(end: number): void {
    const first = visits[blockStart]
    const last = visits[end]
    const sourceStart = offsets[first.index]
    const sourceStop = add(offsets[last.index], subtract(last.end, last.start))
    for (const pedal of pedals) {
      const start =
        compare(pedal.start, sourceStart) < 0 ? sourceStart : pedal.start
      const stop = compare(pedal.end, sourceStop) > 0 ? sourceStop : pedal.end
      if (compare(start, stop) < 0) {
        if (pedalOccurrences.length >= MAX_NOTES) {
          throw new Error('反复展开后超过 200,000 个踏板区间，暂时无法试听。')
        }
        pedalOccurrences.push({
          start: add(first.start, subtract(start, sourceStart)),
          end: add(first.start, subtract(stop, sourceStart)),
          staff: pedal.staff,
        })
      }
    }
  }

  for (const [occurrence, entry] of order.entries()) {
    if (occurrence && entry.index !== order[occurrence - 1].index + 1) {
      finishBlock(occurrence - 1)
      blockStart = occurrence
      pendingTies.clear()
    }
    const measure = score.measures[entry.index]
    const length = fraction(
      measure.timeSignature.beats,
      measure.timeSignature.beatType,
    )
    visits.push({
      measureId: measure.id,
      index: entry.index,
      pass: entry.pass,
      beatType: measure.timeSignature.beatType,
      start: position,
      end: add(position, length),
    })
    for (const lane of measure.voices) {
      const staff = staffByVoice.get(lane.voiceId)!
      for (const event of lane.events) {
        const start = add(position, event.onset)
        const end = add(start, durationTime(event.duration))
        if (events.length >= MAX_NOTES) {
          throw new Error('反复展开后超过 200,000 个音乐事件，暂时无法试听。')
        }
        events.push({ eventId: event.id, start, end })
        if (event.kind === 'rest') {
          continue
        }
        const writtenTime = add(offsets[entry.index], event.onset)
        const velocity =
          markAt(dynamicsByStaff.get(staff)!, writtenTime)?.velocity ??
          VELOCITIES.mf
        for (const note of event.notes) {
          const pitch = soundingPitch(note.pitch)
          if (pitch < 21 || pitch > 108) {
            throw new Error(
              '钢琴试听支持 A0–C8；当前谱中有超出钢琴音域的音符。',
            )
          }
          const previous = pendingTies.get(note.id)
          let performed = previous
          if (previous && compare(previous.keyEnd, start) === 0) {
            previous.keyEnd = end
            previous.end = end
          } else {
            performed = {
              occurrenceId: `${occurrence}:${note.id}`,
              noteId: note.id,
              pitch,
              velocity,
              start,
              keyEnd: end,
              end,
              staffId: staff,
            }
            notes.push(performed)
            if (notes.length > MAX_NOTES) {
              throw new Error('反复展开后超过 200,000 次发音，暂时无法试听。')
            }
          }
          pendingTies.delete(note.id)
          const next = tieFrom.get(note.id)
          if (next) {
            pendingTies.set(next, performed!)
          }
        }
      }
    }
    position = add(position, length)
  }
  finishBlock(visits.length - 1)
  // The prefix's farthest release is the only pedal interval that can extend a key release.
  // Expired intervals have ends <= keyEnd and cannot sustain it. This avoids notes × pedals scans.
  const pedalEndsByStaff = new Map<
    string,
    { time: Fraction; end: Fraction }[]
  >()
  for (const staff of score.staves) {
    const intervals = pedalOccurrences
      .filter((pedal) => pedal.staff === staff.id)
      .sort((a, b) => compare(a.start, b.start))
    let end = fraction(0)
    pedalEndsByStaff.set(
      staff.id,
      intervals.map((pedal) => {
        if (compare(pedal.end, end) > 0) {
          end = pedal.end
        }
        return { time: pedal.start, end }
      }),
    )
  }
  for (const note of notes) {
    const pedal = markAt(pedalEndsByStaff.get(note.staffId)!, note.keyEnd)
    // Query the original key release once, so adjacent ranges never chain a held note indefinitely.
    if (pedal && compare(pedal.end, note.end) > 0) {
      note.end = pedal.end
    }
  }
  notes.sort((a, b) => compare(a.start, b.start))
  events.sort((a, b) => compare(a.start, b.start))
  return { notes, events, visits, duration: position }
}
