// @vitest-environment node
/** Exercise mark intentions against exact musical validation, history and native-file round trips. */
import { describe, expect, it, vi } from 'vitest'
import {
  createPianoScore,
  deserializeScore,
  fraction,
  serializeScore,
} from '../core'
import type { Score } from '../core'
import { compatibleMarkEnd, markEndpoints } from './marks'
import { EditorSession } from './session'

/** Provide adjacent notes across a bar, two voices in the upper staff and a lower-staff event. */
function fixture(): Score {
  const score = createPianoScore({ id: 'score', measureCount: 2 })
  return {
    ...score,
    voices: [
      ...score.voices,
      { id: 'upper-second', staffId: score.staves[0].id },
    ],
    measures: score.measures.map((measure, index) => ({
      ...measure,
      voices: [
        {
          voiceId: score.voices[0].id,
          events: [
            {
              id: `event-${index}`,
              kind: 'note',
              onset: fraction(index === 0 ? 3 : 0, 4),
              duration: { denominator: 4, dots: 0 },
              notes: [
                {
                  id: `note-${index}`,
                  pitch: { step: 'C', alter: 0, octave: 4 },
                },
                {
                  id: `chord-${index}`,
                  pitch: { step: 'E', alter: 0, octave: 4 },
                },
              ],
            },
          ],
        },
        {
          voiceId: 'upper-second',
          events: [
            {
              id: `other-${index}`,
              kind: 'rest',
              onset: fraction(index === 0 ? 3 : 0, 4),
              duration: { denominator: 4, dots: 0 },
            },
          ],
        },
        {
          voiceId: score.voices[1].id,
          events: [
            {
              id: `lower-${index}`,
              kind: 'rest',
              onset: fraction(index === 0 ? 3 : 0, 4),
              duration: { denominator: 4, dots: 0 },
            },
          ],
        },
      ],
    })),
  }
}

/** Give new marks predictable identities without weakening real core validation. */
function session() {
  let identity = 0
  return new EditorSession(fixture(), () => `mark-${++identity}`)
}

describe('musical mark editing', () => {
  it('connects an individual chord tone across a bar and preserves history and file identity', () => {
    const editor = session()
    editor.select({ kind: 'event', eventId: 'event-0', noteId: 'chord-0' })
    const selection = editor.getSnapshot().selection
    expect(
      editor.putMark({
        kind: 'tie',
        startNoteId: 'chord-0',
        endNoteId: 'chord-1',
      }),
    ).toBe(true)
    const tied = editor.getSnapshot().score
    expect(editor.getSnapshot().selection).toEqual(selection)
    expect(deserializeScore(serializeScore(tied))).toEqual(tied)
    editor.undo()
    expect(editor.getSnapshot().score.marks).toEqual([])
    editor.redo()
    expect(editor.getSnapshot().score).toEqual(tied)
    editor.deleteMark(tied.marks[0].id)
    expect(editor.getSnapshot().score.marks).toEqual([])
    expect(editor.getSnapshot().score.measures).toEqual(tied.measures)
    editor.undo()
    expect(editor.getSnapshot().score).toEqual(tied)
  })

  it('updates an existing dynamic without stacking and rolls back invalid span edits', () => {
    const editor = session()
    editor.putMark({ kind: 'dynamic', eventId: 'event-0', value: 'p' })
    const dynamic = editor.getSnapshot().score.marks[0]
    editor.putMark({ kind: 'dynamic', eventId: 'event-0', value: 'ff' })
    expect(editor.getSnapshot().score.marks).toEqual([
      { ...dynamic, value: 'ff' },
    ])
    const before = editor.getSnapshot()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(
        editor.putMark({
          kind: 'tie',
          startNoteId: 'note-0',
          endNoteId: 'chord-1',
        }),
      ).toBe(false)
      expect(editor.getSnapshot().score).toBe(before.score)
      expect(editor.getSnapshot().dirty).toBe(before.dirty)
      expect(editor.getSnapshot().selection).toBe(before.selection)
      expect(editor.getSnapshot().error).toContain('音高拼写')
      editor.undo()
      expect(editor.getSnapshot().score.marks).toEqual([dynamic])
    } finally {
      consoleError.mockRestore()
    }
  })

  it('keeps a saved document clean when a mark is invalid and rejects duplicate targets on revision', () => {
    const editor = session()
    editor.reset(editor.getSnapshot().score, true)
    const initial = editor.getSnapshot().score
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(
        editor.putMark({
          kind: 'tie',
          startNoteId: 'note-1',
          endNoteId: 'note-0',
        }),
      ).toBe(false)
      expect(editor.getSnapshot().score).toBe(initial)
      expect(editor.getSnapshot().dirty).toBe(false)
      expect(editor.getSnapshot().canUndo).toBe(false)
    } finally {
      consoleError.mockRestore()
    }
    editor.putMark({ kind: 'dynamic', eventId: 'event-0', value: 'p' })
    editor.putMark({ kind: 'dynamic', eventId: 'event-1', value: 'f' })
    const before = editor.getSnapshot().score
    expect(
      editor.putMark(
        { kind: 'dynamic', eventId: 'event-0', value: 'ff' },
        before.marks[1].id,
      ),
    ).toBe(false)
    expect(editor.getSnapshot().score).toBe(before)
    expect(editor.getSnapshot().error).toContain('已有同类型记号')
    editor.undo()
    expect(editor.getSnapshot().score.marks).toHaveLength(1)
  })

  it('updates a repeated range instead of introducing a duplicate, with undo restoring its count', () => {
    const editor = session()
    const measures = editor.getSnapshot().score.measures
    const repeat = {
      kind: 'repeat' as const,
      startMeasureId: measures[0].id,
      endMeasureId: measures[1].id,
      times: 2,
    }
    editor.putMark(repeat)
    const original = editor.getSnapshot().score.marks[0]
    editor.putMark({ ...repeat, times: 4 })
    expect(editor.getSnapshot().score.marks).toEqual([
      { ...original, times: 4 },
    ])
    editor.undo()
    expect(editor.getSnapshot().score.marks).toEqual([original])
  })

  it('allows same-staff cross-voice pedal but rejects cross-staff pedal and rest slur', () => {
    const editor = session()
    expect(
      editor.putMark({
        kind: 'pedal',
        startEventId: 'event-0',
        endEventId: 'other-1',
      }),
    ).toBe(true)
    const before = editor.getSnapshot().score
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(
        editor.putMark({
          kind: 'pedal',
          startEventId: 'event-0',
          endEventId: 'lower-1',
        }),
      ).toBe(false)
      expect(
        editor.putMark({
          kind: 'slur',
          startEventId: 'event-0',
          endEventId: 'other-1',
        }),
      ).toBe(false)
      expect(editor.getSnapshot().score).toBe(before)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('revises imported marks and cannot recreate an identity removed by history or endpoint deletion', () => {
    const editor = session()
    editor.putMark({
      kind: 'slur',
      startEventId: 'event-0',
      endEventId: 'event-1',
    })
    const original = editor.getSnapshot().score.marks[0]
    editor.reset(editor.getSnapshot().score, true)
    expect(
      editor.putMark(
        { kind: 'slur', startEventId: 'event-0', endEventId: 'event-1' },
        original.id,
      ),
    ).toBe(true)
    expect(editor.getSnapshot().dirty).toBe(false)
    editor.select({ kind: 'event', eventId: 'event-0' })
    editor.deleteSelection()
    expect(editor.getSnapshot().score.marks).toEqual([])
    const score = editor.getSnapshot().score
    expect(
      editor.putMark(
        { kind: 'slur', startEventId: 'event-0', endEventId: 'event-1' },
        original.id,
      ),
    ).toBe(false)
    expect(editor.getSnapshot().score).toBe(score)
    editor.undo()
    expect(editor.getSnapshot().score.marks).toEqual([original])
  })

  it('validates repeat overlap and count without publishing a partial range', () => {
    const editor = session()
    const measures = editor.getSnapshot().score.measures
    const input = {
      kind: 'repeat' as const,
      startMeasureId: measures[0].id,
      endMeasureId: measures[1].id,
      times: 2,
    }
    editor.putMark(input)
    const mark = editor.getSnapshot().score.marks[0]
    expect(editor.putMark({ ...input, times: 3 }, mark.id)).toBe(true)
    expect(editor.getSnapshot().score.marks[0]).toMatchObject({
      id: mark.id,
      times: 3,
    })
    const before = editor.getSnapshot().score
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(editor.putMark({ ...input, times: 1 }, mark.id)).toBe(false)
      expect(editor.putMark({ ...input, startMeasureId: measures[1].id })).toBe(
        false,
      )
      expect(editor.getSnapshot().score).toBe(before)
    } finally {
      consoleError.mockRestore()
    }
    editor.undo()
    expect(editor.getSnapshot().score.marks[0]).toEqual(mark)
  })
})

it('offers compatible endpoints using exact time, spelling, voice and staff', () => {
  const score = fixture()
  const ties = markEndpoints(score, 'tie')
  const start = ties.find((endpoint) => endpoint.id === 'note-0')!
  expect(
    ties
      .filter((end) => compatibleMarkEnd('tie', start, end))
      .map((end) => end.id),
  ).toEqual(['note-1'])
  const pedal = markEndpoints(score, 'pedal')
  const pedalStart = pedal.find((endpoint) => endpoint.id === 'event-0')!
  expect(
    pedal
      .filter((end) => compatibleMarkEnd('pedal', pedalStart, end))
      .map((end) => end.id),
  ).toEqual(['event-1', 'other-1'])
  const slurs = markEndpoints(score, 'slur')
  expect(slurs.map((endpoint) => endpoint.id)).toEqual(['event-0', 'event-1'])
  const measures = markEndpoints(score, 'repeat')
  expect(compatibleMarkEnd('repeat', measures[0], measures[0])).toBe(true)
  expect(compatibleMarkEnd('repeat', measures[1], measures[0])).toBe(false)
})
