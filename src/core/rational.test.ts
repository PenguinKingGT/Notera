// @vitest-environment node
/** Regression cases for exact musical time and preservation of written pitch spelling. */
import { describe, expect, it } from 'vitest'
import {
  add,
  compare,
  durationTime,
  fraction,
  multiply,
  sameWrittenPitch,
  soundingPitch,
  subtract,
} from './index'

describe('exact musical time', () => {
  it('reduces fractions and represents zero canonically', () => {
    expect(fraction(6, 8)).toEqual({ numerator: 3, denominator: 4 })
    expect(fraction(0, 99)).toEqual({ numerator: 0, denominator: 1 })
    expect(subtract(fraction(1, 8), fraction(1, 4))).toEqual(fraction(-1, 8))
  })

  it('sums three triplet eighths to one quarter exactly', () => {
    const triplet = durationTime({
      denominator: 8,
      dots: 0,
      tuplet: { actual: 3, normal: 2 },
    })
    expect(triplet).toEqual(fraction(1, 12))
    expect(add(add(triplet, triplet), triplet)).toEqual(fraction(1, 4))
  })

  it('combines dots and a tuplet without fixed tick resolution', () => {
    expect(durationTime({ denominator: 4, dots: 2 })).toEqual(fraction(7, 16))
    expect(
      durationTime({
        denominator: 8,
        dots: 1,
        tuplet: { actual: 5, normal: 4 },
      }),
    ).toEqual(fraction(3, 20))
  })

  it('uses exact large products even when they exceed floating-point integer precision', () => {
    const maximum = Number.MAX_SAFE_INTEGER
    expect(multiply(fraction(maximum, 2), fraction(2, maximum))).toEqual(
      fraction(1),
    )
    expect(
      compare(
        fraction(maximum - 1, maximum),
        fraction(maximum - 2, maximum - 1),
      ),
    ).toBe(1)
  })

  it('rejects unsafe output rather than rounding it', () => {
    expect(() => add(fraction(Number.MAX_SAFE_INTEGER), fraction(1))).toThrow(
      RangeError,
    )
  })

  it.each([
    [1, 0],
    [1, -2],
    [0.5, 4],
    [1, Number.POSITIVE_INFINITY],
  ])('rejects invalid fraction %s/%s', (numerator, denominator) => {
    expect(() => fraction(numerator, denominator)).toThrow(RangeError)
  })
})

describe('written pitch', () => {
  it('keeps enharmonic spellings distinct while calculating the same sounding pitch', () => {
    const sharp = { step: 'C', alter: 1, octave: 4 } as const
    const flat = { step: 'D', alter: -1, octave: 4 } as const
    expect(soundingPitch(sharp)).toBe(61)
    expect(soundingPitch(flat)).toBe(61)
    expect(sameWrittenPitch(sharp, flat)).toBe(false)
  })
})
