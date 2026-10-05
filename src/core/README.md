# Musical core

Use `src/core/index.ts` as the public interface. This module owns musical content, validation, edit transactions and native JSON encoding. It has no React, Electron, DOM or engraving-engine dependency; Zod provides strict runtime shape checking and immutable inferred types.

## Model

- A `Score` defines ordered staves, voice identities, ordered measures and anchored marks. Each voice belongs to one staff.
- Measures carry their effective meter and key signature. Voice lanes contain ordered note/chord or rest events; omitted lanes are empty.
- `onset` uses reduced fractions of a whole note: a quarter is `1/4`, an eighth-note triplet is `1/12`. All calculations use exact BigInt intermediates, with safe integers at JSON boundaries.
- Written duration stores denominator, dots and an optional tuplet ratio. `durationTime()` calculates its sounding length. Explicit tuplet grouping, beam preferences and nested tuplets are future notation work.
- `WrittenPitch` stores step, absolute alteration and octave. Key signature does not silently modify it; C sharp and D flat remain distinct spellings even when `soundingPitch()` agrees.
- Chord events have stable IDs and each contained note has its own ID. Ties reference notes, slurs reference events. Identity is unique across entity kinds within one document.

Partial measures and gaps are valid during entry. Same-voice overlap, out-of-order events, measure overflow, duplicate chord pitches and dangling references are rejected. Ties currently require adjacent same-spelling notes in one voice; slurs stay within one voice/staff. Repeat ranges must be disjoint. Pickup-measure lengths, cross-staff notation, repeat endings and explicit major/minor mode remain future work. Jianpu currently interprets fifths using the corresponding major tonic in its independent view adapter.

## Edit and serialize

```ts
import {
  createPianoScore,
  fraction,
  ScoreEditor,
  serializeScore,
} from './index'

const editor = new ScoreEditor(createPianoScore({ id: 'example-score' }))
editor.execute({
  kind: 'insert-event',
  target: { measureId: 'measure-1', voiceId: 'voice-upper' },
  event: {
    id: 'event-1',
    kind: 'note',
    onset: fraction(0),
    duration: { denominator: 4, dots: 0 },
    notes: [{ id: 'note-1', pitch: { step: 'C', alter: 0, octave: 4 } }],
  },
})
const savedSnapshot = editor.score
const text = serializeScore(savedSnapshot)
// The desktop layer writes text, then calls editor.markSaved(savedSnapshot) after success.
editor.undo()
editor.redo()
```

`parseScore(unknown)` returns a detached, deeply frozen snapshot or a `ScoreValidationError` with issue codes and paths. Commands compose new data and validate once at transaction completion; `batch` publishes all edits together or none. Event replacement preserves the event ID; callers retain the IDs of unchanged notes. Explicit event deletion removes its anchored marks; replacement rejects broken marks unless the same batch repairs them.

`append-measure` appends a fully specified measure without generating identities or copying content implicitly. Continuous input can batch this command with the first event of the new bar, so undo removes both together. Inserting into an omitted, known voice lane materializes that empty lane only when content is added.

`ScoreEditor` keeps bounded snapshot history (100 transactions by default). Failed commands and no-ops preserve history and revision. A successful edit after undo discards redo. Save tracking compares content with the confirmed saved snapshot; supplying an older saved snapshot keeps subsequent edits dirty. New documents without a file path still need the desktop layer to track that they have never been saved.

## Native file contract

The envelope is `{ format: "notera-score", version: 1, score }`. `deserializeScore()` distinguishes invalid JSON, invalid envelope, unsupported version and invalid music. Unknown fields are rejected instead of stripped. Version 1 is the first format; there is no previous format to migrate. Future incompatible changes require an explicit version and migration policy.

These functions encode/decode strings. Filesystem access, atomic replacement, recovery copies and MusicXML exchange belong to later modules. JSON validation and snapshot history traverse the complete score; large-document optimization should follow measurement.

## Tests

`pnpm test` runs the core suites in a Node environment. The hand-authored fixture is `tests/fixtures/piano-core.notera.json`, containing two piano staves, three voices, a chord, dots, triplets, rests, accidentals, a cross-measure tie, slur, dynamic, pedal and repeat. Tests cover domain failures, transaction atomicity, undo/redo, asynchronous-save tracking and native-file round trips.
