/** Export numbered notation from the shared score using independent pagination and the trusted vector printer. */
import type { Score } from '../core'
import { engravePdfPages } from './pdf-pages'
import { printPagesPdf } from './svg-pdf'

/** Keep numbered output separate from native save state and run layout away from desktop IPC. */
export async function renderJianpuPdf(
  score: Score,
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const pages = await engravePdfPages(
    score,
    new URL('./jianpu-pdf-worker.js', import.meta.url),
    '简谱',
  )
  return printPagesPdf(score.title, pages, '钢琴简谱')
}
