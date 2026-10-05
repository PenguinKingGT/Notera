/** Browser-only rendering and geometry checks for the reproducible notation benchmark. */
import {
  Accidental,
  Annotation,
  Barline,
  Beam,
  Curve,
  Dot,
  Formatter,
  PedalMarking,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  StaveTie,
  Stem,
  Tuplet,
  Voice,
} from 'vexflow'
import { allEvents, durationFor } from './fixtures.mjs'

const host = document.querySelector('#score')

/** Build a note from musical data, never persisting the VexFlow object in the input score. */
function createNote(event, lane, score) {
  const duration = durationFor(event.ticks)
  const rest = event.pitches.length === 0
  const note = new StaveNote({
    keys: rest
      ? [lane.staff === 1 ? 'b/4' : 'd/3']
      : event.pitches.map(
          (pitch) => `${pitch.step.toLowerCase()}/${pitch.octave}`,
        ),
    duration: `${duration.denominator}${rest ? 'r' : ''}`,
    dots: duration.dots ?? 0,
    clef: lane.staff === 1 ? 'treble' : 'bass',
    stemDirection: lane.staff === 1 && lane.voice === 2 ? Stem.DOWN : Stem.UP,
  })
  note.setAttribute('id', event.id)
  event.pitches.forEach((pitch, index) => {
    if (pitch.alter !== 0) {
      note.addModifier(new Accidental(pitch.alter === 1 ? '#' : 'b'), index)
    }
  })
  if (duration.dots) {
    Dot.buildAndAttach([note], { all: true })
  }
  if (event.id === score.marks.dynamic.event) {
    note.addModifier(
      new Annotation('p').setVerticalJustification(
        Annotation.VerticalJustify.TOP,
      ),
      0,
    )
  }
  return note
}

/** Draw cross-measure ties, using partial segments if the benchmark creates a system break. */
function drawTie(context, first, last) {
  const sameSystem = first.getStave().getY() === last.getStave().getY()
  if (sameSystem) {
    new StaveTie({
      firstNote: first,
      lastNote: last,
      firstIndexes: [0],
      lastIndexes: [0],
    })
      .setContext(context)
      .draw()
  } else {
    new StaveTie({ firstNote: first, firstIndexes: [0], lastIndexes: [0] })
      .setContext(context)
      .draw()
    new StaveTie({ lastNote: last, firstIndexes: [0], lastIndexes: [0] })
      .setContext(context)
      .draw()
  }
}

/** Render with an explicitly application-owned system layout; VexFlow does not paginate this input. */
async function renderVexflow(score, width) {
  await document.fonts.ready
  host.replaceChildren()
  const started = performance.now()
  const measureWidth = 320
  const perSystem = Math.max(1, Math.floor((width - 40) / measureWidth))
  const systems = Math.ceil(score.measures.length / perSystem)
  const height = systems * 280 + 200
  const renderer = new Renderer(host, Renderer.Backends.SVG)
  renderer.resize(width, height)
  const context = renderer.getContext()
  const notesById = new Map()
  score.measures.forEach((measure, index) => {
    const column = index % perSystem
    const row = Math.floor(index / perSystem)
    const x = 20 + column * ((width - 40) / perSystem)
    const y = 140 + row * 280
    const staves = [
      new Stave(x, y, (width - 40) / perSystem),
      new Stave(x, y + 115, (width - 40) / perSystem),
    ]
    if (column === 0) {
      staves[0].addClef('treble')
      staves[1].addClef('bass')
      if (index === 0) {
        staves.forEach((stave) => stave.addTimeSignature('4/4'))
      }
    }
    if (index === 0) {
      staves.forEach((stave) => stave.setBegBarType(Barline.type.REPEAT_BEGIN))
    }
    if (index === score.measures.length - 1) {
      staves.forEach((stave) => stave.setEndBarType(Barline.type.REPEAT_END))
    }
    staves.forEach((stave) => stave.setContext(context).draw())
    // Clefs differ in width; align the note area before formatting simultaneous voices.
    const startX = Math.max(...staves.map((stave) => stave.getNoteStartX()))
    staves.forEach((stave) => stave.setNoteStartX(startX))
    new StaveConnector(staves[0], staves[1])
      .setType(StaveConnector.type.SINGLE_LEFT)
      .setContext(context)
      .draw()
    if (column === 0) {
      new StaveConnector(staves[0], staves[1])
        .setType(StaveConnector.type.BRACE)
        .setContext(context)
        .draw()
    }
    const tuplets = []
    const beams = []
    const voices = measure.lanes.map((lane) => {
      const notes = lane.events.map((event) => {
        const note = createNote(event, lane, score)
        note.setStave(staves[lane.staff - 1])
        notesById.set(event.id, note)
        return note
      })
      for (let noteIndex = 0; noteIndex < lane.events.length; noteIndex += 1) {
        const event = lane.events[noteIndex]
        if (event.ticks === 4) {
          const group = notes.slice(noteIndex, noteIndex + 3)
          tuplets.push(
            new Tuplet(group, {
              numNotes: 3,
              notesOccupied: 2,
              bracketed: false,
            }),
          )
          beams.push(new Beam(group))
          noteIndex += 2
        } else if (
          event.ticks === 6 &&
          event.onset % 12 === 0 &&
          lane.events[noteIndex + 1]?.ticks === 6
        ) {
          beams.push(new Beam(notes.slice(noteIndex, noteIndex + 2)))
          noteIndex += 1
        }
      }
      return new Voice({ numBeats: 4, beatValue: 4 })
        .addTickables(notes)
        .setStave(staves[lane.staff - 1])
    })
    const formatter = new Formatter()
    formatter.joinVoices(voices.slice(0, 2)).joinVoices(voices.slice(2))
    formatter.format(voices, staves[0].getNoteEndX() - startX - 20, {
      context,
      alignRests: true,
    })
    voices.forEach((voice) => voice.draw(context))
    beams.forEach((beam) => beam.setContext(context).draw())
    tuplets.forEach((tuplet) => tuplet.setContext(context).draw())
  })
  drawTie(context, ...score.marks.tie.map((id) => notesById.get(id)))
  new Curve(...score.marks.slur.map((id) => notesById.get(id)))
    .setContext(context)
    .draw()
  PedalMarking.createSustain(score.marks.pedal.map((id) => notesById.get(id)))
    .setContext(context)
    .draw()
  const renderMs = performance.now() - started
  const geometry = inspectGeometry(score, 'vexflow')
  return {
    renderMs,
    systems,
    pages: null,
    pagination: 'application-owned fixed measures per system',
    geometry,
    svg: host.innerHTML,
  }
}

/** Place engine-produced SVG in a real browser so font paths and transformed boxes are measurable. */
function mountVerovio(svgs, score) {
  host.innerHTML = svgs.join('')
  return inspectGeometry(score, 'verovio')
}

/** Find every musical event by stable ID and probe its actual painted SVG bounds. */
function inspectGeometry(score, engine) {
  const missing = []
  const empty = []
  const clipped = []
  const boxes = {}
  for (const event of allEvents(score)) {
    const element = document.getElementById(
      engine === 'vexflow' ? `vf-${event.id}` : event.id,
    )
    if (!element) {
      missing.push(event.id)
      continue
    }
    const rect = element.getBoundingClientRect()
    const page = element.closest('svg').getBoundingClientRect()
    const box = {
      x: rect.x - page.x,
      y: rect.y - page.y,
      width: rect.width,
      height: rect.height,
    }
    boxes[event.id] = box
    if (box.width <= 0 || box.height <= 0) {
      empty.push(event.id)
    }
    if (
      box.x < -1 ||
      box.y < -1 ||
      box.x + box.width > page.width + 1 ||
      box.y + box.height > page.height + 1
    ) {
      clipped.push(event.id)
    }
  }
  // Overlaps of note-group rectangles include stems and can be intentional; they are not a collision verdict.
  return {
    expected: allEvents(score).length,
    mapped: Object.keys(boxes).length,
    missing,
    empty,
    clipped,
    boxes,
  }
}

window.notationBenchmark = { renderVexflow, mountVerovio }
