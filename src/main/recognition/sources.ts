/** Read only explicitly chosen local files, enforcing source-page and byte limits before model requests. */
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { basename, extname, isAbsolute } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import type { RecognitionPage } from './provider'
import { RecognitionError } from '../../recognition/errors'

const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_SOURCE_PAGES = 30

/** Read bounded chunks even if a selected file grows during the read. */
async function readSource(path: string): Promise<Buffer> {
  const stream = createReadStream(path)
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of stream) {
      const bytes = chunk as Buffer
      size += bytes.length
      if (size > MAX_FILE_BYTES) {
        throw new RecognitionError('每个识谱文件最多 10 MiB。')
      }
      chunks.push(bytes)
    }
    return Buffer.concat(chunks, size)
  } finally {
    stream.destroy()
  }
}

/** Reject oversized image headers before a service or image decoder attempts expensive decompression. */
function imageDimensions(
  bytes: Buffer,
  extension: string,
): { width: number; height: number; mediaType: 'image/png' | 'image/jpeg' } {
  if (
    extension === '.png' &&
    bytes.length >= 24 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString('ascii', 12, 16) === 'IHDR'
  ) {
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
      mediaType: 'image/png',
    }
  }
  if (
    ['.jpg', '.jpeg'].includes(extension) &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8
  ) {
    let offset = 2
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        break
      }
      while (bytes[offset] === 0xff) {
        offset += 1
      }
      const marker = bytes[offset++]
      if (marker === 0xd9 || marker === 0xda) {
        break
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        continue
      }
      if (offset + 2 > bytes.length) {
        break
      }
      const length = bytes.readUInt16BE(offset)
      if (length < 2 || offset + length > bytes.length) {
        break
      }
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        length >= 8
      ) {
        return {
          width: bytes.readUInt16BE(offset + 5),
          height: bytes.readUInt16BE(offset + 3),
          mediaType: 'image/jpeg',
        }
      }
      offset += length
    }
  }
  throw new RecognitionError('请选择有效的 PNG 或 JPEG 图片。')
}

/** Prepare an entire selection before replacing a task; failed validation retains the prior source list. */
export async function prepareSources(
  paths: readonly string[],
): Promise<RecognitionPage[]> {
  if (
    !paths.length ||
    paths.length > MAX_SOURCE_PAGES ||
    paths.some((path) => !isAbsolute(path))
  ) {
    throw new RecognitionError('请通过文件选择器选择 1–30 个本地文件。')
  }
  const pages: RecognitionPage[] = []
  let total = 0
  /** Bound prepared PDF pages as well as selected originals to prevent unbounded retained memory. */
  function append(page: RecognitionPage): void {
    total += page.bytes.byteLength
    if (
      pages.length >= MAX_SOURCE_PAGES ||
      total > 40 * 1024 * 1024 ||
      page.bytes.byteLength > MAX_FILE_BYTES
    ) {
      throw new RecognitionError(
        '最多 30 个来源页，每页最多 10 MiB，来源数据合计最多 40 MiB。',
      )
    }
    pages.push(page)
  }
  for (const path of paths) {
    const bytes = await readSource(path)
    const extension = extname(path).toLowerCase()
    if (extension === '.pdf') {
      if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw new RecognitionError('文件不是有效 PDF。')
      }
      let pdf: PDFDocument
      try {
        pdf = await PDFDocument.load(bytes)
      } catch {
        throw new RecognitionError('PDF 无法读取；请使用未加密且完整的 PDF。')
      }
      if (
        !pdf.getPageCount() ||
        pdf.getPageCount() + pages.length > MAX_SOURCE_PAGES
      ) {
        throw new RecognitionError('PDF 与图片合计最多 30 个来源页。')
      }
      for (let index = 0; index < pdf.getPageCount(); index += 1) {
        const single = await PDFDocument.create()
        const [page] = await single.copyPages(pdf, [index])
        single.addPage(page)
        append({
          id: randomUUID(),
          name: `${basename(path)} · 第 ${index + 1} 页`,
          kind: 'pdf',
          mediaType: 'application/pdf',
          bytes: await single.save(),
        })
      }
    } else {
      const dimensions = imageDimensions(bytes, extension)
      if (
        !dimensions.width ||
        !dimensions.height ||
        dimensions.width > 8000 ||
        dimensions.height > 8000 ||
        dimensions.width * dimensions.height > 25_000_000
      ) {
        throw new RecognitionError(
          '图片每边最多 8000 像素，合计最多 2500 万像素。',
        )
      }
      append({
        id: randomUUID(),
        name: basename(path),
        kind: 'image',
        mediaType: dimensions.mediaType,
        bytes,
      })
    }
  }
  return pages
}
