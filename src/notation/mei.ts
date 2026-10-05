/** Project native musical content into MEI with detached input placeholders and stable selection mappings. */
import { add, compare, durationTime, fraction, subtract } from '../core'
import type { Fraction, MusicalEvent, Score, WrittenPitch } from '../core'

/** Musical insertion location independent of engraved coordinates. */
export interface InputCursor {
  readonly measureId: string
  readonly voiceId: string
  readonly onset: Fraction
}

/** SVG identity resolves either to real musical content or to an unpersisted input location. */
export type NotationTarget =
  | {
      readonly kind: 'event'
      readonly eventId: string
      readonly noteId?: string
    }
  | { readonly kind: 'placeholder'; readonly cursor: InputCursor }

/** Engine input and its selection map; neither is an authoritative score document. */
export interface MeiProjection {
  readonly mei: string
  readonly targets: Readonly<Record<string, NotationTarget>>
}

/** Escape musical titles and identifiers before inserting them into XML markup. */
function xml(value: string): string {
  return value.replace(
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

/** Encode document-local IDs as valid XML identifiers without collisions or implicit meaning. */
function meiId(id: string): string {
  return `n-${id.replace(/[^A-Za-z0-9.-]/g, (character) => `_${character.charCodeAt(0).toString(16)}_`)}`
}

/** Encode absolute pitch; explicit accidentals keep key context from changing the sound. */
function pitchAttributes(pitch: WrittenPitch): string {
  const accidental = { '-2': 'ff', '-1': 'f', '0': 'n', '1': 's', '2': 'ss' }[
    String(pitch.alter)
  ]
  return `pname="${pitch.step.toLowerCase()}" oct="${pitch.octave}" accid.ges="${accidental}"`
}

/** Track written accidentals across voices in each staff/bar, including explicit naturals after chromatic notes. */
function writtenAccidentals(score: Score): ReadonlyMap<string, string> {
  const result = new Map<string, string>()
  const symbols: Record<number, string> = {
    [-2]: 'ff',
    [-1]: 'f',
    0: 'n',
    1: 's',
    2: 'ss',
  }
  for (const measure of score.measures) {
    const fifths = measure.keySignature.fifths
    const keySteps = (
      fifths > 0
        ? ['F', 'C', 'G', 'D', 'A', 'E', 'B']
        : ['B', 'E', 'A', 'D', 'G', 'C', 'F']
    ).slice(0, Math.abs(fifths))
    for (const staff of score.staves) {
      const voices = new Set(
        score.voices
          .filter((voice) => voice.staffId === staff.id)
          .map((voice) => voice.id),
      )
      const events = measure.voices
        .filter((lane) => voices.has(lane.voiceId))
        .flatMap((lane) => lane.events)
        .sort((left, right) => compare(left.onset, right.onset))
      const current = new Map<string, number | undefined>()
      for (let index = 0; index < events.length;) {
        const onset = events[index].onset
        const notes = []
        while (
          index < events.length &&
          compare(events[index].onset, onset) === 0
        ) {
          const event = events[index++]
          if (event.kind === 'note') {
            notes.push(...event.notes)
          }
        }
        const simultaneous = new Map<string, Set<number>>()
        for (const note of notes) {
          const pitchKey = `${note.pitch.step}${note.pitch.octave}`
          const alterations = simultaneous.get(pitchKey) ?? new Set<number>()
          alterations.add(note.pitch.alter)
          simultaneous.set(pitchKey, alterations)
        }
        for (const note of notes) {
          const pitch = note.pitch
          const pitchKey = `${pitch.step}${pitch.octave}`
          const prior = current.has(pitchKey)
            ? current.get(pitchKey)
            : keySteps.includes(pitch.step)
              ? Math.sign(fifths)
              : 0
          const conflict = simultaneous.get(pitchKey)!.size > 1
          if (conflict || prior !== pitch.alter) {
            result.set(note.id, symbols[pitch.alter])
          }
        }
        // Conflicting simultaneous spellings have no single effective accidental for a following note.
        for (const [pitchKey, alterations] of simultaneous) {
          current.set(
            pitchKey,
            alterations.size === 1 ? [...alterations][0] : undefined,
          )
        }
      }
    }
  }
  return result
}

/** Build music with optional editor gap rests; print gaps stay invisible and real chord notes retain their identities. */
export function projectToMei(
  score: Score,
  options: { placeholders?: boolean } = {},
): MeiProjection {
  const targets: Record<string, NotationTarget> = {}
  const accidentals = writtenAccidentals(score)
  const staffNumbers = new Map(
    score.staves.map((staff, index) => [staff.id, index + 1]),
  )
  const voiceNumbers = new Map<string, number>()
  for (const staff of score.staves) {
    score.voices
      .filter((voice) => voice.staffId === staff.id)
      .forEach((voice, index) => voiceNumbers.set(voice.id, index + 1))
  }

  /** Emit one event using written durations; enclosing tuplets supply the temporal scale. */
  function eventXml(event: MusicalEvent): string {
    const duration = `dur="${event.duration.denominator}" dots="${event.duration.dots}"`
    if (event.kind === 'rest') {
      const id = meiId(event.id)
      targets[id] = { kind: 'event', eventId: event.id }
      return `<rest xml:id="${id}" ${duration}/>`
    }
    const notes = event.notes
      .map((note) => {
        const id = meiId(note.id)
        targets[id] = { kind: 'event', eventId: event.id, noteId: note.id }
        const accidental = accidentals.get(note.id)
        return `<note xml:id="${id}" ${pitchAttributes(note.pitch)} ${event.notes.length === 1 ? duration : ''}>${accidental ? `<accid accid="${accidental}"/>` : ''}</note>`
      })
      .join('')
    if (event.notes.length === 1) {
      return notes
    }
    const id = meiId(event.id)
    targets[id] = { kind: 'event', eventId: event.id }
    return `<chord xml:id="${id}" ${duration}>${notes}</chord>`
  }

  /** Fill only the rendering projection, allowing click-to-input without adding rests to the score. */
  function gapXml(
    cursor: InputCursor,
    length: Fraction,
    fullMeasure = false,
  ): string {
    if (compare(length, fraction(0)) === 0) {
      return ''
    }
    const pieces: string[] = []
    let remaining = length
    let onset = cursor.onset
    let index = 0
    /** Project a gap as an editor rest or invisible print space, preserving its exact musical position. */
    function rest(denominator: number): string {
      if (options.placeholders === false) {
        return fullMeasure ? '<mSpace/>' : `<space dur="${denominator}"/>`
      }
      const id = `gap-${meiId(cursor.measureId)}-${meiId(cursor.voiceId)}-${cursor.onset.numerator}-${cursor.onset.denominator}-${index++}`
      targets[id] = { kind: 'placeholder', cursor: { ...cursor, onset } }
      return `<${fullMeasure ? 'mRest' : 'rest'} xml:id="${id}" type="input-placeholder"${fullMeasure ? '' : ` dur="${denominator}"`}/>`
    }
    if (fullMeasure) {
      return rest(1)
    }
    for (const denominator of [1, 2, 4, 8, 16, 32, 64]) {
      const part = fraction(1, denominator)
      while (compare(remaining, part) >= 0) {
        pieces.push(rest(denominator))
        onset = add(onset, part)
        remaining = subtract(remaining, part)
      }
    }
    if (compare(remaining, fraction(0)) > 0) {
      // Fractional gaps after tuplets retain exact timing, without showing an invented tuplet group.
      pieces.push(
        `<tuplet num="${remaining.denominator}" numbase="${remaining.numerator}" num.visible="false" bracket.visible="false">${rest(1)}</tuplet>`,
      )
    }
    return pieces.join('')
  }

  const measures = score.measures
    .map((measure, measureIndex) => {
      const length = fraction(
        measure.timeSignature.beats,
        measure.timeSignature.beatType,
      )
      const previous = score.measures[measureIndex - 1]
      const context =
        !previous ||
        JSON.stringify(previous.timeSignature) !==
          JSON.stringify(measure.timeSignature) ||
        previous.keySignature.fifths !== measure.keySignature.fifths
          ? `<scoreDef meter.count="${measure.timeSignature.beats}" meter.unit="${measure.timeSignature.beatType}" key.sig="${Math.abs(measure.keySignature.fifths)}${measure.keySignature.fifths < 0 ? 'f' : measure.keySignature.fifths > 0 ? 's' : ''}"/>`
          : ''
      const staves = score.staves
        .map((staff) => {
          const layers = score.voices
            .filter((voice) => voice.staffId === staff.id)
            .map((voice) => {
              const events =
                measure.voices.find((lane) => lane.voiceId === voice.id)
                  ?.events ?? []
              let onset = fraction(0)
              const music: string[] = []
              for (let index = 0; index < events.length; index += 1) {
                const event = events[index]
                music.push(
                  gapXml(
                    { measureId: measure.id, voiceId: voice.id, onset },
                    subtract(event.onset, onset),
                  ),
                )
                const ratio = event.duration.tuplet
                if (ratio) {
                  const group: MusicalEvent[] = [event]
                  let end = add(event.onset, durationTime(event.duration))
                  while (
                    group.length < ratio.actual &&
                    events[index + 1]?.duration.tuplet?.actual ===
                      ratio.actual &&
                    events[index + 1]?.duration.tuplet?.normal ===
                      ratio.normal &&
                    compare(events[index + 1].onset, end) === 0
                  ) {
                    const next = events[++index]
                    group.push(next)
                    end = add(next.onset, durationTime(next.duration))
                  }
                  music.push(
                    `<tuplet num="${ratio.actual}" numbase="${ratio.normal}"${group.length < ratio.actual ? ' num.visible="false" bracket.visible="false"' : ''}>${group.map(eventXml).join('')}</tuplet>`,
                  )
                  onset = end
                } else {
                  music.push(eventXml(event))
                  onset = add(event.onset, durationTime(event.duration))
                }
              }
              music.push(
                gapXml(
                  { measureId: measure.id, voiceId: voice.id, onset },
                  subtract(length, onset),
                  events.length === 0,
                ),
              )
              return `<layer n="${voiceNumbers.get(voice.id)}">${music.join('')}</layer>`
            })
            .join('')
          return `<staff n="${staffNumbers.get(staff.id)}">${layers}</staff>`
        })
        .join('')
      const repeatStart = score.marks.some(
        (mark) => mark.kind === 'repeat' && mark.startMeasureId === measure.id,
      )
      const repeatEnd = score.marks.some(
        (mark) => mark.kind === 'repeat' && mark.endMeasureId === measure.id,
      )
      return `${context}<measure xml:id="${meiId(measure.id)}" n="${measureIndex + 1}"${repeatStart ? ' left="rptstart"' : ''}${repeatEnd ? ' right="rptend"' : ''}>${staves}</measure>`
    })
    .join('')
  const staffDefinitions = score.staves
    .map(
      (staff, index) =>
        `<staffDef n="${index + 1}" lines="5" clef.shape="${staff.clef === 'bass' ? 'F' : 'G'}" clef.line="${staff.clef === 'bass' ? 4 : 2}"/>`,
    )
    .join('')
  // Spans are emitted inside their start measure; event anchors resolve a chord's first note when needed.
  const eventAnchors = new Map<string, string>()
  const eventMeasures = new Map<string, string>()
  score.measures.forEach((measure) =>
    measure.voices.forEach((lane) =>
      lane.events.forEach((event) => {
        eventAnchors.set(
          event.id,
          meiId(event.kind === 'note' ? event.notes[0].id : event.id),
        )
        eventMeasures.set(event.id, meiId(measure.id))
        if (event.kind === 'note') {
          event.notes.forEach((note) =>
            eventMeasures.set(note.id, meiId(measure.id)),
          )
        }
      }),
    ),
  )
  let section = measures
  for (const mark of score.marks) {
    let control = ''
    let startId = ''
    if (mark.kind === 'tie') {
      startId = mark.startNoteId
      control = `<tie startid="#${meiId(mark.startNoteId)}" endid="#${meiId(mark.endNoteId)}"/>`
    } else if (mark.kind === 'slur') {
      startId = mark.startEventId
      control = `<slur startid="#${eventAnchors.get(mark.startEventId)}" endid="#${eventAnchors.get(mark.endEventId)}"/>`
    } else if (mark.kind === 'dynamic') {
      startId = mark.eventId
      control = `<dynam startid="#${eventAnchors.get(mark.eventId)}" place="below">${mark.value}</dynam>`
    } else if (mark.kind === 'pedal') {
      startId = mark.startEventId
      control = `<pedal startid="#${eventAnchors.get(mark.startEventId)}" dir="down"/><pedal startid="#${eventAnchors.get(mark.endEventId)}" dir="up"/>`
    }
    const measureId = eventMeasures.get(startId)
    if (measureId && control) {
      const opening = `<measure xml:id="${measureId}"`
      const begin = section.indexOf(opening)
      const end = section.indexOf('</measure>', begin)
      section = section.slice(0, end) + control + section.slice(end)
    }
  }
  return {
    mei: `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">
  <meiHead><fileDesc><titleStmt><title>${xml(score.title)}</title></titleStmt><pubStmt/></fileDesc></meiHead>
  <music><body><mdiv><score>
    <scoreDef><staffGrp symbol="brace" bar.thru="true">${staffDefinitions}</staffGrp></scoreDef>
    <section>${section}</section>
  </score></mdiv></body></music>
</mei>`,
    targets,
  }
}
