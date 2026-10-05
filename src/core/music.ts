/** Exact written-duration and pitch calculations shared by editing, layout and playback. */
import type { NotatedDuration, WrittenPitch } from './model'
import { durationSchema, pitchSchema } from './model'
import { fraction, multiply } from './rational'
import type { Fraction } from './rational'

const NATURAL_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as const

/** Compute whole-note duration including dots and tuplets; invalid written values throw. */
export function durationTime(duration: NotatedDuration): Fraction {
  const value = durationSchema.parse(duration)
  // n dots multiply the base value by 2 - 1/2^n; a tuplet scales by normal/actual.
  const dotDenominator = 2 ** value.dots
  const dotted = multiply(
    fraction(1, value.denominator),
    fraction(2 * dotDenominator - 1, dotDenominator),
  )
  if (!value.tuplet) {
    return dotted
  }
  return multiply(dotted, fraction(value.tuplet.normal, value.tuplet.actual))
}

/** Map written pitch to an absolute semitone number (C4 = 60), preserving spelling separately. */
export function soundingPitch(pitch: WrittenPitch): number {
  const value = pitchSchema.parse(pitch)
  return (value.octave + 1) * 12 + NATURAL_SEMITONES[value.step] + value.alter
}

/** Compare exact note spellings; equal sounding pitch alone does not imply equal notation. */
export function sameWrittenPitch(
  left: WrittenPitch,
  right: WrittenPitch,
): boolean {
  return (
    left.step === right.step &&
    left.alter === right.alter &&
    left.octave === right.octave
  )
}
