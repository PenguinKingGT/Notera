/** Offline WASM engraving in a dedicated worker so score layout cannot block renderer interactions. */
import createVerovioModule from 'verovio/wasm'
import { VerovioToolkit } from 'verovio/esm'
import { parseScore } from '../core'
import { projectToMei } from './mei'
import type { EngraveRequest, EngraveResponse } from './protocol'

const workerScope = globalThis as unknown as {
  onmessage: (event: MessageEvent<EngraveRequest>) => void
  postMessage: (message: EngraveResponse) => void
}
const engine = createVerovioModule()

/** Validate each incoming score, generate all pages and always release per-render engine memory. */
workerScope.onmessage = async ({ data }) => {
  let toolkit: VerovioToolkit | undefined
  try {
    const projection = projectToMei(parseScore(data.score))
    toolkit = new VerovioToolkit(await engine)
    toolkit.setOptions({
      pageWidth: 2100,
      pageHeight: 2400,
      scale: 40,
      adjustPageHeight: false,
      breaks: 'auto',
      header: 'none',
      footer: 'none',
      xmlIdSeed: 1,
    })
    if (!toolkit.loadData(projection.mei)) {
      throw new Error('Unable to lay out the score')
    }
    const pages = Array.from({ length: toolkit.getPageCount() }, (_, index) =>
      toolkit!.renderToSVG(index + 1),
    )
    workerScope.postMessage({
      requestId: data.requestId,
      pages,
      targets: projection.targets,
    })
  } catch (error) {
    console.error('Score engraving failed', error)
    workerScope.postMessage({
      requestId: data.requestId,
      error: '谱面暂时无法排版。请重试，已有音乐内容仍然保留。',
    })
  } finally {
    toolkit?.destroy()
  }
}
