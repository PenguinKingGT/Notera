/** Ensure renderer chrome updates retain musical SVG annotations and selected DOM identities. */
import { render } from '@testing-library/react'
import { expect, test } from 'vitest'
import { EditorSession } from '../../../editor/session'
import { createPianoScore } from '../../../core'
import { PlaybackController } from '../../../playback/controller'
import { ScoreCanvas } from './ScoreCanvas'
import type { EngraveResponse } from '../../../notation/protocol'

test('unrelated view state preserves the selected SVG node instead of rebuilding raw markup', () => {
  const playback = new PlaybackController(async () => {
    throw new Error('Audio should not initialize')
  })
  let id = 0
  const session = new EditorSession(
    createPianoScore({ id: 's' }),
    () => `id-${++id}`,
  )
  session.inputPitch('C')
  const snapshot = session.getSnapshot()
  const selection = snapshot.selection!
  const response: EngraveResponse = {
    requestId: 1,
    pages: ['<svg><g id="symbol"><path d="M0 0L1 1" /></g></svg>'],
    targets: {
      symbol: {
        kind: 'event',
        eventId: selection.eventId,
        noteId: selection.noteId,
      },
    },
  }
  const { container, rerender } = render(
    <ScoreCanvas
      playback={playback}
      session={session}
      snapshot={snapshot}
      response={response}
      pending={false}
    />,
  )
  const original = container.querySelector('#symbol')!
  expect(original.getAttribute('data-selected')).toBe('true')
  rerender(
    <ScoreCanvas
      playback={playback}
      session={session}
      snapshot={{ ...snapshot, mode: 'edit' }}
      response={response}
      pending={false}
    />,
  )
  expect(container.querySelector('#symbol')).toBe(original)
  expect(original.getAttribute('data-selected')).toBe('true')
})
