/** Own selected paths, serialized file operations and recovery decisions for one isolated desktop window. */
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import {
  deserializeScore,
  parseScore,
  serializeScore,
  ScoreFileError,
} from '../core'
import type {
  DocumentInfo,
  DocumentStartup,
  FileResult,
  OpenedDocument,
  NotationView,
} from '../shared/desktop-api'
import {
  decodeXml,
  ExchangeError,
  exportMusicXml,
  importMusicXml,
  MAX_ARCHIVE_BYTES,
  packMxl,
  unpackMxl,
} from '../exchange'
import { atomicWrite } from './atomic-file'
import { RecoveryStore } from './recovery-store'
import { PdfExportError } from './pdf-error'
import type { Score } from '../core'
import type { RecoverySnapshot } from './recovery-store'

/** Native dialogs are injected so the service can be verified without a graphical system dialog. */
export interface DocumentDialogs {
  open: () => Promise<string | null>
  save: (defaultName: string) => Promise<string | null>
  importMusic?: () => Promise<string | null>
  exportMusic?: (
    defaultName: string,
    compressed: boolean,
  ) => Promise<string | null>
  exportPdf?: (defaultName: string) => Promise<string | null>
  confirmImport?: (warnings: string[]) => Promise<boolean>
}

const saveRequest = z.strictObject({
  documentId: z.string().min(1),
  score: z.unknown(),
  saveAs: z.boolean(),
})
const exportRequest = z.strictObject({
  documentId: z.string().min(1),
  score: z.unknown(),
  compressed: z.boolean(),
})
const pdfRequest = z.strictObject({
  documentId: z.string().min(1),
  score: z.unknown(),
  notation: z.enum(['staff', 'jianpu']).default('staff'),
})
const checkpointRequest = z.strictObject({
  documentId: z.string().min(1),
  score: z.unknown(),
  dirty: z.boolean(),
})
const recoveryRequest = z.strictObject({
  documentId: z.string().min(1),
  restore: z.boolean(),
})

/** Normalize aliases after explicit user selection, preserving atomic replacement at the real target. */
async function selectedPath(path: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw new Error('File dialog returned a relative path')
  }
  try {
    return await realpath(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
    return join(await realpath(dirname(path)), basename(path))
  }
}

/** Preserve useful native-format errors while keeping OS details and internal validation out of the UI. */
function fileMessage(error: unknown): string {
  if (error instanceof PdfExportError) {
    return error.message
  }
  if (error instanceof ExchangeError) {
    return error.message
  }
  if (error instanceof ScoreFileError) {
    if (error.code === 'unsupported-version') {
      return '此乐谱使用了尚不支持的文件版本。'
    }
    return '文件不是有效的 Notera 乐谱，当前文档已保留。'
  }
  if (error instanceof Error && error.message === 'Externally modified file') {
    return '文件已被其他程序修改。请重新打开，或使用另存为保留当前编辑。'
  }
  return '文件操作失败，请检查文件位置和访问权限。当前乐谱仍然保留。'
}

/** Read only bounded bytes from a chosen file, including files that grow while being read. */
async function exchangeBytes(path: string): Promise<Uint8Array> {
  const stream = createReadStream(path, { highWaterMark: 64 * 1024 })
  const chunks: Buffer[] = []
  let length = 0
  try {
    for await (const chunk of stream) {
      const bytes = chunk as Buffer
      length += bytes.length
      if (length > MAX_ARCHIVE_BYTES) {
        throw new ExchangeError('交换文件超过 12 MiB 的读取限制。')
      }
      chunks.push(bytes)
    }
    return Buffer.concat(chunks, length)
  } finally {
    stream.destroy()
  }
}

/** Main-process capabilities associate a random document token with a user-approved native path. */
export class DocumentService {
  #document: DocumentInfo | null = null
  #diskContent: string | null = null
  #recovery: RecoverySnapshot | null = null
  #awaitingRecovery = false
  #tail: Promise<unknown> = Promise.resolve()

  /** Bind native dialogs and the application-owned recovery store to this window. */
  constructor(
    readonly dialogs: DocumentDialogs,
    readonly recovery: RecoveryStore,
    readonly pdf?: (
      score: Score,
      notation: NotationView,
    ) => Promise<{ bytes: Uint8Array; pageCount: number }>,
  ) {}

  /** Serialize writes and decisions so stale checkpoints cannot resurrect discarded recovery snapshots. */
  private operation<T>(
    action: () => Promise<FileResult<T>>,
  ): Promise<FileResult<T>> {
    const result = this.#tail
      .then(action)
      .catch((error: unknown): FileResult<T> => {
        console.error('Document operation failed', error)
        return { status: 'error', message: fileMessage(error) }
      })
    this.#tail = result
    return result
  }

  /** Allocate a new capability; replacing a document invalidates every previously issued token. */
  private assign(
    path: string | null,
    content: string | null = null,
  ): DocumentInfo {
    this.#document = {
      documentId: randomUUID(),
      filePath: path,
      fileName: path ? basename(path) : null,
    }
    this.#diskContent = content
    return this.#document
  }

  /** Validate the document capability on execution rather than when a queued operation was received. */
  private requireDocument(id: string): DocumentInfo {
    if (!this.#document || this.#document.documentId !== id) {
      throw new Error('Unknown or obsolete document capability')
    }
    return this.#document
  }

  /** Begin a renderer session, including reloads, and inspect recovery before any checkpoint can overwrite it. */
  initialize(score: unknown): Promise<FileResult<DocumentStartup>> {
    return this.operation<DocumentStartup>(async () => {
      parseScore(score)
      let recoveryError: string | null = null
      try {
        this.#recovery = await this.recovery.read()
      } catch (error) {
        console.error('Recovery read failed', error)
        recoveryError =
          '上次的恢复副本无法读取。你可以保留它并退出，或放弃副本后继续。'
      }
      this.#awaitingRecovery = Boolean(this.#recovery || recoveryError)
      const document = this.assign(null)
      return {
        status: 'success',
        value: {
          document,
          recovery: this.#recovery
            ? {
                title: this.#recovery.score.title,
                updatedAt: this.#recovery.updatedAt,
              }
            : null,
          recoveryError,
        },
      }
    })
  }

  /** Replace document identity only after the new music is validated and prior recovery cleared. */
  create(score: unknown): Promise<FileResult<DocumentInfo>> {
    return this.operation<DocumentInfo>(async () => {
      const validated = parseScore(score)
      if (this.#awaitingRecovery) {
        throw new Error('Resolve startup recovery first')
      }
      // Write the replacement first, so a checkpoint crash cannot restore the deliberately discarded document.
      await this.recovery.write(validated)
      return { status: 'success', value: this.assign(null) }
    })
  }

  /** Read an explicitly chosen native file; cancellation or invalid input leaves the current capability intact. */
  open(): Promise<FileResult<OpenedDocument>> {
    return this.operation<OpenedDocument>(async () => {
      if (this.#awaitingRecovery) {
        throw new Error('Resolve startup recovery first')
      }
      const chosen = await this.dialogs.open()
      if (!chosen) {
        return { status: 'cancelled' }
      }
      const path = await selectedPath(chosen)
      const content = await readFile(path, 'utf8')
      const score = deserializeScore(content)
      await this.recovery.clear()
      return {
        status: 'success',
        value: { document: this.assign(path, content), score },
      }
    })
  }

  /** Import only after parsing and explicit loss confirmation; preserve the source and create an untitled native capability. */
  importMusic(): Promise<FileResult<OpenedDocument>> {
    return this.operation<OpenedDocument>(async () => {
      if (this.#awaitingRecovery || !this.#document) {
        throw new Error('Document not ready')
      }
      const chosen = await this.dialogs.importMusic?.()
      if (!chosen) {
        return { status: 'cancelled' }
      }
      const path = await selectedPath(chosen)
      const bytes = await exchangeBytes(path)
      const xml =
        extname(path).toLowerCase() === '.mxl' ||
        (bytes[0] === 0x50 && bytes[1] === 0x4b)
          ? unpackMxl(bytes)
          : decodeXml(bytes)
      const imported = importMusicXml(xml)
      if (
        imported.warnings.length &&
        !(await this.dialogs.confirmImport?.(imported.warnings))
      ) {
        return { status: 'cancelled' }
      }
      await this.recovery.write(imported.score)
      return {
        status: 'success',
        value: { document: this.assign(null), score: imported.score },
      }
    })
  }

  /** Export a captured score without redirecting the native save target or clearing its recovery/dirty state. */
  exportMusic(input: unknown): Promise<FileResult<{ fileName: string }>> {
    return this.operation<{ fileName: string }>(async () => {
      const request = exportRequest.parse(input)
      const document = this.requireDocument(request.documentId)
      if (this.#awaitingRecovery) {
        throw new Error('Resolve startup recovery first')
      }
      const score = parseScore(request.score)
      const xml = exportMusicXml(score)
      const extension = request.compressed ? '.mxl' : '.musicxml'
      const safeTitle =
        score.title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 120) || '乐谱'
      const chosen = await this.dialogs.exportMusic?.(
        `${safeTitle}${extension}`,
        request.compressed,
      )
      if (!chosen) {
        return { status: 'cancelled' }
      }
      const path = await selectedPath(chosen)
      if (
        path === document.filePath ||
        extname(path).toLowerCase() !== extension
      ) {
        throw new ExchangeError(
          `请选择 ${extension} 文件，导出不能覆盖当前原生乐谱。`,
        )
      }
      await atomicWrite(path, request.compressed ? packMxl(xml) : xml)
      return { status: 'success', value: { fileName: basename(path) } }
    })
  }

  /** Authorize a native PDF destination and write a complete print snapshot without changing native save state. */
  exportPdf(
    input: unknown,
  ): Promise<FileResult<{ fileName: string; pageCount: number }>> {
    return this.operation<{ fileName: string; pageCount: number }>(async () => {
      const request = pdfRequest.parse(input)
      const document = this.requireDocument(request.documentId)
      if (this.#awaitingRecovery || !this.pdf || !this.dialogs.exportPdf) {
        throw new PdfExportError('PDF 导出服务尚未就绪，请重试。')
      }
      const score = parseScore(request.score)
      const safeTitle =
        score.title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 120) || '乐谱'
      const chosen = await this.dialogs.exportPdf(
        `${safeTitle}${request.notation === 'jianpu' ? '-简谱' : ''}.pdf`,
      )
      if (!chosen) {
        return { status: 'cancelled' }
      }
      const path = await selectedPath(chosen)
      if (
        path === document.filePath ||
        extname(path).toLowerCase() !== '.pdf'
      ) {
        throw new PdfExportError('请选择 .pdf 文件，导出不能覆盖当前原生乐谱。')
      }
      const result = await this.pdf(score, request.notation)
      await atomicWrite(path, result.bytes)
      return {
        status: 'success',
        value: { fileName: basename(path), pageCount: result.pageCount },
      }
    })
  }

  /** Save exactly the submitted snapshot; the renderer confirms only this version after success. */
  save(input: unknown): Promise<FileResult<DocumentInfo>> {
    return this.operation<DocumentInfo>(async () => {
      const request = saveRequest.parse(input)
      const document = this.requireDocument(request.documentId)
      const score = parseScore(request.score)
      let path = document.filePath
      if (request.saveAs || !path) {
        const safeTitle =
          score.title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 120) || '乐谱'
        const chosen = await this.dialogs.save(path ?? `${safeTitle}.notera`)
        if (!chosen) {
          return { status: 'cancelled' }
        }
        path = await selectedPath(chosen)
      }
      if (path === document.filePath && this.#diskContent !== null) {
        const current = await readFile(path, 'utf8')
        if (current !== this.#diskContent) {
          throw new Error('Externally modified file')
        }
      }
      const content = serializeScore(score)
      await atomicWrite(path, content)
      this.#diskContent = content
      this.#document = { ...document, filePath: path, fileName: basename(path) }
      // Checkpoints are queued separately: a save must not clear a newer, unsaved edit's recovery snapshot.
      return { status: 'success', value: this.#document }
    })
  }

  /** Persist only the current document's dirty snapshot; startup recovery stays untouched until resolved. */
  checkpoint(input: unknown): Promise<FileResult<null>> {
    return this.operation<null>(async () => {
      const request = checkpointRequest.parse(input)
      this.requireDocument(request.documentId)
      const score = parseScore(request.score)
      if (!this.#awaitingRecovery) {
        if (request.dirty) {
          await this.recovery.write(score)
        } else {
          await this.recovery.clear()
        }
      }
      return { status: 'success', value: null }
    })
  }

  /** Restore recovery into an untitled document or deliberately discard it after the startup decision. */
  resolveRecovery(input: unknown): Promise<FileResult<OpenedDocument | null>> {
    return this.operation<OpenedDocument | null>(async () => {
      const request = recoveryRequest.parse(input)
      this.requireDocument(request.documentId)
      if (!this.#awaitingRecovery) {
        throw new Error('No pending recovery')
      }
      if (request.restore) {
        if (!this.#recovery) {
          throw new Error('Recovery unavailable')
        }
        const score = this.#recovery.score
        await this.recovery.write(score)
        const document = this.assign(null)
        this.#awaitingRecovery = false
        this.#recovery = null
        return { status: 'success', value: { document, score } }
      }
      await this.recovery.clear()
      this.#awaitingRecovery = false
      this.#recovery = null
      return { status: 'success', value: null }
    })
  }

  /** Clear recovery only after the renderer has completed the current document's close decision. */
  close(id: unknown): Promise<FileResult<null>> {
    return this.operation<null>(async () => {
      if (id === null) {
        // Initialization failure may still permit closure, while retaining every existing recovery file.
        this.#document = null
        return { status: 'success', value: null }
      }
      this.requireDocument(z.string().min(1).parse(id))
      if (!this.#awaitingRecovery) {
        await this.recovery.clear()
      }
      this.#document = null
      return { status: 'success', value: null }
    })
  }
}
