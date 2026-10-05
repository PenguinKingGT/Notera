// @vitest-environment node
/** Verify title reservation preserves fixed A4 page height and retains space for music for native maximum-length titles. */
import { expect, test } from 'vitest'
import { pdfLayout } from './pdf-layout'

test('short and long Unicode titles share matching print/engraving dimensions', () => {
  for (const title of ['钢琴曲', '长标题'.repeat(30), '长'.repeat(1000)]) {
    const layout = pdfLayout(title)
    expect(layout.headerMm + layout.musicMm + 32 + 6).toBe(297)
    expect(layout.musicMm).toBeGreaterThan(150)
    expect(layout.titlePt).toBeGreaterThanOrEqual(8)
  }
})
