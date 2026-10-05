// @vitest-environment node
/** Editor transactions and save/history scenarios that must remain safe under manual and AI edits. */
import { describe, expect, it } from 'vitest'
import { createPianoScore, fraction, ScoreEditor } from './index'
import type { MusicalEvent } from './index'
import { fixtureEvent, pianoScore } from './test-fixtures'

/** Change a fixture note while retaining its event and individual-note identities. */
function repitch(event: MusicalEvent): MusicalEvent {
  if (event.kind !== 'note') {
    throw new Error('Expected pitched event')
  }
  return {
    ...event,
    notes: event.notes.map((note) => ({
      ...note,
      pitch: { step: 'D', alter: 0, octave: 5 },
    })),
  }
}

describe('score editor', () => {
  it('publishes a tied-pitch batch only after both endpoints are changed', () => {
    const original = pianoScore()
    const editor = new ScoreEditor(original)
    const start = fixtureEvent(original, 'event-tie-start')
    const end = fixtureEvent(original, 'event-tie-end')
    expect(() =>
      editor.execute({
        kind: 'replace-event',
        eventId: start.id,
        event: repitch(start),
      }),
    ).toThrow(/same written pitch/)
    expect(editor.score).toEqual(original)
    expect(editor.revision).toBe(0)
    expect(editor.canUndo).toBe(false)
    editor.execute({
      kind: 'batch',
      commands: [
        { kind: 'replace-event', eventId: start.id, event: repitch(start) },
        { kind: 'replace-event', eventId: end.id, event: repitch(end) },
      ],
    })
    expect(editor.revision).toBe(1)
    const updated = editor.score
    expect(editor.undo()).toEqual(original)
    expect(editor.isDirty).toBe(false)
    expect(editor.redo()).toEqual(updated)
    expect(fixtureEvent(editor.score, end.id).id).toBe(end.id)
  })

  it('deletes anchored marks with an event and restores all identities on undo', () => {
    const editor = new ScoreEditor(pianoScore())
    const original = editor.score
    editor.execute({ kind: 'delete-event', eventId: 'event-lower-chord' })
    expect(editor.score.marks.some((mark) => mark.id === 'mark-pedal')).toBe(
      false,
    )
    expect(editor.undo()).toEqual(original)
    expect(editor.score.marks.find((mark) => mark.id === 'mark-pedal')).toEqual(
      original.marks.find((mark) => mark.id === 'mark-pedal'),
    )
  })

  it('does not silently discard ties when replacement removes individual notes', () => {
    const editor = new ScoreEditor(pianoScore())
    const event = fixtureEvent(editor.score, 'event-tie-start')
    const replacement = {
      id: event.id,
      onset: event.onset,
      duration: event.duration,
      kind: 'rest',
    } as const
    expect(() =>
      editor.execute({
        kind: 'replace-event',
        eventId: event.id,
        event: replacement,
      }),
    ).toThrow(/unknown note/)
    editor.execute({
      kind: 'batch',
      commands: [
        { kind: 'delete-mark', markId: 'mark-tie' },
        { kind: 'replace-event', eventId: event.id, event: replacement },
      ],
    })
    expect(fixtureEvent(editor.score, event.id).kind).toBe('rest')
  })

  it('keeps the redo branch after a failed transaction and discards it after a successful edit', () => {
    const editor = new ScoreEditor(pianoScore())
    editor.execute({ kind: 'set-title', title: 'First edit' })
    editor.undo()
    expect(() =>
      editor.execute({
        kind: 'batch',
        commands: [
          { kind: 'set-title', title: 'Never publish' },
          { kind: 'delete-event', eventId: 'missing-event' },
        ],
      }),
    ).toThrow(/Unknown event/)
    expect(editor.score.title).toBe('Original core piano fixture')
    expect(editor.canRedo).toBe(true)
    editor.execute({ kind: 'set-title', title: 'New branch' })
    expect(editor.canRedo).toBe(false)
  })

  it('sorts inserted events by onset and never mutates the caller score', () => {
    const initial = createPianoScore({ id: 'insert-test' })
    const editor = new ScoreEditor(initial)
    editor.execute({
      kind: 'insert-event',
      target: { measureId: 'measure-1', voiceId: 'voice-upper' },
      event: {
        id: 'later-rest',
        kind: 'rest',
        onset: fraction(1, 2),
        duration: { denominator: 4, dots: 0 },
      },
    })
    editor.execute({
      kind: 'insert-event',
      target: { measureId: 'measure-1', voiceId: 'voice-upper' },
      event: {
        id: 'earlier-rest',
        kind: 'rest',
        onset: fraction(0),
        duration: { denominator: 4, dots: 0 },
      },
    })
    expect(
      editor.score.measures[0].voices[0].events.map((event) => event.id),
    ).toEqual(['earlier-rest', 'later-rest'])
    expect(initial.measures[0].voices[0].events).toEqual([])
  })

  it('rejects replacement identity changes and preserves the snapshot', () => {
    const editor = new ScoreEditor(pianoScore())
    const before = editor.score
    const event = fixtureEvent(before, 'event-chord')
    expect(() =>
      editor.execute({
        kind: 'replace-event',
        eventId: event.id,
        event: { ...event, id: 'different-event' },
      }),
    ).toThrow(/preserve its identity/)
    expect(editor.score).toBe(before)
  })

  it('tracks the snapshot actually saved while newer changes remain dirty', () => {
    const editor = new ScoreEditor(pianoScore())
    editor.execute({ kind: 'set-title', title: 'Being saved' })
    const saved = editor.score
    editor.execute({ kind: 'set-title', title: 'Typed during save' })
    editor.markSaved(saved)
    expect(editor.isDirty).toBe(true)
    editor.undo()
    expect(editor.isDirty).toBe(false)
    editor.redo()
    expect(editor.isDirty).toBe(true)
    editor.markSaved()
    expect(editor.isDirty).toBe(false)
  })

  it('ignores no-ops and bounds undo history', () => {
    const editor = new ScoreEditor(pianoScore(), { historyLimit: 2 })
    editor.execute({ kind: 'batch', commands: [] })
    editor.execute({ kind: 'set-title', title: editor.score.title })
    expect(editor.revision).toBe(0)
    for (const title of ['One', 'Two', 'Three']) {
      editor.execute({ kind: 'set-title', title })
    }
    editor.undo()
    editor.undo()
    expect(editor.score.title).toBe('One')
    expect(editor.canUndo).toBe(false)
    const revision = editor.revision
    editor.undo()
    expect(editor.revision).toBe(revision)
  })

  it('validates mark creation and replacement through the same transaction interface', () => {
    const editor = new ScoreEditor(pianoScore())
    editor.execute({
      kind: 'put-mark',
      mark: {
        id: 'mark-dynamic',
        kind: 'dynamic',
        eventId: 'event-chord',
        value: 'ff',
      },
    })
    expect(
      editor.score.marks.filter((mark) => mark.id === 'mark-dynamic'),
    ).toEqual([
      {
        id: 'mark-dynamic',
        kind: 'dynamic',
        eventId: 'event-chord',
        value: 'ff',
      },
    ])
    expect(() =>
      editor.execute({
        kind: 'put-mark',
        mark: {
          id: 'bad-dynamic',
          kind: 'dynamic',
          eventId: 'missing',
          value: 'p',
        },
      }),
    ).toThrow(/unknown event/)
  })
})
