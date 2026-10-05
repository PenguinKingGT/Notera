/** Expose document intentions through a fixed IPC allowlist, including a close listener with explicit cleanup. */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/desktop-api'
import { RECOGNITION_CHANNELS } from '../shared/recognition-api'
import type { DesktopApi } from '../shared/desktop-api'

const desktopApi: DesktopApi = {
  recognition: {
    getSettings: () => ipcRenderer.invoke(RECOGNITION_CHANNELS.getSettings),
    saveSettings: (input) =>
      ipcRenderer.invoke(RECOGNITION_CHANNELS.saveSettings, input),
    chooseSources: () => ipcRenderer.invoke(RECOGNITION_CHANNELS.chooseSources),
    getTask: () => ipcRenderer.invoke(RECOGNITION_CHANNELS.getTask),
    run: (input) => ipcRenderer.invoke(RECOGNITION_CHANNELS.run, input),
    cancel: (id) => ipcRenderer.invoke(RECOGNITION_CHANNELS.cancel, id),
    result: (input) => ipcRenderer.invoke(RECOGNITION_CHANNELS.result, input),
  },
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
  initializeDocument: (score) =>
    ipcRenderer.invoke(IPC_CHANNELS.initializeDocument, score),
  createDocument: (score) =>
    ipcRenderer.invoke(IPC_CHANNELS.createDocument, score),
  openDocument: () => ipcRenderer.invoke(IPC_CHANNELS.openDocument),
  importMusic: () => ipcRenderer.invoke(IPC_CHANNELS.importMusic),
  exportMusic: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.exportMusic, request),
  exportPdf: (request) => ipcRenderer.invoke(IPC_CHANNELS.exportPdf, request),
  saveDocument: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveDocument, request),
  checkpointDocument: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.checkpointDocument, request),
  resolveRecovery: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.resolveRecovery, request),
  closeDocument: (id) => ipcRenderer.invoke(IPC_CHANNELS.closeDocument, id),
  cancelCloseRequest: () => ipcRenderer.invoke(IPC_CHANNELS.cancelCloseRequest),
  /** Relay only the named close intention; do not expose the Electron event or sender to page code. */
  onCloseRequested: (listener) => {
    const handler = () => listener()
    ipcRenderer.on(IPC_CHANNELS.closeRequested, handler)
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.closeRequested, handler)
  },
}

contextBridge.exposeInMainWorld('notera', desktopApi)
