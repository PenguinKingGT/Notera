/** Validate complete immutable musical snapshots, including identity, rhythm and anchored marks. */
import { scoreSchema } from './model'
import type { MusicalEvent, Note, Score, ScoreMark } from './model'
import { durationTime, sameWrittenPitch, soundingPitch } from './music'
import { add, compare, fraction } from './rational'
import type { Fraction } from './rational'

/** Machine-readable validation categories for file, editor and future recognition callers. */
export type ScoreIssueCode =
  'shape' | 'duplicate-id' | 'reference' | 'rhythm' | 'mark'

/** One actionable domain error with its document location. */
export interface ScoreIssue {
  readonly code: ScoreIssueCode
  readonly path: string
  readonly message: string
}

/** Failed validation never publishes a partially accepted or normalized musical snapshot. */
export class ScoreValidationError extends Error {
  readonly issues: readonly ScoreIssue[]

  /** Retain structured errors without exposing mutable diagnostic state. */
  constructor(issues: readonly ScoreIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'))
    this.name = 'ScoreValidationError'
    this.issues = Object.freeze(
      issues.map((issue) => Object.freeze({ ...issue })),
    )
  }
}

interface EventLocation {
  readonly event: MusicalEvent
  readonly voiceId: string
  readonly staffId: string
  readonly start: Fraction
  readonly end: Fraction
}

interface NoteLocation extends EventLocation {
  readonly note: Note
}

interface ScoreIndex {
  readonly events: Map<string, EventLocation>
  readonly notes: Map<string, NoteLocation>
  readonly measures: Map<string, number>
}

/** Accumulate semantic issues while indexing identities and absolute musical positions. */
function indexScore(score: Score, issues: ScoreIssue[]): ScoreIndex {
  const ids = new Set<string>()
  const events = new Map<string, EventLocation>()
  const notes = new Map<string, NoteLocation>()
  const measures = new Map<string, number>()
  const staffIds = new Set(score.staves.map((staff) => staff.id))
  const voices = new Map(score.voices.map((voice) => [voice.id, voice]))

  /** Register identities across every entity kind, preventing ambiguous mark and command targets. */
  function register(id: string, path: string): void {
    if (ids.has(id)) {
      issues.push({
        code: 'duplicate-id',
        path,
        message: `Duplicate identity ${id}`,
      })
    }
    ids.add(id)
  }

  register(score.id, 'id')
  score.staves.forEach((staff, index) =>
    register(staff.id, `staves.${index}.id`),
  )
  score.voices.forEach((voice, index) => {
    register(voice.id, `voices.${index}.id`)
    if (!staffIds.has(voice.staffId)) {
      issues.push({
        code: 'reference',
        path: `voices.${index}.staffId`,
        message: 'Voice refers to an unknown staff',
      })
    }
  })
  let measureStart = fraction(0)
  score.measures.forEach((measure, measureIndex) => {
    const path = `measures.${measureIndex}`
    register(measure.id, `${path}.id`)
    measures.set(measure.id, measureIndex)
    const length = fraction(
      measure.timeSignature.beats,
      measure.timeSignature.beatType,
    )
    const measureVoices = new Set<string>()
    measure.voices.forEach((lane, laneIndex) => {
      const lanePath = `${path}.voices.${laneIndex}`
      const voice = voices.get(lane.voiceId)
      if (!voice || measureVoices.has(lane.voiceId)) {
        issues.push({
          code: 'reference',
          path: `${lanePath}.voiceId`,
          message: 'Unknown or repeated voice lane in measure',
        })
      }
      measureVoices.add(lane.voiceId)
      let previousEnd = fraction(0)
      lane.events.forEach((event, eventIndex) => {
        const eventPath = `${lanePath}.events.${eventIndex}`
        register(event.id, `${eventPath}.id`)
        const end = add(event.onset, durationTime(event.duration))
        // Gaps are valid while entering a score; overlaps and out-of-order entries are not.
        if (compare(event.onset, previousEnd) < 0 || compare(end, length) > 0) {
          issues.push({
            code: 'rhythm',
            path: eventPath,
            message:
              'Events overlap, are unordered, or extend past the measure',
          })
        }
        previousEnd = end
        const location = {
          event,
          voiceId: lane.voiceId,
          staffId: voice?.staffId ?? '',
          start: add(measureStart, event.onset),
          end: add(measureStart, end),
        }
        events.set(event.id, location)
        if (event.kind === 'note') {
          const chordPitches = new Set<number>()
          event.notes.forEach((note, noteIndex) => {
            register(note.id, `${eventPath}.notes.${noteIndex}.id`)
            const semitone = soundingPitch(note.pitch)
            if (chordPitches.has(semitone)) {
              issues.push({
                code: 'rhythm',
                path: `${eventPath}.notes.${noteIndex}`,
                message:
                  'A chord contains the same sounding pitch more than once',
              })
            }
            chordPitches.add(semitone)
            notes.set(note.id, { ...location, note })
          })
        }
      })
    })
    measureStart = add(measureStart, length)
  })
  score.marks.forEach((mark, index) => register(mark.id, `marks.${index}.id`))
  return { events, notes, measures }
}

/** Validate a tie between adjacent notes of one voice, retaining exact written spelling. */
function validateTie(
  mark: Extract<ScoreMark, { kind: 'tie' }>,
  index: ScoreIndex,
  path: string,
  issues: ScoreIssue[],
): void {
  const start = index.notes.get(mark.startNoteId)
  const end = index.notes.get(mark.endNoteId)
  if (!start || !end) {
    issues.push({
      code: 'reference',
      path,
      message: 'Tie refers to an unknown note',
    })
    return
  }
  if (
    start.voiceId !== end.voiceId ||
    compare(start.end, end.start) !== 0 ||
    !sameWrittenPitch(start.note.pitch, end.note.pitch)
  ) {
    issues.push({
      code: 'mark',
      path,
      message:
        'Tie must connect adjacent notes with the same written pitch in one voice',
    })
  }
}

/** Check supported spans and prevent dangling, backward or incompatible repeat ranges. */
function validateMarks(
  score: Score,
  index: ScoreIndex,
  issues: ScoreIssue[],
): void {
  const tieStarts = new Set<string>()
  const tieEnds = new Set<string>()
  const repeats: { start: number; end: number }[] = []
  score.marks.forEach((mark, markIndex) => {
    const path = `marks.${markIndex}`
    if (mark.kind === 'tie') {
      validateTie(mark, index, path, issues)
      if (tieStarts.has(mark.startNoteId) || tieEnds.has(mark.endNoteId)) {
        issues.push({
          code: 'mark',
          path,
          message: 'A note may have only one incoming and one outgoing tie',
        })
      }
      tieStarts.add(mark.startNoteId)
      tieEnds.add(mark.endNoteId)
      return
    }
    if (mark.kind === 'repeat') {
      const start = index.measures.get(mark.startMeasureId)
      const end = index.measures.get(mark.endMeasureId)
      if (start === undefined || end === undefined) {
        issues.push({
          code: 'reference',
          path,
          message: 'Repeat refers to an unknown measure',
        })
      } else if (
        start > end ||
        repeats.some((repeat) => start <= repeat.end && end >= repeat.start)
      ) {
        issues.push({
          code: 'mark',
          path,
          message:
            'Repeat ranges must be forward and disjoint in this format version',
        })
      } else {
        repeats.push({ start, end })
      }
      return
    }
    if (mark.kind === 'dynamic') {
      if (!index.events.has(mark.eventId)) {
        issues.push({
          code: 'reference',
          path,
          message: 'Dynamic refers to an unknown event',
        })
      }
      return
    }
    const start = index.events.get(mark.startEventId)
    const end = index.events.get(mark.endEventId)
    if (!start || !end) {
      issues.push({
        code: 'reference',
        path,
        message: 'Span refers to an unknown event',
      })
    } else if (
      compare(start.start, end.start) >= 0 ||
      start.staffId !== end.staffId ||
      (mark.kind === 'slur' &&
        (start.event.kind !== 'note' ||
          end.event.kind !== 'note' ||
          start.voiceId !== end.voiceId))
    ) {
      issues.push({
        code: 'mark',
        path,
        message:
          'Span endpoints must be compatible and move forward in musical time',
      })
    }
  })
}

/** Parse untrusted input into a detached, deeply frozen valid score; reject unknown fields. */
export function parseScore(input: unknown): Score {
  const result = scoreSchema.safeParse(input)
  if (!result.success) {
    throw new ScoreValidationError(
      result.error.issues.map((issue) => ({
        code: 'shape',
        path: issue.path.map(String).join('.') || 'score',
        message: issue.message,
      })),
    )
  }
  const issues: ScoreIssue[] = []
  try {
    const index = indexScore(result.data, issues)
    validateMarks(result.data, index, issues)
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error
    }
    issues.push({ code: 'rhythm', path: 'score', message: error.message })
  }
  if (issues.length > 0) {
    throw new ScoreValidationError(issues)
  }
  return result.data
}
