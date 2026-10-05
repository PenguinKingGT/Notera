// @vitest-environment node
/** Verify real file replacement and recovery boundaries with deterministic native-dialog outcomes. */
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createPianoScore, deserializeScore, serializeScore } from '../core'
import { atomicWrite } from './atomic-file'
import { DocumentService } from './document-service'
import { RecoveryStore } from './recovery-store'
import type { FileResult } from '../shared/desktop-api'

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'notera-files-'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/** Fail a test immediately when a file operation unexpectedly rejects or cancels. */
function value<T>(result: FileResult<T>): T {
  if (result.status !== 'success') {
    throw new Error(JSON.stringify(result))
  }
  return result.value
}

/** Construct a service using actual temporary filesystem storage and controllable dialog selection. */
function setup() {
  const open = vi.fn<() => Promise<string | null>>().mockResolvedValue(null)
  const save = vi
    .fn<(name: string) => Promise<string | null>>()
    .mockResolvedValue(join(directory, 'score.notera'))
  const recovery = new RecoveryStore(
    join(directory, 'recovery', 'current.json'),
  )
  const service = new DocumentService({ open, save }, recovery)
  return { service, recovery, open, save }
}

test('save, save as and open preserve a full native score and use selected capabilities only', async () => {
  const { service, open, save } = setup()
  const score = deserializeScore(
    await readFile('tests/fixtures/piano-core.notera.json', 'utf8'),
  )
  const initial = value(await service.initialize(score)).document
  const saved = value(
    await service.save({
      documentId: initial.documentId,
      score,
      saveAs: false,
    }),
  )
  expect(deserializeScore(await readFile(saved.filePath!, 'utf8'))).toEqual(
    score,
  )
  save.mockResolvedValue(join(directory, 'second.notera'))
  const second = value(
    await service.save({
      documentId: initial.documentId,
      score: { ...score, title: 'Second' },
      saveAs: true,
    }),
  )
  expect(second.fileName).toBe('second.notera')
  expect(deserializeScore(await readFile(saved.filePath!, 'utf8')).title).toBe(
    score.title,
  )
  open.mockResolvedValue(saved.filePath)
  expect(value(await service.open()).score).toEqual(score)
  expect(
    (
      await service.save({
        documentId: initial.documentId,
        score,
        saveAs: false,
      })
    ).status,
  ).toBe('error')
})

test('cancelled dialogs and invalid files keep the current save target', async () => {
  const { service, open, save } = setup()
  const score = createPianoScore({ id: 's' })
  const info = value(await service.initialize(score)).document
  save.mockResolvedValue(null)
  expect(
    (await service.save({ documentId: info.documentId, score, saveAs: false }))
      .status,
  ).toBe('cancelled')
  await writeFile(join(directory, 'invalid.notera'), '{invalid')
  open.mockResolvedValue(join(directory, 'invalid.notera'))
  expect((await service.open()).status).toBe('error')
  save.mockResolvedValue(join(directory, 'valid.notera'))
  expect(
    (await service.save({ documentId: info.documentId, score, saveAs: false }))
      .status,
  ).toBe('success')
})

test('an atomic replacement failure leaves original bytes and cleans temporary files', async () => {
  const path = join(directory, 'original.notera')
  await writeFile(path, 'original')
  await expect(
    atomicWrite(path, 'new', async () => {
      throw new Error('Simulated rename failure')
    }),
  ).rejects.toThrow('Simulated')
  expect(await readFile(path, 'utf8')).toBe('original')
  expect(await readdir(directory)).toEqual(['original.notera'])
})

test('detects externally edited disk content before overwriting it', async () => {
  const { service } = setup()
  const score = createPianoScore({ id: 's' })
  const info = value(await service.initialize(score)).document
  const saved = value(
    await service.save({ documentId: info.documentId, score, saveAs: false }),
  )
  await writeFile(saved.filePath!, 'externally modified')
  const result = await service.save({
    documentId: info.documentId,
    score,
    saveAs: false,
  })
  expect(result).toMatchObject({
    status: 'error',
    message: expect.stringContaining('其他程序'),
  })
  expect(await readFile(saved.filePath!, 'utf8')).toBe('externally modified')
})

test('startup checkpoints cannot destroy pending recovery and restoring has no disk target', async () => {
  const { service, recovery } = setup()
  const old = createPianoScore({ id: 'old', title: 'Recovered' })
  await recovery.write(old)
  const fresh = createPianoScore({ id: 'new' })
  const startup = value(await service.initialize(fresh))
  expect(startup.recovery?.title).toBe('Recovered')
  await service.checkpoint({
    documentId: startup.document.documentId,
    score: fresh,
    dirty: false,
  })
  expect((await recovery.read())?.score).toEqual(old)
  const restored = value(
    await service.resolveRecovery({
      documentId: startup.document.documentId,
      restore: true,
    }),
  )!
  expect(restored.document.filePath).toBeNull()
  expect(restored.score).toEqual(old)
  await service.close(restored.document.documentId)
  expect(await recovery.read()).toBeNull()
  expect(
    (
      await service.checkpoint({
        documentId: restored.document.documentId,
        score: old,
        dirty: true,
      })
    ).status,
  ).toBe('error')
})

test('malformed recovery is retained until explicitly discarded', async () => {
  const { service, recovery } = setup()
  await recovery.write(createPianoScore({ id: 's' }))
  await writeFile(recovery.path, 'broken')
  const startup = value(
    await service.initialize(createPianoScore({ id: 'new' })),
  )
  expect(startup.recoveryError).toBeTruthy()
  await service.close(startup.document.documentId)
  expect(await readFile(recovery.path, 'utf8')).toBe('broken')
})

test('strict save payload rejects renderer paths and invalid music without touching disk', async () => {
  const { service } = setup()
  const score = createPianoScore({ id: 's' })
  const info = value(await service.initialize(score)).document
  expect(
    (
      await service.save({
        documentId: info.documentId,
        score,
        saveAs: false,
        path: join(directory, 'unauthorized'),
      })
    ).status,
  ).toBe('error')
  expect(
    (
      await service.save({
        documentId: info.documentId,
        score: { ...score, measures: [] },
        saveAs: false,
      })
    ).status,
  ).toBe('error')
  expect(await readdir(directory)).toEqual([])
  // Native text remains independently decodable even though it cannot authorize a renderer-provided path.
  expect(deserializeScore(serializeScore(score))).toEqual(score)
})

test('renderer reinitialization protects dirty checkpoints and revokes the previous document token', async () => {
  const { service } = setup()
  const dirty = createPianoScore({ id: 'dirty', title: 'Unsaved session' })
  const first = value(await service.initialize(dirty))
  await service.checkpoint({
    documentId: first.document.documentId,
    score: dirty,
    dirty: true,
  })
  const reloaded = value(
    await service.initialize(createPianoScore({ id: 'blank' })),
  )
  expect(reloaded.recovery?.title).toBe('Unsaved session')
  expect(reloaded.document.documentId).not.toBe(first.document.documentId)
  expect(
    (
      await service.save({
        documentId: first.document.documentId,
        score: dirty,
        saveAs: false,
      })
    ).status,
  ).toBe('error')
})

test('MusicXML import confirms losses before replacement; export keeps native target and recovery', async () => {
  const { exportMusicXml, importMusicXml, unpackMxl } =
    await import('../exchange')
  const score = deserializeScore(
    await readFile('tests/fixtures/piano-core.notera.json', 'utf8'),
  )
  const importedPath = join(directory, 'external.musicxml')
  const xml = exportMusicXml(score).replace(
    '<notations>',
    '<notations><articulations><staccato/></articulations>',
  )
  await writeFile(importedPath, xml)
  const pickImport = vi.fn().mockResolvedValue(importedPath)
  const pickExport = vi.fn().mockResolvedValue(join(directory, 'external.mxl'))
  const confirmImport = vi.fn().mockResolvedValue(false)
  const { service, recovery, save } = setup()
  service.dialogs.importMusic = pickImport
  service.dialogs.exportMusic = pickExport
  service.dialogs.confirmImport = confirmImport
  const initial = value(await service.initialize(score)).document
  await service.checkpoint({
    documentId: initial.documentId,
    score,
    dirty: true,
  })
  expect((await service.importMusic()).status).toBe('cancelled')
  expect((await recovery.read())?.score).toEqual(score)
  confirmImport.mockResolvedValue(true)
  const imported = value(await service.importMusic())
  expect(imported.document.filePath).toBeNull()
  expect(imported.document.documentId).not.toBe(initial.documentId)
  expect(confirmImport).toHaveBeenCalledWith(
    expect.arrayContaining(['未保留 articulations 记号。']),
  )
  const saved = value(
    await service.save({
      documentId: imported.document.documentId,
      score: imported.score,
      saveAs: false,
    }),
  )
  const checkpoint = await recovery.read()
  expect(
    value(
      await service.exportMusic({
        documentId: saved.documentId,
        score: imported.score,
        compressed: true,
      }),
    ).fileName,
  ).toBe('external.mxl')
  expect(
    importMusicXml(unpackMxl(await readFile(join(directory, 'external.mxl'))))
      .score.title,
  ).toBe(score.title)
  expect(await recovery.read()).toEqual(checkpoint)
  save.mockClear()
  await service.save({
    documentId: saved.documentId,
    score: { ...imported.score, title: 'Edited' },
    saveAs: false,
  })
  expect(save).not.toHaveBeenCalled()
  expect(deserializeScore(await readFile(saved.filePath!, 'utf8')).title).toBe(
    'Edited',
  )
  expect(await readFile(importedPath, 'utf8')).toBe(xml)
  pickExport.mockResolvedValue(saved.filePath)
  expect(
    (
      await service.exportMusic({
        documentId: saved.documentId,
        score,
        compressed: false,
      })
    ).status,
  ).toBe('error')
  expect(deserializeScore(await readFile(saved.filePath!, 'utf8')).title).toBe(
    'Edited',
  )
})

test('failed or cancelled interchange retains the prior document capability and accepts no renderer path', async () => {
  const { service, save, recovery } = setup()
  const score = createPianoScore({ id: 'original' })
  const initial = value(await service.initialize(score)).document
  const path = join(directory, 'bad.musicxml')
  await writeFile(path, '<score-partwise>broken')
  service.dialogs.importMusic = vi.fn().mockResolvedValue(path)
  expect((await service.importMusic()).status).toBe('error')
  expect(await recovery.read()).toBeNull()
  service.dialogs.importMusic = vi.fn().mockResolvedValue(null)
  expect((await service.importMusic()).status).toBe('cancelled')
  expect(
    (
      await service.exportMusic({
        documentId: initial.documentId,
        score,
        compressed: false,
        path: join(directory, 'unauthorized'),
      })
    ).status,
  ).toBe('error')
  expect(
    (
      await service.exportMusic({
        documentId: initial.documentId,
        score,
        compressed: false,
      })
    ).status,
  ).toBe('cancelled')
  expect(
    (
      await service.save({
        documentId: initial.documentId,
        score,
        saveAs: false,
      })
    ).status,
  ).toBe('success')
  expect(save).toHaveBeenCalledTimes(1)
})

test('PDF export preserves native bytes/recovery and captures music before an asynchronous picker', async () => {
  const score = createPianoScore({ id: 'pdf-score', title: 'PDF Snapshot' })
  const recovery = new RecoveryStore(join(directory, 'recovery.json'))
  let choose!: (path: string | null) => void
  const exportPdf = vi.fn(
    () =>
      new Promise<string | null>((resolve) => {
        choose = resolve
      }),
  )
  const render = vi.fn(async (captured) => ({
    bytes: new TextEncoder().encode(`%PDF-${captured.title}`),
    pageCount: 2,
  }))
  const service = new DocumentService(
    {
      open: async () => null,
      save: async () => join(directory, 'native.notera'),
      exportPdf,
    },
    recovery,
    render,
  )
  const document = value(await service.initialize(score)).document
  const saved = value(
    await service.save({
      documentId: document.documentId,
      score,
      saveAs: false,
    }),
  )
  await service.checkpoint({
    documentId: document.documentId,
    score,
    dirty: true,
  })
  const before = await readFile(saved.filePath!, 'utf8')
  const checkpoint = await readFile(join(directory, 'recovery.json'), 'utf8')
  const exporting = service.exportPdf({
    documentId: document.documentId,
    score,
  })
  await vi.waitFor(() => expect(exportPdf).toHaveBeenCalled())
  choose(join(directory, 'score.pdf'))
  expect(value(await exporting)).toEqual({
    fileName: 'score.pdf',
    pageCount: 2,
  })
  expect(await readFile(saved.filePath!, 'utf8')).toBe(before)
  expect(await readFile(join(directory, 'recovery.json'), 'utf8')).toBe(
    checkpoint,
  )
  expect(render.mock.calls[0][0]).toEqual(score)
  expect(await readFile(join(directory, 'score.pdf'), 'utf8')).toBe(
    '%PDF-PDF Snapshot',
  )
})

test('cancelled/invalid PDF destinations do not render; obsolete capabilities are rejected', async () => {
  const recovery = new RecoveryStore(join(directory, 'recovery.json'))
  const picker = vi.fn<() => Promise<string | null>>().mockResolvedValue(null)
  const render = vi.fn()
  const service = new DocumentService(
    { open: async () => null, save: async () => null, exportPdf: picker },
    recovery,
    render,
  )
  const score = createPianoScore({ id: 's' })
  const document = value(await service.initialize(score)).document
  const request = { documentId: document.documentId, score }
  expect(await service.exportPdf(request)).toEqual({ status: 'cancelled' })
  picker.mockResolvedValue(join(directory, 'invalid.notera'))
  expect(await service.exportPdf(request)).toMatchObject({ status: 'error' })
  expect(render).not.toHaveBeenCalled()
  await service.create(score)
  expect(await service.exportPdf(request)).toMatchObject({ status: 'error' })
  expect(picker).toHaveBeenCalledTimes(2)
})

test('PDF rendering and write failures retain existing outputs and permit subsequent saves', async () => {
  const path = join(directory, 'score.pdf')
  await writeFile(path, 'previous PDF')
  const render = vi
    .fn()
    .mockRejectedValueOnce(new Error('engine failure'))
    .mockResolvedValue({
      bytes: new TextEncoder().encode('%PDF-ready'),
      pageCount: 1,
    })
  const picker = vi.fn().mockResolvedValue(path)
  const service = new DocumentService(
    {
      open: async () => null,
      save: async () => join(directory, 'native.notera'),
      exportPdf: picker,
    },
    new RecoveryStore(join(directory, 'recovery.json')),
    render,
  )
  const score = createPianoScore({ id: 's' })
  const document = value(await service.initialize(score)).document
  const request = { documentId: document.documentId, score }
  expect(await service.exportPdf(request)).toMatchObject({ status: 'error' })
  expect(await readFile(path, 'utf8')).toBe('previous PDF')
  const badTarget = join(directory, 'directory.pdf')
  await mkdir(badTarget)
  picker.mockResolvedValue(badTarget)
  expect(await service.exportPdf(request)).toMatchObject({ status: 'error' })
  expect(await readFile(path, 'utf8')).toBe('previous PDF')
  expect(
    value(await service.save({ ...request, saveAs: false })).fileName,
  ).toBe('native.notera')
  expect((await readdir(directory)).some((name) => name.endsWith('.tmp'))).toBe(
    false,
  )
})
