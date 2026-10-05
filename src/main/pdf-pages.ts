/** Bound an application-owned engraving worker and always release it after success, failure or timeout. */
import { Worker } from 'node:worker_threads'
import type { Score } from '../core'
import { PdfExportError } from './pdf-error'

/** Accept a main-owned worker URL and validated snapshot; return only complete bounded SVG page arrays. */
export function engravePdfPages(
  score: Score,
  workerUrl: URL,
  label: string,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, { workerData: score })
    let finished = false
    const timer = setTimeout(
      () =>
        finish(new PdfExportError(`${label} PDF 排版超时，请缩短乐谱后重试。`)),
      60_000,
    )
    /** Complete the operation once and terminate native/JavaScript worker allocations on every path. */
    function finish(error: Error | null, pages?: string[]): void {
      if (finished) {
        return
      }
      finished = true
      clearTimeout(timer)
      void worker.terminate()
      if (error) {
        reject(error)
      } else {
        resolve(pages!)
      }
    }
    worker.once('message', (message: { pages?: string[]; error?: string }) => {
      if (message.error || !message.pages?.length) {
        finish(
          new PdfExportError(message.error ?? `${label}排版未生成完整页面。`),
        )
      } else if (
        message.pages.length > 200 ||
        message.pages.reduce(
          (total, page) => total + Buffer.byteLength(page),
          0,
        ) >
          32 * 1024 * 1024
      ) {
        finish(
          new PdfExportError(`${label}排版超过导出限制（200 页 / 32 MiB）。`),
        )
      } else {
        finish(null, message.pages)
      }
    })
    worker.once('error', () =>
      finish(new PdfExportError(`${label} PDF 排版服务启动失败，请重试。`)),
    )
    worker.once('exit', () => {
      if (!finished) {
        finish(new PdfExportError(`${label} PDF 排版服务意外退出，请重试。`))
      }
    })
  })
}
