/** Project validated native music into MusicXML 4.0 without depending on the engraving engine. */
import {
  add,
  compare,
  durationTime,
  fraction,
  parseScore,
  subtract,
} from '../core'
import type { Fraction, MusicalEvent, Score, ScoreMark } from '../core'
import { eventKey, IDENTITY_FIELD, noteKey } from './identities'
import type { IdentityMap } from './identities'
import { escapeXml, ExchangeError, MAX_XML_BYTES } from './xml'

export const NOTE_TYPES = {
  1: 'whole',
  2: 'half',
  4: 'quarter',
  8: 'eighth',
  16: '16th',
  32: '32nd',
  64: '64th',
} as const

/** Address a musical mark independently of serialization order. */
export function markKey(mark: ScoreMark): string {
  switch (mark.kind) {
    case 'tie':
      return `mark:tie:${mark.startNoteId}:${mark.endNoteId}`
    case 'slur':
      return `mark:slur:${mark.startEventId}:${mark.endEventId}`
    case 'pedal':
      return `mark:pedal:${mark.startEventId}:${mark.endEventId}`
    case 'dynamic':
      return `mark:dynamic:${mark.eventId}:${mark.value}`
    case 'repeat':
      return `mark:repeat:${mark.startMeasureId}:${mark.endMeasureId}`
  }
}

/** Find the integer rhythmic grid using exact denominators, with a bounded MusicXML divisions value. */
function divisionsFor(score: Score): number {
  let denominator = 1
  for (const measure of score.measures) {
    const times = [
      fraction(measure.timeSignature.beats, measure.timeSignature.beatType),
    ]
    for (const lane of measure.voices) {
      for (const event of lane.events) {
        times.push(event.onset, durationTime(event.duration))
      }
    }
    for (const time of times) {
      let a = denominator
      let b = time.denominator
      while (b) {
        const remainder = a % b
        a = b
        b = remainder
      }
      denominator = (denominator / a) * time.denominator
      if (!Number.isSafeInteger(denominator) || denominator > 1_000_000) {
        throw new ExchangeError(
          '节奏组合需要过大的 MusicXML 时间精度，暂时无法导出。',
        )
      }
    }
  }
  return denominator
}

/** Allocate at most 16 simultaneous span numbers, reusing numbers after their end event. */
function spanNumbers(
  score: Score,
  kind: 'slur' | 'pedal',
): Map<string, number> {
  const positions = new Map<string, number>()
  for (const [index, measure] of score.measures.entries()) {
    for (const lane of measure.voices) {
      for (const event of lane.events) {
        positions.set(
          event.id,
          index * 100 + event.onset.numerator / event.onset.denominator,
        )
      }
    }
  }
  const spans = score.marks
    .filter(
      (mark): mark is Extract<ScoreMark, { kind: 'slur' | 'pedal' }> =>
        mark.kind === kind,
    )
    .sort(
      (a, b) => positions.get(a.startEventId)! - positions.get(b.startEventId)!,
    )
  const active: { end: number; number: number }[] = []
  const result = new Map<string, number>()
  for (const mark of spans) {
    const start = positions.get(mark.startEventId)!
    const end = positions.get(mark.endEventId)!
    for (let index = active.length - 1; index >= 0; index--) {
      if (active[index].end <= start) {
        active.splice(index, 1)
      }
    }
    const number = Array.from({ length: 16 }, (_, index) => index + 1).find(
      (number) => !active.some((span) => span.number === number),
    )
    if (!number) {
      throw new ExchangeError(
        '同一位置超过 16 条连线，无法用首版 MusicXML 适配表示。',
      )
    }
    active.push({ end, number })
    result.set(mark.id, number)
  }
  return result
}

/** Index anchored marks once so export scales with music size instead of rescanning all marks for every note. */
function indexMarks(score: Score) {
  const events = new Map<string, ScoreMark[]>()
  const notes = new Map<string, Extract<ScoreMark, { kind: 'tie' }>[]>()
  const measures = new Map<string, Extract<ScoreMark, { kind: 'repeat' }>[]>()
  for (const mark of score.marks) {
    if (mark.kind === 'tie') {
      for (const id of [mark.startNoteId, mark.endNoteId]) {
        notes.set(id, [...(notes.get(id) ?? []), mark])
      }
    } else if (mark.kind === 'repeat') {
      for (const id of new Set([mark.startMeasureId, mark.endMeasureId])) {
        measures.set(id, [...(measures.get(id) ?? []), mark])
      }
    } else {
      const ids =
        mark.kind === 'dynamic'
          ? [mark.eventId]
          : [mark.startEventId, mark.endEventId]
      for (const id of ids) {
        events.set(id, [...(events.get(id) ?? []), mark])
      }
    }
  }
  return { events, notes, measures }
}

/** Emit a complete score-partwise piano file. IDs travel as optional metadata; all music uses standard elements. */
export function exportMusicXml(input: Score): string {
  const score = parseScore(input)
  if (
    score.staves.length !== 2 ||
    score.staves[0].clef !== 'treble' ||
    score.staves[1].clef !== 'bass' ||
    score.staves.some(
      (staff) => !score.voices.some((voice) => voice.staffId === staff.id),
    )
  ) {
    throw new ExchangeError('首版 MusicXML 导出仅支持高音、低音双谱表钢琴谱。')
  }
  const divisions = divisionsFor(score)
  const marks = indexMarks(score)
  const ids: IdentityMap = { score: score.id }
  const slurs = spanNumbers(score, 'slur')
  const pedals = spanNumbers(score, 'pedal')
  const staffNumber = new Map(
    score.staves.map((staff, index) => [staff.id, index + 1]),
  )
  const voiceNumber = new Map(
    score.voices.map((voice, index) => [voice.id, String(index + 1)]),
  )
  score.staves.forEach((staff, index) => {
    ids[`staff:${index + 1}`] = staff.id
  })
  score.voices.forEach((voice) => {
    ids[
      `voice:${staffNumber.get(voice.staffId)}:${voiceNumber.get(voice.id)}`
    ] = voice.id
  })
  score.marks.forEach((mark) => {
    const key = markKey(mark)
    if (Object.hasOwn(ids, key)) {
      throw new ExchangeError(
        '重复的同端点音乐记号无法无损导出，请先移除重复记号。',
      )
    }
    ids[key] = mark.id
  })

  /** Convert whole-note fractions into integral quarter-note divisions. */
  function ticks(time: Fraction): number {
    const result = time.numerator * ((4 * divisions) / time.denominator)
    if (!Number.isSafeInteger(result)) {
      throw new ExchangeError('MusicXML 时间无法安全表示。')
    }
    return result
  }

  /** Place dynamics/pedal transitions immediately before the exact anchored event. */
  function directions(
    event: MusicalEvent,
    voice: string,
    staff: number,
  ): string {
    const result: string[] = []
    const sorted = [...(marks.events.get(event.id) ?? [])].sort(
      (a, b) =>
        Number(b.kind === 'pedal' && b.endEventId === event.id) -
        Number(a.kind === 'pedal' && a.endEventId === event.id),
    )
    for (const mark of sorted) {
      let content = ''
      if (mark.kind === 'dynamic' && mark.eventId === event.id) {
        content = `<dynamics><${mark.value}/></dynamics>`
      } else if (
        mark.kind === 'pedal' &&
        (mark.startEventId === event.id || mark.endEventId === event.id)
      ) {
        content = `<pedal type="${mark.startEventId === event.id ? 'start' : 'stop'}" number="${pedals.get(mark.id)}" line="yes"/>`
      }
      if (content) {
        result.push(
          `<direction><direction-type>${content}</direction-type><voice>${voice}</voice><staff>${staff}</staff></direction>`,
        )
      }
    }
    return result.join('\n')
  }

  /** Encode one rest or chord, retaining separate note ties and event slurs. */
  function notes(
    event: MusicalEvent,
    voice: string,
    staff: number,
    key: string,
  ): string {
    ids[key] = event.id
    const pitches = event.kind === 'note' ? event.notes : [null]
    return pitches
      .map((note, index) => {
        if (note) {
          ids[noteKey(key, note.pitch)] = note.id
        }
        const ties = note ? (marks.notes.get(note.id) ?? []) : []
        const tieTypes = ties
          .map((mark) =>
            mark.kind === 'tie' && mark.endNoteId === note?.id
              ? 'stop'
              : 'start',
          )
          .sort((a, b) => Number(a === 'start') - Number(b === 'start'))
        const notations = tieTypes.map((type) => `<tied type="${type}"/>`)
        if (index === 0) {
          const orderedMarks = [...(marks.events.get(event.id) ?? [])].sort(
            (a, b) =>
              Number(b.kind === 'slur' && b.endEventId === event.id) -
              Number(a.kind === 'slur' && a.endEventId === event.id),
          )
          for (const mark of orderedMarks) {
            if (
              mark.kind === 'slur' &&
              (mark.startEventId === event.id || mark.endEventId === event.id)
            ) {
              notations.push(
                `<slur type="${mark.startEventId === event.id ? 'start' : 'stop'}" number="${slurs.get(mark.id)}"/>`,
              )
            }
          }
        }
        const pitch = note
          ? `<pitch><step>${note.pitch.step}</step><alter>${note.pitch.alter}</alter><octave>${note.pitch.octave}</octave></pitch>`
          : '<rest/>'
        const tuplet = event.duration.tuplet
        return `<note>${index > 0 ? '<chord/>' : ''}${pitch}<duration>${ticks(durationTime(event.duration))}</duration>${tieTypes.map((type) => `<tie type="${type}"/>`).join('')}<voice>${voice}</voice><type>${NOTE_TYPES[event.duration.denominator]}</type>${'<dot/>'.repeat(event.duration.dots)}${tuplet ? `<time-modification><actual-notes>${tuplet.actual}</actual-notes><normal-notes>${tuplet.normal}</normal-notes></time-modification>` : ''}<staff>${staff}</staff>${notations.length ? `<notations>${notations.join('')}</notations>` : ''}</note>`
      })
      .join('\n')
  }

  const measures = score.measures
    .map((measure, index) => {
      ids[`measure:${index}`] = measure.id
      const previous = score.measures[index - 1]
      const attributes: string[] = []
      if (!previous) {
        attributes.push(`<divisions>${divisions}</divisions>`)
      }
      if (
        !previous ||
        measure.keySignature.fifths !== previous.keySignature.fifths
      ) {
        attributes.push(
          `<key><fifths>${measure.keySignature.fifths}</fifths></key>`,
        )
      }
      if (
        !previous ||
        JSON.stringify(measure.timeSignature) !==
          JSON.stringify(previous.timeSignature)
      ) {
        attributes.push(
          `<time><beats>${measure.timeSignature.beats}</beats><beat-type>${measure.timeSignature.beatType}</beat-type></time>`,
        )
      }
      if (!previous) {
        attributes.push(
          '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>',
        )
      }
      const output = [
        `<measure number="${index + 1}">${attributes.length ? `<attributes>${attributes.join('')}</attributes>` : ''}`,
      ]
      for (const mark of marks.measures.get(measure.id) ?? []) {
        if (mark.kind === 'repeat' && mark.startMeasureId === measure.id) {
          output.push(
            '<barline location="left"><repeat direction="forward"/></barline>',
          )
        }
      }
      let cursor = fraction(0)
      for (const voice of score.voices) {
        const number = voiceNumber.get(voice.id)!
        const staff = staffNumber.get(voice.staffId)!
        if (cursor.numerator) {
          output.push(`<backup><duration>${ticks(cursor)}</duration></backup>`)
        }
        cursor = fraction(0)
        const lane = measure.voices.find((lane) => lane.voiceId === voice.id)
        // Forward preserves gaps without fabricating rests in the native music model.
        for (const event of lane?.events ?? []) {
          if (compare(event.onset, cursor) > 0) {
            output.push(
              `<forward><duration>${ticks(subtract(event.onset, cursor))}</duration><voice>${number}</voice><staff>${staff}</staff></forward>`,
            )
          }
          output.push(
            directions(event, number, staff),
            notes(event, number, staff, eventKey(index, number, event.onset)),
          )
          cursor = add(event.onset, durationTime(event.duration))
        }
        const length = fraction(
          measure.timeSignature.beats,
          measure.timeSignature.beatType,
        )
        if (compare(cursor, length) < 0) {
          output.push(
            `<forward><duration>${ticks(subtract(length, cursor))}</duration><voice>${number}</voice><staff>${staff}</staff></forward>`,
          )
        }
        cursor = length
      }
      for (const mark of marks.measures.get(measure.id) ?? []) {
        if (mark.kind === 'repeat' && mark.endMeasureId === measure.id) {
          output.push(
            `<barline location="right"><repeat direction="backward" times="${mark.times}"/></barline>`,
          )
        }
      }
      output.push('</measure>')
      return output.join('\n')
    })
    .join('\n')
  if (Object.keys(ids).length > 30_000) {
    throw new ExchangeError('乐谱实体数量超过首版 MusicXML 交换限制。')
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0"><work><work-title>${escapeXml(score.title)}</work-title></work><identification><encoding><software>Notera</software></encoding><miscellaneous><miscellaneous-field name="${IDENTITY_FIELD}">${escapeXml(JSON.stringify(ids))}</miscellaneous-field></miscellaneous></identification><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">\n${measures}\n</part></score-partwise>\n`
  if (new globalThis.TextEncoder().encode(xml).length > MAX_XML_BYTES) {
    throw new ExchangeError('导出的 MusicXML 超过 8 MiB 限制。')
  }
  return xml
}
