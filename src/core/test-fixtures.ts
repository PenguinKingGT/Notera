/** Test-only readers for the hand-authored native piano fixture; never exported by the core interface. */
import pianoFixture from '../../tests/fixtures/piano-core.notera.json'
import { deserializeScore } from './score-file'
import type { MusicalEvent, Score } from './model'

/** Load an independent immutable copy so each test owns its score and history. */
export function pianoScore(): Score {
  return deserializeScore(JSON.stringify(pianoFixture))
}

/** Locate a known fixture event; failing loudly prevents tests from exercising the wrong music. */
export function fixtureEvent(score: Score, eventId: string): MusicalEvent {
  const event = score.measures
    .flatMap((measure) => measure.voices.flatMap((lane) => lane.events))
    .find((candidate) => candidate.id === eventId)
  if (!event) {
    throw new Error(`Missing fixture event ${eventId}`)
  }
  return event
}

/** Compose deliberately invalid or changed event data without mutating immutable input snapshots. */
export function withFixtureEvent(
  score: Score,
  eventId: string,
  event: MusicalEvent,
): Score {
  return {
    ...score,
    measures: score.measures.map((measure) => ({
      ...measure,
      voices: measure.voices.map((lane) => ({
        ...lane,
        events: lane.events.map((candidate) =>
          candidate.id === eventId ? event : candidate,
        ),
      })),
    })),
  }
}
