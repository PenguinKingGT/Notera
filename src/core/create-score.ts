/** Build an initial piano document with deterministic caller-owned identity and empty voice lanes. */
import type { Score } from './model'
import { parseScore } from './validation'

/** Parameters needed to create a score without coupling identity generation to any runtime. */
export interface PianoScoreOptions {
  readonly id: string
  readonly title?: string
  readonly measureCount?: number
}

/** Create a 4/4 C-major piano score; callers provide the score ID (for example, a UUID). */
export function createPianoScore(options: PianoScoreOptions): Score {
  const measureCount = options.measureCount ?? 1
  if (
    !Number.isSafeInteger(measureCount) ||
    measureCount < 1 ||
    measureCount > 10000
  ) {
    throw new RangeError('Initial measure count must be between 1 and 10000')
  }
  const identities = new Set([options.id])

  /** Allocate a document-local identity without colliding with an arbitrary caller-owned score ID. */
  function localId(base: string): string {
    let candidate = base
    let suffix = 1
    while (identities.has(candidate)) {
      candidate = `${base}-${suffix}`
      suffix += 1
    }
    identities.add(candidate)
    return candidate
  }

  const upperStaff = localId('staff-upper')
  const lowerStaff = localId('staff-lower')
  const upperVoice = localId('voice-upper')
  const lowerVoice = localId('voice-lower')
  // Child identities are document-local; their spelling is not used to infer musical relationships.
  return parseScore({
    id: options.id,
    title: options.title ?? 'Untitled',
    staves: [
      { id: upperStaff, clef: 'treble' },
      { id: lowerStaff, clef: 'bass' },
    ],
    voices: [
      { id: upperVoice, staffId: upperStaff },
      { id: lowerVoice, staffId: lowerStaff },
    ],
    measures: Array.from({ length: measureCount }, (_, index) => ({
      id: localId(`measure-${index + 1}`),
      timeSignature: { beats: 4, beatType: 4 },
      keySignature: { fifths: 0 },
      voices: [
        { voiceId: upperVoice, events: [] },
        { voiceId: lowerVoice, events: [] },
      ],
    })),
    marks: [],
  })
}
