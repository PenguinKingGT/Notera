/** Share chord baselines and symbol extents between numbered-notation layout and SVG drawing. */
import type { JianpuToken } from './projection'

/** Stack higher pitches above the lowest number, keeping octave dots clear of adjacent digits. */
export function pitchOffsets(token: JianpuToken): number[] {
  const offsets = token.pitches.map(() => 0)
  for (let index = offsets.length - 2; index >= 0; index--) {
    const upper = token.pitches[index]
    const lower = token.pitches[index + 1]
    offsets[index] =
      offsets[index + 1] -
      28 -
      Math.max(0, -upper.octave) * 5 -
      Math.max(0, lower.octave) * 5
  }
  return offsets
}

/** Reserve actual symbol bounds around a common baseline, including register dots and rhythm lines. */
export function tokenExtents(token: JianpuToken): {
  above: number
  below: number
} {
  const offsets = pitchOffsets(token)
  const highest = token.pitches[0]
  const lowest = token.pitches.at(-1)
  const upperDots =
    token.symbol === 'number' ? Math.max(0, highest?.octave ?? 0) : 0
  const lowerDots =
    token.symbol === 'number' ? Math.max(0, -(lowest?.octave ?? 0)) : 0
  return {
    above: -(offsets[0] ?? 0) + 24 + upperDots * 5,
    below: 12 + lowerDots * 5 + Math.max(0, token.underlines - 1) * 5,
  }
}
