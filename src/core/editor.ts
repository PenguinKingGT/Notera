/** Own validated document snapshots, bounded history and save tracking without UI or file side effects. */
import type { Score } from './model'
import type { ScoreCommand } from './commands'
import { applyScoreCommand } from './commands'
import { parseScore } from './validation'

/** Editor history settings; caller controls the snapshot budget. */
export interface ScoreEditorOptions {
  readonly historyLimit?: number
}

/** A small transactional interface for edit history, with immutable public score snapshots. */
export class ScoreEditor {
  #score: Score
  #undo: Score[] = []
  #redo: Score[] = []
  #revision = 0
  #savedContent: string
  readonly #historyLimit: number

  /** Validate and detach the initial document; opening it starts with a clean save state. */
  constructor(score: Score, options: ScoreEditorOptions = {}) {
    const historyLimit = options.historyLimit ?? 100
    if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) {
      throw new RangeError('History limit must be a positive safe integer')
    }
    this.#score = parseScore(score)
    this.#savedContent = JSON.stringify(this.#score)
    this.#historyLimit = historyLimit
  }

  /** Current detached immutable musical document; safe to share with a view or background task. */
  get score(): Score {
    return this.#score
  }

  /** Monotonic session revision, advancing only when edit, undo or redo changes content. */
  get revision(): number {
    return this.#revision
  }

  /** Whether one more previous snapshot is available. */
  get canUndo(): boolean {
    return this.#undo.length > 0
  }

  /** Whether an undone snapshot remains available; successful edits discard the redo branch. */
  get canRedo(): boolean {
    return this.#redo.length > 0
  }

  /** Musical content differs from the most recently confirmed saved snapshot. */
  get isDirty(): boolean {
    return JSON.stringify(this.#score) !== this.#savedContent
  }

  /** Execute one atomic transaction; a failure or no-op leaves history, revision and save state intact. */
  execute(command: ScoreCommand): Score {
    const next = applyScoreCommand(this.#score, command)
    if (JSON.stringify(next) === JSON.stringify(this.#score)) {
      return this.#score
    }
    this.#undo.push(this.#score)
    if (this.#undo.length > this.#historyLimit) {
      this.#undo.shift()
    }
    this.#score = next
    this.#redo = []
    this.#revision += 1
    return this.#score
  }

  /** Restore the preceding snapshot without generating or renumbering musical identities. */
  undo(): Score {
    const previous = this.#undo.pop()
    if (!previous) {
      return this.#score
    }
    this.#redo.push(this.#score)
    this.#score = previous
    this.#revision += 1
    return this.#score
  }

  /** Reapply an undone snapshot; empty redo history is a no-op. */
  redo(): Score {
    const next = this.#redo.pop()
    if (!next) {
      return this.#score
    }
    this.#undo.push(this.#score)
    this.#score = next
    this.#revision += 1
    return this.#score
  }

  /** Confirm the snapshot actually saved; passing an older snapshot preserves newer edits as dirty. */
  markSaved(saved: Score = this.#score): void {
    const snapshot = parseScore(saved)
    if (snapshot.id !== this.#score.id) {
      throw new Error('Saved snapshot belongs to another score')
    }
    this.#savedContent = JSON.stringify(snapshot)
  }
}
