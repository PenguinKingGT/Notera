/** Run numbered-notation layout off the UI thread; replies remain associated with one exact music snapshot. */
import { parseScore } from '../core'
import { engraveJianpu } from './svg'
import type { JianpuRequest, JianpuResponse } from './protocol'

self.onmessage = ({ data }: MessageEvent<JianpuRequest>) => {
  let response: JianpuResponse
  try {
    response = {
      requestId: data.requestId,
      ...engraveJianpu(parseScore(data.score)),
    }
  } catch (error) {
    response = {
      requestId: data.requestId,
      error: error instanceof Error ? error.message : '简谱排版失败，请重试。',
    }
  }
  self.postMessage(response)
}
