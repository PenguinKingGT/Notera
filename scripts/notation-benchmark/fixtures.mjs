/** Hand-authored musical expectations for engine and future recognition evaluation. */

export const TICKS_PER_QUARTER = 12
export const TICKS_PER_MEASURE = 48

/** Decode a compact pitch used only by this benchmark, such as C#5 or E3. */
export function parsePitch(value) {
  const match = /^([A-G])([#b]?)(\d)$/.exec(value)
  if (!match) {
    throw new Error(`Invalid benchmark pitch: ${value}`)
  }
  return {
    step: match[1],
    alter: match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0,
    octave: Number(match[3]),
  }
}

/** Expand four manually specified bars; repetition probes pagination, not repertoire breadth. */
export function createScore(measureCount = 4) {
  // Each lane is one complete 4/4 voice. Tuplet eighths occupy four ticks.
  const patterns = [
    [
      {
        staff: 1,
        voice: 1,
        notes: [
          [12, 'C5 E5 G5'],
          [6, 'D5'],
          [6, 'E5'],
          [18, 'F#5'],
          [6, 'G5'],
        ],
      },
      {
        staff: 1,
        voice: 2,
        notes: [
          [24, 'G4'],
          [24, 'A4'],
        ],
      },
      {
        staff: 2,
        voice: 1,
        notes: [
          [24, 'C3 G3'],
          [24, 'G2 B2'],
        ],
      },
    ],
    [
      {
        staff: 1,
        voice: 1,
        notes: [
          [4, 'G5'],
          [4, 'A5'],
          [4, 'B5'],
          [12, 'C6'],
          [12, 'E5'],
          [12, 'D5'],
        ],
      },
      {
        staff: 1,
        voice: 2,
        notes: [
          [24, 'G4'],
          [24, 'F4'],
        ],
      },
      {
        staff: 2,
        voice: 1,
        notes: [
          [12, 'C3'],
          [12, 'E3'],
          [12, 'G3'],
          [12, 'C4'],
        ],
      },
    ],
    [
      {
        staff: 1,
        voice: 1,
        notes: [
          [6, 'E5'],
          [6, 'F5'],
          [6, 'G5'],
          [6, 'Ab5'],
          [12, 'G5'],
          [12, 'rest'],
        ],
      },
      {
        staff: 1,
        voice: 2,
        notes: [
          [24, 'C5'],
          [24, 'B4'],
        ],
      },
      {
        staff: 2,
        voice: 1,
        notes: [
          [24, 'F2 C3'],
          [24, 'G2 D3'],
        ],
      },
    ],
    [
      {
        staff: 1,
        voice: 1,
        notes: [
          [24, 'C5 E5 G5'],
          [24, 'C5 E5 G5'],
        ],
      },
      { staff: 1, voice: 2, notes: [[48, 'rest']] },
      { staff: 2, voice: 1, notes: [[48, 'C3 G3']] },
    ],
  ]
  const measures = Array.from({ length: measureCount }, (_, index) => {
    const lanes = patterns[index % patterns.length].map((lane) => {
      let onset = 0
      const events = lane.notes.map(([ticks, pitches], noteIndex) => {
        const event = {
          id: `m${index + 1}-s${lane.staff}-v${lane.voice}-e${noteIndex + 1}`,
          onset,
          ticks,
          pitches: pitches === 'rest' ? [] : pitches.split(' ').map(parsePitch),
        }
        onset += ticks
        return event
      })
      if (onset !== TICKS_PER_MEASURE) {
        throw new Error('Benchmark voice does not fill its measure')
      }
      return { staff: lane.staff, voice: lane.voice, events }
    })
    return { number: index + 1, lanes }
  })
  return {
    title: 'Notera piano benchmark (original fixture)',
    ticksPerQuarter: TICKS_PER_QUARTER,
    timeSignature: [4, 4],
    measures,
    marks: {
      tie: ['m1-s1-v1-e5', 'm2-s1-v1-e1'],
      slur: ['m2-s1-v1-e1', 'm2-s1-v1-e3'],
      dynamic: { event: 'm1-s2-v1-e1', value: 'p' },
      pedal: ['m1-s2-v1-e1', 'm1-s2-v1-e2'],
      repeat: [1, measureCount],
    },
  }
}

/** Return flat events with their musical location, suitable for stable ID comparisons. */
export function allEvents(score) {
  return score.measures.flatMap((measure) =>
    measure.lanes.flatMap((lane) =>
      lane.events.map((event) => ({
        ...event,
        measure: measure.number,
        staff: lane.staff,
        voice: lane.voice,
      })),
    ),
  )
}

/** Change a chord and redistribute durations while keeping identities and the complete 4/4 voice. */
export function editScore(score) {
  const edited = structuredClone(score)
  edited.measures[0].lanes[0].events[0].pitches = ['C#5', 'E5', 'G5', 'B5'].map(
    parsePitch,
  )
  edited.measures[0].lanes[0].events[0].ticks = 6
  edited.measures[0].lanes[0].events[1].ticks = 12
  edited.measures[0].lanes[0].events[1].onset = 6
  return edited
}

/** Convert exact benchmark ticks to written durations; this is not a general rhythm model. */
export function durationFor(ticks) {
  const values = {
    4: { denominator: 8, type: 'eighth', triplet: true },
    6: { denominator: 8, type: 'eighth' },
    12: { denominator: 4, type: 'quarter' },
    18: { denominator: 4, type: 'quarter', dots: 1 },
    24: { denominator: 2, type: 'half' },
    48: { denominator: 1, type: 'whole' },
  }
  const duration = values[ticks]
  if (!duration) {
    throw new Error(`Unsupported benchmark duration: ${ticks}`)
  }
  return duration
}
