/** Engrave a validated score in an isolated Node worker so long scores cannot block desktop IPC. */
import { parentPort, workerData } from 'node:worker_threads'
import createVerovioModule from 'verovio/wasm'
import { VerovioToolkit } from 'verovio/esm'
import { parseScore } from '../core'
import { pdfLayout } from './pdf-layout'
import { projectToMei } from '../notation/mei'

/** Compile complete print pages and release WASM state on every result, including engine failures. */
async function engrave(): Promise<void> {
  let toolkit: VerovioToolkit | undefined
  try {
    const score = parseScore(workerData)
    const projection = projectToMei(score, { placeholders: false })
    toolkit = new VerovioToolkit(await createVerovioModule())
    toolkit.setOptions({
      pageWidth: 1780,
      pageHeight: Math.round(pdfLayout(score.title).musicMm * 10),
      scale: 40,
      svgViewBox: true,
      adjustPageHeight: false,
      pageMarginTop: 50,
      pageMarginBottom: 50,
      pageMarginLeft: 50,
      pageMarginRight: 50,
      breaks: 'auto',
      header: 'none',
      footer: 'none',
      xmlIdSeed: 1,
    })
    if (!toolkit.loadData(projection.mei)) {
      throw new Error('Unable to engrave PDF music')
    }
    const count = toolkit.getPageCount()
    if (count < 1 || count > 200) {
      throw new Error('PDF export exceeds page limit')
    }
    const pages: string[] = []
    let bytes = 0
    for (let page = 1; page <= count; page++) {
      const svg = toolkit.renderToSVG(page)
      if (!svg.includes('<svg')) {
        throw new Error('Missing engraved page')
      }
      bytes += Buffer.byteLength(svg)
      if (bytes > 32 * 1024 * 1024) {
        throw new Error('PDF export exceeds SVG size limit')
      }
      pages.push(svg)
    }
    // Every musical identity must survive pagination; never report success after omitting a trailing system.
    const rendered = new Set(
      pages.flatMap((svg) =>
        [...svg.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]),
      ),
    )
    if (Object.keys(projection.targets).some((id) => !rendered.has(id))) {
      throw new Error('Incomplete musical pagination')
    }
    parentPort!.postMessage({ pages })
  } catch (error) {
    console.error('PDF engraving failed', error)
    parentPort!.postMessage({
      error:
        '五线谱排版失败或超过导出限制（200 页 / 32 MiB）。当前乐谱仍然保留。',
    })
  } finally {
    toolkit?.destroy()
  }
}
void engrave()
