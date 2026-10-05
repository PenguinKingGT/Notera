// @vitest-environment node
/** Verify rhythmic beam boundaries from independently stated meter and event examples. */
import { describe, expect, it } from 'vitest'
import { add, durationTime, fraction } from '../core'
import type { Fraction, Measure, MusicalEvent, NotatedDuration } from '../core'
import { beamGroups } from './beaming'

/** Create stable note/chord identities at an explicit exact onset. */
function note(
  id: string,
  onset: Fraction,
  duration: NotatedDuration = { denominator: 8, dots: 0 },
): MusicalEvent {
  return {
    id,
    kind: 'note',
    onset,
    duration,
    notes: [{ id: `${id}-note`, pitch: { step: 'C', alter: 0, octave: 4 } }],
  }
}

/** Construct a sequential voice for examples whose written values define their onsets. */
function sequence(durations: readonly NotatedDuration[]): MusicalEvent[] {
  let onset = fraction(0)
  return durations.map((duration, index) => {
    const event = note(`event-${index}`, onset, duration)
    onset = add(onset, durationTime(duration))
    return event
  })
}

describe('automatic beam groups', () => {
  it.each([
    [4, 4, 8, [2, 2, 2, 2]],
    [3, 4, 6, [2, 2, 2]],
    [6, 8, 6, [3, 3]],
    [9, 8, 9, [3, 3, 3]],
    [12, 8, 12, [3, 3, 3, 3]],
    [3, 8, 3, [3]],
    [2, 2, 8, [4, 4]],
    [5, 8, 5, [1, 1, 1, 1, 1]],
  ] as const)(
    'groups %i/%i without crossing beats',
    (beats, beatType, count, lengths) => {
      const events = sequence(
        Array.from({ length: count }, () => ({ denominator: 8, dots: 0 })),
      )
      expect(
        beamGroups(events, { beats, beatType }).map((group) => group.length),
      ).toEqual(lengths)
    },
  )

  it('keeps mixed levels and dotted rhythms within one beat', () => {
    const events = sequence([
      { denominator: 8, dots: 1 },
      { denominator: 16, dots: 0 },
      { denominator: 8, dots: 0 },
      { denominator: 16, dots: 0 },
      { denominator: 32, dots: 0 },
      { denominator: 32, dots: 0 },
    ])
    expect(
      beamGroups(events, { beats: 4, beatType: 4 }).map(
        (group) => group.length,
      ),
    ).toEqual([2, 4])
  })

  it('breaks at rests, gaps, long notes and notes that straddle a beat', () => {
    const events: MusicalEvent[] = [
      note('a', fraction(0)),
      {
        id: 'rest',
        kind: 'rest',
        onset: fraction(1, 8),
        duration: { denominator: 16, dots: 0 },
      },
      note('b', fraction(3, 16), { denominator: 16, dots: 0 }),
      note('c', fraction(1, 4), { denominator: 4, dots: 0 }),
      note('d', fraction(1, 2), { denominator: 16, dots: 0 }),
      note('e', fraction(11, 16)),
      note('f', fraction(13, 16), { denominator: 16, dots: 0 }),
      note('g', fraction(7, 8)),
    ]
    expect(
      beamGroups(events, { beats: 4, beatType: 4 }).map((group) =>
        group.map((event) => event.id),
      ),
    ).toEqual([['a'], ['rest'], ['b'], ['c'], ['d'], ['e'], ['f', 'g']])
  })

  it('groups exact triplets and separates changes in tuplet ratio', () => {
    const triplet: NotatedDuration = {
      denominator: 8,
      dots: 0,
      tuplet: { actual: 3, normal: 2 },
    }
    const events = sequence([
      triplet,
      triplet,
      triplet,
      { denominator: 8, dots: 0 },
      { denominator: 8, dots: 0 },
    ])
    expect(
      beamGroups(events, { beats: 4, beatType: 4 }).map(
        (group) => group.length,
      ),
    ).toEqual([3, 2])
    const ratios = sequence([
      { denominator: 16, dots: 0, tuplet: { actual: 3, normal: 2 } },
      { denominator: 16, dots: 0, tuplet: { actual: 5, normal: 4 } },
    ])
    expect(
      beamGroups(ratios, { beats: 4, beatType: 4 }).map(
        (group) => group.length,
      ),
    ).toEqual([1, 1])
  })

  it('preserves musical object identities and treats a chord as one rhythmic event', () => {
    const first = note('chord', fraction(0))
    if (first.kind !== 'note') {
      throw new Error('Expected note')
    }
    const chord: MusicalEvent = {
      ...first,
      notes: [
        ...first.notes,
        { id: 'upper-tone', pitch: { step: 'E', alter: 0, octave: 4 } },
      ],
    }
    const second = note('second', fraction(1, 8))
    const groups = beamGroups([chord, second], { beats: 4, beatType: 4 })
    expect(groups).toHaveLength(1)
    expect(groups[0][0]).toBe(chord)
    expect(groups[0][1]).toBe(second)
  })

  it('uses sixteenth-note pulses in a short 3/16 bar', () => {
    const events = sequence(
      Array.from({ length: 3 }, () => ({ denominator: 16, dots: 0 })),
    )
    const meter: Measure['timeSignature'] = { beats: 3, beatType: 16 }
    expect(beamGroups(events, meter).map((group) => group.length)).toEqual([3])
  })
})
