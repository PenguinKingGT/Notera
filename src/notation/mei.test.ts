/** Verify the rendering boundary preserves identity and exact gaps without modifying native music. */
import { expect, test } from 'vitest'
import { applyScoreCommand, createPianoScore, fraction } from '../core'
import { pianoScore } from '../core/test-fixtures'
import { projectToMei } from './mei'

test('multiple gaps have unique XML identities and input mappings', () => {
  let score = createPianoScore({ id: 'score' })
  for (const [index, onset] of [fraction(1, 4), fraction(3, 4)].entries()) {
    score = applyScoreCommand(score, {
      kind: 'insert-event',
      target: { measureId: score.measures[0].id, voiceId: score.voices[0].id },
      event: {
        id: `event-${index}`,
        kind: 'note',
        onset,
        duration: { denominator: 8, dots: 0 },
        notes: [
          { id: `note-${index}`, pitch: { step: 'C', alter: 0, octave: 4 } },
        ],
      },
    })
  }
  const before = JSON.stringify(score)
  const projection = projectToMei(score)
  const xml = new DOMParser().parseFromString(projection.mei, 'application/xml')
  expect(xml.querySelector('parsererror')).toBeNull()
  const ids = [...xml.querySelectorAll('[xml\\:id]')].map((node) =>
    node.getAttribute('xml:id'),
  )
  expect(new Set(ids).size).toBe(ids.length)
  expect(
    Object.values(projection.targets).filter(
      (target) => target.kind === 'event',
    ),
  ).toHaveLength(2)
  expect(
    Object.values(projection.targets).filter(
      (target) => target.kind === 'placeholder',
    ).length,
  ).toBeGreaterThan(2)
  expect(JSON.stringify(score)).toBe(before)
})

test('XML-sensitive titles remain text and cannot inject notation elements', () => {
  const score = createPianoScore({ id: 'score', title: '<note>&" piano' })
  const xml = new DOMParser().parseFromString(
    projectToMei(score).mei,
    'application/xml',
  )
  expect(xml.querySelector('parsererror')).toBeNull()
  expect(xml.querySelector('title')?.textContent).toBe(score.title)
  expect(xml.querySelectorAll('note')).toHaveLength(0)
})

test('writes a natural after a sharp instead of changing the next note under accidental rules', () => {
  let score = createPianoScore({ id: 'score' })
  for (const [index, alter] of ([1, 0] as const).entries()) {
    score = applyScoreCommand(score, {
      kind: 'insert-event',
      target: { measureId: score.measures[0].id, voiceId: score.voices[0].id },
      event: {
        id: `e-${index}`,
        kind: 'note',
        onset: fraction(index, 4),
        duration: { denominator: 4, dots: 0 },
        notes: [{ id: `n-${index}`, pitch: { step: 'C', octave: 4, alter } }],
      },
    })
  }
  const xml = new DOMParser().parseFromString(
    projectToMei(score).mei,
    'application/xml',
  )
  expect(
    [...xml.querySelectorAll('note accid')].map((accidental) =>
      accidental.getAttribute('accid'),
    ),
  ).toEqual(['s', 'n'])
})

test('print projection keeps real rests while gaps remain invisible and unselectable', () => {
  const score = pianoScore()
  const projection = projectToMei(score, { placeholders: false })
  expect(projection.mei).not.toContain('input-placeholder')
  expect(projection.mei).toContain('<space ')
  expect(projection.mei).toContain('<rest ')
  expect(
    Object.values(projection.targets).some(
      (target) => target.kind === 'placeholder',
    ),
  ).toBe(false)
})

test('custom repeat counts remain visible in editor and PDF projections, including empty bars', () => {
  const initial = createPianoScore({ id: 'repeat-score', measureCount: 2 })
  const score = applyScoreCommand(initial, {
    kind: 'put-mark',
    mark: {
      id: 'repeat-mark',
      kind: 'repeat',
      startMeasureId: initial.measures[0].id,
      endMeasureId: initial.measures[1].id,
      times: 3,
    },
  })
  for (const placeholders of [true, false]) {
    const xml = new DOMParser().parseFromString(
      projectToMei(score, { placeholders }).mei,
      'application/xml',
    )
    expect(xml.querySelector('dir')?.textContent).toBe('3×')
    expect(xml.querySelector('dir')?.getAttribute('staff')).toBe('1')
    expect(xml.querySelector('dir')?.getAttribute('tstamp')).toBe('1')
    expect(xml.querySelector('measure')?.getAttribute('left')).toBe('rptstart')
  }
})

test('screen and print share independent per-voice beams and keep all note targets', () => {
  let score = createPianoScore({ id: 'beaming-score', measureCount: 1 })
  for (const voice of score.voices) {
    for (let index = 0; index < 4; index += 1) {
      score = applyScoreCommand(score, {
        kind: 'insert-event',
        target: { measureId: score.measures[0].id, voiceId: voice.id },
        event: {
          id: `${voice.id}-event-${index}`,
          kind: 'note',
          onset: fraction(index, 8),
          duration: { denominator: 8, dots: 0 },
          notes: [
            {
              id: `${voice.id}-note-${index}`,
              pitch: { step: 'C', alter: 0, octave: 4 },
            },
          ],
        },
      })
    }
  }
  const before = JSON.stringify(score)
  for (const placeholders of [true, false]) {
    const projection = projectToMei(score, { placeholders })
    const xml = new DOMParser().parseFromString(
      projection.mei,
      'application/xml',
    )
    expect(xml.querySelector('parsererror')).toBeNull()
    expect(xml.querySelectorAll('beam')).toHaveLength(4)
    expect(
      [...xml.querySelectorAll('beam')].map(
        (beam) => beam.querySelectorAll('note').length,
      ),
    ).toEqual([2, 2, 2, 2])
    expect(
      Object.values(projection.targets).filter(
        (target) => target.kind === 'event',
      ),
    ).toHaveLength(8)
    expect(xml.querySelectorAll('beam rest, beam space')).toHaveLength(0)
  }
  expect(JSON.stringify(score)).toBe(before)
})

test('keeps two consecutive eighth-triplet groups as distinct tuplet beams', () => {
  let score = createPianoScore({ id: 'tuplets', measureCount: 1 })
  for (let index = 0; index < 6; index += 1) {
    score = applyScoreCommand(score, {
      kind: 'insert-event',
      target: { measureId: score.measures[0].id, voiceId: score.voices[0].id },
      event: {
        id: `event-${index}`,
        kind: 'note',
        onset: fraction(index, 12),
        duration: { denominator: 8, dots: 0, tuplet: { actual: 3, normal: 2 } },
        notes: [
          { id: `note-${index}`, pitch: { step: 'D', alter: 0, octave: 4 } },
        ],
      },
    })
  }
  const xml = new DOMParser().parseFromString(
    projectToMei(score).mei,
    'application/xml',
  )
  expect(xml.querySelectorAll('tuplet beam')).toHaveLength(2)
  expect(
    [...xml.querySelectorAll('tuplet beam')].map(
      (beam) => beam.querySelectorAll('note').length,
    ),
  ).toEqual([3, 3])
  expect(xml.querySelectorAll('beam tuplet')).toHaveLength(0)
})
