/** Protect identity mapping from stale worker results and verify recovery recreates an isolated worker. */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { applyScoreCommand, createPianoScore } from '../../core'
import type { EngraveRequest, EngraveResponse } from '../../notation/protocol'
import { useEngraving } from './useEngraving'

/** Deterministic message transport; the production Electron test exercises the actual WASM engine. */
class WorkerStub {
  static instances: WorkerStub[] = []
  messages: EngraveRequest[] = []
  onmessage: ((event: { data: EngraveResponse }) => void) | null = null
  onerror: (() => void) | null = null
  terminated = false

  /** Record worker creation without fetching an external resource. */
  constructor() {
    WorkerStub.instances.push(this)
  }

  /** Capture the document crossing the asynchronous boundary. */
  postMessage(request: EngraveRequest) {
    this.messages.push(request)
  }

  /** Release the stub just as unmount or retry releases a real worker. */
  terminate() {
    this.terminated = true
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  WorkerStub.instances = []
})

test('ignores obsolete pages and keeps retry pending until the new worker returns', async () => {
  vi.stubGlobal('Worker', WorkerStub)
  const initial = createPianoScore({ id: 'score' })
  const { result, rerender, unmount } = renderHook(
    ({ score }) => useEngraving(score),
    { initialProps: { score: initial } },
  )
  const first = WorkerStub.instances[0]
  await waitFor(() => expect(first.messages).toHaveLength(1))
  const changed = applyScoreCommand(initial, {
    kind: 'set-title',
    title: 'Edited',
  })
  rerender({ score: changed })
  await waitFor(() => expect(first.messages).toHaveLength(2))
  act(() =>
    first.onmessage?.({
      data: {
        requestId: first.messages[0].requestId,
        pages: ['obsolete'],
        targets: {},
      },
    }),
  )
  expect(result.current.pending).toBe(true)
  expect(result.current.response).toBeNull()
  act(() => first.onerror?.())
  expect(result.current.pending).toBe(false)
  expect(result.current.response).toHaveProperty('error')
  act(() => result.current.retry())
  expect(first.terminated).toBe(true)
  expect(result.current.pending).toBe(true)
  const replacement = WorkerStub.instances[1]
  await waitFor(() => expect(replacement.messages).toHaveLength(1))
  act(() =>
    replacement.onmessage?.({
      data: {
        requestId: replacement.messages[0].requestId,
        pages: ['current'],
        targets: {},
      },
    }),
  )
  expect(result.current.pending).toBe(false)
  expect(result.current.response).toHaveProperty('pages', ['current'])
  unmount()
  expect(replacement.terminated).toBe(true)
})
