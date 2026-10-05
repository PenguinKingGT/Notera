/** Strict native JSON envelope with explicit version rejection and validated musical payloads. */
import { z } from 'zod'
import type { Score } from './model'
import { parseScore, ScoreValidationError } from './validation'

export const SCORE_FILE_FORMAT = 'notera-score'
export const SCORE_FILE_VERSION = 1

const envelopeSchema = z.strictObject({
  format: z.literal(SCORE_FILE_FORMAT),
  version: z.number().int().safe().positive(),
  score: z.unknown(),
})

/** File failure categories allow UI callers to distinguish unsupported versions from corruption. */
export type ScoreFileErrorCode =
  'invalid-json' | 'invalid-envelope' | 'unsupported-version' | 'invalid-score'

/** Parsing errors keep the underlying domain diagnostics as a cause when available. */
export class ScoreFileError extends Error {
  readonly code: ScoreFileErrorCode

  /** Construct a typed file error without discarding its original validation cause. */
  constructor(code: ScoreFileErrorCode, message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'ScoreFileError'
    this.code = code
  }
}

/** Validate and serialize native musical content, retaining identities and exact fractions. */
export function serializeScore(score: Score): string {
  return `${JSON.stringify({ format: SCORE_FILE_FORMAT, version: SCORE_FILE_VERSION, score: parseScore(score) }, null, 2)}\n`
}

/** Decode current-version JSON without silently discarding fields or guessing future formats. */
export function deserializeScore(text: string): Score {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new ScoreFileError(
      'invalid-json',
      'Score file is not valid JSON',
      error,
    )
  }
  const envelope = envelopeSchema.safeParse(value)
  if (!envelope.success) {
    throw new ScoreFileError(
      'invalid-envelope',
      'Invalid Notera score-file envelope',
      envelope.error,
    )
  }
  if (envelope.data.version !== SCORE_FILE_VERSION) {
    throw new ScoreFileError(
      'unsupported-version',
      `Unsupported score-file version ${envelope.data.version}`,
    )
  }
  try {
    return parseScore(envelope.data.score)
  } catch (error) {
    if (!(error instanceof ScoreValidationError)) {
      throw error
    }
    throw new ScoreFileError(
      'invalid-score',
      'Score file contains invalid musical content',
      error,
    )
  }
}
