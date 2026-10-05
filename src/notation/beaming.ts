/** Derive automatic beam runs from exact music time, independent of SVG geometry and engine state. */
import { add, compare, durationTime } from '../core'
import type { Fraction, Measure, MusicalEvent } from '../core'

type Meter = Measure['timeSignature']

/** Use dotted beats in compound meters and one short triple beat for 3/8 or smaller units. */
function beatUnits(meter: Meter): number {
  if (
    (meter.beats >= 6 && meter.beats % 3 === 0) ||
    (meter.beats === 3 && meter.beatType >= 8)
  ) {
    return 3
  }
  return 1
}

/** Locate an onset's beam beat using integer arithmetic, including exact tuplet fractions. */
function beatIndex(time: Fraction, meter: Meter): bigint {
  return (
    (BigInt(time.numerator) * BigInt(meter.beatType)) /
    (BigInt(time.denominator) * BigInt(beatUnits(meter)))
  )
}

/** Check that a short note lies wholly within its onset beat; finishing exactly on its boundary is valid. */
function fitsBeat(event: MusicalEvent, meter: Meter): boolean {
  const boundaryNumerator =
    (beatIndex(event.onset, meter) + 1n) * BigInt(beatUnits(meter))
  const end = add(event.onset, durationTime(event.duration))
  return (
    BigInt(end.numerator) * BigInt(meter.beatType) <=
    boundaryNumerator * BigInt(end.denominator)
  )
}

/** Partition one already bounded voice/tuplet run; singleton entries remain flagged or unbeamed. */
export function beamGroups(
  events: readonly MusicalEvent[],
  meter: Meter,
): readonly (readonly MusicalEvent[])[] {
  const groups: MusicalEvent[][] = []
  let group: MusicalEvent[] = []
  for (const event of events) {
    const previous = group.at(-1)
    const shortNote =
      event.kind === 'note' &&
      event.duration.denominator >= 8 &&
      fitsBeat(event, meter)
    const sameRatio =
      previous?.duration.tuplet?.actual === event.duration.tuplet?.actual &&
      previous?.duration.tuplet?.normal === event.duration.tuplet?.normal
    const connected =
      previous?.kind === 'note' &&
      previous.duration.denominator >= 8 &&
      fitsBeat(previous, meter) &&
      sameRatio &&
      compare(
        add(previous.onset, durationTime(previous.duration)),
        event.onset,
      ) === 0 &&
      beatIndex(previous.onset, meter) === beatIndex(event.onset, meter)
    if (!shortNote || !connected) {
      group = []
      groups.push(group)
    }
    group.push(event)
  }
  return groups
}
