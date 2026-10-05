/** Start isolated desktop windows and bind trusted document capabilities to their originating main frame. */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, safeStorage, net } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../shared/desktop-api'
import type { AppInfo } from '../shared/desktop-api'
import { DocumentService } from './document-service'
import { renderStaffPdf } from './staff-pdf'
import { renderJianpuPdf } from './jianpu-pdf'
import { RecoveryStore } from './recovery-store'
import { RecognitionSettingsStore } from './recognition/settings'
import { RecognitionService, recognitionResult } from './recognition/service'
import { RecognitionError } from '../recognition/errors'
import { RECOGNITION_CHANNELS } from '../shared/recognition-api'

const currentDirectory = fileURLToPath(new URL('.', import.meta.url))
const developmentUrl = process.env.ELECTRON_RENDERER_URL
const services = new Map<number, DocumentService>()
const recognitionServices = new Map<number, RecognitionService>()
let quitRequested = false
const closeHandlers = new Map<number, (id: unknown) => Promise<unknown>>()

// A process-level profile override permits isolated desktop tests without touching a user's recovery file.
if (process.env.NOTERA_USER_DATA_DIR) {
  mkdirSync(process.env.NOTERA_USER_DATA_DIR, { recursive: true })
  app.setPath('userData', process.env.NOTERA_USER_DATA_DIR)
}

/** Accept only this app's loaded top-level frame, including the exact local development origin. */
function trustedWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender)
  const frame = event.senderFrame
  const expected =
    !app.isPackaged && developmentUrl
      ? developmentUrl.replace(/\/$/, '')
      : fileURLToPath(new URL('../renderer/index.html', import.meta.url))
  const actual = frame?.url
  const validUrl =
    !app.isPackaged && developmentUrl
      ? actual?.replace(/\/$/, '') === expected
      : actual?.startsWith('file:') && fileURLToPath(actual) === expected
  if (
    !window ||
    frame !== window.webContents.mainFrame ||
    !validUrl ||
    !services.has(window.id)
  ) {
    throw new Error('Untrusted IPC sender')
  }
  return window
}

/** Register one IPC allowlist; payload validation and path authorization stay in the window-owned service. */
function registerDocumentHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getAppInfo, (event): AppInfo => {
    trustedWindow(event)
    return {
      name: app.isPackaged ? app.getName() : 'Notera',
      version: app.getVersion(),
    }
  })
  const recognitionHandlers = {
    [RECOGNITION_CHANNELS.getSettings]: (service: RecognitionService) =>
      recognitionResult(() => service.settings.get()),
    [RECOGNITION_CHANNELS.saveSettings]: (
      service: RecognitionService,
      input: unknown,
    ) =>
      recognitionResult(async () => {
        if (service.getTask()?.running) {
          throw new RecognitionError('请先结束当前识谱任务，再修改服务配置。')
        }
        return service.settings.save(input)
      }),
    [RECOGNITION_CHANNELS.chooseSources]: (service: RecognitionService) =>
      service.chooseSources(),
    [RECOGNITION_CHANNELS.getTask]: (service: RecognitionService) =>
      recognitionResult(async () => service.getTask()),
    [RECOGNITION_CHANNELS.run]: (service: RecognitionService, input: unknown) =>
      recognitionResult(() => service.run(input)),
    [RECOGNITION_CHANNELS.cancel]: (
      service: RecognitionService,
      input: unknown,
    ) => recognitionResult(async () => service.cancel(input)),
    [RECOGNITION_CHANNELS.result]: (
      service: RecognitionService,
      input: unknown,
    ) => recognitionResult(async () => service.result(input)),
  }
  for (const [channel, handler] of Object.entries(recognitionHandlers)) {
    ipcMain.handle(channel, (event, input: unknown) => {
      const window = trustedWindow(event)
      return handler(recognitionServices.get(window.id)!, input)
    })
  }
  const handlers = {
    [IPC_CHANNELS.initializeDocument]: (
      service: DocumentService,
      payload: unknown,
    ) => service.initialize(payload),
    [IPC_CHANNELS.createDocument]: (
      service: DocumentService,
      payload: unknown,
    ) => service.create(payload),
    [IPC_CHANNELS.openDocument]: (service: DocumentService) => service.open(),
    [IPC_CHANNELS.importMusic]: (service: DocumentService) =>
      service.importMusic(),
    [IPC_CHANNELS.exportMusic]: (service: DocumentService, payload: unknown) =>
      service.exportMusic(payload),
    [IPC_CHANNELS.exportPdf]: (service: DocumentService, payload: unknown) =>
      service.exportPdf(payload),
    [IPC_CHANNELS.saveDocument]: (service: DocumentService, payload: unknown) =>
      service.save(payload),
    [IPC_CHANNELS.checkpointDocument]: (
      service: DocumentService,
      payload: unknown,
    ) => service.checkpoint(payload),
    [IPC_CHANNELS.resolveRecovery]: (
      service: DocumentService,
      payload: unknown,
    ) => service.resolveRecovery(payload),
  }
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, payload: unknown) => {
      const window = trustedWindow(event)
      return handler(services.get(window.id)!, payload)
    })
  }
}

/** Create the window and its native dialogs; close requests remain cancellable until the UI resolves edits. */
async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    title: 'Notera',
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#fafafa',
    webPreferences: {
      preload: join(currentDirectory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  const filters = [{ name: 'Notera 乐谱', extensions: ['notera', 'json'] }]
  const service = new DocumentService(
    {
      /** Return only an explicitly selected native score filename. */
      open: async () => {
        const result = await dialog.showOpenDialog(window, {
          title: '打开乐谱',
          filters,
          properties: ['openFile'],
        })
        return result.canceled ? null : (result.filePaths[0] ?? null)
      },
      /** Read MusicXML or MXL through an explicit native selection. */
      importMusic: async () => {
        const result = await dialog.showOpenDialog(window, {
          title: '导入 MusicXML',
          filters: [
            { name: 'MusicXML 乐谱', extensions: ['musicxml', 'xml', 'mxl'] },
          ],
          properties: ['openFile'],
        })
        return result.canceled ? null : (result.filePaths[0] ?? null)
      },
      /** Confirm listed losses before replacing any current score or recovery. */
      confirmImport: async (warnings) => {
        const result = await dialog.showMessageBox(window, {
          type: 'warning',
          title: 'MusicXML 导入提示',
          message: '以下内容无法完整保留，是否继续导入？',
          detail: warnings.join('\n'),
          buttons: ['取消', '继续导入'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        })
        return result.response === 1
      },
      /** Keep interchange exports separate from the native document's save capability. */
      exportMusic: async (defaultPath, compressed) => {
        const result = await dialog.showSaveDialog(window, {
          title: compressed ? '导出 MXL' : '导出 MusicXML',
          defaultPath,
          filters: [
            {
              name: compressed ? '压缩 MusicXML' : 'MusicXML',
              extensions: [compressed ? 'mxl' : 'musicxml'],
            },
          ],
          properties: ['createDirectory', 'showOverwriteConfirmation'],
        })
        return result.canceled ? null : (result.filePath ?? null)
      },
      /** Select a PDF destination owned exclusively by main. */
      exportPdf: async (defaultPath) => {
        const result = await dialog.showSaveDialog(window, {
          title: '导出乐谱 PDF',
          defaultPath,
          filters: [{ name: 'PDF 乐谱', extensions: ['pdf'] }],
          properties: ['createDirectory', 'showOverwriteConfirmation'],
        })
        return result.canceled ? null : (result.filePath ?? null)
      },
      /** Let the OS confirm overwrite; score saving remains in the service after the dialog resolves. */
      save: async (defaultPath) => {
        const result = await dialog.showSaveDialog(window, {
          title: '保存乐谱',
          defaultPath,
          filters: [{ name: 'Notera 乐谱', extensions: ['notera'] }],
          properties: ['createDirectory', 'showOverwriteConfirmation'],
        })
        return result.canceled ? null : (result.filePath ?? null)
      },
    },
    new RecoveryStore(
      join(app.getPath('userData'), 'recovery', 'current.json'),
    ),
    (score, notation) =>
      notation === 'jianpu' ? renderJianpuPdf(score) : renderStaffPdf(score),
  )
  services.set(window.id, service)
  const recognition = new RecognitionService(
    new RecognitionSettingsStore(
      join(app.getPath('userData'), 'ai', 'settings.json'),
      {
        available: () =>
          safeStorage.isEncryptionAvailable() &&
          (process.platform !== 'linux' ||
            safeStorage.getSelectedStorageBackend() !== 'basic_text'),
        encrypt: (text) => safeStorage.encryptString(text),
        decrypt: (bytes) => safeStorage.decryptString(bytes),
      },
    ),
    async () => {
      const selected = await dialog.showOpenDialog(window, {
        title: '选择要识别的五线谱',
        filters: [
          {
            name: '五线谱图片或 PDF',
            extensions: ['png', 'jpg', 'jpeg', 'pdf'],
          },
        ],
        properties: ['openFile', 'multiSelections'],
      })
      return selected.canceled ? null : selected.filePaths
    },
    net.fetch,
  )
  recognitionServices.set(window.id, recognition)
  let allowClose = false
  let rendererUnavailable = false
  window.webContents.on('render-process-gone', () => {
    rendererUnavailable = true
  })
  window.webContents.on('did-finish-load', () => {
    rendererUnavailable = false
  })
  closeHandlers.set(window.id, async (id: unknown) => {
    const result = await service.close(id)
    if (result.status === 'success') {
      allowClose = true
      setImmediate(() => window.close())
    }
    return result
  })
  window.on('close', (event) => {
    // A crashed renderer cannot answer the close handshake; preserve its checkpoint and allow closure.
    if (!allowClose && !rendererUnavailable) {
      event.preventDefault()
      window.webContents.send(IPC_CHANNELS.closeRequested)
    }
  })
  window.on('closed', () => {
    recognition.dispose()
    recognitionServices.delete(window.id)
    services.delete(window.id)
    closeHandlers.delete(window.id)
    if (quitRequested) {
      app.quit()
    }
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  if (!app.isPackaged && developmentUrl) {
    await window.loadURL(developmentUrl)
  } else {
    await window.loadFile(join(currentDirectory, '../renderer/index.html'))
  }
}

// One active profile owns one recovery slot. A second launch activates the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows().find((candidate) =>
      services.has(candidate.id),
    )
    if (window?.isMinimized()) {
      window.restore()
    }
    if (window) {
      window.focus()
    } else {
      void app.whenReady().then(createWindow).catch(reportStartupError)
    }
  })
  app
    .whenReady()
    .then(async () => {
      registerDocumentHandlers()
      ipcMain.handle(IPC_CHANNELS.closeDocument, (event, id: unknown) => {
        const window = trustedWindow(event)
        return closeHandlers.get(window.id)!(id)
      })
      ipcMain.handle(IPC_CHANNELS.cancelCloseRequest, (event) => {
        trustedWindow(event)
        quitRequested = false
      })
      await createWindow()
      app.on('activate', () => {
        if (
          !BrowserWindow.getAllWindows().some((candidate) =>
            services.has(candidate.id),
          )
        ) {
          void createWindow().catch(reportStartupError)
        }
      })
    })
    .catch(reportStartupError)
}

app.on('before-quit', (event) => {
  const windows = BrowserWindow.getAllWindows().filter((window) =>
    services.has(window.id),
  )
  if (windows.length > 0) {
    event.preventDefault()
    quitRequested = true
    windows.forEach((window) => window.close())
  }
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

/** Report startup failures explicitly rather than leaving a hidden, unusable desktop process. */
function reportStartupError(error: unknown): void {
  console.error('Unable to start Notera:', error)
  app.exit(1)
}
