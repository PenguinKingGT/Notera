/** Native musical schema and inferred immutable types, independent of layout and desktop runtime. */
import { z } from 'zod'
import { isCanonicalFraction } from './rational'

const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
const integerSchema = z.number().int().safe()
const fractionSchema = z
  .strictObject({
    numerator: integerSchema.min(0),
    denominator: integerSchema.positive(),
  })
  .refine(
    (value) =>
      Number.isSafeInteger(value.numerator) &&
      Number.isSafeInteger(value.denominator) &&
      value.denominator > 0 &&
      isCanonicalFraction(value),
    'Music time must be a reduced fraction',
  )
  .readonly()

export const pitchSchema = z
  .strictObject({
    step: z.enum(['C', 'D', 'E', 'F', 'G', 'A', 'B']),
    alter: integerSchema.min(-2).max(2),
    octave: integerSchema.min(0).max(9),
  })
  .readonly()

export const durationSchema = z
  .strictObject({
    denominator: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(4),
      z.literal(8),
      z.literal(16),
      z.literal(32),
      z.literal(64),
    ]),
    dots: integerSchema.min(0).max(3),
    tuplet: z
      .strictObject({
        actual: integerSchema.min(2).max(32),
        normal: integerSchema.min(1).max(32),
      })
      .readonly()
      .optional(),
  })
  .readonly()

const noteSchema = z
  .strictObject({ id: idSchema, pitch: pitchSchema })
  .readonly()
const eventFields = {
  id: idSchema,
  onset: fractionSchema,
  duration: durationSchema,
}
export const eventSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      ...eventFields,
      kind: z.literal('note'),
      notes: z.array(noteSchema).min(1).readonly(),
    })
    .readonly(),
  z.strictObject({ ...eventFields, kind: z.literal('rest') }).readonly(),
])

const markSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      id: idSchema,
      kind: z.literal('tie'),
      startNoteId: idSchema,
      endNoteId: idSchema,
    })
    .readonly(),
  z
    .strictObject({
      id: idSchema,
      kind: z.literal('slur'),
      startEventId: idSchema,
      endEventId: idSchema,
    })
    .readonly(),
  z
    .strictObject({
      id: idSchema,
      kind: z.literal('dynamic'),
      eventId: idSchema,
      value: z.enum(['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff']),
    })
    .readonly(),
  z
    .strictObject({
      id: idSchema,
      kind: z.literal('pedal'),
      startEventId: idSchema,
      endEventId: idSchema,
    })
    .readonly(),
  z
    .strictObject({
      id: idSchema,
      kind: z.literal('repeat'),
      startMeasureId: idSchema,
      endMeasureId: idSchema,
      times: integerSchema.min(2).max(16),
    })
    .readonly(),
])

const timeSignatureSchema = z
  .strictObject({
    beats: integerSchema.min(1).max(32),
    beatType: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(4),
      z.literal(8),
      z.literal(16),
      z.literal(32),
    ]),
  })
  .readonly()
const measureSchema = z
  .strictObject({
    id: idSchema,
    timeSignature: timeSignatureSchema,
    keySignature: z
      .strictObject({ fifths: integerSchema.min(-7).max(7) })
      .readonly(),
    voices: z
      .array(
        z
          .strictObject({
            voiceId: idSchema,
            events: z.array(eventSchema).readonly(),
          })
          .readonly(),
      )
      .readonly(),
  })
  .readonly()

export const scoreSchema = z
  .strictObject({
    id: idSchema,
    title: z.string().max(1000),
    staves: z
      .array(
        z
          .strictObject({ id: idSchema, clef: z.enum(['treble', 'bass']) })
          .readonly(),
      )
      .min(1)
      .readonly(),
    voices: z
      .array(z.strictObject({ id: idSchema, staffId: idSchema }).readonly())
      .min(1)
      .readonly(),
    measures: z.array(measureSchema).min(1).readonly(),
    marks: z.array(markSchema).readonly(),
  })
  .readonly()

/** Complete musical document; array order establishes measure and staff order. */
export type Score = z.infer<typeof scoreSchema>
/** Timed note/chord or rest in one voice; onset is relative to its measure. */
export type MusicalEvent = z.infer<typeof eventSchema>
/** One independently addressable note within a chord event. */
export type Note = z.infer<typeof noteSchema>
/** Explicit pitch spelling; alteration is absolute, not an accidental-display instruction. */
export type WrittenPitch = z.infer<typeof pitchSchema>
/** Written note value, dots and optional tuplet ratio before exact time calculation. */
export type NotatedDuration = z.infer<typeof durationSchema>
/** Supported anchored musical marks; ties reference individual notes, slurs reference events. */
export type ScoreMark = z.infer<typeof markSchema>
/** A measure's complete meter and key context, containing zero or more voice lanes. */
export type Measure = z.infer<typeof measureSchema>
