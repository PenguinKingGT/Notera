/** Define narrow document capabilities; paths are display metadata and never accepted as renderer write targets. */
import type { Score } from '../core'
import type { RecognitionApi } from './recognition-api'

/** Desktop application metadata. */
export interface AppInfo {
  name: string
  version: string
}

/** Explicit outcomes keep cancellation separate from file errors across structured IPC. */
export type FileResult<T> =
  | { status: 'success'; value: T }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

/** Opaque main-process document identity with read-only display metadata. */
export interface DocumentInfo {
  documentId: string
  fileName: string | null
  filePath: string | null
}

/** A validated score and the main-process capability that owns its selected path. */
export interface OpenedDocument {
  document: DocumentInfo
  score: Score
}

/** Startup recovery metadata; recovery content stays in the main process until accepted. */
export interface DocumentStartup {
  document: DocumentInfo
  recovery: { title: string; updatedAt: string } | null
  recoveryError: string | null
}

/** Native file operations expose intentions and snapshots, never arbitrary filesystem access. */
export interface DesktopApi {
  readonly recognition: RecognitionApi
  getAppInfo: () => Promise<AppInfo>
  initializeDocument: (score: Score) => Promise<FileResult<DocumentStartup>>
  createDocument: (score: Score) => Promise<FileResult<DocumentInfo>>
  openDocument: () => Promise<FileResult<OpenedDocument>>
  importMusic: () => Promise<FileResult<OpenedDocument>>
  exportMusic: (request: {
    documentId: string
    score: Score
    compressed: boolean
  }) => Promise<FileResult<{ fileName: string }>>
  exportPdf: (request: {
    documentId: string
    score: Score
  }) => Promise<FileResult<{ fileName: string; pageCount: number }>>
  saveDocument: (request: {
    documentId: string
    score: Score
    saveAs: boolean
  }) => Promise<FileResult<DocumentInfo>>
  checkpointDocument: (request: {
    documentId: string
    score: Score
    dirty: boolean
  }) => Promise<FileResult<null>>
  resolveRecovery: (request: {
    documentId: string
    restore: boolean
  }) => Promise<FileResult<OpenedDocument | null>>
  closeDocument: (documentId: string | null) => Promise<FileResult<null>>
  cancelCloseRequest: () => Promise<void>
  onCloseRequested: (listener: () => void) => () => void
}

export const IPC_CHANNELS = {
  getAppInfo: 'app:get-info',
  initializeDocument: 'document:initialize',
  createDocument: 'document:create',
  openDocument: 'document:open',
  saveDocument: 'document:save',
  importMusic: 'document:import-music',
  exportMusic: 'document:export-music',
  exportPdf: 'document:export-pdf',
  checkpointDocument: 'document:checkpoint',
  resolveRecovery: 'document:resolve-recovery',
  closeDocument: 'document:close',
  closeRequested: 'document:close-requested',
  cancelCloseRequest: 'document:cancel-close-request',
} as const
