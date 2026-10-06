/** Coordinate recognition UI intentions without putting request bodies or credentials into renderer state. */
import type {
  RecognitionApi,
  RecognitionSettings,
  RecognitionTask,
  RecognitionImport,
} from '../shared/recognition-api'
import type { FileResult } from '../shared/desktop-api'
import type { Score } from '../core'
import type { RecognitionMergeMode, RecognitionMergeTarget } from './merge'

/** Capture and apply against a live document without binding recognition requests to React or Electron. */
export interface RecognitionMergePort {
  capture: (taskId: string) => RecognitionMergeTarget | null
  apply: (
    result: RecognitionImport,
    mode: RecognitionMergeMode,
    target: RecognitionMergeTarget,
  ) => string | null
}

/** Cached view state contains only public settings and source metadata. */
export interface RecognitionState {
  readonly settings: RecognitionSettings | null
  readonly task: RecognitionTask | null
  readonly busy: boolean
  readonly error: string | null
  readonly message: string | null
}

/** Keep asynchronous task decisions independent of React rendering and document replacement. */
export class RecognitionController {
  #state: RecognitionState = {
    settings: null,
    task: null,
    busy: false,
    error: null,
    message: null,
  }
  #listeners = new Set<() => void>()
  /** Bind only the fixed preload API; accepted music is passed to the existing document decision flow. */
  constructor(
    readonly api: RecognitionApi,
    readonly accept: (score: Score, origin?: RecognitionImport) => boolean,
    readonly merge?: RecognitionMergePort,
  ) {}

  /** Return the same reference until metadata or an operation state changes. */
  getSnapshot = (): RecognitionState => this.#state

  /** Register an external-store subscriber and return its cleanup. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Publish a complete renderer-safe snapshot. */
  private publish(patch: Partial<RecognitionState>): void {
    this.#state = { ...this.#state, ...patch }
    this.#listeners.forEach((listener) => listener())
  }

  /** Report explicit IPC errors without exposing thrown transport details. */
  private value<T>(result: FileResult<T>): T | undefined {
    if (result.status === 'success') {
      return result.value
    }
    if (result.status === 'error') {
      this.publish({ error: result.message })
    }
    return undefined
  }

  /** Serialize user intentions; cancellation and status polling remain available during a request. */
  private async operation(action: () => Promise<void>): Promise<void> {
    if (this.#state.busy) {
      return
    }
    this.publish({ busy: true, error: null, message: null })
    try {
      await action()
    } catch {
      this.publish({ error: 'AI 服务暂时不可用，已有乐谱与识别结果仍然保留。' })
    } finally {
      this.publish({ busy: false })
    }
  }

  /** Refresh metadata when the panel opens; independent settings and task reads run in parallel. */
  async open(): Promise<void> {
    if (this.#state.busy) {
      return
    }
    await this.operation(async () => {
      const [settings, task] = await Promise.all([
        this.api.getSettings(),
        this.api.getTask(),
      ])
      const configuration = this.value(settings)
      const current = this.value(task)
      this.publish({
        ...(configuration ? { settings: configuration } : {}),
        ...(current !== undefined ? { task: current } : {}),
      })
    })
  }

  /** Save typed form fields; plaintext key is not retained in the controller's snapshot. */
  async saveSettings(
    input: Parameters<RecognitionApi['saveSettings']>[0],
  ): Promise<boolean> {
    let saved = false
    await this.operation(async () => {
      const settings = this.value(await this.api.saveSettings(input))
      if (settings) {
        this.publish({ settings, message: 'AI 配置已保存。' })
        saved = true
      }
    })
    return saved
  }

  /** Replace sources only after main's native dialog and full selection validation succeed. */
  async choose(): Promise<void> {
    await this.operation(async () => {
      const task = this.value(await this.api.chooseSources())
      if (task) {
        this.publish({ task })
      }
    })
  }

  /** Move one retained source page without modifying musical content. */
  move(id: string, direction: -1 | 1): void {
    const task = this.#state.task
    if (!task || task.running || this.#state.busy) {
      return
    }
    const sources = [...task.sources]
    const index = sources.findIndex((source) => source.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= sources.length) {
      return
    }
    const moved = sources[index]
    sources[index] = sources[target]
    sources[target] = moved
    this.publish({ task: { ...task, sources } })
  }

  /** Run all unfinished pages or one selected failed page, retaining previously validated successes. */
  async run(sourceId?: string): Promise<void> {
    const task = this.#state.task
    if (!task || task.running) {
      return
    }
    await this.operation(async () => {
      const result = this.value(
        await this.api.run({
          taskId: task.id,
          sourceIds: sourceId
            ? [sourceId]
            : task.sources.map((source) => source.id),
        }),
      )
      if (result) {
        this.publish({ task: result })
      }
    })
  }

  /** Poll main's progress while a task runs, retaining local source ordering until main accepts it. */
  async poll(): Promise<void> {
    try {
      const task = this.value(await this.api.getTask())
      if (task && task.id === this.#state.task?.id) {
        const order = this.#state.task.sources.map((source) => source.id)
        const sources = order
          .map((id) => task.sources.find((source) => source.id === id)!)
          .filter(Boolean)
        this.publish({ task: { ...task, sources } })
      }
    } catch {
      this.publish({ error: '暂时无法获取识谱进度。' })
    }
  }

  /** Request cancellation separately from the active run operation. */
  async cancel(): Promise<void> {
    const task = this.#state.task
    if (!task) {
      return
    }
    try {
      const result = this.value(await this.api.cancel(task.id))
      if (result) {
        this.publish({
          task: result,
          message: '正在取消，已成功的来源页仍然保留。',
        })
      }
    } catch {
      this.publish({ error: '取消请求未完成，请重试。' })
    }
  }

  /** Explicitly stage successful pages as a new score; the document controller owns unsaved-edit decisions. */
  async importScore(): Promise<boolean> {
    const task = this.#state.task
    if (!task || task.running) {
      return false
    }
    let accepted = false
    await this.operation(async () => {
      const result = this.value(
        await this.api.result({
          taskId: task.id,
          sourceIds: task.sources.map((source) => source.id),
        }),
      )
      if (result) {
        accepted = this.accept(result.score, result)
        if (!accepted) {
          this.publish({
            error: '当前文档正在处理其他操作，请稍后再导入。识别结果仍然保留。',
          })
        }
      }
    })
    return accepted
  }

  /** Fetch validated results and explicitly add only missing pages to a captured, still-current document. */
  async mergeScore(mode: RecognitionMergeMode = 'ordered'): Promise<boolean> {
    const task = this.#state.task
    if (!task || task.running || !this.merge) {
      return false
    }
    const target = this.merge.capture(task.id)
    if (!target) {
      this.publish({
        error:
          '当前乐谱与此任务没有有效关联，请先导入成功页为新乐谱。重新打开或重启后也需创建新谱。',
      })
      return false
    }
    let merged = false
    await this.operation(async () => {
      const result = this.value(
        await this.api.result({
          taskId: task.id,
          sourceIds: task.sources.map((source) => source.id),
        }),
      )
      if (result) {
        const error = this.merge!.apply(result, mode, target)
        merged = error === null
        this.publish(
          error
            ? { error }
            : { message: '补识别页已加入当前乐谱，已有编辑保留，可撤销。' },
        )
      }
    })
    return merged
  }
}
