/** Interpret written pitches as movable-do degrees without guessing a major/minor mode absent from the score. */
import type { WrittenPitch } from '../core'

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const
const TONICS = [
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
]

/** A displayed degree retains spelling, relative alteration and register against the written tonic in octave four. */
export interface JianpuPitch {
  readonly degree: number
  readonly accidental: string
  readonly octave: number
}

/** Return the major tonic corresponding to a validated key signature; no minor-mode inference occurs. */
export function tonicLabel(fifths: number): string {
  return TONICS[fifths + 7]
}

/** Convert a pitch relative to the diatonic key scale; altered degrees are explicit on every occurrence. */
export function toJianpuPitch(
  pitch: WrittenPitch,
  fifths: number,
): JianpuPitch {
  const tonic = STEPS.indexOf(tonicLabel(fifths)[0] as WrittenPitch['step'])
  const distance =
    pitch.octave * 7 + STEPS.indexOf(pitch.step) - (4 * 7 + tonic)
  const signature =
    fifths >= 0
      ? ['F', 'C', 'G', 'D', 'A', 'E', 'B']
      : ['B', 'E', 'A', 'D', 'G', 'C', 'F']
  const keyAlter = signature.slice(0, Math.abs(fifths)).includes(pitch.step)
    ? Math.sign(fifths)
    : 0
  const relativeAlter = pitch.alter - keyAlter
  return {
    degree: (((distance % 7) + 7) % 7) + 1,
    octave: Math.floor(distance / 7),
    accidental:
      relativeAlter === 0
        ? ''
        : (relativeAlter > 0 ? '♯' : '♭').repeat(Math.abs(relativeAlter)),
  }
}
