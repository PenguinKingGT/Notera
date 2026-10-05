/** Carry only immutable musical snapshots and bounded layout responses across the numbered-notation worker. */
import type { Score } from '../core'

export interface JianpuRequest {
  readonly score: Score
  readonly requestId: number
}

export type JianpuResponse =
  | {
      readonly requestId: number
      readonly pages: string[]
      readonly height: number
    }
  | { readonly requestId: number; readonly error: string }
