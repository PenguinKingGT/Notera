/** Public musical-core interface; runtime schemas and editing implementation stay internal. */
export type { Fraction } from './rational'
export { fraction, add, subtract, multiply, compare } from './rational'
export type {
  Score,
  MusicalEvent,
  Note,
  WrittenPitch,
  NotatedDuration,
  ScoreMark,
  Measure,
} from './model'
export { durationTime, soundingPitch, sameWrittenPitch } from './music'
export { parseScore, ScoreValidationError } from './validation'
export type { ScoreIssue, ScoreIssueCode } from './validation'
export { createPianoScore } from './create-score'
export type { PianoScoreOptions } from './create-score'
export { applyScoreCommand, ScoreCommandError } from './commands'
export type { ScoreCommand, EventTarget } from './commands'
export { ScoreEditor } from './editor'
export type { ScoreEditorOptions } from './editor'
export {
  serializeScore,
  deserializeScore,
  ScoreFileError,
  SCORE_FILE_FORMAT,
  SCORE_FILE_VERSION,
} from './score-file'
export type { ScoreFileErrorCode } from './score-file'
