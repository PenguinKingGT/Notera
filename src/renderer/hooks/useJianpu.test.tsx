/** Verify numbered notation never publishes obsolete music and releases workers when the view is closed. */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { createPianoScore } from '../../core'
import { useJianpu } from './useJianpu'
import type { JianpuRequest, JianpuResponse } from '../../jianpu/protocol'

/** Model worker messages explicitly so out-of-order completion can be tested without a desktop runtime. */
class TestWorker {
  static instances: TestWorker[] = []
  onmessage: ((event: MessageEvent<JianpuResponse>) => void) | null = null
  onerror: (() => void) | null = null
  requests: JianpuRequest[] = []
  terminated = false

  /** Retain only test-owned instances and their queued immutable musical requests. */
  constructor() {
    TestWorker.instances.push(this)
  }

  /** Record a job without completing it automatically, exposing races to the test. */
  postMessage(request: JianpuRequest) {
    this.requests.push(request)
  }

  /** Record cleanup without cancelling callbacks the test deliberately delivers late. */
  terminate() {
    this.terminated = true
  }

  /** Publish deterministic pages associated with a chosen captured request identity. */
  reply(request: JianpuRequest, page: string) {
    this.onmessage?.({
      data: { requestId: request.requestId, pages: [page], height: 1200 },
    } as MessageEvent<JianpuResponse>)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  TestWorker.instances = []
})

test('late worker replies cannot replace a more recent score and retry clears the current error state', async () => {
  vi.stubGlobal('Worker', TestWorker)
  const first = createPianoScore({ id: 'first' })
  const second = createPianoScore({ id: 'second' })
  const { result, rerender, unmount } = renderHook(
    ({ score, enabled }) => useJianpu(score, enabled),
    { initialProps: { score: first, enabled: true } },
  )
  const worker = TestWorker.instances[0]
  await waitFor(() => expect(worker.requests).toHaveLength(1))
  rerender({ score: second, enabled: true })
  await waitFor(() => expect(worker.requests).toHaveLength(2))
  act(() => worker.reply(worker.requests[0], 'obsolete'))
  expect(result.current.pending).toBe(true)
  expect(result.current.response).toBeNull()
  act(() => worker.reply(worker.requests[1], 'current'))
  expect(result.current.response).toMatchObject({ pages: ['current'] })
  act(() => result.current.retry())
  expect(result.current.pending).toBe(true)
  expect(result.current.response).toBeNull()
  expect(worker.terminated).toBe(true)
  rerender({ score: second, enabled: false })
  expect(TestWorker.instances.at(-1)?.terminated).toBe(true)
  unmount()
})
