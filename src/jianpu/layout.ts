/** Lay out numbered notation using shared rational columns, variable voice heights and independent A4 pagination. */
import { compare, fraction } from '../core'
import type { Score, Fraction } from '../core'
import { pdfLayout } from '../shared/print-layout'
import { projectJianpu, timeKey } from './projection'
import { tokenExtents } from './geometry'
import type { JianpuMeasure, JianpuToken } from './projection'

export const JIANPU_WIDTH = 900
export const MUSIC_LEFT = 108
export const MUSIC_RIGHT = 876

/** One segment may continue a dense measure without implying a new musical bar. */
export interface JianpuSegment {
  readonly bar: JianpuMeasure
  readonly columns: readonly Fraction[]
  readonly widths: readonly number[]
  readonly continuation: boolean
  readonly last: boolean
  readonly width: number
}

/** A system shares horizontal bar geometry across separately stacked voices. */
export interface JianpuSystem {
  readonly segments: readonly { segment: JianpuSegment; x: number }[]
  readonly rows: readonly {
    voiceId: string
    label: string
    staffId: string
    y: number
    baseline: number
    rhythmY: number
    musicBottom: number
    bottom: number
    curveLayers: number
    pedalLayers: number
  }[]
  readonly height: number
  readonly y: number
  readonly index: number
}

/** Pagination deliberately differs from staff notation but never omits a token or voice. */
export interface JianpuLayout {
  readonly pages: readonly (readonly JianpuSystem[])[]
  readonly height: number
  readonly bars: readonly JianpuMeasure[]
}

/** Reserve horizontal room for explicit accidentals and augmentation dots before joining all voices. */
function tokenWidth(token: JianpuToken): number {
  const accidental = Math.max(
    0,
    ...token.pitches.map((pitch) => pitch.accidental.length),
  )
  return Math.max(34, 24 + accidental * 24 + token.dots * 14)
}

/** Split very dense bars at exact onset columns; continuation boundaries are drawn differently from barlines. */
function segments(bar: JianpuMeasure): JianpuSegment[] {
  const times = new Map<string, Fraction>([[timeKey(fraction(0)), fraction(0)]])
  const widths = new Map<string, number>()
  for (const token of bar.tokens) {
    const key = timeKey(token.onset)
    times.set(key, token.onset)
    widths.set(key, Math.max(widths.get(key) ?? 34, tokenWidth(token)))
  }
  // Keep blank beat positions visible during partial entry, without synthesizing rests.
  for (let beat = 0; beat < bar.measure.timeSignature.beats; beat++) {
    const time = fraction(beat, bar.measure.timeSignature.beatType)
    times.set(timeKey(time), time)
  }
  const columns = [...times.values()].sort(compare)
  const result: JianpuSegment[] = []
  let start = 0
  while (start < columns.length) {
    let end = start
    let width = 36
    while (
      end < columns.length &&
      width + (widths.get(timeKey(columns[end])) ?? 34) <=
        MUSIC_RIGHT - MUSIC_LEFT
    ) {
      width += widths.get(timeKey(columns[end])) ?? 34
      end++
    }
    if (end === start) {
      throw new Error('小节内容过密，无法完整排版。')
    }
    result.push({
      bar,
      columns: columns.slice(start, end),
      widths: columns
        .slice(start, end)
        .map((time) => widths.get(timeKey(time)) ?? 34),
      continuation: start > 0,
      last: end === columns.length,
      width,
    })
    start = end
  }
  return result
}

/** Measure the tallest stack and lowest rhythm symbols while sharing one bottom-number baseline per voice. */
function rowExtents(tokens: readonly JianpuToken[]): {
  above: number
  below: number
} {
  let above = 24
  let below = 12
  for (const token of tokens) {
    const bounds = tokenExtents(token)
    above = Math.max(above, bounds.above)
    below = Math.max(below, bounds.below)
  }
  return { above, below }
}

interface MarkDepth {
  curves: number
  pedals: number
}

/** Sweep exact endpoint times per voice to reserve enough room for overlapping note-level ties and other spans. */
function markDepths(score: Score): Map<string, MarkDepth> {
  const anchors = new Map<
    string,
    { voiceId: string; measure: number; time: Fraction }
  >()
  score.measures.forEach((measure, index) => {
    for (const lane of measure.voices) {
      for (const event of lane.events) {
        const anchor = {
          voiceId: lane.voiceId,
          measure: index,
          time: event.onset,
        }
        anchors.set(event.id, anchor)
        if (event.kind === 'note') {
          for (const note of event.notes) {
            anchors.set(note.id, anchor)
          }
        }
      }
    }
  })
  const endpoints = new Map<
    string,
    { measure: number; time: Fraction; delta: number }[]
  >()
  for (const mark of score.marks) {
    const ids =
      mark.kind === 'tie'
        ? [mark.startNoteId, mark.endNoteId]
        : mark.kind === 'slur' || mark.kind === 'pedal'
          ? [mark.startEventId, mark.endEventId]
          : null
    if (!ids) {
      continue
    }
    const start = anchors.get(ids[0])!
    const end = anchors.get(ids[1])!
    const key = `${start.voiceId}:${mark.kind === 'pedal' ? 'pedals' : 'curves'}`
    const entries = endpoints.get(key) ?? []
    entries.push({ ...start, delta: 1 }, { ...end, delta: -1 })
    endpoints.set(key, entries)
  }
  const result = new Map<string, MarkDepth>()
  for (const voice of score.voices) {
    const depth = { curves: 0, pedals: 0 }
    for (const kind of ['curves', 'pedals'] as const) {
      const entries = endpoints.get(`${voice.id}:${kind}`) ?? []
      entries.sort(
        (a, b) =>
          a.measure - b.measure || compare(a.time, b.time) || b.delta - a.delta,
      )
      let active = 0
      for (const entry of entries) {
        active += entry.delta
        depth[kind] = Math.max(depth[kind], active)
      }
    }
    result.set(voice.id, depth)
  }
  return result
}

/** Pack complete systems into pages; reject unsupported resource sizes explicitly instead of clipping music. */
export function layoutJianpu(score: Score): JianpuLayout {
  const height = (pdfLayout(score.title).musicMm * JIANPU_WIDTH) / 178
  const bars = projectJianpu(score)
  const chunks = bars.flatMap(segments)
  const depths = markDepths(score)
  const lines: JianpuSegment[][] = []
  for (const chunk of chunks) {
    const last = lines.at(-1)
    if (
      !last ||
      last.reduce((total, item) => total + item.width, 0) + chunk.width >
        MUSIC_RIGHT - MUSIC_LEFT
    ) {
      lines.push([chunk])
    } else {
      last.push(chunk)
    }
  }
  const systems = lines.map((line, index) => {
    // Header context is shown once and at changes, with enough space above musical annotations.
    const hasContext =
      index === 0 ||
      line.some(
        (chunk) =>
          !chunk.continuation &&
          chunk.bar.index > 0 &&
          chunk.bar.context !== bars[chunk.bar.index - 1].context,
      )
    let y = hasContext ? 42 : 20
    const rows = score.staves.flatMap((staff, staffIndex) => {
      const voices = score.voices.filter((voice) => voice.staffId === staff.id)
      return voices.map((voice, voiceIndex) => {
        const tokens = line.flatMap((chunk) =>
          chunk.bar.tokens.filter(
            (token) =>
              token.voiceId === voice.id &&
              chunk.columns.some((time) => compare(time, token.onset) === 0),
          ),
        )
        const depth = depths.get(voice.id)!
        // Reserve annotation space only when needed; blank hands retain a compact visible row.
        y += depth.curves ? depth.curves * 13 + 24 : 12
        const bounds = rowExtents(tokens)
        const baseline = y + bounds.above + 4
        const lowerDots = Math.max(
          0,
          ...tokens.map((token) =>
            token.symbol === 'number'
              ? -(token.pitches.at(-1)?.octave ?? 0)
              : 0,
          ),
        )
        const rhythmY = baseline + 12 + lowerDots * 5
        const underlines = Math.max(
          0,
          ...tokens.map((token) => token.underlines),
        )
        const musicBottom = Math.max(
          baseline + bounds.below + 4,
          rhythmY + Math.max(0, underlines - 1) * 5 + 4,
        )
        const hasDynamic = score.marks.some(
          (mark) =>
            mark.kind === 'dynamic' &&
            tokens.some((token) => token.eventId === mark.eventId),
        )
        const annotationHeight = (hasDynamic ? 22 : 0) + depth.pedals * 18
        const bottom = musicBottom + annotationHeight + 8
        const row = {
          voiceId: voice.id,
          staffId: staff.id,
          label: `${staffIndex === 0 ? '右手' : staffIndex === 1 ? '左手' : `谱表 ${staffIndex + 1}`}${voices.length > 1 ? ` ${voiceIndex + 1}` : ''}`,
          y,
          baseline,
          rhythmY,
          musicBottom,
          bottom,
          curveLayers: depth.curves,
          pedalLayers: depth.pedals,
        }
        y = bottom
        if (voiceIndex === voices.length - 1) {
          y += 8
        }
        return row
      })
    })
    // Stretch complete lines evenly; the final short line keeps its natural spacing.
    const naturalWidth = line.reduce(
      (total, segment) => total + segment.width,
      0,
    )
    const extraPerColumn =
      index < lines.length - 1
        ? (MUSIC_RIGHT - MUSIC_LEFT - naturalWidth) /
          line.reduce((total, segment) => total + segment.columns.length, 0)
        : 0
    let x = MUSIC_LEFT
    const placed = line.map((original) => {
      const segment = {
        ...original,
        widths: original.widths.map((width) => width + extraPerColumn),
        width: original.width + extraPerColumn * original.columns.length,
      }
      const placed = { segment, x }
      x += segment.width
      return placed
    })
    return { segments: placed, rows, height: y + 8, y: 0, index }
  })
  const pages: JianpuSystem[][] = [[]]
  let y = 18
  for (const system of systems) {
    if (system.height + 36 > height) {
      throw new Error(
        '声部或和弦过多，单行超出 A4 页面高度；请减少声部后导出。',
      )
    }
    if (y + system.height > height - 18) {
      pages.push([])
      y = 18
    }
    pages.at(-1)!.push({ ...system, y })
    y += system.height + 32
  }
  if (pages.length > 200) {
    throw new Error('简谱超过 200 页的排版限制。')
  }
  return { pages, height, bars }
}

/** Locate one shared exact column, centering the note number while leaving room for accidental prefixes. */
export function columnX(segment: JianpuSegment, index: number): number {
  return (
    18 +
    segment.widths.slice(0, index).reduce((total, width) => total + width, 0) +
    segment.widths[index] / 2
  )
}
