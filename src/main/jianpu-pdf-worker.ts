/** Compile complete numbered-notation print pages off the main thread using the same projection as the screen. */
import { parentPort, workerData } from 'node:worker_threads'
import { parseScore } from '../core'
import { engraveJianpu } from '../jianpu/svg'

try {
  parentPort!.postMessage(engraveJianpu(parseScore(workerData)))
} catch (error) {
  parentPort!.postMessage({
    error:
      error instanceof Error
        ? error.message
        : '简谱排版失败，当前乐谱仍然保留。',
  })
}
