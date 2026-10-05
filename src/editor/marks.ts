/** Build identity-based mark endpoint choices and labels without depending on React or engraving. */
import { add, compare, durationTime, fraction, sameWrittenPitch } from '../core'
import type { Fraction, Score, ScoreMark, WrittenPitch } from '../core'

/** A mark intention whose identity is allocated or preserved by the editing session. */
export type MarkInput = ScoreMark extends infer Mark
  ? Mark extends ScoreMark
    ? Omit<Mark, 'id'>
    : never
  : never

export const MARK_LABELS: Record<ScoreMark['kind'], string> = {
  tie: '延音线',
  slur: '连奏线',
  dynamic: '力度',
  pedal: '踏板',
  repeat: '基础反复',
}

/** One selectable musical anchor; note IDs are used only for ties. */
export interface MarkEndpoint {
  readonly id: string
  readonly eventId?: string
  readonly label: string
  readonly voiceId?: string
  readonly staffId?: string
  readonly start: Fraction
  readonly end: Fraction
  readonly pitch?: WrittenPitch
}

/** Enumerate anchors in score order, retaining exact absolute times for cross-bar ties. */
export function markEndpoints(
  score: Score,
  kind: ScoreMark['kind'],
): MarkEndpoint[] {
  const endpoints: MarkEndpoint[] = []
  const voices = new Map(score.voices.map((voice) => [voice.id, voice]))
  const staves = new Map(
    score.staves.map((staff, index) => [staff.id, index + 1]),
  )
  let measureStart = fraction(0)
  for (const [index, measure] of score.measures.entries()) {
    const length = fraction(
      measure.timeSignature.beats,
      measure.timeSignature.beatType,
    )
    if (kind === 'repeat') {
      endpoints.push({
        id: measure.id,
        label: `第 ${index + 1} 小节`,
        start: measureStart,
        end: add(measureStart, length),
      })
    } else {
      for (const lane of measure.voices) {
        const staffId = voices.get(lane.voiceId)!.staffId
        const siblings = score.voices.filter(
          (voice) => voice.staffId === staffId,
        )
        const voiceNumber =
          siblings.findIndex((voice) => voice.id === lane.voiceId) + 1
        for (const event of lane.events) {
          if ((kind === 'tie' || kind === 'slur') && event.kind !== 'note') {
            continue
          }
          const position = `第 ${index + 1} 小节 · 谱表 ${staves.get(staffId)} 声部 ${voiceNumber} · ${event.onset.numerator}/${event.onset.denominator}`
          const location = {
            eventId: event.id,
            voiceId: lane.voiceId,
            staffId,
            start: add(measureStart, event.onset),
            end: add(
              measureStart,
              add(event.onset, durationTime(event.duration)),
            ),
          }
          if (kind === 'tie' && event.kind === 'note') {
            for (const note of event.notes) {
              const accidental = ['𝄫', '♭', '', '♯', '𝄪'][note.pitch.alter + 2]
              endpoints.push({
                ...location,
                id: note.id,
                pitch: note.pitch,
                label: `${position} · ${note.pitch.step}${accidental}${note.pitch.octave}`,
              })
            }
          } else {
            endpoints.push({
              ...location,
              id: event.id,
              label: `${position} · ${event.kind === 'rest' ? '休止符' : event.notes.map((note) => `${note.pitch.step}${note.pitch.octave}`).join('/')}`,
            })
          }
        }
      }
    }
    measureStart = add(measureStart, length)
  }
  return endpoints
}

/** Filter visual choices; authoritative core validation still rejects invalid or stale submissions. */
export function compatibleMarkEnd(
  kind: ScoreMark['kind'],
  start: MarkEndpoint,
  end: MarkEndpoint,
): boolean {
  if (kind === 'repeat') {
    return compare(start.start, end.start) <= 0
  }
  if (kind === 'tie') {
    return (
      start.voiceId === end.voiceId &&
      compare(start.end, end.start) === 0 &&
      Boolean(
        start.pitch && end.pitch && sameWrittenPitch(start.pitch, end.pitch),
      )
    )
  }
  return (
    compare(start.start, end.start) < 0 &&
    start.staffId === end.staffId &&
    (kind !== 'slur' || start.voiceId === end.voiceId)
  )
}

/** Return a mark's native endpoint identities for form initialization. */
export function markAnchors(mark: MarkInput): { start: string; end: string } {
  switch (mark.kind) {
    case 'tie':
      return { start: mark.startNoteId, end: mark.endNoteId }
    case 'slur':
    case 'pedal':
      return { start: mark.startEventId, end: mark.endEventId }
    case 'dynamic':
      return { start: mark.eventId, end: '' }
    case 'repeat':
      return { start: mark.startMeasureId, end: mark.endMeasureId }
  }
}

/** Describe both endpoints so imported marks remain identifiable even without selecting their SVG. */
export function describeMark(
  mark: ScoreMark,
  endpoints: readonly MarkEndpoint[],
): string {
  const anchors = markAnchors(mark)
  const start =
    endpoints.find((endpoint) => endpoint.id === anchors.start)?.label ??
    '未知位置'
  const end = endpoints.find((endpoint) => endpoint.id === anchors.end)?.label
  const value =
    mark.kind === 'dynamic'
      ? ` ${mark.value}`
      : mark.kind === 'repeat'
        ? ` ${mark.times} 遍`
        : ''
  return `${MARK_LABELS[mark.kind]}${value}：${start}${end ? ` → ${end}` : ''}`
}
