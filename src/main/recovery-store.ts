/** Keep one local recovery snapshot separate from native user-selected score files. */
import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { deserializeScore, serializeScore } from '../core'
import type { Score } from '../core'
import { atomicWrite } from './atomic-file'

const envelope = z.strictObject({
  format: z.literal('notera-recovery'),
  version: z.literal(1),
  updatedAt: z.iso.datetime(),
  scoreFile: z.string(),
})

/** Validated recovery content is restored as an untitled document, never as a saved disk version. */
export interface RecoverySnapshot {
  score: Score
  updatedAt: string
}

/** Persist only this app's recovery path; never authorize a score file path from recovery metadata. */
export class RecoveryStore {
  /** Receive the application-owned recovery filename, outside renderer control. */
  constructor(readonly path: string) {}

  /** Read and validate the full native score; leave malformed recovery files for an explicit user decision. */
  async read(): Promise<RecoverySnapshot | null> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw error
    }
    const value = envelope.parse(JSON.parse(text))
    return {
      score: deserializeScore(value.scoreFile),
      updatedAt: value.updatedAt,
    }
  }

  /** Store the native envelope atomically; this is not a confirmation of formal save success. */
  async write(score: Score): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    await atomicWrite(
      this.path,
      JSON.stringify(
        {
          format: 'notera-recovery',
          version: 1,
          updatedAt: new Date().toISOString(),
          scoreFile: serializeScore(score),
        },
        null,
        2,
      ),
    )
  }

  /** Remove recovery only after save, deliberate discard or accepted clean closure. */
  async clear(): Promise<void> {
    await rm(this.path, { force: true })
  }
}
