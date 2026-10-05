/** Convert the small benchmark corpus to MEI and MusicXML; not production exchange code. */
import { durationFor } from './fixtures.mjs'

/** Encode one benchmark pitch as a MEI note with a caller-owned stable identifier. */
function meiPitch(pitch, id, duration = '') {
  const accidental = pitch.alter === 1 ? 's' : pitch.alter === -1 ? 'f' : ''
  return `
    <note xml:id="${id}" pname="${pitch.step.toLowerCase()}" oct="${pitch.octave}" ${duration}>
      ${accidental ? `<accid accid="${accidental}"/>` : ''}
    </note>`
}

/** Encode one timed event, keeping chords and rests addressable by event ID. */
function meiEvent(event) {
  const value = durationFor(event.ticks)
  const duration = `dur="${value.denominator}"${value.dots ? ' dots="1"' : ''}`
  if (event.pitches.length === 0) {
    return `<rest xml:id="${event.id}" ${duration}/>`
  }
  if (event.pitches.length === 1) {
    return meiPitch(event.pitches[0], event.id, duration)
  }
  const pitches = event.pitches
    .map((pitch, index) => meiPitch(pitch, `${event.id}-p${index + 1}`))
    .join('')
  return `<chord xml:id="${event.id}" ${duration}>${pitches}</chord>`
}

/** Group consecutive eighths and triplets so both engines receive the same written grouping. */
function meiLane(lane) {
  const result = []
  for (let index = 0; index < lane.events.length; index += 1) {
    const event = lane.events[index]
    if (event.ticks === 4) {
      const group = lane.events.slice(index, index + 3)
      result.push(
        `<tuplet num="3" numbase="2"><beam>${group.map(meiEvent).join('')}</beam></tuplet>`,
      )
      index += 2
    } else if (
      event.ticks === 6 &&
      event.onset % 12 === 0 &&
      lane.events[index + 1]?.ticks === 6
    ) {
      result.push(
        `<beam>${meiEvent(event)}${meiEvent(lane.events[index + 1])}</beam>`,
      )
      index += 1
    } else {
      result.push(meiEvent(event))
    }
  }
  return `<layer n="${lane.voice}">${result.join('')}</layer>`
}

/** Build an MEI score without explicit page/line breaks, so Verovio performs pagination. */
export function toMei(score) {
  const measures = score.measures
    .map((measure) => {
      const staff = [1, 2]
        .map(
          (number) =>
            `<staff n="${number}">${measure.lanes
              .filter((lane) => lane.staff === number)
              .map(meiLane)
              .join('')}</staff>`,
        )
        .join('')
      const controls = []
      if (measure.number === 1) {
        controls.push(
          `<dynam staff="2" startid="#${score.marks.dynamic.event}" place="above">p</dynam>`,
        )
        controls.push(
          `<pedal staff="2" startid="#${score.marks.pedal[0]}" dir="down" form="pedstar"/>`,
        )
        controls.push(
          `<pedal staff="2" startid="#${score.marks.pedal[1]}" dir="up" form="pedstar"/>`,
        )
        controls.push(
          `<tie startid="#${score.marks.tie[0]}" endid="#${score.marks.tie[1]}"/>`,
        )
      }
      if (measure.number === 2) {
        controls.push(
          `<slur startid="#${score.marks.slur[0]}" endid="#${score.marks.slur[1]}"/>`,
        )
      }
      const repeatStart = measure.number === 1 ? ' left="rptstart"' : ''
      const repeatEnd =
        measure.number === score.measures.length ? ' right="rptend"' : ''
      const repeat = repeatStart + repeatEnd
      return `<measure xml:id="measure-${measure.number}" n="${measure.number}"${repeat}>${staff}${controls.join('')}</measure>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">
  <meiHead>
    <fileDesc>
      <titleStmt><title>${score.title}</title></titleStmt>
      <pubStmt/>
    </fileDesc>
  </meiHead>
  <music><body><mdiv><score>
    <scoreDef meter.count="4" meter.unit="4" key.sig="0">
      <staffGrp symbol="brace" bar.thru="true">
        <staffDef n="1" lines="5" clef.shape="G" clef.line="2"/>
        <staffDef n="2" lines="5" clef.shape="F" clef.line="4"/>
      </staffGrp>
    </scoreDef>
    <section>${measures}</section>
  </score></mdiv></body></music>
</mei>`
}

/** Encode one MusicXML voice event, including chord members and cross-bar tie endpoints. */
function xmlEvent(event, lane, score) {
  const value = durationFor(event.ticks)
  const pitches = event.pitches.length > 0 ? event.pitches : [null]
  return pitches
    .map((pitch, index) => {
      const tie =
        event.id === score.marks.tie[0]
          ? 'start'
          : event.id === score.marks.tie[1]
            ? 'stop'
            : ''
      const slur =
        event.id === score.marks.slur[0]
          ? 'start'
          : event.id === score.marks.slur[1]
            ? 'stop'
            : ''
      const notations = [
        tie ? `<tied type="${tie}"/>` : '',
        slur ? `<slur type="${slur}" number="1"/>` : '',
        value.triplet && event.onset === 0 ? '<tuplet type="start"/>' : '',
        value.triplet && event.onset === 8 ? '<tuplet type="stop"/>' : '',
      ].join('')
      const pitchXml = pitch
        ? `<pitch><step>${pitch.step}</step>${pitch.alter ? `<alter>${pitch.alter}</alter>` : ''}<octave>${pitch.octave}</octave></pitch>`
        : '<rest/>'
      const id = `${event.id}${index > 0 ? `-p${index + 1}` : ''}`
      const contents = [
        index > 0 ? '<chord/>' : '',
        pitchXml,
        `<duration>${event.ticks}</duration>`,
        tie ? `<tie type="${tie}"/>` : '',
        `<voice>${lane.staff === 2 ? 3 : lane.voice}</voice>`,
        `<type>${value.type}</type>`,
        value.dots ? '<dot/>' : '',
        pitch?.alter
          ? `<accidental>${pitch.alter === 1 ? 'sharp' : 'flat'}</accidental>`
          : '',
        value.triplet
          ? `
          <time-modification>
            <actual-notes>3</actual-notes><normal-notes>2</normal-notes>
          </time-modification>`
          : '',
        `<staff>${lane.staff}</staff>`,
        notations ? `<notations>${notations}</notations>` : '',
      ]
      return `<note id="${id}">${contents.join('')}</note>`
    })
    .join('')
}

/** Export an independent MusicXML input to probe the engine's importer; no round-trip claim. */
export function toMusicXml(score) {
  const measures = score.measures
    .map((measure) => {
      const attributes =
        measure.number === 1
          ? `<attributes>
              <divisions>12</divisions>
              <key><fifths>0</fifths></key>
              <time><beats>4</beats><beat-type>4</beat-type></time>
              <staves>2</staves>
              <clef number="1"><sign>G</sign><line>2</line></clef>
              <clef number="2"><sign>F</sign><line>4</line></clef>
            </attributes>`
          : ''
      const lanes = measure.lanes
        .map(
          (lane, index) =>
            `${index > 0 ? '<backup><duration>48</duration></backup>' : ''}${lane.events
              .map((event) => {
                const direction =
                  event.id === score.marks.dynamic.event
                    ? '<direction placement="above"><direction-type><dynamics><p/></dynamics></direction-type><staff>2</staff></direction>'
                    : ''
                const pedal =
                  event.id === score.marks.pedal[0]
                    ? 'start'
                    : event.id === score.marks.pedal[1]
                      ? 'stop'
                      : ''
                return `${direction}${pedal ? `<direction><direction-type><pedal type="${pedal}" line="no"/></direction-type><staff>2</staff></direction>` : ''}${xmlEvent(event, lane, score)}`
              })
              .join('')}`,
        )
        .join('')
      const repeatStart =
        measure.number === 1
          ? '<barline location="left"><repeat direction="forward"/></barline>'
          : ''
      const repeatEnd =
        measure.number === score.measures.length
          ? '<barline location="right"><repeat direction="backward"/></barline>'
          : ''
      return `<measure number="${measure.number}">${attributes}${repeatStart}${lanes}${repeatEnd}</measure>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>${score.title}</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">${measures}</part>
</score-partwise>`
}
