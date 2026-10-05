/** Typed messages across the engraving worker boundary, including stale-result identity. */
import type { Score } from '../core'
import type { NotationTarget } from './mei'

/** One immutable score revision to lay out. */
export interface EngraveRequest {
  readonly requestId: number
  readonly score: Score
}

/** Complete pages or an explicit failure; request IDs let the view reject obsolete results. */
export type EngraveResponse =
  | {
      readonly requestId: number
      readonly pages: readonly string[]
      readonly targets: Readonly<Record<string, NotationTarget>>
    }
  | {
      readonly requestId: number
      readonly error: string
    }
