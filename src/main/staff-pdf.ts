/** Export staff notation from an immutable score using isolated engraving and the shared trusted vector printer. */
import type { Score } from '../core'
import { engravePdfPages } from './pdf-pages'
import { printPagesPdf } from './svg-pdf'

/** Print a fresh staff projection without accepting renderer-generated pages or transient editing highlights. */
export async function renderStaffPdf(
  score: Score,
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const pages = await engravePdfPages(
    score,
    new URL('./pdf-worker.js', import.meta.url),
    '五线谱',
  )
  return printPagesPdf(score.title, pages)
}
