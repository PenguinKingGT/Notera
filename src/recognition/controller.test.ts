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
      value: createPianoScore({ id: 'recognized' }),
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
