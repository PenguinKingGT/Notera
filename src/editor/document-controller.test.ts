// @vitest-environment node
/** Verify async document decisions preserve new edits, failed transitions and native-close cancellation. */
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createPianoScore } from '../core'
import type {
  DesktopApi,
  DocumentInfo,
  FileResult,
} from '../shared/desktop-api'
import { EditorSession } from './session'
import { DocumentController } from './document-controller'

const info: DocumentInfo = {
  documentId: 'document',
  fileName: null,
  filePath: null,
}

/** Wrap an explicit successful structured IPC outcome for typed stubs. */
function success<T>(value: T): FileResult<T> {
  return { status: 'success', value }
}

/** Build the real controller around deterministic desktop intentions. */
function setup() {
  const session = new EditorSession(createPianoScore({ id: 's' }))
  const api: DesktopApi = {
    recognition: {
      getSettings: vi.fn(),
      saveSettings: vi.fn(),
      chooseSources: vi.fn(),
      getTask: vi.fn(),
      run: vi.fn(),
      cancel: vi.fn(),
      result: vi.fn(),
    },
    getAppInfo: vi.fn(),
    initializeDocument: vi
      .fn()
      .mockResolvedValue(
        success({ document: info, recovery: null, recoveryError: null }),
      ),
    createDocument: vi
      .fn()
      .mockResolvedValue(success({ ...info, documentId: 'replacement' })),
    openDocument: vi.fn().mockResolvedValue({ status: 'cancelled' }),
    importMusic: vi.fn().mockResolvedValue({ status: 'cancelled' }),
    exportMusic: vi
      .fn()
      .mockResolvedValue(success({ fileName: 'export.musicxml' })),
    exportPdf: vi
      .fn()
      .mockResolvedValue(success({ fileName: 'score.pdf', pageCount: 1 })),
    saveDocument: vi.fn().mockResolvedValue(
      success({
        ...info,
        fileName: 'saved.notera',
        filePath: '/chosen/saved.notera',
      }),
    ),
    checkpointDocument: vi.fn().mockResolvedValue(success(null)),
    resolveRecovery: vi.fn().mockResolvedValue(success(null)),
    closeDocument: vi.fn().mockResolvedValue(success(null)),
    onCloseRequested: vi.fn(),
    cancelCloseRequest: vi.fn().mockResolvedValue(undefined),
  }
  const controller = new DocumentController(session, api, () =>
    createPianoScore({ id: 'sample' }),
  )
  return { session, api, controller }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('saving an old snapshot cannot discard edits made while it was pending', async () => {
  const { session, api, controller } = setup()
  await controller.start()
  session.inputPitch('C')
  controller.request('new')
  let complete!: (value: FileResult<DocumentInfo>) => void
  vi.mocked(api.saveDocument).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  const saving = controller.saveAndContinue()
  session.inputPitch('D')
  complete(
    success({
      ...info,
      fileName: 'saved.notera',
      filePath: '/chosen/saved.notera',
    }),
  )
  await saving
  expect(session.getSnapshot().dirty).toBe(true)
  expect(session.getSnapshot().score.measures[0].voices[0].events).toHaveLength(
    2,
  )
  expect(controller.getSnapshot().prompt).toBe('new')
  expect(api.createDocument).not.toHaveBeenCalled()
  expect(api.checkpointDocument).toHaveBeenLastCalledWith(
    expect.objectContaining({
      dirty: true,
      score: session.getSnapshot().score,
    }),
  )
  controller.stop()
})

test('cancelled save keeps the prompt and musical undo history', async () => {
  const { session, api, controller } = setup()
  await controller.start()
  session.inputPitch('C')
  const score = session.getSnapshot().score
  controller.request('close')
  vi.mocked(api.saveDocument).mockResolvedValue({ status: 'cancelled' })
  await controller.saveAndContinue()
  expect(controller.getSnapshot().prompt).toBe('close')
  expect(session.getSnapshot().score).toBe(score)
  expect(api.closeDocument).not.toHaveBeenCalled()
  controller.cancel()
  expect(api.cancelCloseRequest).toHaveBeenCalledTimes(1)
  session.undo()
  expect(session.getSnapshot().dirty).toBe(false)
  controller.stop()
})

test('failed open does not discard current music even after a discard decision', async () => {
  const { session, api, controller } = setup()
  await controller.start()
  session.inputPitch('C')
  const before = session.getSnapshot()
  vi.mocked(api.openDocument).mockResolvedValue({
    status: 'error',
    message: 'Invalid native file',
  })
  controller.request('open')
  controller.discard()
  await vi.waitFor(() => expect(controller.getSnapshot().busy).toBe(false))
  expect(session.getSnapshot()).toBe(before)
  expect(controller.getSnapshot().error).toBe('Invalid native file')
  expect(controller.getSnapshot().prompt).toBe('open')
  controller.stop()
})

test('selection changes cannot indefinitely postpone recovery of dirty music', async () => {
  const { session, api, controller } = setup()
  await controller.start()
  session.inputPitch('C')
  await vi.advanceTimersByTimeAsync(300)
  session.setOctave(5)
  await vi.advanceTimersByTimeAsync(200)
  expect(api.checkpointDocument).toHaveBeenCalledWith(
    expect.objectContaining({ dirty: true }),
  )
  controller.stop()
})

test('a queued native close supersedes a prior new-document transition after saving', async () => {
  const { session, api, controller } = setup()
  await controller.start()
  session.inputPitch('C')
  controller.request('new')
  let complete!: (value: FileResult<DocumentInfo>) => void
  vi.mocked(api.saveDocument).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  const saving = controller.saveAndContinue()
  controller.request('close')
  complete(
    success({
      ...info,
      fileName: 'saved.notera',
      filePath: '/chosen/saved.notera',
    }),
  )
  await saving
  await vi.waitFor(() => expect(api.closeDocument).toHaveBeenCalledTimes(1))
  expect(api.createDocument).not.toHaveBeenCalled()
  controller.stop()
})

test('imported music is a normal dirty document with editing, undo and native save', async () => {
  const { session, api, controller } = setup()
  await controller.start()
  vi.mocked(api.importMusic).mockResolvedValue(
    success({
      document: { ...info, documentId: 'imported' },
      score: createPianoScore({ id: 'imported', title: 'Imported piano' }),
    }),
  )
  controller.request('import')
  await vi.waitFor(() => expect(controller.getSnapshot().busy).toBe(false))
  expect(session.getSnapshot().dirty).toBe(true)
  session.inputPitch('C')
  session.undo()
  expect(session.getSnapshot().score.title).toBe('Imported piano')
  expect(session.getSnapshot().dirty).toBe(true)
  expect(await controller.save()).toBe(true)
  expect(session.getSnapshot().dirty).toBe(false)
  controller.stop()
})

test('exporting a captured snapshot never marks native edits saved or redirects document identity', async () => {
  const { session, api, controller } = setup()
  await controller.start()
  session.inputPitch('C')
  const score = session.getSnapshot().score
  await controller.exportMusic(true)
  expect(api.exportMusic).toHaveBeenCalledWith({
    documentId: info.documentId,
    score,
    compressed: true,
  })
  expect(session.getSnapshot().dirty).toBe(true)
  expect(controller.getSnapshot().document).toBe(info)
  session.undo()
  expect(session.getSnapshot().dirty).toBe(false)
  controller.stop()
})

test('PDF export submits one snapshot while ongoing edits retain their history and dirty state', async () => {
  const { session, api, controller } = setup()
  await controller.start()
  session.inputPitch('C')
  const captured = session.getSnapshot().score
  let finish!: (
    result: FileResult<{ fileName: string; pageCount: number }>,
  ) => void
  vi.mocked(api.exportPdf).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const exporting = controller.exportPdf()
  expect(controller.getSnapshot().editingLocked).toBe(false)
  session.inputPitch('D')
  finish(success({ fileName: 'music.pdf', pageCount: 2 }))
  await exporting
  expect(api.exportPdf).toHaveBeenCalledWith({
    documentId: info.documentId,
    score: captured,
  })
  expect(session.getSnapshot().dirty).toBe(true)
  expect(session.getSnapshot().canUndo).toBe(true)
  expect(controller.getSnapshot().document).toEqual(info)
  expect(controller.getSnapshot().message).toContain('2 页')
  session.undo()
  expect(session.getSnapshot().score).toEqual(captured)
  controller.stop()
})

test('recognition import preserves current music on cancel or failed creation and becomes a normal dirty score', async () => {
  const { session, api, controller } = setup()
  await controller.start()
  session.inputPitch('C')
  const current = session.getSnapshot().score
  const recognized = createPianoScore({ id: 'recognized', title: 'AI piano' })
  controller.importRecognition(recognized)
  expect(controller.getSnapshot().prompt).toBe('recognition')
  controller.cancel()
  expect(session.getSnapshot().score).toBe(current)
  controller.importRecognition(recognized)
  vi.mocked(api.createDocument).mockResolvedValueOnce({
    status: 'error',
    message: 'Recovery write failed',
  })
  controller.discard()
  await vi.waitFor(() => expect(controller.getSnapshot().busy).toBe(false))
  expect(session.getSnapshot().score).toBe(current)
  expect(controller.getSnapshot().prompt).toBe('recognition')
  controller.discard()
  await vi.waitFor(() => expect(controller.getSnapshot().busy).toBe(false))
  expect(session.getSnapshot().score).toEqual(recognized)
  expect(session.getSnapshot().dirty).toBe(true)
  session.inputPitch('D')
  session.undo()
  expect(session.getSnapshot().score).toEqual(recognized)
  expect(await controller.save()).toBe(true)
  expect(session.getSnapshot().dirty).toBe(false)
  controller.stop()
})
