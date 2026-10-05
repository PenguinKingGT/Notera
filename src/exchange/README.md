# MusicXML piano interchange

Read this before changing conversion rules, loss reports or MXL parsing. `src/exchange/index.ts` is the independent exchange boundary; every import calls the musical core's `parseScore()`. MusicXML and Verovio never become the native editing authority.

## Supported content

| Content  | Import / export contract                                                                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files    | `score-partwise`, one piano part with treble and bass staves; `.musicxml`, `.xml`, compressed `.mxl`. Export emits MusicXML 4.0.                                                                               |
| Time     | Shared part cursor, integer divisions, backup/forward, exact fractions, independent voices; gaps remain gaps. Written note types whole through 64th, up to three dots, a supported actual/normal tuplet ratio. |
| Pitch    | Written C–B, alteration −2…2, octave 0…9, separate chord-note identities. Chord notes share voice, staff and written duration.                                                                                 |
| Context  | Effective integer meter and conventional fifths at measure boundaries; fixed treble/bass clefs.                                                                                                                |
| Spans    | Adjacent same-spelling note ties; forward slurs in one voice; pedal start/stop on one staff, including across voices. Cross-measure endpoints retain their native identity.                                    |
| Marks    | `ppp`…`fff`, basic disjoint repeat ranges with 2…16 plays; dynamics/pedal anchor at event onsets. At most 16 simultaneous exported spans of each kind.                                                         |
| Identity | Optional `notera-identities-v1` miscellaneous metadata maps semantic locations to native IDs. It contains no musical payload. External files get new IDs. Other programs may discard this metadata.            |

Imported lanes may omit empty voices; empty lanes and mark order are not musical differences. External XML IDs, voice labels and measure numbers are not native identity authority. A native document round trip preserves all represented entity IDs when optional metadata remains intact.

## Losses and rejections

Import lists losses in a native confirmation dialog before replacing the document. Cancelling preserves music, history, the native path and recovery. Layout, beams, stems, explicit accidental appearance, tuplet grouping, lyrics, articulations, ornaments, wedges, tempo, playback parameters and extra metadata are not retained. A supported cumulative tuplet ratio retains time; grouped/nested engraving is regenerated. Unknown note/notation/direction content is reported. Major/minor mode is omitted while fifths remain.

Reject grace/cue/unpitched notes, cross-staff voices, multiple parts, timewise/opus, pickups marked implicit, transposition, octave shifts, independent staff meters/keys, mid-measure attributes, custom keys, repeat endings/jumps, mismatched chord/tick durations, unsupported spans or anchors, and core-invalid overlaps. Short editing measures without an implicit flag retain gaps; pickup duration is not inferred from missing notes. Duplicate marks with identical semantic endpoints cannot be exported losslessly and fail explicitly.

Imports become untitled, dirty native documents with ordinary edit/undo/save. Exports write a captured snapshot through an authorized native picker and atomic replacement; they do not acknowledge native save success or redirect its path.

## Input limits and dependencies

- Main-process streams cap file reads at 12 MiB. XML caps 8 MiB, 150,000 elements, depth 64 and 10,000 measures; identity metadata caps 30,000 mappings. Export uses the same XML/identity limits.
- MXL caps 64 entries, 8 MiB per inflated entry and 16 MiB total. Both declared and actual sizes are checked. CRC-32, central/local entries, duplicate names and relative paths are checked; entries stay in memory and are never extracted to disk. ZIP64, encryption and multipart archives fail.
- UTF-8 and BOM-declared UTF-16 are decoded strictly. XML internal DTD subsets/custom entities and external resource references fail. Conventional external MusicXML DTD declarations are inert; no schema/entity/resource is fetched during import.
- `fflate` 0.8.3 (MIT) provides streaming compression. `saxes` 6.0.0 (ISC) provides strict XML parsing and is already used transitively by the test DOM. Its upstream repository is archived; the parser seam is isolated in `xml.ts`, versions are pinned, and malformed-input regressions must accompany future replacements. Neither dependency requires application C++.

## Verification and sources

`pnpm run test` covers native/plain/MXL semantic round trips, a separately hand-authored external fixture, cross-voice time/spans, failure/cancellation and archive integrity. Verovio independently reads the exported standard elements with Notera metadata removed, checks pitched-note count and span presence, and renders SVG. This does not establish MuseScore/Dorico GUI compatibility or preservation of every layout detail.

`pnpm run verify:musicxml` downloads the pinned official v4.0 schemas into ignored `logs/musicxml-schema/` and validates the original export and external fixture using `xmllint --nonet` (requires network for downloads and a local `xmllint`). `pnpm run test:e2e` verifies real Electron import → edit/undo → native save/reopen → plain/MXL export; native picker/confirmation outcomes are injected, not OS widgets. A screenshot is written to `logs/musicxml-exchange-preview.png`.

Rules follow the official [MusicXML 4.0 schema](https://raw.githubusercontent.com/w3c/musicxml/v4.0/schema/musicxml.xsd), [notes](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/note/), [backup](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/backup/), [time modification](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/time-modification/), [directions](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/direction/), [ties](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/tie/), [repeats](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/repeat/) and [MXL container specification](https://www.w3.org/2021/06/musicxml40/tutorial/compressed-mxl-files/). Dependency behavior/licensing was checked against [fflate](https://github.com/101arrowz/fflate) and [saxes](https://github.com/lddubeau/saxes).
