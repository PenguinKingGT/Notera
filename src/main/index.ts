import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../shared/desktop-api'
import type { AppInfo } from '../shared/desktop-api'

const currentDirectory = fileURLToPath(new URL('.', import.meta.url))
const developmentUrl = process.env.ELECTRON_RENDERER_URL

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

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  if (!app.isPackaged && developmentUrl) {
    await window.loadURL(developmentUrl)
  } else {
    await window.loadFile(join(currentDirectory, '../renderer/index.html'))
  }
}

app
  .whenReady()
  .then(async () => {
    ipcMain.handle(IPC_CHANNELS.getAppInfo, (event): AppInfo => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('Untrusted IPC sender')
      }
      return {
        name: app.isPackaged ? app.getName() : 'Notera',
        version: app.getVersion(),
      }
    })

    await createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow().catch(reportStartupError)
      }
    })
  })
  .catch(reportStartupError)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function reportStartupError(error: unknown): void {
  console.error('Unable to start Notera:', error)
  app.exit(1)
}
