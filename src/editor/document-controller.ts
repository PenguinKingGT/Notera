/** Coordinate asynchronous desktop document operations without coupling the music editor to React or Electron. */
import { createPianoScore, parseScore } from '../core'
import type { Score } from '../core'
import type {
  DesktopApi,
  DocumentInfo,
  DocumentStartup,
  FileResult,
} from '../shared/desktop-api'
import { EditorSession } from './session'

/** Replacement intentions share one save/discard/cancel decision. */
export type DocumentAction =
  'new' | 'sample' | 'open' | 'import' | 'recognition' | 'close'

/** Cached UI state describes file operations independently of musical editing snapshots. */
export interface DocumentState {
  readonly document: DocumentInfo | null
  readonly ready: boolean
  readonly busy: boolean
  readonly editingLocked: boolean
  readonly error: string | null
  readonly recoveryError: string | null
  readonly message: string | null
  readonly prompt: DocumentAction | null
  readonly startup: Pick<DocumentStartup, 'recovery' | 'recoveryError'> | null
}

/** Own async operations and leave musical undo history in the supplied input session. */
export class DocumentController {
  #state: DocumentState = {
    document: null,
    ready: false,
    busy: false,
    editingLocked: false,
    error: null,
    recoveryError: null,
    message: null,
    prompt: null,
    startup: null,
  }
  #listeners = new Set<() => void>()
  #initialization: Promise<void> | null = null
  #timer: ReturnType<typeof setTimeout> | undefined
  #queuedClose = false
  #scheduled: { score: Score; dirty: boolean; documentId: string } | null = null
  #unsubscribe: (() => void) | null = null
  #recognized: Score | null = null

  /** Bind only the narrow desktop API and a provider for the original bundled sample. */
  constructor(
    readonly session: EditorSession,
    readonly api: DesktopApi,
    readonly sample: () => Score,
  ) {}

  /** Return one stable external-store snapshot until document state changes. */
  getSnapshot = (): DocumentState => this.#state

  /** Subscribe React or another UI, returning a cleanup function. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Publish a complete operation state independently of renderer geometry. */
  private publish(patch: Partial<DocumentState>): void {
    this.#state = { ...this.#state, ...patch }
    this.#listeners.forEach((listener) => listener())
  }

  /** Initialize once across StrictMode mounts and protect startup recovery until a decision is made. */
  start(): Promise<void> {
    if (!this.#unsubscribe) {
      this.#unsubscribe = this.session.subscribe(() =>
        this.scheduleCheckpoint(),
      )
    }
    this.#initialization ??= this.initialize()
    this.scheduleCheckpoint()
    return this.#initialization
  }

  /** Inspect the main-process recovery store without resetting current musical content. */
  private async initialize(): Promise<void> {
    try {
      const result = await this.api.initializeDocument(
        this.session.getSnapshot().score,
      )
      if (result.status === 'success') {
        const value = result.value
        this.publish({
          document: value.document,
          ready: true,
          startup:
            value.recovery || value.recoveryError
              ? { recovery: value.recovery, recoveryError: value.recoveryError }
              : null,
        })
        this.scheduleCheckpoint()
      } else if (result.status === 'error') {
        this.publish({ error: result.message })
      }
    } catch {
      this.publish({
        error: '无法初始化文件服务。请重新启动应用，当前音乐内容仍然保留。',
      })
    }
  }

  /** Stop background timers and subscriptions; a remount can resume the existing controller. */
  stop(): void {
    clearTimeout(this.#timer)
    this.#unsubscribe?.()
    this.#unsubscribe = null
    this.#scheduled = null
  }

  /** Debounce musical snapshots only; cursor and selection changes do not postpone dirty-content recovery. */
  private scheduleCheckpoint(): void {
    if (!this.#state.document || this.#state.startup) {
      return
    }
    const { score, dirty } = this.session.getSnapshot()
    const documentId = this.#state.document.documentId
    if (
      this.#scheduled?.score === score &&
      this.#scheduled.dirty === dirty &&
      this.#scheduled.documentId === documentId
    ) {
      return
    }
    this.#scheduled = { score, dirty, documentId }
    // Flush reads current content when the timer fires; it cannot write a formerly selected document.
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => void this.checkpoint(), 500)
  }

  /** Write the latest dirty snapshot, keeping recovery errors visible without marking the score saved. */
  async checkpoint(): Promise<boolean> {
    clearTimeout(this.#timer)
    const document = this.#state.document
    if (!document || this.#state.startup) {
      return true
    }
    const { score, dirty } = this.session.getSnapshot()
    try {
      const result = await this.api.checkpointDocument({
        documentId: document.documentId,
        score,
        dirty,
      })
      if (this.#state.document?.documentId === document.documentId) {
        this.publish({
          recoveryError:
            result.status === 'error'
              ? '恢复副本写入失败；请手动保存以保留当前编辑。'
              : null,
        })
      }
      return result.status === 'success'
    } catch {
      this.publish({
        recoveryError: '恢复副本写入失败；请手动保存以保留当前编辑。',
      })
      return false
    }
  }

  /** Stage validated recognition music before asking the existing save/discard/cancel question. */
  importRecognition(score: Score): boolean {
    if (
      !this.#state.ready ||
      this.#state.busy ||
      this.#state.startup ||
      this.#state.prompt
    ) {
      return false
    }
    try {
      this.#recognized = parseScore(score)
    } catch {
      this.publish({ error: '识谱结果不是有效乐谱，当前音乐已保留。' })
      return false
    }
    this.request('recognition')
    return true
  }

  /** Guard replacements using the current music snapshot, including edits made during a previous save. */
  request(action: DocumentAction): void {
    if (!this.#state.ready) {
      if (action === 'close') {
        void this.#initialization?.then(() => {
          if (this.#state.ready) {
            this.request('close')
          } else {
            void this.api.closeDocument(null)
          }
        })
      }
      return
    }
    if (this.#state.busy) {
      this.#queuedClose ||= action === 'close'
      return
    }
    if (this.#state.startup && action !== 'close') {
      return
    }
    if (!this.#state.startup && this.session.getSnapshot().dirty) {
      this.publish({ prompt: action, error: null })
    } else {
      void this.perform(action)
    }
  }

  /** Cancel the pending transition without altering the score or history. */
  cancel(): void {
    if (!this.#state.busy) {
      if (this.#state.prompt === 'recognition') {
        this.#recognized = null
      }
      if (this.#state.prompt === 'close') {
        void this.api
          .cancelCloseRequest()
          .catch(() => this.publish({ error: '关闭取消通知失败，请重试。' }))
      }
      this.publish({ prompt: null })
    }
  }

  /** Deliberately discard current changes only if the requested replacement itself succeeds. */
  discard(): void {
    const action = this.#state.prompt
    if (action && !this.#state.busy) {
      void this.perform(action)
    }
  }

  /** Save before transitioning; cancelled/failed saves or new edits retain the current document and prompt. */
  async saveAndContinue(): Promise<void> {
    const action = this.#state.prompt
    if (
      action &&
      (await this.save()) &&
      !this.#state.busy &&
      this.#state.prompt === action &&
      !this.session.getSnapshot().dirty
    ) {
      await this.perform(action)
    }
  }

  /** Report one explicit result and keep native cancellation free of an error message. */
  private report<T>(result: FileResult<T>): void {
    if (result.status === 'error') {
      this.publish({ error: result.message })
    }
  }

  /** Save a captured snapshot while permitting musical input; older snapshots cannot clear newer edits. */
  async save(saveAs = false): Promise<boolean> {
    const document = this.#state.document
    if (!document || this.#state.busy || this.#state.startup) {
      return false
    }
    const score = this.session.getSnapshot().score
    this.publish({ busy: true, error: null, message: null })
    let saved = false
    try {
      const result = await this.api.saveDocument({
        documentId: document.documentId,
        score,
        saveAs,
      })
      if (result.status === 'success') {
        this.session.markSaved(score)
        this.publish({
          document: result.value,
          message: `已保存 ${result.value.fileName}`,
        })
        await this.checkpoint()
        saved = true
      } else {
        this.report(result)
      }
    } catch {
      this.publish({ error: '保存服务暂时不可用，当前乐谱仍然保留。' })
    } finally {
      this.finishOperation()
    }
    return saved
  }

  /** Export without acknowledging a native save; editing during the captured-snapshot write remains dirty. */
  async exportMusic(compressed: boolean): Promise<void> {
    return this.exportSnapshot((documentId, score) =>
      this.api.exportMusic({ documentId, score, compressed }),
    )
  }

  /** Export the captured music as a print document, preserving native save and undo state. */
  async exportPdf(): Promise<void> {
    return this.exportSnapshot((documentId, score) =>
      this.api.exportPdf({ documentId, score }),
    )
  }

  /** Serialize export UI decisions while allowing musical edits during rendering and writing. */
  private async exportSnapshot(
    exporter: (
      documentId: string,
      score: Score,
    ) => Promise<FileResult<{ fileName: string; pageCount?: number }>>,
  ): Promise<void> {
    const document = this.#state.document
    if (
      !document ||
      this.#state.busy ||
      this.#state.startup ||
      this.#state.prompt
    ) {
      return
    }
    const score = this.session.getSnapshot().score
    this.publish({ busy: true, error: null, message: null })
    try {
      const result = await exporter(document.documentId, score)
      if (result.status === 'success') {
        this.publish({
          message: `已导出 ${result.value.fileName}${result.value.pageCount ? `（${result.value.pageCount} 页）` : ''}；原生保存状态未改变。`,
        })
      } else {
        this.report(result)
      }
    } catch {
      this.publish({ error: '导出服务暂时不可用，当前乐谱仍然保留。' })
    } finally {
      this.finishOperation()
    }
  }

  /** Replace content only after a valid open or create operation, and finish close only after recovery cleanup. */
  private async perform(action: DocumentAction): Promise<void> {
    this.publish({
      busy: true,
      editingLocked: true,
      error: null,
      message: null,
    })
    clearTimeout(this.#timer)
    try {
      if (action === 'close') {
        const result = await this.api.closeDocument(
          this.#state.document!.documentId,
        )
        this.report(result)
        if (result.status === 'success') {
          this.publish({ prompt: null })
        }
      } else if (action === 'open' || action === 'import') {
        const result =
          action === 'import'
            ? await this.api.importMusic()
            : await this.api.openDocument()
        if (result.status === 'success') {
          this.session.reset(result.value.score, action === 'open')
          this.publish({ document: result.value.document, prompt: null })
        } else {
          this.report(result)
        }
      } else {
        if (action === 'recognition' && !this.#recognized) {
          throw new Error('Missing recognition result')
        }
        const score =
          action === 'recognition'
            ? this.#recognized!
            : action === 'sample'
              ? this.sample()
              : createPianoScore({
                  id: globalThis.crypto.randomUUID(),
                  title: '未命名钢琴谱',
                  measureCount: 4,
                })
        const result = await this.api.createDocument(score)
        if (result.status === 'success') {
          this.session.reset(score, action === 'new')
          this.#recognized = null
          this.publish({ document: result.value, prompt: null })
        } else {
          this.report(result)
        }
      }
    } catch {
      this.publish({ error: '文档操作未完成，当前乐谱仍然保留。' })
    } finally {
      this.finishOperation()
      if (action !== 'close') {
        this.scheduleCheckpoint()
      }
    }
  }

  /** Restore or discard startup recovery without assigning its old disk path as a write capability. */
  async resolveRecovery(restore: boolean): Promise<void> {
    if (!this.#state.document || this.#state.busy) {
      return
    }
    this.publish({ busy: true, error: null })
    try {
      const result = await this.api.resolveRecovery({
        documentId: this.#state.document.documentId,
        restore,
      })
      if (result.status === 'success') {
        if (result.value) {
          this.session.reset(result.value.score)
          this.publish({
            document: result.value.document,
            message: '已恢复未保存乐谱，请选择位置保存。',
          })
        }
        this.publish({ startup: null })
        this.scheduleCheckpoint()
      } else {
        this.report(result)
      }
    } catch {
      this.publish({ error: '恢复操作失败，原恢复副本仍然保留。' })
    } finally {
      this.finishOperation()
    }
  }

  /** Release the operation lock and honor a native close request that arrived while a dialog was open. */
  private finishOperation(): void {
    this.publish({ busy: false, editingLocked: false })
    if (this.#queuedClose) {
      this.#queuedClose = false
      this.request('close')
    }
  }
}
