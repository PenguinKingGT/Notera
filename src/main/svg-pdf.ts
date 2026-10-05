/** Print only main-owned vector pages through an isolated sandboxed window with bounded font/image readiness. */
import { BrowserWindow } from 'electron'
import { pdfLayout } from './pdf-layout'
import { PdfExportError } from './pdf-error'

/** Escape only the musical title before placing it in the main-owned print document. */
function htmlText(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!,
  )
}

/** Compose fixed physical pages; separate SVG image documents prevent cross-page glyph-ID collisions. */
export function printHtml(
  title: string,
  pages: readonly string[],
  label = '钢琴五线谱',
): string {
  const layout = pdfLayout(title)
  const sections = pages
    .map(
      (svg, index) =>
        `<section class="page"><h1>${htmlText(title)}</h1><img alt="${htmlText(label)}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"><footer>${index + 1} / ${pages.length}</footer></section>`,
    )
    .join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:;"><title>${htmlText(title)}</title><style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; color: #000; background: #fff; }
    .page { width: 210mm; height: 297mm; padding: 16mm; break-after: page; }
    .page:last-child { break-after: auto; }
    h1 { height: ${layout.headerMm}mm; margin: 0; font: ${layout.titlePt}pt/1.2 'PingFang SC', 'Songti SC', serif; text-align: center; overflow-wrap: anywhere; }
    img { display: block; width: 178mm; height: ${layout.musicMm}mm; }
    footer { height: 6mm; font: 9pt/6mm 'PingFang SC', serif; text-align: center; }
  </style></head><body>${sections}</body></html>`
}

/** Print only main-generated vector pages; numbered and staff notation share asset readiness and resource limits. */
export async function printPagesPdf(
  title: string,
  pages: readonly string[],
  label = '钢琴五线谱',
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const window = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    /** Complete layout/assets before printing so empty or partially decoded pages cannot look successful. */
    const printing = async () => {
      await window.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(printHtml(title, pages, label))}`,
      )
      await window.webContents.executeJavaScript(
        'Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.decode())]).then(() => true)',
      )
      const bytes = await window.webContents.printToPDF({
        pageSize: 'A4',
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: false,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      })
      if (
        !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) ||
        bytes.length > 64 * 1024 * 1024
      ) {
        throw new Error('Invalid PDF output')
      }
      return { bytes, pageCount: pages.length }
    }
    return await Promise.race([
      printing(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('PDF printing timeout')),
          60_000,
        )
      }),
    ])
  } catch (error) {
    console.error('PDF printing failed', error)
    throw new PdfExportError(
      'PDF 生成失败，请重试；未写入目标文件，当前乐谱仍然保留。',
    )
  } finally {
    clearTimeout(timer)
    if (!window.isDestroyed()) {
      window.destroy()
    }
  }
}
