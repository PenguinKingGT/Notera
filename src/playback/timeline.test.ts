// @vitest-environment node
/** Verify performed timing against hand-authored musical expectations, rather than against engraving output. */
import { expect, test } from 'vitest'
import {
  pianoScore,
  fixtureEvent,
  withFixtureEvent,
} from '../core/test-fixtures'
import { createPianoScore, fraction } from '../core'
import { compilePerformance, quarterBeats } from './timeline'

test('compiles simultaneous voices, exact triplets, staff dynamics, ties and two repeat passes', () => {
  const score = pianoScore()
  const before = JSON.stringify(score)
  const performance = compilePerformance(score)
  expect(performance.duration).toEqual(fraction(4))
  expect(
    performance.visits.map((visit) => [
      visit.index,
      visit.pass,
      quarterBeats(visit.start),
    ]),
  ).toEqual([
    [0, 1, 0],
    [1, 1, 4],
    [0, 2, 8],
    [1, 2, 12],
  ])
  expect(performance.notes).toHaveLength(22)
  expect(
    performance.notes
      .filter((note) => quarterBeats(note.start) === 0)
      .map((note) => [note.pitch, note.velocity, quarterBeats(note.end)]),
  ).toEqual([
    [72, 0.38, 1.5],
    [79, 0.38, 1.5],
    [64, 0.38, 4],
    [48, 0.65, 2],
    [55, 0.65, 2],
  ])
  const triplets = performance.notes
    .filter((note) => note.noteId.startsWith('note-triplet'))
    .slice(0, 3)
  expect(triplets.map((note) => note.start)).toEqual([
    fraction(3, 8),
    fraction(11, 24),
    fraction(13, 24),
  ])
  expect(
    performance.notes
      .filter((note) => note.noteId === 'note-tie-start')
      .map((note) => [quarterBeats(note.start), quarterBeats(note.end)]),
  ).toEqual([
    [3, 5],
    [11, 13],
  ])
  expect(performance.notes.some((note) => note.noteId === 'note-tie-end')).toBe(
    false,
  )
  expect(
    performance.events
      .filter((event) => event.eventId === 'event-tie-end')
      .map((event) => quarterBeats(event.start)),
  ).toEqual([4, 12])
  expect(JSON.stringify(score)).toBe(before)
})

test('pedal sustains to release but not across a repeat jump, and applies to the whole staff', () => {
  const score = pianoScore()
  const pedal = {
    id: 'upper-pedal',
    kind: 'pedal' as const,
    startEventId: 'event-chord',
    endEventId: 'event-inner-2',
  }
  const performance = compilePerformance({
    ...score,
    marks: [...score.marks.filter((mark) => mark.kind !== 'pedal'), pedal],
  })
  const chords = performance.notes.filter(
    (note) => note.noteId === 'note-chord-c',
  )
  expect(
    chords.map((note) => [quarterBeats(note.keyEnd), quarterBeats(note.end)]),
  ).toEqual([
    [1.5, 4],
    [9.5, 12],
  ])
  expect(
    performance.notes.find((note) => note.noteId === 'note-lower-c')!.end,
  ).toEqual(fraction(1, 2))
})

test('same pitches in different voices remain separate attacks', () => {
  const score = pianoScore()
  const event = fixtureEvent(score, 'event-inner-1')
  if (event.kind !== 'note') {
    throw new Error('Expected pitched fixture')
  }
  const performance = compilePerformance(
    withFixtureEvent(score, event.id, {
      ...event,
      notes: [{ ...event.notes[0], pitch: { step: 'C', alter: 0, octave: 5 } }],
    }),
  )
  expect(
    performance.notes.filter(
      (note) => note.pitch === 72 && quarterBeats(note.start) === 0,
    ),
  ).toHaveLength(2)
})

test('empty bars retain their duration, and unsupported piano pitches fail explicitly', () => {
  const empty = compilePerformance(
    createPianoScore({ id: 'empty', measureCount: 3 }),
  )
  expect(empty.notes).toEqual([])
  expect(quarterBeats(empty.duration)).toBe(12)
  const score = pianoScore()
  const event = fixtureEvent(score, 'event-inner-1')
  if (event.kind !== 'note') {
    throw new Error('Expected pitched fixture')
  }
  expect(() =>
    compilePerformance(
      withFixtureEvent(score, event.id, {
        ...event,
        notes: [
          { ...event.notes[0], pitch: { step: 'C', alter: 0, octave: 0 } },
        ],
      }),
    ),
  ).toThrow('A0–C8')
})

test('a repeat ending before a pedal/tie endpoint clips the first pass and reconnects the final pass', () => {
  const score = pianoScore()
  const performance = compilePerformance({
    ...score,
    marks: [
      ...score.marks.filter(
        (mark) => mark.kind !== 'repeat' && mark.kind !== 'pedal',
      ),
      {
        id: 'short-repeat',
        kind: 'repeat',
        startMeasureId: 'measure-1',
        endMeasureId: 'measure-1',
        times: 2,
      },
      {
        id: 'long-pedal',
        kind: 'pedal',
        startEventId: 'event-chord',
        endEventId: 'event-inner-2',
      },
    ],
  })
  expect(
    performance.notes
      .filter((note) => note.noteId === 'note-chord-c')
      .map((note) => quarterBeats(note.end)),
  ).toEqual([4, 8])
  expect(
    performance.notes
      .filter((note) => note.noteId === 'note-tie-start')
      .map((note) => [quarterBeats(note.start), quarterBeats(note.keyEnd)]),
  ).toEqual([
    [3, 4],
    [7, 9],
  ])
  expect(quarterBeats(performance.duration)).toBe(12)
})
