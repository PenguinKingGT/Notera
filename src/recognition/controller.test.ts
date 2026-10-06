// @vitest-environment node
/** Verify renderer recognition state keeps ordering, cancellation and document-import races explicit. */
import { expect, test, vi } from 'vitest'
import { createPianoScore } from '../core'
import type {
  RecognitionApi,
  RecognitionSettings,
  RecognitionTask,
} from '../shared/recognition-api'
import { RecognitionController } from './controller'

const settings: RecognitionSettings = {
  protocol: 'openai-chat',
  baseUrl: 'https://example.test/v1',
  model: 'model',
  maxTokens: 4096,
  jsonMode: false,
  reasoningMode: 'auto',
  timeoutSeconds: 180,
  hasKey: true,
}
const task: RecognitionTask = {
  id: 'task',
  running: false,
  sources: [
    {
      id: 'first',
      name: 'first.png',
      kind: 'image',
      status: 'pending',
      error: null,
      measures: 0,
    },
    {
      id: 'second',
      name: 'second.png',
      kind: 'image',
      status: 'pending',
      error: null,
      measures: 0,
    },
  ],
}

/** Use explicit successful fake outcomes while leaving controller concurrency and state publication real. */
function setup(accept = vi.fn().mockReturnValue(true)) {
  const recognized = createPianoScore({ id: 'recognized', measureCount: 2 })
  const api: RecognitionApi = {
    getSettings: vi
      .fn()
      .mockResolvedValue({ status: 'success', value: settings }),
    saveSettings: vi
      .fn()
      .mockResolvedValue({ status: 'success', value: settings }),
    chooseSources: vi
      .fn()
      .mockResolvedValue({ status: 'success', value: structuredClone(task) }),
    getTask: vi
      .fn()
      .mockResolvedValue({ status: 'success', value: structuredClone(task) }),
    run: vi.fn().mockResolvedValue({
      status: 'success',
      value: {
        ...task,
        sources: task.sources.map((source) => ({
          ...source,
          status: 'success',
          measures: 1,
        })),
      },
    }),
    cancel: vi.fn().mockResolvedValue({ status: 'success', value: task }),
    result: vi.fn().mockResolvedValue({
      status: 'success',
      value: {
        taskId: task.id,
        sourceOrder: task.sources.map((source) => source.id),
        fragments: task.sources.map((source, index) => ({
          sourceId: source.id,
          measureIds: [recognized.measures[index].id],
        })),
        score: recognized,
      },
    }),
  }
  return { api, accept, controller: new RecognitionController(api, accept) }
}

test('preserves explicit source ordering across progress polls and sends only source capabilities', async () => {
  const { api, controller } = setup()
  await controller.open()
  controller.move('second', -1)
  await controller.poll()
  expect(
    controller.getSnapshot().task?.sources.map((source) => source.id),
  ).toEqual(['second', 'first'])
  await controller.run()
  expect(api.run).toHaveBeenCalledWith({
    taskId: 'task',
    sourceIds: ['second', 'first'],
  })
  expect(JSON.stringify(controller.getSnapshot())).not.toContain('apiKey')
})

test('keeps cancellation available during a pending run and serializes other user intentions', async () => {
  const { api, controller } = setup()
  await controller.open()
  let finish!: (value: Awaited<ReturnType<RecognitionApi['run']>>) => void
  vi.mocked(api.run).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const running = controller.run()
  expect(controller.getSnapshot().busy).toBe(true)
  await controller.choose()
  expect(api.chooseSources).not.toHaveBeenCalled()
  await controller.cancel()
  expect(api.cancel).toHaveBeenCalledWith('task')
  finish({ status: 'success', value: task })
  await running
  expect(controller.getSnapshot().busy).toBe(false)
})

test('retains successful task metadata when document replacement is blocked or cancelled', async () => {
  const { api, controller, accept } = setup(vi.fn().mockReturnValue(false))
  await controller.open()
  await controller.run()
  const before = controller.getSnapshot().task
  expect(await controller.importScore()).toBe(false)
  expect(controller.getSnapshot().task).toBe(before)
  expect(controller.getSnapshot().error).toContain('稍后再导入')
  expect(accept).toHaveBeenCalledOnce()
  vi.mocked(api.result).mockResolvedValue({ status: 'cancelled' })
  expect(await controller.importScore()).toBe(false)
  expect(controller.getSnapshot().task).toBe(before)
})

test('captures a merge target before awaiting results and reports a rejected stale target without replacing documents', async () => {
  const { api, accept } = setup()
  const target = {
    documentId: 'document',
    score: createPianoScore({ id: 'edited' }),
  }
  const capture = vi.fn().mockReturnValue(target)
  const apply = vi.fn().mockReturnValue('文档已变化，请重新补入。')
  const controller = new RecognitionController(api, accept, { capture, apply })
  await controller.open()
  await controller.run()
  let complete!: (value: Awaited<ReturnType<RecognitionApi['result']>>) => void
  vi.mocked(api.result).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  const merging = controller.mergeScore()
  expect(capture).toHaveBeenCalledWith(task.id)
  expect(controller.getSnapshot().busy).toBe(true)
  controller.move('second', -1)
  const score = createPianoScore({ id: 'retry' })
  const result = {
    taskId: task.id,
    sourceOrder: ['first', 'second'],
    fragments: [],
    score,
  }
  complete({ status: 'success', value: result })
  expect(await merging).toBe(false)
  expect(apply).toHaveBeenCalledWith(result, 'ordered', target)
  expect(accept).not.toHaveBeenCalled()
  expect(controller.getSnapshot().error).toContain('文档已变化')
  capture.mockReturnValue(null)
  expect(await controller.mergeScore('append')).toBe(false)
  expect(api.result).toHaveBeenCalledTimes(1)
})
