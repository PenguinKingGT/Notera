/** Pure score transactions; related edits are validated and published together or rejected together. */
import type { Measure, MusicalEvent, Score, ScoreMark } from './model'
import { compare } from './rational'
import { parseScore } from './validation'

/** Location of one voice lane; voice identity is shared across measures. */
export interface EventTarget {
  readonly measureId: string
  readonly voiceId: string
}

/** Explicit editing operations; batch operations form one atomic, undoable transaction. */
export type ScoreCommand =
  | {
      readonly kind: 'insert-event'
      readonly target: EventTarget
      readonly event: MusicalEvent
    }
  | {
      readonly kind: 'replace-event'
      readonly eventId: string
      readonly event: MusicalEvent
    }
  | { readonly kind: 'delete-event'; readonly eventId: string }
  | { readonly kind: 'put-mark'; readonly mark: ScoreMark }
  | { readonly kind: 'delete-mark'; readonly markId: string }
  | { readonly kind: 'set-title'; readonly title: string }
  | { readonly kind: 'append-measure'; readonly measure: Measure }
  | {
      readonly kind: 'insert-measures'
      readonly beforeMeasureId: string | null
      readonly measures: readonly Measure[]
      readonly voices: Score['voices']
      readonly marks: readonly ScoreMark[]
    }
  | { readonly kind: 'batch'; readonly commands: readonly ScoreCommand[] }

/** A command addressed nonexistent content or tried to change an existing event's identity. */
export class ScoreCommandError extends Error {
  /** Report a command failure independently of the later musical validation step. */
  constructor(message: string) {
    super(message)
    this.name = 'ScoreCommandError'
  }
}

/** Find one event and its lane, throwing before any editing result is returned. */
function locateEvent(
  score: Score,
  eventId: string,
): { target: EventTarget; event: MusicalEvent } {
  for (const measure of score.measures) {
    for (const lane of measure.voices) {
      const event = lane.events.find((candidate) => candidate.id === eventId)
      if (event) {
        return {
          target: { measureId: measure.id, voiceId: lane.voiceId },
          event,
        }
      }
    }
  }
  throw new ScoreCommandError(`Unknown event ${eventId}`)
}

/** Replace a lane by composition, preserving all unrelated entities and references. */
function updateLane(
  score: Score,
  target: EventTarget,
  update: (events: readonly MusicalEvent[]) => readonly MusicalEvent[],
): Score {
  const measure = score.measures.find(
    (candidate) => candidate.id === target.measureId,
  )
  if (!measure || !score.voices.some((voice) => voice.id === target.voiceId)) {
    throw new ScoreCommandError('Unknown measure or voice lane')
  }
  // Omitted lanes are valid empty music; materialize one only when an edit inserts content.
  const voices = measure.voices.some((lane) => lane.voiceId === target.voiceId)
    ? measure.voices
    : [...measure.voices, { voiceId: target.voiceId, events: [] }]
  return {
    ...score,
    measures: score.measures.map((candidate) =>
      candidate.id === target.measureId
        ? {
            ...candidate,
            voices: voices.map((lane) =>
              lane.voiceId === target.voiceId
                ? { ...lane, events: update(lane.events) }
                : lane,
            ),
          }
        : candidate,
    ),
  }
}

/** Determine which anchored marks are removed by deliberate deletion of an entire event. */
function referencesEvent(mark: ScoreMark, event: MusicalEvent): boolean {
  if (mark.kind === 'tie') {
    return (
      event.kind === 'note' &&
      event.notes.some(
        (note) => note.id === mark.startNoteId || note.id === mark.endNoteId,
      )
    )
  }
  if (mark.kind === 'slur' || mark.kind === 'pedal') {
    return mark.startEventId === event.id || mark.endEventId === event.id
  }
  return mark.kind === 'dynamic' && mark.eventId === event.id
}

/** Apply structural changes without publishing intermediate states; final validation owns invariants. */
function applyUnchecked(score: Score, command: ScoreCommand): Score {
  switch (command.kind) {
    case 'insert-event':
      return updateLane(score, command.target, (events) =>
        [...events, command.event].sort((left, right) =>
          compare(left.onset, right.onset),
        ),
      )
    case 'replace-event': {
      const { target } = locateEvent(score, command.eventId)
      if (command.event.id !== command.eventId) {
        throw new ScoreCommandError(
          'Replacing an event must preserve its identity',
        )
      }
      return updateLane(score, target, (events) =>
        events
          .map((event) =>
            event.id === command.eventId ? command.event : event,
          )
          .sort((left, right) => compare(left.onset, right.onset)),
      )
    }
    case 'delete-event': {
      const { target, event } = locateEvent(score, command.eventId)
      const updated = updateLane(score, target, (events) =>
        events.filter((candidate) => candidate.id !== command.eventId),
      )
      // Only explicit event deletion cascades. Replacement must repair affected marks in the same batch.
      return {
        ...updated,
        marks: updated.marks.filter((mark) => !referencesEvent(mark, event)),
      }
    }
    case 'put-mark': {
      const exists = score.marks.some((mark) => mark.id === command.mark.id)
      return {
        ...score,
        marks: exists
          ? score.marks.map((mark) =>
              mark.id === command.mark.id ? command.mark : mark,
            )
          : [...score.marks, command.mark],
      }
    }
    case 'delete-mark': {
      if (!score.marks.some((mark) => mark.id === command.markId)) {
        throw new ScoreCommandError(`Unknown mark ${command.markId}`)
      }
      return {
        ...score,
        marks: score.marks.filter((mark) => mark.id !== command.markId),
      }
    }
    case 'set-title':
      return { ...score, title: command.title }
    case 'append-measure':
      return { ...score, measures: [...score.measures, command.measure] }
    case 'insert-measures': {
      const index =
        command.beforeMeasureId === null
          ? score.measures.length
          : score.measures.findIndex(
              (measure) => measure.id === command.beforeMeasureId,
            )
      if (index < 0) {
        throw new ScoreCommandError('Insertion anchor no longer exists')
      }
      // Validate the complete insertion later, including existing ties or repeats affected by new measures.
      return {
        ...score,
        voices: [...score.voices, ...command.voices],
        measures: [
          ...score.measures.slice(0, index),
          ...command.measures,
          ...score.measures.slice(index),
        ],
        marks: [...score.marks, ...command.marks],
      }
    }
    case 'batch':
      return command.commands.reduce(applyUnchecked, score)
    default:
      throw new ScoreCommandError('Unsupported command')
  }
}

/** Return a new deeply frozen score or throw; neither input nor partial batch results are mutated. */
export function applyScoreCommand(score: Score, command: ScoreCommand): Score {
  const initial = parseScore(score)
  return parseScore(applyUnchecked(initial, command))
}
