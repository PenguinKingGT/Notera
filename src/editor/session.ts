/** Translate editor intentions into atomic musical commands, keeping interaction state outside the score. */
import {
  ScoreEditor,
  createPianoScore,
  fraction,
  add,
  compare,
  durationTime,
} from '../core'
import type {
  Score,
  MusicalEvent,
  NotatedDuration,
  WrittenPitch,
  ScoreCommand,
} from '../core'
import type { InputCursor, NotationTarget } from '../notation/mei'

/** A cached external-store snapshot shared by React and interaction tests. */
export interface EditorSnapshot {
  readonly score: Score
  readonly cursor: InputCursor
  readonly selection: { eventId: string; noteId?: string } | null
  readonly mode: 'write' | 'edit'
  readonly duration: NotatedDuration
  readonly octave: number
  readonly error: string | null
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly dirty: boolean
}

/** Resolve musical identity without consulting coordinates or engine state. */
export function findEvent(score: Score, eventId: string) {
  for (const measure of score.measures) {
    for (const lane of measure.voices) {
      const event = lane.events.find((item) => item.id === eventId)
      if (event) {
        return { measure, voiceId: lane.voiceId, event }
      }
    }
  }
  return undefined
}

/** Own the input cursor and selection while the musical core owns validation and undo history. */
export class EditorSession {
  #needsSave = false
  #editor: ScoreEditor
  #snapshot: EditorSnapshot
  #listeners = new Set<() => void>()
  readonly #id: () => string

  /** Start an unsaved piano document; injected IDs make input behavior reproducible in tests. */
  constructor(
    score?: Score,
    id: () => string = () => globalThis.crypto.randomUUID(),
  ) {
    this.#id = id
    this.#editor = new ScoreEditor(
      score ??
        createPianoScore({ id: id(), title: '未命名钢琴谱', measureCount: 4 }),
    )
    this.#snapshot = this.initialSnapshot()
  }

  /** Build interaction defaults without adding placeholder rests to musical content. */
  private initialSnapshot(): EditorSnapshot {
    return {
      score: this.#editor.score,
      cursor: {
        measureId: this.#editor.score.measures[0].id,
        voiceId: this.#editor.score.voices[0].id,
        onset: fraction(0),
      },
      selection: null,
      mode: 'write',
      duration: { denominator: 4, dots: 0 },
      octave: 4,
      error: null,
      canUndo: false,
      canRedo: false,
      dirty: false,
    }
  }

  /** Return the same reference until an intention changes the store. */
  getSnapshot = (): EditorSnapshot => this.#snapshot

  /** Register a React-compatible listener and return its cleanup function. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Publish one complete state after a successful transaction or a recoverable input error. */
  private publish(patch: Partial<EditorSnapshot> = {}): void {
    this.#snapshot = {
      ...this.#snapshot,
      ...patch,
      score: this.#editor.score,
      canUndo: this.#editor.canUndo,
      canRedo: this.#editor.canRedo,
      dirty: this.#needsSave || this.#editor.isDirty,
    }
    this.#listeners.forEach((listener) => listener())
  }

  /** Reject invalid rhythm or references without changing music, cursor or undo history. */
  private execute(
    command: ScoreCommand,
    patch: Partial<EditorSnapshot> = {},
  ): void {
    try {
      this.#editor.execute(command)
      this.publish({ ...patch, error: null })
    } catch (error) {
      console.error('Musical edit rejected', error)
      this.publish({
        error:
          '无法完成此编辑：请检查剩余时值、同声部重叠、重复音高或延音线端点。',
      })
    }
  }

  /** Reset a document after the UI has confirmed any unsaved changes. */
  reset(score?: Score, saved = false): void {
    this.#needsSave = Boolean(score) && !saved
    this.#editor = new ScoreEditor(
      score ??
        createPianoScore({
          id: this.#id(),
          title: '未命名钢琴谱',
          measureCount: 4,
        }),
    )
    this.#snapshot = this.initialSnapshot()
    this.publish()
  }

  /** Confirm only the snapshot actually written, preserving edits made while an asynchronous save ran. */
  markSaved(score: Score): void {
    this.#editor.markSaved(score)
    this.#needsSave = false
    this.publish()
  }

  /** Change the title as one undoable transaction, without storing blank names. */
  setTitle(title: string): void {
    this.execute({ kind: 'set-title', title: title.trim() || '未命名钢琴谱' })
  }

  /** Choose input mode; continuing from a selection begins immediately after that event. */
  setMode(mode: EditorSnapshot['mode']): void {
    const selected =
      this.#snapshot.selection &&
      findEvent(this.#editor.score, this.#snapshot.selection.eventId)
    this.publish({
      mode,
      error: null,
      ...(mode === 'write' && selected
        ? {
            cursor: {
              measureId: selected.measure.id,
              voiceId: selected.voiceId,
              onset: add(
                selected.event.onset,
                durationTime(selected.event.duration),
              ),
            },
          }
        : {}),
    })
  }

  /** Choose a voice explicitly, avoiding accidental edits to overlapping piano layers. */
  setVoice(voiceId: string): void {
    if (!this.#editor.score.voices.some((voice) => voice.id === voiceId)) {
      return
    }
    this.publish({
      cursor: { ...this.#snapshot.cursor, voiceId },
      selection: null,
      mode: 'write',
      error: null,
    })
  }

  /** Select the written duration of the next input; existing music changes only through explicit edits. */
  setDuration(duration: NotatedDuration): void {
    this.publish({ duration, error: null })
  }

  /** Choose an absolute pitch octave for subsequent keyboard input. */
  setOctave(octave: number): void {
    if (Number.isInteger(octave) && octave >= 0 && octave <= 9) {
      this.publish({ octave })
    }
  }

  /** Select an engraved event or a temporary empty position by its identity mapping. */
  select(target: NotationTarget): void {
    if (target.kind === 'placeholder') {
      this.publish({
        cursor: target.cursor,
        selection: null,
        mode: 'write',
        error: null,
      })
      return
    }
    const found = findEvent(this.#editor.score, target.eventId)
    if (!found) {
      return
    }
    const note =
      found.event.kind === 'note'
        ? (found.event.notes.find((item) => item.id === target.noteId) ??
          found.event.notes[0])
        : undefined
    this.publish({
      selection: { eventId: target.eventId, noteId: note?.id },
      cursor: {
        measureId: found.measure.id,
        voiceId: found.voiceId,
        onset: found.event.onset,
      },
      mode: 'edit',
      duration: found.event.duration,
      octave: note?.pitch.octave ?? this.#snapshot.octave,
      error: null,
    })
  }

  /** Insert a pitch, replace a selected note, or add one independently selectable chord tone. */
  inputPitch(step: WrittenPitch['step'], chord = false): void {
    const pitch: WrittenPitch = {
      step,
      octave: this.#snapshot.octave,
      alter: 0,
    }
    const selected =
      this.#snapshot.selection &&
      findEvent(this.#editor.score, this.#snapshot.selection.eventId)
    if (chord || this.#snapshot.mode === 'edit') {
      if (!selected) {
        this.publish({ error: '先选择一个音符，再修改音高或添加和弦音。' })
        return
      }
      const event = selected.event
      const noteId = this.#snapshot.selection?.noteId
      const notes =
        event.kind === 'note'
          ? chord
            ? [...event.notes, { id: this.#id(), pitch }]
            : event.notes.map((note) =>
                note.id === noteId ? { ...note, pitch } : note,
              )
          : [{ id: this.#id(), pitch }]
      this.execute(
        {
          kind: 'replace-event',
          eventId: event.id,
          event: {
            id: event.id,
            onset: event.onset,
            duration: event.duration,
            kind: 'note',
            notes,
          },
        },
        {
          selection: {
            eventId: event.id,
            noteId: chord ? notes.at(-1)!.id : (noteId ?? notes[0].id),
          },
        },
      )
      return
    }
    this.insert({
      id: this.#id(),
      kind: 'note',
      notes: [{ id: this.#id(), pitch }],
      onset: this.#snapshot.cursor.onset,
      duration: this.#snapshot.duration,
    })
  }

  /** Insert a real rest distinct from the engine's temporary gap placeholders. */
  inputRest(): void {
    if (this.#snapshot.mode !== 'write') {
      this.publish({ error: '切换到输入模式，再输入休止符。' })
      return
    }
    this.insert({
      id: this.#id(),
      kind: 'rest',
      onset: this.#snapshot.cursor.onset,
      duration: this.#snapshot.duration,
    })
  }

  /** Move across bars without splitting durations; a new last bar and its input form one transaction. */
  private insert(event: MusicalEvent): void {
    const score = this.#editor.score
    let cursor = this.#snapshot.cursor
    let index = score.measures.findIndex(
      (measure) => measure.id === cursor.measureId,
    )
    let measure = score.measures[index]
    const commands: ScoreCommand[] = []
    const length = fraction(
      measure.timeSignature.beats,
      measure.timeSignature.beatType,
    )
    if (compare(cursor.onset, length) === 0) {
      index += 1
      if (index === score.measures.length) {
        measure = {
          ...measure,
          id: this.#id(),
          voices: score.voices.map((voice) => ({
            voiceId: voice.id,
            events: [],
          })),
        }
        commands.push({ kind: 'append-measure', measure })
      } else {
        measure = score.measures[index]
      }
      cursor = { ...cursor, measureId: measure.id, onset: fraction(0) }
    }
    const placed = { ...event, onset: cursor.onset }
    commands.push({ kind: 'insert-event', target: cursor, event: placed })
    this.execute(
      { kind: 'batch', commands },
      {
        cursor: {
          ...cursor,
          onset: add(cursor.onset, durationTime(event.duration)),
        },
        selection: {
          eventId: placed.id,
          noteId: placed.kind === 'note' ? placed.notes[0].id : undefined,
        },
      },
    )
  }

  /** Change only the chosen chord tone; invalid tie edits stay rejected instead of discarding marks. */
  alterSelected(alter: WrittenPitch['alter']): void {
    this.updateSelectedPitch((pitch) => ({ ...pitch, alter }))
  }

  /** Move the chosen note by diatonic staff steps, preserving its accidental spelling. */
  transposeSelected(steps: number): void {
    const names: WrittenPitch['step'][] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
    this.updateSelectedPitch((pitch) => {
      const absolute = pitch.octave * 7 + names.indexOf(pitch.step) + steps
      if (absolute < 0 || absolute >= 70) {
        throw new RangeError('Pitch outside supported octaves')
      }
      return {
        ...pitch,
        step: names[absolute % 7],
        octave: Math.floor(absolute / 7),
      }
    })
  }

  /** Apply a pitch transform while keeping the selected note and event IDs unchanged. */
  private updateSelectedPitch(
    update: (pitch: WrittenPitch) => WrittenPitch,
  ): void {
    const selection = this.#snapshot.selection
    const found = selection && findEvent(this.#editor.score, selection.eventId)
    if (!found || found.event.kind !== 'note') {
      return
    }
    try {
      this.execute({
        kind: 'replace-event',
        eventId: found.event.id,
        event: {
          ...found.event,
          notes: found.event.notes.map((note) =>
            note.id === selection?.noteId
              ? { ...note, pitch: update(note.pitch) }
              : note,
          ),
        },
      })
    } catch {
      this.publish({ error: '音高超出当前支持范围。' })
    }
  }

  /** Apply the current written duration explicitly; overlaps and broken ties are rejected atomically. */
  applyDuration(): void {
    const selected =
      this.#snapshot.selection &&
      findEvent(this.#editor.score, this.#snapshot.selection.eventId)
    if (selected) {
      this.execute({
        kind: 'replace-event',
        eventId: selected.event.id,
        event: { ...selected.event, duration: this.#snapshot.duration },
      })
    }
  }

  /** Navigate events in the active voice across measures so selection also works without pointer input. */
  navigate(direction: -1 | 1): void {
    const events = this.#editor.score.measures.flatMap(
      (measure) =>
        measure.voices.find(
          (lane) => lane.voiceId === this.#snapshot.cursor.voiceId,
        )?.events ?? [],
    )
    const index = events.findIndex(
      (event) => event.id === this.#snapshot.selection?.eventId,
    )
    const next =
      events[
        index < 0
          ? direction === 1
            ? 0
            : events.length - 1
          : index + direction
      ]
    if (next) {
      this.select({ kind: 'event', eventId: next.id })
    }
  }

  /** Delete the whole selected event, leaving its musical position available for another input. */
  deleteSelection(): void {
    const selected =
      this.#snapshot.selection &&
      findEvent(this.#editor.score, this.#snapshot.selection.eventId)
    if (selected) {
      this.execute(
        { kind: 'delete-event', eventId: selected.event.id },
        {
          selection: null,
          mode: 'write',
          cursor: {
            measureId: selected.measure.id,
            voiceId: selected.voiceId,
            onset: selected.event.onset,
          },
        },
      )
    }
  }

  /** Restore history and clear stale identities, including a bar appended by continuous input. */
  undo(): void {
    this.#editor.undo()
    this.restoreCursor()
  }

  /** Reapply history without interpreting a previously engraved page. */
  redo(): void {
    this.#editor.redo()
    this.restoreCursor()
  }

  /** Keep the cursor in a surviving measure and remove selection after history traversal. */
  private restoreCursor(): void {
    const cursor = this.#snapshot.cursor
    const measure =
      this.#editor.score.measures.find(
        (item) => item.id === cursor.measureId,
      ) ?? this.#editor.score.measures.at(-1)!
    const lane = measure.voices.find((item) => item.voiceId === cursor.voiceId)
    const last = lane?.events.at(-1)
    this.publish({
      selection: null,
      mode: 'write',
      error: null,
      cursor: {
        ...cursor,
        measureId: measure.id,
        onset: last
          ? add(last.onset, durationTime(last.duration))
          : fraction(0),
      },
    })
  }
}
