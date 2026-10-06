/** Own one window's private sources, cancellable attempts and validated recognition fragments. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Score } from '../../core'
import type { FileResult } from '../../shared/desktop-api'
import type {
  RecognitionTask,
  RecognitionSource,
  RecognitionImport,
} from '../../shared/recognition-api'
import { RecognitionError } from '../../recognition/errors'
import { combineRecognitionScores } from '../../recognition/score-result'
import { RecognitionSettingsStore } from './settings'
import { recognizePage } from './provider'
import type { RecognitionPage, RecognitionFetch } from './provider'
import { prepareSources, MAX_SOURCE_PAGES } from './sources'

const selectionSchema = z.strictObject({
  taskId: z.string().uuid(),
  sourceIds: z.array(z.string().uuid()).min(1).max(MAX_SOURCE_PAGES),
})

/** Convert only application-authored errors to IPC outcomes; raw service messages may contain credentials. */
export async function recognitionResult<T>(
  operation: () => Promise<T>,
): Promise<FileResult<T>> {
  try {
    return { status: 'success', value: await operation() }
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof RecognitionError
          ? error.message
          : 'AI 识谱操作失败，已有乐谱与识别结果仍然保留。',
    }
  }
}

/** Keep file bytes, credentials and successful fragments outside the renderer and active document. */
export class RecognitionService {
  #task: RecognitionTask | null = null
  #pages = new Map<string, RecognitionPage>()
  #scores = new Map<string, Score>()
  #abort: AbortController | null = null
  #choosing = false

  /** Inject explicit native selection and HTTP requests for real boundary tests without external services. */
  constructor(
    readonly settings: RecognitionSettingsStore,
    readonly choose: () => Promise<string[] | null>,
    readonly request: RecognitionFetch = fetch,
  ) {}

  /** Return a detached metadata snapshot; mutating an IPC response cannot alter main-owned state. */
  getTask(): RecognitionTask | null {
    return this.#task ? structuredClone(this.#task) : null
  }

  /** Select and validate all files before retiring previous results; cancel leaves the existing task intact. */
  async chooseSources(): Promise<FileResult<RecognitionTask>> {
    if (this.#task?.running || this.#choosing) {
      return { status: 'error', message: '请先结束当前识谱操作。' }
    }
    this.#choosing = true
    try {
      const paths = await this.choose()
      if (!paths) {
        return { status: 'cancelled' }
      }
      return await recognitionResult(async () => {
        const pages = await prepareSources(paths)
        this.#pages = new Map(pages.map((page) => [page.id, page]))
        this.#scores.clear()
        this.#task = {
          id: randomUUID(),
          running: false,
          sources: pages.map((page) => ({
            id: page.id,
            name: page.name,
            kind: page.kind,
            status: 'pending',
            error: null,
            measures: 0,
          })),
        }
        return this.getTask()!
      })
    } finally {
      this.#choosing = false
    }
  }

  /** Accept only current source capabilities, never renderer filenames or byte payloads. */
  private selected(input: unknown): {
    task: RecognitionTask
    sourceIds: string[]
  } {
    const parsed = selectionSchema.safeParse(input)
    const task = this.#task
    if (
      !parsed.success ||
      !task ||
      task.id !== parsed.data.taskId ||
      new Set(parsed.data.sourceIds).size !== parsed.data.sourceIds.length ||
      parsed.data.sourceIds.some((id) => !this.#pages.has(id))
    ) {
      throw new RecognitionError('来源页选择已过期或无效，请重新选择。')
    }
    return { task, sourceIds: parsed.data.sourceIds }
  }

  /** Run only unfinished selected pages; preserve successes and discard cancelled/late attempt results. */
  async run(input: unknown): Promise<RecognitionTask> {
    const { task, sourceIds } = this.selected(input)
    if (task.running || this.#choosing) {
      throw new RecognitionError('识谱任务正在运行。')
    }
    const abort = new AbortController()
    this.#abort = abort
    task.running = true
    try {
      const credentials = await this.settings.credentials()
      if (sourceIds.length === task.sources.length) {
        task.sources = sourceIds.map((id) =>
          task.sources.find((source) => source.id === id)!,
        )
      }
      for (const id of sourceIds) {
        if (abort.signal.aborted || this.#task !== task) {
          break
        }
        const source = task.sources.find((item) => item.id === id)!
        if (source.status === 'success') {
          continue
        }
        this.patch(source, { status: 'running', error: null })
        try {
          const score = await recognizePage(
            credentials,
            this.#pages.get(id)!,
            task.sources.findIndex((source) => source.id === id) + 1,
            abort.signal,
            this.request,
          )
          if (
            abort.signal.aborted ||
            this.#task !== task ||
            this.#abort !== abort
          ) {
            break
          }
          this.#scores.set(id, score)
          this.patch(source, {
            status: 'success',
            error: null,
            measures: score.measures.length,
          })
        } catch (error) {
          if (abort.signal.aborted) {
            break
          }
          this.patch(source, {
            status: 'error',
            error:
              error instanceof RecognitionError
                ? error.message
                : '此来源页识别失败，可单独重试。',
          })
        }
      }
    } finally {
      if (this.#task === task) {
        for (const source of task.sources) {
          if (source.status === 'running') {
            this.patch(source, { status: 'pending', error: null })
          }
        }
        task.running = false
      }
      if (this.#abort === abort) {
        this.#abort = null
      }
    }
    return this.getTask()!
  }

  /** Mutate only main's working metadata; callers receive detached snapshots. */
  private patch(
    source: RecognitionSource,
    patch: Partial<RecognitionSource>,
  ): void {
    Object.assign(source, patch)
  }

  /** Abort one current task; running stays true until its request actually settles. */
  cancel(input: unknown): RecognitionTask {
    if (!this.#task || input !== this.#task.id) {
      throw new RecognitionError('识谱任务已过期。')
    }
    this.#abort?.abort()
    return this.getTask()!
  }

  /** Build a fresh ordinary document from successful pages, preserving explicit user order and partial results. */
  result(input: unknown): Score {
    return this.resultWithSources(input).score
  }

  /** Attach main-owned source provenance to the exact generated snapshot, skipping unsuccessful sources. */
  resultWithSources(input: unknown): RecognitionImport {
    const { task, sourceIds } = this.selected(input)
    if (task.running) {
      throw new RecognitionError('请先等待或取消识谱任务。')
    }
    const successful = sourceIds.filter((id) => this.#scores.has(id))
    const scores = successful.map((id) => this.#scores.get(id)!)
    const score = combineRecognitionScores(scores, randomUUID())
    let offset = 0
    const fragments = successful.map((sourceId, index) => {
      const measureIds = score.measures
        .slice(offset, offset + scores[index].measures.length)
        .map((measure) => measure.id)
      offset += measureIds.length
      return { sourceId, measureIds }
    })
    return { taskId: task.id, sourceOrder: sourceIds, fragments, score }
  }

  /** Cancel owned network work and release source bytes when the window is destroyed. */
  dispose(): void {
    this.#abort?.abort()
    this.#pages.clear()
    this.#scores.clear()
    this.#task = null
  }
}
