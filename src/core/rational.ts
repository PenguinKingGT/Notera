/** Exact, JSON-safe rational arithmetic for music time measured in whole notes. */

/** Reduced fraction with a positive denominator and safe-integer components. */
export interface Fraction {
  readonly numerator: number
  readonly denominator: number
}

/** Calculate a greatest common divisor without rounding large intermediate products. */
function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left
  let b = right < 0n ? -right : right
  while (b !== 0n) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a
}

/** Reduce BigInt intermediates before converting to JSON numbers; reject unsafe results. */
function fromBigInts(numerator: bigint, denominator: bigint): Fraction {
  if (denominator <= 0n) {
    throw new RangeError('Fraction denominator must be positive')
  }
  const divisor = gcd(numerator, denominator)
  const reducedNumerator = Number(numerator / divisor)
  const reducedDenominator = Number(denominator / divisor)
  if (
    !Number.isSafeInteger(reducedNumerator) ||
    !Number.isSafeInteger(reducedDenominator)
  ) {
    throw new RangeError('Fraction exceeds the JSON safe-integer range')
  }
  return Object.freeze({
    numerator: reducedNumerator,
    denominator: reducedDenominator,
  })
}

/** Create a canonical immutable fraction; throws for nonintegers or nonpositive denominators. */
export function fraction(numerator: number, denominator = 1): Fraction {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new RangeError('Fraction components must be safe integers')
  }
  return fromBigInts(BigInt(numerator), BigInt(denominator))
}

/** Check structural fraction values before arithmetic accepts externally constructed objects. */
function assertFraction(value: Fraction): void {
  if (
    !Number.isSafeInteger(value.numerator) ||
    !Number.isSafeInteger(value.denominator) ||
    value.denominator <= 0
  ) {
    throw new RangeError('Invalid fraction')
  }
}

/** Add two fractions exactly; throws if the reduced result cannot be stored safely in JSON. */
export function add(left: Fraction, right: Fraction): Fraction {
  assertFraction(left)
  assertFraction(right)
  return fromBigInts(
    BigInt(left.numerator) * BigInt(right.denominator) +
      BigInt(right.numerator) * BigInt(left.denominator),
    BigInt(left.denominator) * BigInt(right.denominator),
  )
}

/** Subtract fractions exactly, retaining signed results for relative-time calculations. */
export function subtract(left: Fraction, right: Fraction): Fraction {
  return add(left, fraction(-right.numerator, right.denominator))
}

/** Multiply fractions exactly using BigInt intermediate values. */
export function multiply(left: Fraction, right: Fraction): Fraction {
  assertFraction(left)
  assertFraction(right)
  return fromBigInts(
    BigInt(left.numerator) * BigInt(right.numerator),
    BigInt(left.denominator) * BigInt(right.denominator),
  )
}

/** Compare fractions without floating-point conversion, returning -1, 0 or 1. */
export function compare(left: Fraction, right: Fraction): -1 | 0 | 1 {
  assertFraction(left)
  assertFraction(right)
  const difference =
    BigInt(left.numerator) * BigInt(right.denominator) -
    BigInt(right.numerator) * BigInt(left.denominator)
  if (difference < 0n) {
    return -1
  }
  if (difference > 0n) {
    return 1
  }
  return 0
}

/** Return whether a structurally valid fraction is already reduced, including zero as 0/1. */
export function isCanonicalFraction(value: Fraction): boolean {
  assertFraction(value)
  const canonical = fraction(value.numerator, value.denominator)
  return (
    value.numerator === canonical.numerator &&
    value.denominator === canonical.denominator
  )
}
