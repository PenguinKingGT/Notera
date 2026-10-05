// @vitest-environment node
/** Real piano-domain failures: timing, identities, voice ownership and spanning mark references. */
import { describe, expect, it } from 'vitest'
import pianoFixture from '../../tests/fixtures/piano-core.notera.json'
import {
  applyScoreCommand,
  createPianoScore,
  fraction,
  parseScore,
  ScoreValidationError,
} from './index'
import { fixtureEvent, pianoScore, withFixtureEvent } from './test-fixtures'

describe('musical snapshot validation', () => {
  it('detaches parsed music from later changes to the input data', () => {
    const input = structuredClone(pianoFixture.score)
    const score = parseScore(input)
    input.title = 'Changed outside the editor'
    input.measures[0].voices[0].events[0].duration.dots = 0
    expect(score.title).toBe('Original core piano fixture')
    expect(fixtureEvent(score, 'event-chord').duration.dots).toBe(1)
  })

  it('creates valid piano documents even when the score ID resembles a child identity', () => {
    for (const id of ['staff-upper', 'voice-lower', 'measure-1']) {
      const score = createPianoScore({ id })
      expect(parseScore(score)).toEqual(score)
      expect(score.measures[0].voices[1].voiceId).toBe(score.voices[1].id)
    }
  })
  it('loads piano chords, three voices, triplets and a cross-measure tie without DOM', () => {
    const score = pianoScore()
    expect(typeof globalThis.document).toBe('undefined')
    expect(score.staves).toHaveLength(2)
    expect(score.voices).toHaveLength(3)
    expect(score.marks.map((mark) => mark.kind)).toEqual([
      'tie',
      'slur',
      'dynamic',
      'pedal',
      'repeat',
    ])
    expect(Object.isFrozen(score)).toBe(true)
    expect(
      Object.isFrozen(score.measures[0].voices[0].events[0].duration),
    ).toBe(true)
    const chord = fixtureEvent(score, 'event-chord')
    if (chord.kind !== 'note') {
      throw new Error('Expected fixture chord')
    }
    expect(Object.isFrozen(chord.notes[0].pitch)).toBe(true)
  })

  it('allows partial entry with gaps while keeping events inside the measure', () => {
    const score = createPianoScore({ id: 'empty-piano' })
    const next = applyScoreCommand(score, {
      kind: 'insert-event',
      target: { measureId: 'measure-1', voiceId: 'voice-upper' },
      event: {
        id: 'rest-partial',
        kind: 'rest',
        onset: fraction(1, 2),
        duration: { denominator: 4, dots: 0 },
      },
    })
    expect(next.measures[0].voices[0].events).toHaveLength(1)
    expect(score.measures[0].voices[0].events).toHaveLength(0)
  })

  it('rejects unknown fields instead of dropping unsupported content', () => {
    expect(() => parseScore({ ...pianoScore(), layout: { x: 20 } })).toThrow(
      ScoreValidationError,
    )
  })

  it('rejects identities duplicated across different entity kinds', () => {
    const score = pianoScore()
    expect(() =>
      parseScore({
        ...score,
        voices: [
          ...score.voices,
          { id: 'staff-upper', staffId: 'staff-upper' },
        ],
      }),
    ).toThrow(/Duplicate identity/)
  })

  it('rejects a voice assigned to an unknown staff', () => {
    const score = pianoScore()
    expect(() =>
      parseScore({
        ...score,
        voices: score.voices.map((voice) => ({
          ...voice,
          staffId: 'missing-staff',
        })),
      }),
    ).toThrow(/unknown staff/)
  })

  it('rejects repeated voice lanes within one measure', () => {
    const score = pianoScore()
    const measure = score.measures[0]
    expect(() =>
      parseScore({
        ...score,
        measures: [
          { ...measure, voices: [...measure.voices, measure.voices[0]] },
          ...score.measures.slice(1),
        ],
      }),
    ).toThrow(/repeated voice lane/)
  })

  it('rejects overlap and measure overflow independently of other voices', () => {
    const score = pianoScore()
    const event = fixtureEvent(score, 'event-upper-rest-2')
    expect(() =>
      parseScore(
        withFixtureEvent(score, event.id, { ...event, onset: fraction(1, 4) }),
      ),
    ).toThrow(/overlap/)
    expect(() =>
      parseScore(
        withFixtureEvent(score, event.id, {
          ...event,
          duration: { denominator: 1, dots: 0 },
        }),
      ),
    ).toThrow(/past the measure/)
  })

  it('rejects invalid and noncanonical time without throwing from a schema refinement', () => {
    const score = pianoScore()
    const event = fixtureEvent(score, 'event-chord')
    expect(() =>
      parseScore(
        withFixtureEvent(score, event.id, {
          ...event,
          onset: { numerator: 0, denominator: 0 },
        }),
      ),
    ).toThrow(ScoreValidationError)
    expect(() =>
      parseScore(
        withFixtureEvent(score, event.id, {
          ...event,
          onset: { numerator: 0, denominator: 2 },
        }),
      ),
    ).toThrow(/reduced fraction/)
  })

  it('rejects duplicate sounding notes inside a chord', () => {
    const score = pianoScore()
    const chord = fixtureEvent(score, 'event-chord')
    if (chord.kind !== 'note') {
      throw new Error('Expected fixture chord')
    }
    const duplicated = {
      ...chord,
      notes: chord.notes.map((note) => ({
        ...note,
        pitch: chord.notes[0].pitch,
      })),
    }
    expect(() =>
      parseScore(withFixtureEvent(score, chord.id, duplicated)),
    ).toThrow(/same sounding pitch/)
  })

  it('rejects a tie to an event ID rather than an individual note', () => {
    const score = pianoScore()
    expect(() =>
      parseScore({
        ...score,
        marks: [
          {
            id: 'wrong-tie',
            kind: 'tie',
            startNoteId: 'event-chord',
            endNoteId: 'note-tie-end',
          },
        ],
      }),
    ).toThrow(/unknown note/)
  })

  it('rejects a gap between tied notes even across measures', () => {
    const score = pianoScore()
    const event = fixtureEvent(score, 'event-tie-start')
    expect(() =>
      parseScore(
        withFixtureEvent(score, event.id, {
          ...event,
          duration: { denominator: 8, dots: 0 },
        }),
      ),
    ).toThrow(/adjacent notes/)
  })

  it('distinguishes slur direction from equal-pitch tie requirements', () => {
    const score = pianoScore()
    expect(() =>
      parseScore({
        ...score,
        marks: [
          {
            id: 'backward-slur',
            kind: 'slur',
            startEventId: 'event-triplet-3',
            endEventId: 'event-triplet-1',
          },
        ],
      }),
    ).toThrow(/move forward/)
  })

  it('rejects overlapping repeat ranges rather than silently interpreting unsupported nesting', () => {
    const score = pianoScore()
    expect(() =>
      parseScore({
        ...score,
        marks: [
          ...score.marks,
          {
            id: 'nested-repeat',
            kind: 'repeat',
            startMeasureId: 'measure-1',
            endMeasureId: 'measure-1',
            times: 2,
          },
        ],
      }),
    ).toThrow(/disjoint/)
  })
})
