/** Define AI intentions and public task metadata; file bytes and saved credentials remain in main. */
import type { Score } from '../core'
import type { FileResult } from './desktop-api'

export type RecognitionProtocol = 'openai-chat' | 'openai-responses' | 'claude'

/** Compatibility choices allow custom gateways to opt into their documented reasoning controls. */
export type RecognitionReasoningMode =
  'auto' | 'service-default' | 'openai-none' | 'thinking-off'

/** Identify only the official hostname; incomplete form values and lookalike domains are not trusted providers. */
export function isDeepSeekService(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === 'api.deepseek.com'
  } catch {
    return false
  }
}

/** Public configuration omits saved plaintext and ciphertext secrets. */
export interface RecognitionSettings {
  protocol: RecognitionProtocol
  baseUrl: string
  model: string
  maxTokens: number
  jsonMode: boolean
  reasoningMode: RecognitionReasoningMode
  timeoutSeconds: number
  hasKey: boolean
}

/** A source page identity is unrelated to the pages produced by automatic engraving. */
export interface RecognitionSource {
  id: string
  name: string
  kind: 'image' | 'pdf'
  status: 'pending' | 'running' | 'success' | 'error'
  error: string | null
  measures: number
}

/** Pollable immutable metadata never contains original files or model response bodies. */
export interface RecognitionTask {
  id: string
  running: boolean
  sources: RecognitionSource[]
}

/** Fixed operations for one window-owned recognition service. */
export interface RecognitionApi {
  getSettings: () => Promise<FileResult<RecognitionSettings>>
  saveSettings: (
    input: Omit<RecognitionSettings, 'hasKey'> & {
      apiKey: string
      clearKey: boolean
    },
  ) => Promise<FileResult<RecognitionSettings>>
  chooseSources: () => Promise<FileResult<RecognitionTask>>
  getTask: () => Promise<FileResult<RecognitionTask | null>>
  run: (input: {
    taskId: string
    sourceIds: string[]
  }) => Promise<FileResult<RecognitionTask>>
  cancel: (taskId: string) => Promise<FileResult<RecognitionTask>>
  result: (input: {
    taskId: string
    sourceIds: string[]
  }) => Promise<FileResult<Score>>
}

export const RECOGNITION_CHANNELS = {
  getSettings: 'recognition:get-settings',
  saveSettings: 'recognition:save-settings',
  chooseSources: 'recognition:choose-sources',
  getTask: 'recognition:get-task',
  run: 'recognition:run',
  cancel: 'recognition:cancel',
  result: 'recognition:result',
} as const
