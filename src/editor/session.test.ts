// @vitest-environment node
/** Verify input intentions through real transactions, including rollback and continuous-bar history. */
import { describe, expect, it, vi } from 'vitest'
import { createPianoScore, fraction } from '../core'
import { EditorSession } from './session'

/** Provide deterministic identities while retaining the real schema and command implementation. */
function session() {
  let id = 0
  return new EditorSession(
    createPianoScore({ id: 'score', measureCount: 1 }),
    () => `input-${++id}`,
  )
}

describe('piano input session', () => {
  it('adds a bar and its first event as one undoable operation', () => {
    const editor = session()
    for (const step of ['C', 'D', 'E', 'F', 'G'] as const) {
      editor.inputPitch(step)
    }
    expect(editor.getSnapshot().score.measures).toHaveLength(2)
    expect(
      editor.getSnapshot().score.measures[1].voices[0].events[0].onset,
    ).toEqual(fraction(0))
    editor.undo()
    expect(editor.getSnapshot().score.measures).toHaveLength(1)
    editor.redo()
    expect(editor.getSnapshot().score.measures).toHaveLength(2)
  })

  it('keeps chord note identities when editing and restores deleted content', () => {
    const editor = session()
    editor.inputPitch('C')
    editor.inputPitch('E', true)
    const event = editor.getSnapshot().score.measures[0].voices[0].events[0]
    if (event.kind !== 'note') {
      throw new Error('Expected chord')
    }
    const noteId = event.notes[1].id
    editor.select({ kind: 'event', eventId: event.id, noteId })
    editor.transposeSelected(1)
    expect(
      editor.getSnapshot().score.measures[0].voices[0].events[0],
    ).toMatchObject({
      notes: [{ pitch: { step: 'C' } }, { id: noteId, pitch: { step: 'F' } }],
    })
    editor.deleteSelection()
    expect(
      editor.getSnapshot().score.measures[0].voices[0].events,
    ).toHaveLength(0)
    editor.undo()
    expect(editor.getSnapshot().score.measures[0].voices[0].events[0].id).toBe(
      event.id,
    )
  })

  it('rejects an oversized duration without changing the cursor or history', () => {
    const editor = session()
    editor.inputPitch('C')
    const before = editor.getSnapshot()
    editor.setDuration({ denominator: 1, dots: 0 })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    editor.inputRest()
    expect(editor.getSnapshot().score).toBe(before.score)
    expect(editor.getSnapshot().cursor).toEqual(before.cursor)
    expect(editor.getSnapshot().error).toBeTruthy()
    editor.undo()
    expect(
      editor.getSnapshot().score.measures[0].voices[0].events,
    ).toHaveLength(0)
    vi.restoreAllMocks()
  })

  it('fills a clicked empty position in a different staff without persisting other gaps', () => {
    const editor = session()
    const initial = editor.getSnapshot()
    editor.select({
      kind: 'placeholder',
      cursor: {
        measureId: initial.cursor.measureId,
        voiceId: initial.score.voices[1].id,
        onset: fraction(1, 2),
      },
    })
    editor.inputRest()
    const lanes = editor.getSnapshot().score.measures[0].voices
    expect(lanes[0].events).toHaveLength(0)
    expect(lanes[1].events).toHaveLength(1)
    expect(lanes[1].events[0]).toMatchObject({
      kind: 'rest',
      onset: fraction(1, 2),
    })
  })

  it('notifies once per intention and keeps snapshot identity between changes', () => {
    const editor = session()
    const listener = vi.fn()
    const cleanup = editor.subscribe(listener)
    const snapshot = editor.getSnapshot()
    expect(editor.getSnapshot()).toBe(snapshot)
    editor.inputPitch('C')
    expect(listener).toHaveBeenCalledTimes(1)
    cleanup()
    editor.undo()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

it('inputs exact eighth-note triplets and navigates the same voice across bars', () => {
  const editor = session()
  editor.setDuration({
    denominator: 8,
    dots: 0,
    tuplet: { actual: 3, normal: 2 },
  })
  editor.inputPitch('C')
  editor.inputPitch('D')
  editor.inputPitch('E')
  expect(editor.getSnapshot().cursor.onset).toEqual(fraction(1, 4))
  editor.navigate(-1)
  expect(editor.getSnapshot().mode).toBe('edit')
  editor.setDuration({ denominator: 16, dots: 0 })
  editor.applyDuration()
  const second = editor.getSnapshot().score.measures[0].voices[0].events[1]
  expect(second.duration).toEqual({ denominator: 16, dots: 0 })
  expect(
    editor.getSnapshot().score.measures[0].voices[0].events[2].onset,
  ).toEqual(fraction(1, 6))
  editor.undo()
  expect(
    editor.getSnapshot().score.measures[0].voices[0].events[1].duration.tuplet,
  ).toEqual({ actual: 3, normal: 2 })
})

it('materializes an omitted empty voice lane only when inserting music', () => {
  const initial = createPianoScore({ id: 's' })
  const editor = new EditorSession(
    { ...initial, measures: [{ ...initial.measures[0], voices: [] }] },
    () => 'new-event',
  )
  editor.inputRest()
  expect(editor.getSnapshot().score.measures[0].voices).toHaveLength(1)
  editor.undo()
  expect(editor.getSnapshot().score.measures[0].voices).toHaveLength(0)
})
