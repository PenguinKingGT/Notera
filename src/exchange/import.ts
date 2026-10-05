/** Convert a bounded piano MusicXML part into validated, normally editable native music. */
import { add, compare, fraction, parseScore, subtract } from '../core'
import type {
  Fraction,
  Measure,
  MusicalEvent,
  NotatedDuration,
  Note,
  Score,
  ScoreMark,
  WrittenPitch,
} from '../core'
import { eventKey, identity, noteKey, readIdentities } from './identities'
import { markKey } from './export'
import { inspect, OMITTED_NOTATION, readDuration } from './import-rules'
import { readAttributes } from './attributes'
import { child, children, ExchangeError, integer, parseXml, value } from './xml'
import type { XmlElement } from './xml'

/** Import warnings enumerate omitted notation; the desktop asks before accepting a lossy conversion. */
export interface ImportedMusicXml {
  score: Score
  warnings: string[]
}

type MutableEvent = {
  id: string
  onset: Fraction
  duration: NotatedDuration
} & ({ kind: 'rest' } | { kind: 'note'; notes: Note[] })
type Lane = { voiceId: string; events: MutableEvent[] }
type Anchor = {
  measure: number
  onset: Fraction
  staff: number
  voice?: string
  element: XmlElement
}

/** Parse one score-partwise piano part; final core validation catches overlap, invalid spans and measure overflow. */
export function importMusicXml(text: string): ImportedMusicXml {
  const root = parseXml(text)
  if (root.name !== 'score-partwise') {
    throw new ExchangeError(
      '首版仅支持 score-partwise MusicXML；请从来源软件导出此格式。',
    )
  }
  const parts = children(root, 'part')
  if (parts.length !== 1) {
    throw new ExchangeError(
      '首版仅支持一个钢琴声部、两个谱表；暂不支持总谱或拆分声部。',
    )
  }
  const warnings = new Set<string>()
  inspect(root, warnings)
  const ids = readIdentities(root)
  let serial = 0
  const used = new Set(Object.values(ids))
  const generated = new Map<string, string>()
  /** Generate identities for external music without colliding with retained native metadata. */
  function id(key: string): string {
    if (Object.hasOwn(ids, key)) {
      return identity(ids, key, '')
    }
    const existing = generated.get(key)
    if (existing) {
      return existing
    }
    let result: string
    do {
      result = `import-${++serial}`
    } while (used.has(result))
    used.add(result)
    generated.set(key, result)
    return result
  }
  const staves = [
    { id: id('staff:1'), clef: 'treble' as const },
    { id: id('staff:2'), clef: 'bass' as const },
  ]
  const voices: { id: string; staffId: string }[] = []
  const voiceMap = new Map<string, string>()
  const voiceStaves = new Map<string, number>()
  const measures: Measure[] = []
  const marks: ScoreMark[] = []
  const ties = new Map<string, string>()
  const slurs = new Map<string, string>()
  const pedalStarts = new Map<string, string>()
  const anchors: Anchor[] = []
  let repeatStart: number | null = null
  let divisions = 0
  let timeSignature: Measure['timeSignature'] | null = null
  let keySignature = { fifths: 0 }
  let declaredStaves = 2

  /** Register a globally named MusicXML voice on one staff; moving it between staves is unsupported cross-staff notation. */
  function voice(label: string, staff: number): string {
    const previous = voiceStaves.get(label)
    if (previous && previous !== staff) {
      throw new ExchangeError('首版尚不支持同一声部跨谱表记谱。')
    }
    voiceStaves.set(label, staff)
    const key = `${staff}:${label}`
    let result = voiceMap.get(key)
    if (!result) {
      result = id(`voice:${key}`)
      voiceMap.set(key, result)
      voices.push({ id: result, staffId: staves[staff - 1].id })
    }
    return result
  }

  /** Build a native mark with semantic-keyed identity, independent of XML notation ordering. */
  function mark(input: ScoreMark): void {
    marks.push({ ...input, id: id(markKey(input)) })
  }

  /** Keep start/stop pairs exact rather than fabricating endpoints for incomplete notation. */
  function span(
    map: Map<string, string>,
    key: string,
    type: string,
    endpoint: string,
    kind: 'tie' | 'slur' | 'pedal',
  ): void {
    if (type === 'stop' || type === 'continue') {
      const start = map.get(key)
      if (!start) {
        throw new ExchangeError(`${kind} 连线缺少起点。`)
      }
      if (kind === 'tie') {
        mark({ id: '', kind, startNoteId: start, endNoteId: endpoint })
      } else {
        mark({ id: '', kind, startEventId: start, endEventId: endpoint })
      }
      map.delete(key)
    }
    if (type === 'start' || type === 'continue') {
      if (map.has(key)) {
        throw new ExchangeError(`${kind} 连线起点重复。`)
      }
      map.set(key, endpoint)
    } else if (type !== 'stop') {
      throw new ExchangeError(`尚不支持 ${kind} 的 ${type} 记号。`)
    }
  }

  const sourceMeasures = children(parts[0], 'measure')
  if (!sourceMeasures.length || sourceMeasures.length > 10_000) {
    throw new ExchangeError('MusicXML 小节数量超出支持范围。')
  }
  for (const [measureIndex, source] of sourceMeasures.entries()) {
    if (
      source.attributes.implicit === 'yes' ||
      source.attributes['non-controlling'] === 'yes'
    ) {
      throw new ExchangeError('首版尚不支持弱起或非同步小节。')
    }
    const lanes = new Map<string, Lane>()
    let cursor = fraction(0)
    let last: { event: MutableEvent; voiceId: string; staff: number } | null =
      null
    let hasMusic = false
    /** Read quarter-note ticks using the currently effective divisions. */
    function readTime(element: XmlElement, signed = false): Fraction {
      if (!divisions) {
        throw new ExchangeError('MusicXML 缺少有效 divisions。')
      }
      const ticks = integer(
        element.text.trim(),
        signed ? -32_000_000 : 1,
        32_000_000,
      )
      return fraction(Math.abs(ticks), divisions * 4)
    }
    /** Materialize a lane only when a note or rest is present; forwards never fabricate events. */
    function lane(voiceId: string): Lane {
      let result = lanes.get(voiceId)
      if (!result) {
        result = { voiceId, events: [] }
        lanes.set(voiceId, result)
      }
      return result
    }
    for (const element of source.children) {
      if (element.name === 'attributes') {
        if (hasMusic) {
          throw new ExchangeError('首版尚不支持小节内部的属性变化。')
        }
        const context = readAttributes(
          element,
          { divisions, timeSignature, keySignature, staves: declaredStaves },
          warnings,
        )
        divisions = context.divisions
        timeSignature = context.timeSignature
        keySignature = context.keySignature
        declaredStaves = context.staves
        last = null
      } else if (element.name === 'backup' || element.name === 'forward') {
        const duration = child(element, 'duration')
        if (!duration) {
          throw new ExchangeError('MusicXML 时间推进缺少 duration。')
        }
        const time = readTime(duration)
        if (element.name === 'backup' && compare(cursor, time) < 0) {
          throw new ExchangeError('MusicXML backup 超出当前小节。')
        }
        cursor =
          element.name === 'backup' ? subtract(cursor, time) : add(cursor, time)
        if (element.name === 'forward' && value(element, 'voice')) {
          voice(
            value(element, 'voice'),
            integer(value(element, 'staff', '1'), 1, 2),
          )
        }
        if (
          timeSignature &&
          compare(
            cursor,
            fraction(timeSignature.beats, timeSignature.beatType),
          ) > 0
        ) {
          throw new ExchangeError('MusicXML forward 超出当前小节。')
        }
        last = null
      } else if (element.name === 'note') {
        const staff = integer(value(element, 'staff', '1'), 1, 2)
        const label = value(element, 'voice', String(staff))
        const voiceId = voice(label, staff)
        const isChord = Boolean(child(element, 'chord'))
        const rest = child(element, 'rest')
        const pitch = child(element, 'pitch')
        const durationElement = child(element, 'duration')
        if (!durationElement || Boolean(rest) === Boolean(pitch)) {
          throw new ExchangeError('音符缺少有效音高、休止或 duration。')
        }
        const time = readTime(durationElement)
        const duration = readDuration(element, time)
        const onset: Fraction = isChord && last ? last.event.onset : cursor
        if (
          isChord &&
          (!last ||
            last.voiceId !== voiceId ||
            last.staff !== staff ||
            last.event.kind !== 'note' ||
            rest ||
            JSON.stringify(last.event.duration) !== JSON.stringify(duration))
        ) {
          throw new ExchangeError(
            '和弦音符必须紧随同声部、同谱表、同时值的音符。',
          )
        }
        const key = eventKey(measureIndex, label, onset)
        const event: MutableEvent = isChord
          ? last!.event
          : {
              id: id(key),
              onset,
              duration,
              ...(rest
                ? { kind: 'rest' as const }
                : { kind: 'note' as const, notes: [] }),
            }
        let note: Note | null = null
        if (pitch) {
          const written = {
            step: value(pitch, 'step') as WrittenPitch['step'],
            alter: integer(value(pitch, 'alter', '0'), -2, 2),
            octave: integer(value(pitch, 'octave'), 0, 9),
          }
          note = { id: id(noteKey(key, written)), pitch: written }
          if (event.kind === 'note') {
            event.notes.push(note)
          }
        }
        if (!isChord) {
          lane(voiceId).events.push(event)
          cursor = add(cursor, time)
          last = { event, voiceId, staff }
        }
        const notations = child(element, 'notations')
        if (note) {
          const soundTies = children(element, 'tie')
          const visualTies = notations ? children(notations, 'tied') : []
          const types = new Set(
            (soundTies.length ? soundTies : visualTies).map(
              (tie) => tie.attributes.type,
            ),
          )
          const tieKey = `${voiceId}:${note.pitch.step}:${note.pitch.alter}:${note.pitch.octave}`
          for (const type of ['stop', 'continue', 'start']) {
            if (types.has(type)) {
              span(ties, tieKey, type, note.id, 'tie')
            }
          }
          if (
            [...types].some(
              (type) => !['stop', 'start', 'continue'].includes(type),
            )
          ) {
            throw new ExchangeError('首版尚不支持此类延音线。')
          }
        }
        if (notations) {
          for (const slur of children(notations, 'slur')) {
            // A slur repeated on another note of the same chord is the same endpoint, not another musical mark.
            if (isChord) {
              warnings.add('和弦附加音上的连奏线端点采用和弦首音记号。')
              continue
            }
            const type = slur.attributes.type
            if (type === 'continue') {
              warnings.add('连奏线的跨行续接外观将重新排版。')
            } else {
              span(
                slurs,
                `${voiceId}:${slur.attributes.number ?? '1'}`,
                type,
                event.id,
                'slur',
              )
            }
          }
          for (const nested of notations.children) {
            if (
              !['tied', 'slur', 'tuplet', ...OMITTED_NOTATION].includes(
                nested.name,
              )
            ) {
              warnings.add(`未保留 ${nested.name} 记号。`)
            }
          }
        }
        hasMusic = true
      } else if (element.name === 'direction') {
        const offset = child(element, 'offset')
        let onset = cursor
        if (offset) {
          const time = readTime(offset, true)
          if (Number(offset.text) < 0 && compare(cursor, time) < 0) {
            throw new ExchangeError('方向记号的 offset 超出当前小节。')
          }
          onset =
            Number(offset.text) < 0 ? subtract(cursor, time) : add(cursor, time)
        }
        anchors.push({
          measure: measureIndex,
          onset,
          staff: integer(value(element, 'staff', '1'), 1, 2),
          voice: value(element, 'voice') || undefined,
          element,
        })
      } else if (element.name === 'barline') {
        if (
          child(element, 'segno') ||
          child(element, 'coda') ||
          child(element, 'ending')
        ) {
          throw new ExchangeError('首版尚不支持反复跳转或房子。')
        }
        const repeat = child(element, 'repeat')
        if (repeat?.attributes.direction === 'forward') {
          if (repeatStart !== null || element.attributes.location === 'right') {
            throw new ExchangeError('首版尚不支持嵌套反复或小节右侧起始反复。')
          }
          repeatStart = measureIndex
        } else if (repeat?.attributes.direction === 'backward') {
          if (
            element.attributes.location === 'left' ||
            repeat.attributes['after-jump']
          ) {
            throw new ExchangeError('首版尚不支持此类反复。')
          }
          const start = repeatStart ?? 0
          mark({
            id: '',
            kind: 'repeat',
            startMeasureId: id(`measure:${start}`),
            endMeasureId: id(`measure:${measureIndex}`),
            times: integer(repeat.attributes.times ?? '2', 2, 16),
          })
          repeatStart = null
        } else if (repeat) {
          throw new ExchangeError('反复记号方向无效。')
        }
      } else if (
        !['print', 'harmony', 'figured-bass', 'sound', 'grouping'].includes(
          element.name,
        )
      ) {
        warnings.add(`未保留小节中的 ${element.name} 内容。`)
      }
    }
    if (!timeSignature || !divisions || declaredStaves !== 2) {
      throw new ExchangeError('MusicXML 缺少受支持的钢琴拍号或时间精度。')
    }
    const length = fraction(timeSignature.beats, timeSignature.beatType)
    if (compare(cursor, length) > 0) {
      throw new ExchangeError('MusicXML 时间推进超出小节。')
    }
    measures.push({
      id: id(`measure:${measureIndex}`),
      timeSignature,
      keySignature,
      voices: [...lanes.values()].map((lane) => ({
        voiceId: lane.voiceId,
        events: lane.events as MusicalEvent[],
      })),
    })
  }
  if (repeatStart !== null) {
    throw new ExchangeError('起始反复记号缺少结束反复。')
  }
  if (!voices.some((item) => item.staffId === staves[1].id)) {
    throw new ExchangeError('首版仅支持包含两个谱表的钢琴声部。')
  }
  // Directions are serialized by voice, so paired pedal endpoints must be resolved in musical time order.
  /** Stops precede starts at a shared time, permitting adjacent pedal ranges with reused numbers. */
  function stopsPedal(anchor: Anchor): boolean {
    return children(anchor.element, 'direction-type').some((direction) =>
      children(direction, 'pedal').some(
        (pedal) => pedal.attributes.type === 'stop',
      ),
    )
  }
  anchors.sort(
    (a, b) =>
      a.measure - b.measure ||
      compare(a.onset, b.onset) ||
      Number(stopsPedal(b)) - Number(stopsPedal(a)),
  )
  for (const anchor of anchors) {
    for (const direction of children(anchor.element, 'direction-type')) {
      for (const content of direction.children) {
        if (!['dynamics', 'pedal'].includes(content.name)) {
          if (!OMITTED_NOTATION.has(content.name)) {
            warnings.add(`未保留 ${content.name} 方向记号。`)
          }
          continue
        }
        const measure = measures[anchor.measure]
        const candidates = measure.voices
          .filter((lane) => {
            const matched = voices.find((voice) => voice.id === lane.voiceId)!
            return (
              matched.staffId === staves[anchor.staff - 1].id &&
              (!anchor.voice ||
                voiceMap.get(`${anchor.staff}:${anchor.voice}`) === matched.id)
            )
          })
          .flatMap((lane) => lane.events)
          .filter((event) => compare(event.onset, anchor.onset) === 0)
        const event = candidates[0]
        if (!event) {
          throw new ExchangeError(
            '力度或踏板记号不在可编辑音乐事件的起点，首版无法准确保留。',
          )
        }
        if (!anchor.voice && candidates.length > 1) {
          warnings.add('未指定声部的方向记号锚定到同位置的首个声部。')
        }
        if (content.name === 'dynamics') {
          if (
            content.children.length !== 1 ||
            !['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'].includes(
              content.children[0].name,
            )
          ) {
            warnings.add('未保留组合或自定义力度记号。')
            continue
          }
          mark({
            id: '',
            kind: 'dynamic',
            eventId: event.id,
            value: content.children[0].name as Extract<
              ScoreMark,
              { kind: 'dynamic' }
            >['value'],
          })
        } else {
          span(
            pedalStarts,
            `${anchor.staff}:${content.attributes.number ?? '1'}`,
            content.attributes.type,
            event.id,
            'pedal',
          )
        }
      }
    }
  }
  if (ties.size || slurs.size || pedalStarts.size) {
    throw new ExchangeError('MusicXML 含缺少结束端点的连线或踏板。')
  }
  const work = child(root, 'work')
  const title =
    (work && value(work, 'work-title')) ||
    value(root, 'movement-title', '导入的钢琴谱')
  try {
    const score = parseScore({
      id: id('score'),
      title,
      staves,
      voices,
      measures,
      marks,
    })
    return { score, warnings: [...warnings] }
  } catch {
    throw new ExchangeError(
      'MusicXML 中有核心无法表示的重叠、跨小节时值或无效连线。当前乐谱已保留。',
    )
  }
}
