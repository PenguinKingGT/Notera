/** Manage the isolated engraving worker and discard results belonging to obsolete score snapshots. */
import { useEffect, useRef, useState } from 'react'
import type { Score } from '../../core'
import type { EngraveRequest, EngraveResponse } from '../../notation/protocol'

/** Queue engraving off the UI thread; cleanup supports React StrictMode and document replacement. */
export function useEngraving(score: Score) {
  const [result, setResult] = useState<{
    score: Score
    retry: number
    response: EngraveResponse
  } | null>(null)
  const [retry, setRetry] = useState(0)
  const sequence = useRef(0)
  const worker = useRef<Worker | null>(null)
  const pending = useRef<{ score: Score; requestId: number } | null>(null)

  useEffect(() => {
    const instance = new Worker(
      new URL('../../notation/engraving.worker.ts', import.meta.url),
      { type: 'module' },
    )
    worker.current = instance
    /** Associate successful or failed responses only with the latest requested document. */
    instance.onmessage = ({ data }: MessageEvent<EngraveResponse>) => {
      if (pending.current?.requestId === data.requestId) {
        setResult({ score: pending.current.score, response: data, retry })
      }
    }
    /** Surface initialization/CSP failures without erasing musical content. */
    instance.onerror = () => {
      const request = pending.current
      if (request) {
        setResult({
          score: request.score,
          retry,
          response: {
            requestId: request.requestId,
            error: '排版引擎启动失败，请重试。',
          },
        })
      }
    }
    return () => {
      instance.terminate()
      worker.current = null
    }
  }, [retry])

  useEffect(() => {
    const requestId = ++sequence.current
    pending.current = { score, requestId }
    const timer = window.setTimeout(() => {
      worker.current?.postMessage({ score, requestId } satisfies EngraveRequest)
    }, 40)
    return () => window.clearTimeout(timer)
  }, [score, retry])

  return {
    response: result?.response ?? null,
    pending: result?.score !== score || result?.retry !== retry,
    retry: () => setRetry((count) => count + 1),
  }
}
