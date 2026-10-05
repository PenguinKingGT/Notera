/** Request numbered notation only while visible and discard obsolete worker results after musical edits. */
import { useEffect, useRef, useState } from 'react'
import type { Score } from '../../core'
import type { JianpuRequest, JianpuResponse } from '../../jianpu/protocol'

/** Own a bounded worker lifetime and associate each result with its exact immutable score identity. */
export function useJianpu(score: Score, enabled: boolean) {
  const [result, setResult] = useState<{
    score: Score
    retry: number
    response: JianpuResponse
  } | null>(null)
  const [retry, setRetry] = useState(0)
  const sequence = useRef(0)
  const worker = useRef<Worker | null>(null)
  const pending = useRef<{ score: Score; requestId: number } | null>(null)

  useEffect(() => {
    if (!enabled) {
      return
    }
    const instance = new Worker(
      new URL('../../jianpu/jianpu.worker.ts', import.meta.url),
      { type: 'module' },
    )
    worker.current = instance
    instance.onmessage = ({ data }: MessageEvent<JianpuResponse>) => {
      if (pending.current?.requestId === data.requestId) {
        setResult({ score: pending.current.score, retry, response: data })
      }
    }
    instance.onerror = () => {
      const request = pending.current
      if (request) {
        setResult({
          score: request.score,
          retry,
          response: {
            requestId: request.requestId,
            error: '简谱排版服务启动失败，请重试。',
          },
        })
      }
    }
    return () => {
      instance.terminate()
      worker.current = null
      pending.current = null
    }
  }, [enabled, retry])

  useEffect(() => {
    if (!enabled) {
      return
    }
    const requestId = ++sequence.current
    pending.current = { score, requestId }
    const timer = window.setTimeout(() => {
      worker.current?.postMessage({ score, requestId } satisfies JianpuRequest)
    }, 40)
    return () => window.clearTimeout(timer)
  }, [score, enabled, retry])

  return {
    response:
      result?.score === score && result.retry === retry
        ? result.response
        : null,
    pending: enabled && (result?.score !== score || result?.retry !== retry),
    retry: () => setRetry((count) => count + 1),
  }
}
