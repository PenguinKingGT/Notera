// @vitest-environment node
/** Verify independent music exchange, exact timings, persistent identities and hostile input boundaries. */
import { expect, test } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { createPianoScore, fraction, parseScore } from '../core'
import type { Score } from '../core'
import { pianoScore } from '../core/test-fixtures'
import {
  decodeXml,
  exportMusicXml,
  importMusicXml,
  packMxl,
  unpackMxl,
} from './index'

/** Compare all semantic entities while disregarding irrelevant mark/lane serialization order and empty lanes. */
function canonical(score: Score) {
  return {
    ...score,
    marks: [...score.marks].sort((a, b) => a.id.localeCompare(b.id)),
    measures: score.measures.map((measure) => ({
      ...measure,
      voices: measure.voices
        .filter((lane) => lane.events.length)
        .sort((a, b) => a.voiceId.localeCompare(b.voiceId)),
    })),
  }
}

test('original piano fixture retains every musical entity and ID through plain and compressed round trips', () => {
  const score = pianoScore()
  const xml = exportMusicXml(score)
  expect(xml).toContain('<backup>')
  expect(xml).toContain('<forward>')
  expect(xml).toContain('<time-modification>')
  expect(canonical(importMusicXml(xml).score)).toEqual(canonical(score))
  const compressed = packMxl(xml)
  expect(unpackMxl(compressed)).toBe(xml)
  expect(canonical(importMusicXml(unpackMxl(compressed)).score)).toEqual(
    canonical(score),
  )
})

test('empty voices and gaps do not turn into invented rests', () => {
  const score = createPianoScore({ id: 'empty', measureCount: 2 })
  expect(canonical(importMusicXml(exportMusicXml(score)).score)).toEqual(
    canonical(score),
  )
})

test('effective meter/key changes and escaped titles survive interchange', () => {
  const fixture = pianoScore()
  const score = parseScore({
    ...fixture,
    title: '<练习 & "钢琴">',
    measures: [
      ...fixture.measures,
      {
        id: 'third',
        timeSignature: { beats: 3, beatType: 4 },
        keySignature: { fifths: -3 },
        voices: [],
      },
    ],
  })
  expect(canonical(importMusicXml(exportMusicXml(score)).score)).toEqual(
    canonical(score),
  )
})

test('external part uses one shared cursor with backup/forward, pitch alter and exact chord timing', () => {
  const xml = exportMusicXml(pianoScore()).replace(
    /<identification>[\s\S]*?<\/identification>/,
    '',
  )
  const imported = importMusicXml(xml).score
  expect(imported.voices).toHaveLength(3)
  expect(imported.measures[0].voices[0].events[0]).toMatchObject({
    kind: 'note',
    duration: { denominator: 4, dots: 1 },
    notes: [
      { pitch: { step: 'C', octave: 5 } },
      { pitch: { step: 'G', octave: 5 } },
    ],
  })
  expect(imported.measures[0].voices[0].events[2].onset).toEqual(
    fraction(11, 24),
  )
  expect(imported.marks.map((mark) => mark.kind).sort()).toEqual([
    'dynamic',
    'pedal',
    'repeat',
    'slur',
    'tie',
  ])
})

test('omitted notation produces a warning while nonrepresentable music fails explicitly', () => {
  const xml = exportMusicXml(pianoScore())
  const decorated = xml.replace(
    '<notations>',
    '<notations><articulations><staccato/></articulations>',
  )
  expect(importMusicXml(decorated).warnings).toContain(
    '未保留 articulations 记号。',
  )
  for (const replacement of ['<grace/>', '<cue/>', '<unpitched/>']) {
    expect(() =>
      importMusicXml(xml.replace('<pitch>', `${replacement}<pitch>`)),
    ).toThrow('首版尚不支持')
  }
  expect(() =>
    importMusicXml(
      xml.replace(
        '<measure number="1">',
        '<measure number="1" implicit="yes">',
      ),
    ),
  ).toThrow('弱起')
  expect(() =>
    importMusicXml(
      xml.replace('<duration>36</duration>', '<duration>35</duration>'),
    ),
  ).toThrow()
})

test('malformed XML, custom entities, external resources and oversized/deep XML are rejected', () => {
  const xml = exportMusicXml(pianoScore())
  expect(() => importMusicXml(xml.slice(0, -20))).toThrow('XML 格式损坏')
  expect(() =>
    importMusicXml(
      '<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><x>&a;</x>',
    ),
  ).toThrow('内部 DTD')
  expect(() =>
    importMusicXml(
      xml.replace('<work>', '<work href="https://example.com/a">'),
    ),
  ).toThrow('外部资源')
  expect(() => importMusicXml('<x>'.repeat(70) + '</x>'.repeat(70))).toThrow(
    '嵌套深度',
  )
  expect(() => importMusicXml(' '.repeat(8 * 1024 * 1024 + 1))).toThrow('8 MiB')
  // Common MusicXML external DTD declarations are accepted inertly; nothing is fetched.
  expect(
    importMusicXml(
      xml.replace(
        '<score-partwise',
        '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "https://www.musicxml.org/dtds/partwise.dtd"><score-partwise',
      ),
    ).score.title,
  ).toBe(pianoScore().title)
})

test('compressed archives reject traversal, missing containers, truncated entries and CRC corruption', () => {
  const xml = exportMusicXml(pianoScore())
  expect(() =>
    unpackMxl(zipSync({ '../escape.musicxml': strToU8(xml) })),
  ).toThrow('安全限制')
  expect(() => unpackMxl(zipSync({ 'score.musicxml': strToU8(xml) }))).toThrow(
    'container.xml',
  )
  const compressed = packMxl(xml)
  expect(() => unpackMxl(compressed.slice(0, -10))).toThrow()
  const corrupt = compressed.slice()
  // mimetype is stored without compression; changing its bytes remains valid ZIP syntax but fails integrity.
  corrupt[38] ^= 1
  expect(() => unpackMxl(corrupt)).toThrow('校验和')
})

test('UTF-8/UTF-16 are decoded strictly rather than replacing invalid bytes', () => {
  expect(
    decodeXml(strToU8('<?xml version="1.0" encoding="UTF-8"?><x>钢琴</x>')),
  ).toContain('钢琴')
  expect(
    decodeXml(
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(
          '<?xml version="1.0" encoding="UTF-16"?><x>钢琴</x>',
          'utf16le',
        ),
      ]),
    ),
  ).toContain('钢琴')
  expect(() => decodeXml(new Uint8Array([0xff]))).toThrow('编码')
  expect(() =>
    decodeXml(strToU8('<?xml version="1.0" encoding="ISO-8859-1"?><x/>')),
  ).toThrow('编码')
})

test('hand-authored external fixture has independently specified voices, timings and cross-bar spans', async () => {
  const { readFile } = await import('node:fs/promises')
  const score = importMusicXml(
    await readFile('tests/fixtures/external-piano.musicxml', 'utf8'),
  ).score
  expect(score.title).toBe('原创交换练习')
  expect(score.voices).toHaveLength(3)
  expect(score.measures[0].timeSignature).toEqual({ beats: 3, beatType: 4 })
  expect(score.measures[1].timeSignature).toEqual({ beats: 4, beatType: 4 })
  expect(score.measures[1].keySignature).toEqual({ fifths: 1 })
  expect(
    score.measures[0].voices[0].events.map((event) => event.onset),
  ).toEqual([fraction(0), fraction(3, 8), fraction(1, 2)])
  expect(
    score.measures[1].voices[0].events.map((event) => event.onset),
  ).toEqual([fraction(0), fraction(1, 2)])
  expect(score.measures[0].voices[0].events[0]).toMatchObject({
    notes: [
      { pitch: { step: 'C', alter: 1, octave: 5 } },
      { pitch: { step: 'E', alter: 0, octave: 5 } },
    ],
  })
  expect(score.marks.find((mark) => mark.kind === 'repeat')).toMatchObject({
    times: 3,
  })
  expect(canonical(importMusicXml(exportMusicXml(score)).score)).toEqual(
    canonical(score),
  )
})

test('Verovio reads exported standard music independently of Notera identity metadata', async () => {
  const { default: createModule } = await import('verovio/wasm')
  const { VerovioToolkit } = await import('verovio/esm')
  const toolkit = new VerovioToolkit(await createModule())
  try {
    const score = pianoScore()
    const xml = exportMusicXml(score).replace(
      /<identification>[\s\S]*?<\/identification>/,
      '',
    )
    toolkit.setOptions({ inputFrom: 'musicxml', breaks: 'none' })
    expect(toolkit.loadData(xml)).toBe(1)
    expect(toolkit.getPageCount()).toBeGreaterThan(0)
    const mei = toolkit.getMEI({})
    const expected = score.measures
      .flatMap((measure) => measure.voices.flatMap((lane) => lane.events))
      .reduce(
        (total, event) =>
          total + (event.kind === 'note' ? event.notes.length : 0),
        0,
      )
    expect((mei.match(/<note\b/g) ?? []).length).toBe(expected)
    expect(mei).toContain('<tie ')
    expect(mei).toContain('<slur ')
    expect(toolkit.renderToSVG(1)).toContain('<svg')
  } finally {
    toolkit.destroy()
  }
}, 15_000)

test('cross-voice pedal endpoints and adjacent slurs resolve in musical rather than XML voice order', () => {
  const fixture = pianoScore()
  const score = parseScore({
    ...fixture,
    marks: [
      ...fixture.marks.filter((mark) => mark.kind !== 'slur'),
      {
        id: 'slur-later',
        kind: 'slur',
        startEventId: 'event-triplet-2',
        endEventId: 'event-triplet-3',
      },
      {
        id: 'slur-earlier',
        kind: 'slur',
        startEventId: 'event-triplet-1',
        endEventId: 'event-triplet-2',
      },
      {
        id: 'pedal-cross-voice',
        kind: 'pedal',
        startEventId: 'event-inner-1',
        endEventId: 'event-triplet-1',
      },
    ],
  })
  expect(canonical(importMusicXml(exportMusicXml(score)).score)).toEqual(
    canonical(score),
  )
})

test('a forged ZIP size cannot truncate inflated data into an accepted document', () => {
  const compressed = packMxl(exportMusicXml(pianoScore()))
  const view = new DataView(
    compressed.buffer,
    compressed.byteOffset,
    compressed.byteLength,
  )
  for (let offset = 0; offset < compressed.length - 46; offset++) {
    if (
      view.getUint32(offset, true) === 0x02014b50 &&
      view.getUint16(offset + 28, true) === 'score.musicxml'.length
    ) {
      view.setUint32(offset + 24, 20, true)
      break
    }
  }
  expect(() => unpackMxl(compressed)).toThrow('实际解压量')
})
