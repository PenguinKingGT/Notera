/** Project immutable musical events into numbered-note tokens, keeping exact time, identity and all voices. */
import {
  add,
  compare,
  durationTime,
  fraction,
  multiply,
  soundingPitch,
} from '../core'
import type { Fraction, Score, Measure, MusicalEvent } from '../core'
import { toJianpuPitch, tonicLabel } from './pitch'
import type { JianpuPitch } from './pitch'

/** A number, explicit rest or quarter-value continuation at one exact musical instant. */
export interface JianpuToken {
  readonly eventId: string
  readonly voiceId: string
  readonly onset: Fraction
  readonly pitches: readonly (JianpuPitch & { readonly noteId: string })[]
  readonly symbol: 'number' | 'rest' | 'dash'
  readonly underlines: number
  readonly dots: number
  readonly first: boolean
}

/** Tuplet brackets retain their native ratio even when only a partial input group exists. */
export interface JianpuTuplet {
  readonly voiceId: string
  readonly eventIds: readonly string[]
  readonly label: string
}

/** One bar provides shared columns for all voice rows; absent input never becomes an invented rest. */
export interface JianpuMeasure {
  readonly measure: Measure
  readonly index: number
  readonly context: string
  readonly tokens: readonly JianpuToken[]
  readonly tuplets: readonly JianpuTuplet[]
}

/** Return the exact key used to join independently constructed rational times. */
export function timeKey(time: Fraction): string {
  return `${time.numerator}/${time.denominator}`
}

/** Expand long values into quarter units; dots on the final unit preserve the complete written duration. */
function eventTokens(
  event: MusicalEvent,
  voiceId: string,
  fifths: number,
): JianpuToken[] {
  const pitches =
    event.kind === 'note'
      ? [...event.notes]
          .sort((a, b) => soundingPitch(b.pitch) - soundingPitch(a.pitch))
          .map((note) => ({
            ...toJianpuPitch(note.pitch, fifths),
            noteId: note.id,
          }))
      : []
  const units = durationTime({ ...event.duration, tuplet: undefined })
  const quarters = multiply(units, fraction(4))
  const long = event.duration.denominator < 4
  const count = long ? Math.floor(quarters.numerator / quarters.denominator) : 1
  const remainder =
    (quarters.numerator % quarters.denominator) / quarters.denominator
  const finalDots =
    long && remainder > 0 ? Math.round(-Math.log2(1 - remainder)) : 0
  const scale = event.duration.tuplet
    ? fraction(event.duration.tuplet.normal, event.duration.tuplet.actual)
    : fraction(1)
  return Array.from({ length: count }, (_, index) => ({
    eventId: event.id,
    voiceId,
    onset: add(event.onset, multiply(fraction(index, 4), scale)),
    pitches,
    symbol: event.kind === 'rest' ? 'rest' : index === 0 ? 'number' : 'dash',
    underlines: Math.max(0, Math.log2(event.duration.denominator) - 2),
    dots: long ? (index === count - 1 ? finalDots : 0) : event.duration.dots,
    first: index === 0,
  }))
}

/** Infer bounded contiguous tuplet groups exactly as the current native model permits; do not join gaps. */
function tuplets(
  events: readonly MusicalEvent[],
  voiceId: string,
): JianpuTuplet[] {
  const groups: JianpuTuplet[] = []
  for (let index = 0; index < events.length; index++) {
    const first = events[index]
    const ratio = first.duration.tuplet
    if (!ratio) {
      continue
    }
    const ids = [first.id]
    let last = first
    while (ids.length < ratio.actual && index + 1 < events.length) {
      const next = events[index + 1]
      if (
        next.duration.tuplet?.actual !== ratio.actual ||
        next.duration.tuplet.normal !== ratio.normal ||
        compare(add(last.onset, durationTime(last.duration)), next.onset) !== 0
      ) {
        break
      }
      ids.push(next.id)
      last = next
      index++
    }
    groups.push({
      voiceId,
      eventIds: ids,
      label:
        ratio.normal === 2 && ratio.actual === 3
          ? '3'
          : `${ratio.actual}:${ratio.normal}`,
    })
  }
  return groups
}

/** Produce all bars without mutating music or serialization; key and meter context follows each measure. */
export function projectJianpu(score: Score): JianpuMeasure[] {
  return score.measures.map((measure, index) => ({
    measure,
    index,
    context: `1=${tonicLabel(measure.keySignature.fifths)} · ${measure.timeSignature.beats}/${measure.timeSignature.beatType}`,
    tokens: measure.voices.flatMap((lane) =>
      lane.events.flatMap((event) =>
        eventTokens(event, lane.voiceId, measure.keySignature.fifths),
      ),
    ),
    tuplets: measure.voices.flatMap((lane) =>
      tuplets(lane.events, lane.voiceId),
    ),
  }))
}
