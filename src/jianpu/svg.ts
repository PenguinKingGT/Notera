/** Draw deterministic vector numbered notation and segmented marks from the shared musical layout. */
import type { Score, ScoreMark } from '../core'
import { add, compare, durationTime } from '../core'
import { columnX, JIANPU_WIDTH, layoutJianpu, MUSIC_LEFT } from './layout'
import type { JianpuSystem, JianpuSegment } from './layout'
import type { JianpuToken } from './projection'
import { pitchOffsets } from './geometry'

interface Anchor {
  readonly system: number
  readonly voiceId: string
  readonly x: number
  readonly y: number
}

/** Escape all document text and identities before generating SVG, including user-authored titles. */
export function svgText(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[character]!,
  )
}

/** Place text with deterministic font sizing; positional attributes are application-owned numbers. */
function text(
  x: number,
  y: number,
  value: string,
  size = 22,
  attributes = '',
): string {
  return `<text x="${x}" y="${y}" font-size="${size}" ${attributes}>${svgText(value)}</text>`
}

/** Draw a line without allowing callers to inject markup through musical metadata. */
function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  extra = '',
): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="1.3" ${extra}/>`
}

/** Draw a token's number stack, register dots, duration lines and augmentation dots with stable source identities. */
function drawToken(
  token: JianpuToken,
  x: number,
  y: number,
  underlineY: number,
  positions: Map<string, Anchor>,
  system: number,
): string {
  const pieces: string[] = []
  const ys = pitchOffsets(token).map((offset) => y + offset)
  const bottom = y
  if (token.first) {
    positions.set(token.eventId, {
      system,
      voiceId: token.voiceId,
      x,
      y: (ys[0] ?? y) - 20,
    })
  }
  if (token.symbol === 'rest') {
    pieces.push(text(x, bottom, '0', 22, 'text-anchor="middle"'))
  } else {
    token.pitches.forEach((pitch, index) => {
      const py = ys[index]
      const symbol = token.symbol === 'dash' ? '—' : String(pitch.degree)
      const prefix = token.symbol === 'number' ? pitch.accidental : ''
      const number = text(
        x,
        py,
        symbol,
        22,
        'text-anchor="middle" font-weight="500"',
      )
      const accidental = prefix
        ? text(x - 9, py - 1, prefix, 16, 'text-anchor="end"')
        : ''
      const dots =
        token.symbol === 'number'
          ? Array.from(
              { length: Math.abs(pitch.octave) },
              (_, dot) =>
                `<circle cx="${x}" cy="${pitch.octave > 0 ? py - 24 - dot * 5 : py + 8 + dot * 5}" r="1.7"/>`,
            ).join('')
          : ''
      pieces.push(
        `<g data-note-id="${svgText(pitch.noteId)}" data-degree="${pitch.degree}" data-octave="${pitch.octave}">${number}${accidental}${dots}</g>`,
      )
      if (token.first) {
        positions.set(pitch.noteId, {
          system,
          voiceId: token.voiceId,
          x,
          y: py - 8,
        })
      }
    })
  }
  for (let index = 0; index < token.underlines; index++) {
    pieces.push(
      line(x - 9, underlineY + index * 5, x + 9, underlineY + index * 5),
    )
  }
  for (let index = 0; index < token.dots; index++) {
    pieces.push(
      `<circle cx="${x + 13 + index * 7}" cy="${bottom - 7}" r="1.7" data-duration-dot="true"/>`,
    )
  }
  return `<g data-event-id="${svgText(token.eventId)}" data-first="${token.first}" data-symbol="${token.symbol}" data-voice-id="${svgText(token.voiceId)}" data-underlines="${token.underlines}">${pieces.join('')}</g>`
}

/** Identify the containing simple or compound beat without changing the token's musical position. */
function beatGroup(
  token: JianpuToken,
  beatType: number,
  beatsPerGroup: number,
): number {
  return Math.floor(
    (token.onset.numerator * beatType) /
      token.onset.denominator /
      beatsPerGroup,
  )
}

/** Join adjacent short values within one beat group, never bridging a gap, a bar or a tuplet-ratio change. */
function drawRhythmGroups(
  segment: JianpuSegment,
  x: number,
  voiceId: string,
  y: number,
): string {
  const lane = segment.bar.measure.voices.find(
    (item) => item.voiceId === voiceId,
  )
  if (!lane) {
    return ''
  }
  const tokens = segment.bar.tokens
    .filter(
      (token) =>
        token.voiceId === voiceId &&
        token.underlines > 0 &&
        segment.columns.some((time) => compare(time, token.onset) === 0),
    )
    .sort((a, b) => compare(a.onset, b.onset))
  const meter = segment.bar.measure.timeSignature
  // Compound meters group three eighths; simple meters group by the written beat.
  const beatsPerGroup =
    meter.beatType === 8 && meter.beats > 3 && meter.beats % 3 === 0 ? 3 : 1
  const pieces: string[] = []
  const events = new Map(lane.events.map((event) => [event.id, event]))
  for (let index = 1; index < tokens.length; index++) {
    const previous = tokens[index - 1]
    const current = tokens[index]
    const event = events.get(previous.eventId)!
    const next = events.get(current.eventId)!
    if (
      compare(add(event.onset, durationTime(event.duration)), current.onset) !==
        0 ||
      beatGroup(previous, meter.beatType, beatsPerGroup) !==
        beatGroup(current, meter.beatType, beatsPerGroup) ||
      event.duration.tuplet?.actual !== next.duration.tuplet?.actual ||
      event.duration.tuplet?.normal !== next.duration.tuplet?.normal
    ) {
      continue
    }
    const x1 =
      x +
      columnX(
        segment,
        segment.columns.findIndex(
          (time) => compare(time, previous.onset) === 0,
        ),
      )
    const x2 =
      x +
      columnX(
        segment,
        segment.columns.findIndex((time) => compare(time, current.onset) === 0),
      )
    for (
      let level = 0;
      level < Math.min(previous.underlines, current.underlines);
      level++
    ) {
      pieces.push(
        line(
          x1 + 9,
          y + level * 5,
          x2 - 9,
          y + level * 5,
          'data-rhythm-join="true"',
        ),
      )
    }
  }
  return pieces.join('')
}

/** Draw a complete aligned system, leaving partial input blank and dense-bar continuation boundaries dashed. */
function drawSystem(
  system: JianpuSystem,
  positions: Map<string, Anchor>,
  score: Score,
): string {
  const pieces: string[] = []
  for (const row of system.rows) {
    pieces.push(text(30, row.baseline - 2, row.label, 11, 'fill="#555"'))
  }
  for (const { segment, x } of system.segments) {
    const right = x + segment.width
    const previous = score.measures[segment.bar.index - 1]
    const contextChanged =
      !segment.continuation &&
      (!previous ||
        previous.keySignature.fifths !==
          segment.bar.measure.keySignature.fifths ||
        previous.timeSignature.beats !==
          segment.bar.measure.timeSignature.beats ||
        previous.timeSignature.beatType !==
          segment.bar.measure.timeSignature.beatType)
    if (contextChanged) {
      pieces.push(
        text(
          x + 3,
          18,
          segment.bar.context,
          13,
          'font-weight="500" data-context="true"',
        ),
      )
    }
    if (segment === system.segments[0].segment || segment.continuation) {
      pieces.push(
        text(
          x + 3,
          contextChanged ? 38 : 18,
          `${segment.bar.index + 1}${segment.continuation ? '（续）' : ''}`,
          10,
          'fill="#666" data-measure-number="true"',
        ),
      )
    }
    for (const row of system.rows) {
      pieces.push(
        line(
          x,
          row.baseline - 20,
          x,
          row.baseline + 6,
          segment.continuation ? 'stroke-dasharray="3 4"' : '',
        ),
      )
      pieces.push(
        line(
          right,
          row.baseline - 20,
          right,
          row.baseline + 6,
          segment.last ? '' : 'stroke-dasharray="3 4"',
        ),
      )
      const tokens = segment.bar.tokens.filter(
        (token) => token.voiceId === row.voiceId,
      )
      segment.columns.forEach((time, index) => {
        for (const token of tokens.filter(
          (item) => compare(time, item.onset) === 0,
        )) {
          pieces.push(
            drawToken(
              token,
              x + columnX(segment, index),
              row.baseline,
              row.rhythmY,
              positions,
              system.index,
            ),
          )
        }
      })
      pieces.push(drawRhythmGroups(segment, x, row.voiceId, row.rhythmY))
    }
    for (const mark of score.marks.filter((mark) => mark.kind === 'repeat')) {
      if (mark.kind !== 'repeat') {
        continue
      }
      const start =
        mark.startMeasureId === segment.bar.measure.id && !segment.continuation
      const end = mark.endMeasureId === segment.bar.measure.id && segment.last
      for (const row of system.rows) {
        for (const side of [start ? 'start' : null, end ? 'end' : null]) {
          if (!side) {
            continue
          }
          const bx = side === 'start' ? x + 4 : right - 4
          pieces.push(line(bx, row.baseline - 20, bx, row.baseline + 6))
          for (const offset of [-13, -4]) {
            pieces.push(
              `<circle cx="${bx + (side === 'start' ? 5 : -5)}" cy="${row.baseline + offset}" r="2"/>`,
            )
          }
        }
      }
      if (end) {
        pieces.push(
          text(right - 5, 15, `${mark.times}×`, 12, 'text-anchor="end"'),
        )
      }
    }
  }
  // One continuous piano bracket joins the hands; its endpoints use music bounds, never fixed offsets.
  const first = system.rows[0]
  const last = system.rows.at(-1)!
  const top = first.y + 4
  const bottom = last.baseline + 6
  pieces.push(
    `<path data-piano-bracket="true" d="M 23 ${top} H 17 V ${bottom} H 23" fill="none" stroke="currentColor" stroke-width="1.2"/>`,
  )
  return pieces.join('')
}

/** Resolve ranged native marks without flattening note-level ties to whole chords. */
function endpoints(mark: ScoreMark): readonly [string, string] | null {
  if (mark.kind === 'tie') {
    return [mark.startNoteId, mark.endNoteId]
  }
  if (mark.kind === 'slur' || mark.kind === 'pedal') {
    return [mark.startEventId, mark.endEventId]
  }
  return null
}

/** Clip a musical range to one system, repeating continuation arcs/brackets on every intervening line and page. */
function rangeShape(
  start: Anchor,
  end: Anchor,
  system: JianpuSystem,
  kind: 'tie' | 'slur' | 'pedal',
  layer: number,
): string {
  if (system.index < start.system || system.index > end.system) {
    return ''
  }
  const row = system.rows.find((row) => row.voiceId === start.voiceId)!
  const x1 = system.index === start.system ? start.x + 7 : MUSIC_LEFT + 3
  const x2 =
    system.index === end.system
      ? end.x - 7
      : system.segments.at(-1)!.x + system.segments.at(-1)!.segment.width - 3
  if (kind === 'pedal') {
    const y = row.bottom - 8 - layer * 18
    return (
      text(x1, y - 3, 'Ped.', 12) +
      line(x1 + 26, y, Math.max(x1 + 28, x2), y) +
      (system.index === end.system ? line(x2, y, x2, y - 8) : '')
    )
  }
  const y = row.y - 16 - layer * 13
  const y1 =
    kind === 'tie' && system.index === start.system ? start.y - layer * 13 : y
  const y2 =
    kind === 'tie' && system.index === end.system ? end.y - layer * 13 : y
  return `<path d="M ${x1} ${y1} Q ${(x1 + x2) / 2} ${Math.min(y1, y2) - 18} ${Math.max(x1 + 8, x2)} ${y2}" stroke="currentColor" stroke-width="${kind === 'tie' ? 1.3 : 1.7}" fill="none"/>`
}

/** Add musical annotations after every anchor exists, allowing marks to cross systems and page boundaries. */
function drawAnnotations(
  score: Score,
  system: JianpuSystem,
  positions: Map<string, Anchor>,
): string {
  const pieces: string[] = []
  const layers = new Map<string, number>()
  const occupied = new Map<
    string,
    { start: number; end: number; layer: number }[]
  >()
  for (const mark of score.marks) {
    if (mark.kind === 'dynamic') {
      const anchor = positions.get(mark.eventId)
      if (anchor?.system === system.index) {
        const row = system.rows.find((row) => row.voiceId === anchor.voiceId)!
        pieces.push(
          `<g data-mark-id="${svgText(mark.id)}" data-mark-kind="dynamic">${text(anchor.x, row.musicBottom + 18, mark.value, 16, 'font-style="italic" text-anchor="middle"')}</g>`,
        )
      }
      continue
    }
    const ids = endpoints(mark)
    if (!ids) {
      continue
    }
    const start = positions.get(ids[0])
    const end = positions.get(ids[1])
    if (!start || !end) {
      throw new Error('简谱音乐记号缺少端点，未生成不完整谱面。')
    }
    if (start.system <= system.index && end.system >= system.index) {
      const key = `${start.voiceId}:${mark.kind === 'pedal' ? 'pedals' : 'curves'}`
      const intervals = occupied.get(key) ?? []
      const x1 = start.system === system.index ? start.x : MUSIC_LEFT
      const x2 = end.system === system.index ? end.x : 900
      let layer = 0
      while (
        intervals.some(
          (interval) =>
            interval.layer === layer &&
            interval.start <= x2 &&
            interval.end >= x1,
        )
      ) {
        layer++
      }
      // Supported overlapping marks must fit their reserved annotation band rather than silently collide.
      const row = system.rows.find((row) => row.voiceId === start.voiceId)!
      const capacity = mark.kind === 'pedal' ? row.pedalLayers : row.curveLayers
      if (layer >= capacity) {
        throw new Error('同一行重叠连线或踏板过多，暂无法完整排版。')
      }
      intervals.push({ start: x1, end: x2, layer })
      occupied.set(key, intervals)
      const shape = rangeShape(
        start,
        end,
        system,
        mark.kind as 'tie' | 'slur' | 'pedal',
        layer,
      )
      pieces.push(
        `<g data-mark-id="${svgText(mark.id)}" data-mark-kind="${mark.kind}">${shape}</g>`,
      )
    }
  }
  for (const { segment } of system.segments) {
    for (const group of segment.bar.tuplets) {
      const anchors = group.eventIds
        .map((id) => positions.get(id)!)
        .filter((anchor) => anchor.system === system.index)
      if (!anchors.length) {
        continue
      }
      const key = `tuplet:${segment.bar.measure.id}:${group.eventIds[0]}`
      if (layers.has(key)) {
        continue
      }
      layers.set(key, 1)
      const row = system.rows.find((row) => row.voiceId === group.voiceId)!
      const x1 = anchors[0].x - 9
      const x2 = anchors.at(-1)!.x + 9
      const y = row.y - 2
      pieces.push(
        `<g data-tuplet="${svgText(group.label)}">${line(x1, y, x2, y)}${line(x1, y, x1, y + 5)}${line(x2, y, x2, y + 5)}${text((x1 + x2) / 2, y - 4, group.label, 12, 'text-anchor="middle"')}</g>`,
      )
    }
  }
  return pieces.join('')
}

/** Generate the same bounded vector pages for screen and print; reject oversized output before publication. */
export function engraveJianpu(score: Score): {
  pages: string[]
  height: number
} {
  const layout = layoutJianpu(score)
  const positions = new Map<string, Anchor>()
  const content = new Map<number, string>()
  for (const systems of layout.pages) {
    for (const system of systems) {
      content.set(system.index, drawSystem(system, positions, score))
    }
  }
  let bytes = 0
  const pages = layout.pages.map((systems) => {
    const body = systems
      .map(
        (system) =>
          `<g data-system="${system.index}" transform="translate(0 ${system.y})">${content.get(system.index)}${drawAnnotations(score, system, positions)}</g>`,
      )
      .join('')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${JIANPU_WIDTH} ${layout.height}" role="img" aria-label="钢琴简谱" style="color:#111;font-variant-numeric:tabular-nums;font-family:'Helvetica Neue',Arial,'PingFang SC',sans-serif"><rect width="100%" height="100%" fill="white"/><g fill="currentColor">${body}</g></svg>`
    bytes += new TextEncoder().encode(svg).length
    if (bytes > 32 * 1024 * 1024) {
      throw new Error('简谱超过 32 MiB 的排版限制。')
    }
    return svg
  })
  return { pages, height: layout.height }
}
