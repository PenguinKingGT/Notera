// @vitest-environment node
/** Native-file compatibility and corruption checks using a real versioned piano document. */
import { describe, expect, it } from 'vitest'
import pianoFixture from '../../tests/fixtures/piano-core.notera.json'
import { deserializeScore, ScoreFileError, serializeScore } from './index'
import { pianoScore } from './test-fixtures'

describe('native score files', () => {
  it('round-trips exact musical data, individual note IDs and anchored marks', () => {
    const score = pianoScore()
    const encoded = serializeScore(score)
    expect(encoded.endsWith('\n')).toBe(true)
    expect(JSON.parse(encoded)).toEqual(pianoFixture)
    expect(deserializeScore(encoded)).toEqual(score)
    expect(Object.isFrozen(deserializeScore(encoded).marks)).toBe(true)
  })

  it('rejects malformed JSON with a distinct file error', () => {
    expect(() => deserializeScore('{')).toThrowError(
      expect.objectContaining({ code: 'invalid-json' }),
    )
  })

  it('rejects future versions before trying to interpret their score', () => {
    expect(() =>
      deserializeScore(
        JSON.stringify({
          format: 'notera-score',
          version: 2,
          score: { future: true },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'unsupported-version' }))
  })

  it('rejects foreign envelopes and extra envelope fields', () => {
    expect(() =>
      deserializeScore(JSON.stringify({ ...pianoFixture, format: 'musicxml' })),
    ).toThrowError(expect.objectContaining({ code: 'invalid-envelope' }))
    expect(() =>
      deserializeScore(
        JSON.stringify({ ...pianoFixture, extra: 'must not be lost' }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid-envelope' }))
  })

  it('retains domain diagnostics for damaged references in an otherwise valid file', () => {
    const score = pianoScore()
    const invalid = {
      ...pianoFixture,
      score: {
        ...score,
        marks: [
          {
            id: 'orphan-mark',
            kind: 'dynamic',
            eventId: 'unknown-event',
            value: 'p',
          },
        ],
      },
    }
    try {
      deserializeScore(JSON.stringify(invalid))
      throw new Error('Expected file rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(ScoreFileError)
      expect(error).toMatchObject({
        code: 'invalid-score',
        cause: { issues: [{ code: 'reference' }] },
      })
    }
  })
})
