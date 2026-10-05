// @vitest-environment node
/** Verify independently expected numbered pitches, exact rhythms, all-voice alignment and complete vector pagination. */
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import {
  createPianoScore,
  deserializeScore,
  fraction,
  parseScore,
} from '../core'
import type { Score, MusicalEvent } from '../core'
import { toJianpuPitch, tonicLabel } from './pitch'
import { projectJianpu } from './projection'
import { columnX, layoutJianpu } from './layout'
import { engraveJianpu } from './svg'

const original = deserializeScore(
  readFileSync('tests/fixtures/piano-core.notera.json', 'utf8'),
)

/** Build a valid one-voice rhythmic example without any implicit musical content. */
function withEvent(event: MusicalEvent): Score {
  const score = createPianoScore({ id: 'jianpu-example' })
  return parseScore({
    ...score,
    measures: [
      {
        ...score.measures[0],
        timeSignature: { beats: 8, beatType: 4 },
        voices: [{ voiceId: score.voices[0].id, events: [event] }],
      },
    ],
  })
}

test('key-relative degrees preserve accidental spelling, octave boundaries and all fifteen signatures', () => {
  expect(
    Array.from({ length: 15 }, (_, index) => tonicLabel(index - 7)),
  ).toEqual([
    'C♭',
    'G♭',
    'D♭',
    'A♭',
    'E♭',
    'B♭',
    'F',
    'C',
    'G',
    'D',
    'A',
    'E',
    'B',
    'F♯',
    'C♯',
  ])
  expect(toJianpuPitch({ step: 'C', alter: 0, octave: 4 }, 0)).toEqual({
    degree: 1,
    octave: 0,
    accidental: '',
  })
  expect(toJianpuPitch({ step: 'B', alter: 0, octave: 3 }, 0)).toEqual({
    degree: 7,
    octave: -1,
    accidental: '',
  })
  expect(toJianpuPitch({ step: 'C', alter: 0, octave: 5 }, 0)).toEqual({
    degree: 1,
    octave: 1,
    accidental: '',
  })
  expect(toJianpuPitch({ step: 'F', alter: 1, octave: 4 }, 1)).toEqual({
    degree: 7,
    octave: -1,
    accidental: '',
  })
  expect(toJianpuPitch({ step: 'F', alter: 0, octave: 4 }, 1)).toEqual({
    degree: 7,
    octave: -1,
    accidental: '♭',
  })
  expect(toJianpuPitch({ step: 'B', alter: -1, octave: 4 }, -1)).toEqual({
    degree: 4,
    octave: 0,
    accidental: '',
  })
  expect(toJianpuPitch({ step: 'B', alter: 0, octave: 4 }, -1)).toEqual({
    degree: 4,
    octave: 0,
    accidental: '♯',
  })
  expect(toJianpuPitch({ step: 'F', alter: -2, octave: 4 }, 1).accidental).toBe(
    '♭♭♭',
  )
  expect(toJianpuPitch({ step: 'C', alter: -1, octave: 4 }, -7)).toEqual({
    degree: 1,
    octave: 0,
    accidental: '',
  })
})

test('long notes use quarter continuations, long rests repeat zero and remaining dots retain the exact written value', () => {
  const event: MusicalEvent = {
    id: 'long-note',
    kind: 'note',
    onset: fraction(0),
    duration: { denominator: 2, dots: 2 },
    notes: [{ id: 'long-pitch', pitch: { step: 'C', alter: 0, octave: 4 } }],
  }
  const tokens = projectJianpu(withEvent(event))[0].tokens
  expect(
    tokens.map((token) => [token.symbol, token.onset, token.dots]),
  ).toEqual([
    ['number', fraction(0), 0],
    ['dash', fraction(1, 4), 0],
    ['dash', fraction(1, 2), 1],
  ])
  const rests = projectJianpu(
    withEvent({
      id: 'long-rest',
      kind: 'rest',
      onset: fraction(0),
      duration: { denominator: 1, dots: 0 },
    }),
  )[0].tokens
  expect(rests.map((token) => token.symbol)).toEqual([
    'rest',
    'rest',
    'rest',
    'rest',
  ])
  expect(rests.map((token) => token.onset)).toEqual([
    fraction(0),
    fraction(1, 4),
    fraction(1, 2),
    fraction(3, 4),
  ])
  const tripleDotted = projectJianpu(
    withEvent({ ...event, duration: { denominator: 2, dots: 3 } }),
  )[0].tokens
  expect(tripleDotted.at(-1)?.dots).toBe(2)
})

test('short values, triplet times and chord ordering are explicit without invented rests', () => {
  const projected = projectJianpu(original)
  const first = projected[0]
  expect(first.tuplets).toEqual([
    {
      voiceId: 'voice-upper',
      eventIds: ['event-triplet-1', 'event-triplet-2', 'event-triplet-3'],
      label: '3',
    },
  ])
  expect(
    first.tokens.find((token) => token.eventId === 'event-triplet-2')?.onset,
  ).toEqual(fraction(11, 24))
  expect(
    first.tokens.find((token) => token.eventId === 'event-triplet-1')
      ?.underlines,
  ).toBe(1)
  const chord = first.tokens.find((token) => token.eventId === 'event-chord')!
  expect(chord.pitches.map((pitch) => pitch.degree)).toEqual([5, 1])
  const empty = projectJianpu(createPianoScore({ id: 'empty' }))
  expect(empty.flatMap((bar) => bar.tokens)).toEqual([])
})

test('simultaneous events share exact columns while staves and voices remain separate rows', () => {
  const layout = layoutJianpu(original)
  const system = layout.pages[0][0]
  expect(system.rows.map((row) => row.label)).toEqual([
    '右手 1',
    '右手 2',
    '左手',
  ])
  const { segment, x } = system.segments[0]
  const onsets = segment.bar.tokens.filter(
    (token) => token.first && token.onset.numerator === 0,
  )
  expect(onsets.map(() => x + columnX(segment, 0))).toEqual([
    x + columnX(segment, 0),
    x + columnX(segment, 0),
    x + columnX(segment, 0),
  ])
  expect(engraveJianpu(original).pages.join('')).toContain('data-tuplet="3"')
})

test('chord bottoms, single notes and rests share a baseline without expanding empty hands', () => {
  const base = createPianoScore({ id: 'baseline' })
  const score = parseScore({
    ...base,
    measures: [
      {
        ...base.measures[0],
        voices: [
          {
            voiceId: base.voices[0].id,
            events: [
              {
                id: 'stack',
                kind: 'note',
                onset: fraction(0),
                duration: { denominator: 4, dots: 0 },
                notes: [
                  {
                    id: 'stack-low',
                    pitch: { step: 'C', alter: 0, octave: 4 },
                  },
                  {
                    id: 'stack-high',
                    pitch: { step: 'G', alter: 0, octave: 6 },
                  },
                ],
              },
              {
                id: 'single',
                kind: 'note',
                onset: fraction(1, 4),
                duration: { denominator: 4, dots: 0 },
                notes: [
                  {
                    id: 'single-high',
                    pitch: { step: 'B', alter: 0, octave: 5 },
                  },
                ],
              },
              {
                id: 'explicit-rest',
                kind: 'rest',
                onset: fraction(1, 2),
                duration: { denominator: 4, dots: 0 },
              },
            ],
          },
        ],
      },
    ],
  })
  const svg = engraveJianpu(score).pages[0]
  const low = Number(
    svg.match(/data-note-id="stack-low"[^>]*><text x="[^"]*" y="([^"]*)"/)![1],
  )
  const high = Number(
    svg.match(/data-note-id="stack-high"[^>]*><text x="[^"]*" y="([^"]*)"/)![1],
  )
  const single = Number(
    svg.match(
      /data-note-id="single-high"[^>]*><text x="[^"]*" y="([^"]*)"/,
    )![1],
  )
  const rest = Number(
    svg.match(
      /data-event-id="explicit-rest"[^>]*><text x="[^"]*" y="([^"]*)"/,
    )![1],
  )
  expect(low).toBe(single)
  expect(rest).toBe(single)
  expect(high).toBeLessThanOrEqual(low - 28)
  const empty = layoutJianpu(base).pages[0][0]
  expect(empty.rows[1].baseline - empty.rows[0].baseline).toBeLessThan(110)
})

test('pages preserve every event and note identity, marks, key changes and escaped document text', () => {
  const before = JSON.stringify(original)
  const svg = engraveJianpu(original).pages.join('')
  for (const measure of original.measures) {
    for (const lane of measure.voices) {
      for (const event of lane.events) {
        expect(svg).toContain(`data-event-id="${event.id}"`)
        if (event.kind === 'note') {
          for (const note of event.notes) {
            expect(svg).toContain(`data-note-id="${note.id}"`)
          }
        }
      }
    }
  }
  for (const mark of original.marks.filter((mark) => mark.kind !== 'repeat')) {
    expect(svg).toContain(`data-mark-id="${mark.id}"`)
  }
  expect(svg).toContain('2×')
  expect(JSON.stringify(original)).toBe(before)
  const changed = parseScore({
    ...original,
    measures: original.measures.map((measure, index) => ({
      ...measure,
      keySignature: { fifths: index ? -1 : 0 },
    })),
  })
  expect(engraveJianpu(changed).pages.join('')).toContain('1=F')
})

test('dense measures continue automatically and every sixty-fourth note remains visible once', () => {
  const score = createPianoScore({ id: 'dense' })
  const music = parseScore({
    ...score,
    measures: [
      {
        ...score.measures[0],
        voices: [
          {
            voiceId: score.voices[0].id,
            events: Array.from({ length: 64 }, (_, index) => ({
              id: `dense-${index}`,
              kind: 'note',
              onset: fraction(index, 64),
              duration: { denominator: 64, dots: 0 },
              notes: [
                {
                  id: `dense-pitch-${index}`,
                  pitch: { step: 'C', alter: 0, octave: 4 },
                },
              ],
            })),
          },
        ],
      },
    ],
  })
  const layout = layoutJianpu(music)
  expect(layout.pages.flat().length).toBeGreaterThan(1)
  expect(layout.pages.flat()[1].segments[0].segment.continuation).toBe(true)
  const svg = engraveJianpu(music).pages.join('')
  expect([...svg.matchAll(/data-first="true"/g)].length).toBe(64)
  expect(svg).toContain('（续）')
  expect(svg).toContain('data-underlines="4"')
})

test('long scores independently paginate and ranged marks continue across every intervening page', () => {
  const base = createPianoScore({ id: 'long-score' })
  const measures = Array.from({ length: 32 }, (_, index) => ({
    ...base.measures[0],
    id: `bar-${index}`,
    voices: [
      {
        voiceId: base.voices[0].id,
        events: [
          {
            id: `event-${index}`,
            kind: 'note' as const,
            onset: fraction(0),
            duration: { denominator: 1 as const, dots: 0 },
            notes: [
              {
                id: `pitch-${index}`,
                pitch: { step: 'C' as const, alter: 0, octave: 4 },
              },
            ],
          },
        ],
      },
    ],
  }))
  const score = parseScore({
    ...base,
    measures,
    marks: [
      {
        id: 'across-pages',
        kind: 'slur',
        startEventId: 'event-0',
        endEventId: 'event-31',
      },
    ],
  })
  const result = engraveJianpu(score)
  expect(result.pages.length).toBeGreaterThan(1)
  for (const page of result.pages) {
    expect(page).toContain('data-mark-id="across-pages"')
  }
  expect([...result.pages.join('').matchAll(/data-first="true"/g)].length).toBe(
    32,
  )
})

test('four-note chord ties and an overlapping slur reserve separate annotation layers', () => {
  const base = createPianoScore({ id: 'chord-ties' })
  const events = Array.from({ length: 2 }, (_, index) => ({
    id: `tied-event-${index}`,
    kind: 'note' as const,
    onset: fraction(index, 4),
    duration: { denominator: 4 as const, dots: 0 },
    notes: (['C', 'E', 'G', 'B'] as const).map((step) => ({
      id: `tied-${step}-${index}`,
      pitch: { step, alter: 0, octave: 4 },
    })),
  }))
  const score = parseScore({
    ...base,
    measures: [
      { ...base.measures[0], voices: [{ voiceId: base.voices[0].id, events }] },
    ],
    marks: [
      ...(['C', 'E', 'G', 'B'] as const).map((step) => ({
        id: `tie-${step}`,
        kind: 'tie' as const,
        startNoteId: `tied-${step}-0`,
        endNoteId: `tied-${step}-1`,
      })),
      {
        id: 'slur-chord',
        kind: 'slur',
        startEventId: 'tied-event-0',
        endEventId: 'tied-event-1',
      },
    ],
  })
  expect(layoutJianpu(score).pages[0][0].rows[0].curveLayers).toBe(5)
  const svg = engraveJianpu(score).pages.join('')
  expect([...svg.matchAll(/data-mark-kind="tie"/g)].length).toBe(4)
  expect(svg).toContain('data-mark-id="slur-chord"')
})

test('print layout suppresses repeated context, retains changes and draws complete piano brackets', () => {
  const base = createPianoScore({ id: 'print-context' })
  const score = parseScore({
    ...base,
    measures: Array.from({ length: 8 }, (_, index) => ({
      ...base.measures[0],
      id: `context-bar-${index}`,
      keySignature: { fifths: index < 5 ? 0 : -1 },
      voices: [],
    })),
  })
  const svg = engraveJianpu(score).pages.join('')
  expect([...svg.matchAll(/data-context="true"/g)]).toHaveLength(2)
  expect(svg).toContain('1=C')
  expect(svg).toContain('1=F')
  const systems = layoutJianpu(score).pages.flat()
  const brackets = [
    ...svg.matchAll(
      /data-piano-bracket="true" d="M 23 ([\d.]+) H 17 V ([\d.]+) H 23"/g,
    ),
  ]
  expect(brackets).toHaveLength(systems.length)
  for (const bracket of brackets) {
    expect(Number(bracket[2]) - Number(bracket[1])).toBeGreaterThan(50)
  }
  const fullLine = systems[0]
  const end = fullLine.segments.at(-1)!
  expect(end.x + end.segment.width).toBeCloseTo(876)
})

test('eighth-note rhythm joins stop at beat boundaries and never bridge unentered gaps', () => {
  const base = createPianoScore({ id: 'rhythm-groups' })
  const score = parseScore({
    ...base,
    measures: [
      {
        ...base.measures[0],
        voices: [
          {
            voiceId: base.voices[0].id,
            events: [0, 1, 2, 3, 5, 7].map((beat) => ({
              id: `short-${beat}`,
              kind: 'note',
              onset: fraction(beat, 8),
              duration: { denominator: 8, dots: 0 },
              notes: [
                {
                  id: `short-pitch-${beat}`,
                  pitch: { step: 'C', alter: 0, octave: 4 },
                },
              ],
            })),
          },
        ],
      },
    ],
  })
  const svg = engraveJianpu(score).pages.join('')
  expect([...svg.matchAll(/data-rhythm-join="true"/g)]).toHaveLength(2)
  expect([...svg.matchAll(/data-first="true"/g)]).toHaveLength(6)
})
