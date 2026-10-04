import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/desktop-api'
import type { DesktopApi } from '../shared/desktop-api'

const desktopApi: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
}

contextBridge.exposeInMainWorld('notera', desktopApi)
