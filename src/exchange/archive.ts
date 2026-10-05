/** Read/write MXL in memory with bounded inflation, ZIP integrity checks and no filesystem extraction. */
import { Unzip, UnzipInflate, zipSync } from 'fflate'
import { child, children, ExchangeError, MAX_XML_BYTES, parseXml } from './xml'

export const MAX_ARCHIVE_BYTES = 12 * 1024 * 1024
const MAX_EXPANDED_BYTES = 16 * 1024 * 1024
const MIME = 'application/vnd.recordare.musicxml'

interface Entry {
  name: string
  size: number
  compressed: number
  crc: number
  method: number
}

/** Restrict archive names to relative POSIX paths, excluding ambiguous aliases and filesystem escapes. */
function safeName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 512 &&
    !/[\\:]/.test(name) &&
    !Array.from(name).some((character) => character.charCodeAt(0) < 32) &&
    !name.startsWith('/') &&
    !name
      .split('/')
      .some(
        (part, index, parts) =>
          part === '..' || part === '.' || (!part && index < parts.length - 1),
      )
  )
}

/** Check CRC-32 of inflated bytes; fflate intentionally does not validate ZIP checksums. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Inspect the bounded central directory before inflation; reject ZIP64, encryption, duplicates and forged offsets. */
function indexArchive(bytes: Uint8Array): Map<string, Entry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  for (; end >= Math.max(0, bytes.length - 65_558); end--) {
    if (
      view.getUint32(end, true) === 0x06054b50 &&
      end + 22 + view.getUint16(end + 20, true) === bytes.length
    ) {
      break
    }
  }
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) {
    throw new ExchangeError('MXL 缺少完整 ZIP 目录。')
  }
  const count = view.getUint16(end + 10, true)
  const size = view.getUint32(end + 12, true)
  let offset = view.getUint32(end + 16, true)
  if (
    !count ||
    count > 64 ||
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    view.getUint16(end + 8, true) !== count ||
    offset + size !== end
  ) {
    throw new ExchangeError('不支持多卷、ZIP64 或超过 64 个条目的 MXL。')
  }
  const entries = new Map<string, Entry>()
  let total = 0
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) {
      throw new ExchangeError('MXL 的 ZIP 目录损坏。')
    }
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const next = offset + 46 + nameLength + extraLength + commentLength
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const compressed = view.getUint32(offset + 20, true)
    const original = view.getUint32(offset + 24, true)
    const local = view.getUint32(offset + 42, true)
    if (
      next > end ||
      local + 30 > view.getUint32(end + 16, true) ||
      view.getUint32(local, true) !== 0x04034b50 ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      view.getUint16(offset + 34, true)
    ) {
      throw new ExchangeError('MXL 含加密、未知压缩方式或损坏的条目。')
    }
    const name = new globalThis.TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    )
    const localNameLength = view.getUint16(local + 26, true)
    const localExtraLength = view.getUint16(local + 28, true)
    const dataStart = local + 30 + localNameLength + localExtraLength
    const localName = new globalThis.TextDecoder('utf-8', {
      fatal: true,
    }).decode(bytes.subarray(local + 30, local + 30 + localNameLength))
    total += original
    if (
      !safeName(name) ||
      entries.has(name) ||
      localName !== name ||
      dataStart + compressed > view.getUint32(end + 16, true) ||
      view.getUint16(local + 6, true) !== flags ||
      view.getUint16(local + 8, true) !== method ||
      original > MAX_XML_BYTES ||
      total > MAX_EXPANDED_BYTES
    ) {
      throw new ExchangeError('MXL 的路径、条目大小或解压总量超过安全限制。')
    }
    entries.set(name, {
      name,
      size: original,
      compressed,
      crc: view.getUint32(offset + 16, true),
      method,
    })
    offset = next
  }
  if (offset !== end) {
    throw new ExchangeError('MXL 的 ZIP 目录长度不一致。')
  }
  return entries
}

/** Inflate small input chunks and compare actual sizes/checksums, never trusting declared uncompressed sizes alone. */
export function unpackMxl(bytes: Uint8Array): string {
  if (bytes.length > MAX_ARCHIVE_BYTES || bytes.length < 22) {
    throw new ExchangeError('MXL 文件大小超出读取范围。')
  }
  try {
    const entries = indexArchive(bytes)
    const files = new Map<string, Uint8Array>()
    const seen = new Set<string>()
    let total = 0
    const unzip = new Unzip((file) => {
      const entry = entries.get(file.name)
      if (!entry || seen.has(file.name) || entry.method !== file.compression) {
        throw new ExchangeError('MXL 的本地条目与 ZIP 目录不一致。')
      }
      seen.add(file.name)
      let length = 0
      const chunks: Uint8Array[] = []
      file.ondata = (error, chunk, final) => {
        if (error) {
          throw error
        }
        length += chunk.length
        total += chunk.length
        if (
          length > entry.size ||
          length > MAX_XML_BYTES ||
          total > MAX_EXPANDED_BYTES
        ) {
          throw new ExchangeError('MXL 实际解压量超过限制。')
        }
        chunks.push(chunk)
        if (final) {
          const data = new Uint8Array(length)
          let offset = 0
          for (const part of chunks) {
            data.set(part, offset)
            offset += part.length
          }
          if (length !== entry.size || crc32(data) !== entry.crc) {
            throw new ExchangeError('MXL 条目长度或校验和错误。')
          }
          files.set(file.name, data)
        }
      }
      file.start()
    })
    unzip.register(UnzipInflate)
    for (let offset = 0; offset < bytes.length; offset += 256) {
      unzip.push(
        bytes.subarray(offset, offset + 256),
        offset + 256 >= bytes.length,
      )
    }
    if (files.size !== entries.size) {
      throw new ExchangeError('MXL 有未完成的压缩条目。')
    }
    const container = files.get('META-INF/container.xml')
    if (!container || container.length > 64 * 1024) {
      throw new ExchangeError('MXL 缺少有效 META-INF/container.xml。')
    }
    const root = parseXml(decodeXml(container))
    const rootfiles = child(root, 'rootfiles')
    const first = rootfiles && children(rootfiles, 'rootfile')[0]
    const path = first?.attributes['full-path']
    if (
      root.name !== 'container' ||
      !path ||
      !safeName(path) ||
      (first.attributes['media-type'] &&
        first.attributes['media-type'] !== `${MIME}+xml`)
    ) {
      throw new ExchangeError('MXL 未指向受支持的 MusicXML 乐谱。')
    }
    const score = files.get(path)
    if (!score) {
      throw new ExchangeError('MXL 中找不到声明的乐谱文件。')
    }
    return decodeXml(score)
  } catch (error) {
    if (error instanceof ExchangeError) {
      throw error
    }
    throw new ExchangeError('MXL 压缩文件损坏或使用了不支持的编码。')
  }
}

/** Accept UTF-8 and BOM-declared UTF-16 XML; incompatible encodings fail instead of silently corrupting titles. */
export function decodeXml(bytes: Uint8Array): string {
  if (bytes.length > MAX_XML_BYTES) {
    throw new ExchangeError('XML 超过 8 MiB 的读取限制。')
  }
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : 'utf-8'
  try {
    const text = new globalThis.TextDecoder(encoding, { fatal: true }).decode(
      bytes,
    )
    const declaration = text
      .match(/^\s*<\?xml\b[^?]*encoding\s*=\s*["']([^"']+)["']/i)?.[1]
      .toLowerCase()
    if (
      declaration &&
      !(encoding === 'utf-8'
        ? ['utf-8', 'utf8', 'us-ascii'].includes(declaration)
        : ['utf-16', encoding].includes(declaration))
    ) {
      throw new Error('Unsupported encoding')
    }
    return text
  } catch {
    throw new ExchangeError('MusicXML 需要 UTF-8 或带 BOM 的 UTF-16 编码。')
  }
}

/** Create a standards-compatible archive: first uncompressed mimetype, then container and UTF-8 score. */
export function packMxl(xml: string): Uint8Array {
  const encoder = new globalThis.TextEncoder()
  const score = encoder.encode(xml)
  if (score.length > MAX_XML_BYTES) {
    throw new ExchangeError('XML 超过 8 MiB 的导出限制。')
  }
  return zipSync(
    {
      mimetype: [encoder.encode(MIME), { level: 0 }],
      'META-INF/container.xml': encoder.encode(
        '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>',
      ),
      'score.musicxml': score,
    },
    { level: 6 },
  )
}
