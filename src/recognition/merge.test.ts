// @vitest-environment node
/** Exercise real source-aware insertions, edited music preservation, conflicting references and undo replay. */
import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { createPianoScore, fraction, parseScore, ScoreEditor } from '../core'
import { deserializeScore } from '../core'
import type { Score } from '../core'
import type { RecognitionImport } from '../shared/recognition-api'
import { combineRecognitionScores } from './score-result'
import { planRecognitionMerge, recognitionLedger } from './merge'

/** Make one independently identified, valid page containing a whole-note piano event. */
function page(id: string, step: 'C' | 'D' | 'E' = 'C'): Score {
  const base = createPianoScore({ id })
  return parseScore({
    ...base,
    measures: [
      {
        ...base.measures[0],
        voices: [
          {
            voiceId: base.voices[0].id,
            events: [
              {
                id: `${id}-event`,
                kind: 'note',
                onset: fraction(0),
                duration: { denominator: 1, dots: 0 },
                notes: [
                  { id: `${id}-note`, pitch: { step, alter: 0, octave: 4 } },
                ],
              },
            ],
          },
        ],
      },
    ],
  })
}

/** Model main's explicit source/measure association independently of displayed page counts. */
function result(
  ids: string[],
  parts: Score[],
  order = ['a', 'b', 'c'],
): RecognitionImport {
  const score = combineRecognitionScores(parts, 'recognized-score')
  let offset = 0
  const fragments = ids.map((sourceId, index) => {
    const measureIds = score.measures
      .slice(offset, offset + parts[index].measures.length)
      .map((measure) => measure.id)
    offset += measureIds.length
    return { sourceId, measureIds }
  })
  return { taskId: 'task', sourceOrder: order, fragments, score }
}

test('inserts failed middle page while preserving hand edits, IDs and title; merge is undoable and cannot duplicate', () => {
  const initial = result(['a', 'c'], [page('a'), page('c')])
  const ledger = recognitionLedger(initial)
  const editor = new ScoreEditor(initial.score)
  editor.execute({ kind: 'set-title', title: '手动修改的标题' })
  const first = editor.score.measures[0].voices[0].events[0]
  if (first.kind !== 'note') {
    throw new Error('Expected note')
  }
  editor.execute({
    kind: 'replace-event',
    eventId: first.id,
    event: {
      ...first,
      notes: [{ ...first.notes[0], pitch: { step: 'E', alter: 0, octave: 4 } }],
    },
  })
  const before = editor.score
  const complete = result(
    ['a', 'b', 'c'],
    [page('a'), page('b', 'D'), page('c')],
  )
  const plan = planRecognitionMerge(before, ledger, complete, 'ordered')
  editor.execute(plan.command)
  expect(editor.score.title).toBe(before.title)
  expect(editor.score.id).toBe(before.id)
  expect(editor.score.measures[0]).toEqual(before.measures[0])
  expect(editor.score.measures[2]).toEqual(before.measures[1])
  expect(editor.score.measures[1].voices[0].events[0]).toMatchObject({
    notes: [{ pitch: { step: 'D' } }],
  })
  expect(() =>
    planRecognitionMerge(editor.score, plan.ledger, complete, 'ordered'),
  ).toThrow('没有可重复')
  const merged = editor.score
  editor.undo()
  expect(editor.score).toEqual(before)
  // A page undone by the user can be reinserted without copying already-retained pages.
  expect(
    planRecognitionMerge(editor.score, plan.ledger, complete, 'ordered').added,
  ).toBe(1)
  editor.redo()
  expect(editor.score).toEqual(merged)
})

test('ordered insertion cannot break an edited cross-page tie; explicit append preserves it', () => {
  const initial = result(['a', 'c'], [page('a'), page('c')])
  const editor = new ScoreEditor(initial.score)
  const noteId = (score: Score, index: number) => {
    const event = score.measures[index].voices[0].events[0]
    if (event.kind !== 'note') {
      throw new Error('Expected note')
    }
    return event.notes[0].id
  }
  editor.execute({
    kind: 'put-mark',
    mark: {
      id: 'hand-tie',
      kind: 'tie',
      startNoteId: noteId(editor.score, 0),
      endNoteId: noteId(editor.score, 1),
    },
  })
  const before = editor.score
  const complete = result(
    ['a', 'b', 'c'],
    [page('a'), page('b', 'D'), page('c')],
  )
  const ledger = recognitionLedger(initial)
  expect(() =>
    editor.execute(
      planRecognitionMerge(before, ledger, complete, 'ordered').command,
    ),
  ).toThrow()
  expect(editor.score).toBe(before)
  editor.execute(
    planRecognitionMerge(before, ledger, complete, 'append').command,
  )
  expect(editor.score.measures.slice(0, 2)).toEqual(before.measures)
  expect(editor.score.marks).toEqual(before.marks)
})

test('source reordering requires explicit append and malformed provenance never plans music', () => {
  const initial = result(['a'], [page('a')])
  const complete = result(['b', 'a'], [page('b'), page('a')], ['b', 'a', 'c'])
  const ledger = recognitionLedger(initial)
  expect(() =>
    planRecognitionMerge(initial.score, ledger, complete, 'ordered'),
  ).toThrow('来源顺序')
  const editor = new ScoreEditor(initial.score)
  editor.execute(
    planRecognitionMerge(initial.score, ledger, complete, 'append').command,
  )
  expect(editor.score.measures).toHaveLength(2)
  expect(editor.score.measures[0]).toEqual(initial.score.measures[0])
  expect(() =>
    recognitionLedger({
      ...complete,
      fragments: [{ sourceId: 'b', measureIds: ['wrong'] }],
    }),
  ).toThrow('关联无效')
  expect(() =>
    planRecognitionMerge(
      initial.score,
      ledger,
      { ...complete, taskId: 'other' },
      'append',
    ),
  ).toThrow('不属于')
})

test('adds extra voices and remaps all new musical marks without touching retained pages', () => {
  const piano = deserializeScore(
    readFileSync('tests/fixtures/piano-core.notera.json', 'utf8'),
  )
  const initial = result(['a'], [page('a')])
  const complete = result(['a', 'b'], [page('a'), piano])
  const editor = new ScoreEditor(initial.score)
  const before = editor.score
  const plan = planRecognitionMerge(
    before,
    recognitionLedger(initial),
    complete,
    'ordered',
  )
  editor.execute(plan.command)
  expect(editor.score.voices).toHaveLength(3)
  expect(editor.score.measures[0]).toEqual(before.measures[0])
  expect(editor.score.marks.map((mark) => mark.kind)).toEqual(
    piano.marks.map((mark) => mark.kind),
  )
  expect(
    editor.score.marks.every(
      (mark) => !piano.marks.some((old) => old.id === mark.id),
    ),
  ).toBe(true)
  expect(() => parseScore(editor.score)).not.toThrow()
  editor.undo()
  expect(editor.score).toEqual(before)
})
