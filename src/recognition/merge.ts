/** Plan source-aware additive score transactions without replacing edited music or persisting AI task state. */
import { parseScore } from '../core'
import type { Score, ScoreCommand, ScoreMark } from '../core'
import type { RecognitionImport } from '../shared/recognition-api'
import { remapMark } from './score-result'

/** An association belongs to one live document capability; music identities determine which insertions remain applied. */
export type RecognitionLedger = Omit<RecognitionImport, 'score'>
export type RecognitionMergeMode = 'ordered' | 'append'

/** Capture the exact document and musical snapshot before an asynchronous result request. */
export interface RecognitionMergeTarget {
  readonly documentId: string
  readonly score: Score
}

/** Validate complete, non-overlapping provenance against actual music rather than source-page display counts. */
export function recognitionLedger(
  result: RecognitionImport,
): RecognitionLedger {
  const score = parseScore(result.score)
  const sourceIds = result.fragments.map((fragment) => fragment.sourceId)
  const ids = result.fragments.flatMap((fragment) => fragment.measureIds)
  if (
    !result.taskId ||
    new Set(result.sourceOrder).size !== result.sourceOrder.length ||
    new Set(sourceIds).size !== sourceIds.length ||
    sourceIds.some(
      (id, index) =>
        index > 0 &&
        result.sourceOrder.indexOf(id) <=
          result.sourceOrder.indexOf(sourceIds[index - 1]),
    ) ||
    result.fragments.some(
      (fragment) =>
        !result.sourceOrder.includes(fragment.sourceId) ||
        !fragment.measureIds.length,
    ) ||
    ids.length !== score.measures.length ||
    ids.some((id, index) => id !== score.measures[index].id)
  ) {
    throw new Error('识谱来源关联无效，未修改当前乐谱。')
  }
  return {
    taskId: result.taskId,
    sourceOrder: [...result.sourceOrder],
    fragments: result.fragments.map((fragment) => ({
      sourceId: fragment.sourceId,
      measureIds: [...fragment.measureIds],
    })),
  }
}

/** List musical endpoints used to keep each new page's marks inside its own freshly renamed music. */
function markReferences(mark: ScoreMark): readonly string[] {
  switch (mark.kind) {
    case 'tie':
      return [mark.startNoteId, mark.endNoteId]
    case 'slur':
    case 'pedal':
      return [mark.startEventId, mark.endEventId]
    case 'dynamic':
      return [mark.eventId]
    case 'repeat':
      return [mark.startMeasureId, mark.endMeasureId]
  }
}

/** Preserve existing entities, adding only missing source pages; ordered conflicts fail before publishing any edit. */
export function planRecognitionMerge(
  current: Score,
  previous: RecognitionLedger,
  result: RecognitionImport,
  mode: RecognitionMergeMode,
  generateId: () => string = () => globalThis.crypto.randomUUID(),
): {
  command: Extract<ScoreCommand, { kind: 'batch' }>
  ledger: RecognitionLedger
  added: number
} {
  const incoming = recognitionLedger(result)
  if (incoming.taskId !== previous.taskId) {
    throw new Error('当前乐谱不属于此识谱任务，请导入为新乐谱。')
  }
  if (
    current.staves.length !== 2 ||
    current.staves.some(
      (staff, index) => staff.clef !== result.score.staves[index]?.clef,
    )
  ) {
    throw new Error('当前谱表结构与识谱结果不兼容，请导入为新乐谱。')
  }
  const positions = new Map(
    current.measures.map((measure, index) => [measure.id, index]),
  )
  const retained = previous.fragments.filter((fragment) =>
    fragment.measureIds.every((id) => positions.has(id)),
  )
  const partial = previous.fragments.filter(
    (fragment) =>
      !retained.includes(fragment) &&
      fragment.measureIds.some((id) => positions.has(id)),
  )
  const addable = incoming.fragments.filter((fragment) => {
    const old = previous.fragments.find(
      (item) => item.sourceId === fragment.sourceId,
    )
    return !old || old.measureIds.every((id) => !positions.has(id))
  })
  if (!addable.length) {
    throw new Error('成功页均已补入当前乐谱，没有可重复加入的页。')
  }
  if (mode === 'ordered') {
    if (
      JSON.stringify(previous.sourceOrder) !==
        JSON.stringify(incoming.sourceOrder) ||
      partial.length
    ) {
      throw new Error(
        '来源顺序或原有小节已变化，无法安全按序补入。可选择追加到末尾或导入新乐谱。',
      )
    }
    const anchors = previous.sourceOrder.flatMap(
      (sourceId) =>
        retained.find((fragment) => fragment.sourceId === sourceId)
          ?.measureIds ?? [],
    )
    if (
      !anchors.length ||
      anchors.some(
        (id, index) =>
          index > 0 && positions.get(id)! <= positions.get(anchors[index - 1])!,
      )
    ) {
      throw new Error(
        '原有来源页定位点已变化，无法安全按序补入。可选择追加到末尾。',
      )
    }
  }

  // Allocate fresh identities for added content only; existing note IDs and hand edits are never remapped.
  const voices = [...current.voices]
  const newVoices: Score['voices'][number][] = []
  const voiceMap = new Map<string, string>()
  result.score.staves.forEach((staff, staffIndex) => {
    result.score.voices
      .filter((voice) => voice.staffId === staff.id)
      .forEach((voice, index) => {
        let target = voices.filter(
          (item) => item.staffId === current.staves[staffIndex].id,
        )[index]
        if (!target) {
          target = { id: generateId(), staffId: current.staves[staffIndex].id }
          voices.push(target)
          newVoices.push(target)
        }
        voiceMap.set(voice.id, target.id)
      })
  })
  const commands: ScoreCommand[] = []
  const updated = [...previous.fragments]
  for (const fragment of addable) {
    const identities = new Map<string, string>()
    const measures = result.score.measures
      .filter((measure) => fragment.measureIds.includes(measure.id))
      .map((measure) => {
        identities.set(measure.id, generateId())
        return {
          ...measure,
          id: identities.get(measure.id)!,
          voices: measure.voices.map((lane) => ({
            voiceId: voiceMap.get(lane.voiceId)!,
            events: lane.events.map((event) => {
              const id = generateId()
              identities.set(event.id, id)
              if (event.kind === 'rest') {
                return { ...event, id }
              }
              return {
                ...event,
                id,
                notes: event.notes.map((note) => {
                  const id = generateId()
                  identities.set(note.id, id)
                  return { ...note, id }
                }),
              }
            }),
          })),
        }
      })
    const marks = result.score.marks
      .filter((mark) => markReferences(mark).every((id) => identities.has(id)))
      .map((mark) => {
        identities.set(mark.id, generateId())
        return remapMark(mark, (id) => identities.get(id)!)
      })
    let beforeMeasureId: string | null = null
    if (mode === 'ordered') {
      const sourceIndex = previous.sourceOrder.indexOf(fragment.sourceId)
      const next = previous.sourceOrder
        .slice(sourceIndex + 1)
        .map((id) => retained.find((item) => item.sourceId === id))
        .find(Boolean)
      const earlier = previous.sourceOrder
        .slice(0, sourceIndex)
        .reverse()
        .map((id) => retained.find((item) => item.sourceId === id))
        .find(Boolean)
      beforeMeasureId =
        next?.measureIds[0] ??
        (earlier
          ? (current.measures[positions.get(earlier.measureIds.at(-1)!)! + 1]
              ?.id ?? null)
          : null)
    }
    commands.push({
      kind: 'insert-measures',
      beforeMeasureId,
      measures,
      marks,
      voices: commands.length ? [] : newVoices,
    })
    const old = updated.findIndex((item) => item.sourceId === fragment.sourceId)
    const added = {
      sourceId: fragment.sourceId,
      measureIds: measures.map((measure) => measure.id),
    }
    if (old >= 0) {
      updated[old] = added
    } else {
      updated.push(added)
    }
  }
  return {
    command: { kind: 'batch', commands },
    ledger: { ...previous, fragments: updated },
    added: addable.length,
  }
}
