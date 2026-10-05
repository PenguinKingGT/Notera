# Staff notation projection

`projectToMei()` turns immutable native music into MEI and returns musical identities for SVG selection. The Verovio worker owns screen engraving; the main PDF worker uses the same projection with `{ placeholders: false }`. Neither projection changes the score or persists layout coordinates.

## Automatic beams

`beaming.ts` partitions an already bounded voice run into automatic groups. Only notes/chords with written denominators 8–64 participate. Their exact sounding intervals must be contiguous and fit within one beam beat. Rests, gaps, longer values, beat crossings, voice/measure boundaries and tuplet boundaries break groups. A single eligible event remains flagged; mixed short values and dots can share a beam.

Defaults are an application policy, with future customization expected:

- Simple meters group by the denominator unit: 4/4 and 3/4 use quarter-note beats; 2/2 uses half-note beats.
- Compound counts divisible by three and at least six use three denominator units, e.g. 6/8, 9/8 and 12/8 group in dotted quarters.
- Short triple bars such as 3/8 and 3/16 group their three units together.
- Asymmetric meters such as 5/8 retain single denominator-unit groups. No unrecorded 2+3 accent pattern is invented.

Beat lookup and boundary comparisons use BigInt rational arithmetic. An event ending exactly at a beat boundary can join the group; a note crossing that boundary stays separate. The existing native model has no explicit tuplet-group identity: projection bounds each inferred group by contiguous equal-ratio events and `actual` event count. Beam groups stay inside those inferred tuplets, without promising full mixed-value/nested-tuplet engraving.

The MEI adapter wraps multi-event groups in [`beam`](https://music-encoding.org/guidelines/v5/elements/beam.html), including inside tuplets. It emits ordinary music and inferred tuplets separately, keeping placeholder rests and invisible print spaces outside beam containers. Native note/event IDs and target mappings remain unchanged, so selection, editing and playback highlighting keep working after re-engraving.

The [MuseScore time-signature documentation](https://handbook.musescore.org/notation/rhythm-meter-and-measures/time-signatures) describes configurable beam groups. This first implementation supplies defaults; it does not import/persist custom beam preferences, infer phrasing, join through rests, beam across staves or offer manual beam breaking.

## Verification

`pnpm test` covers exact rhythms, meters, dots, mixed levels, rests/gaps, ratio changes, chord identities, voice separation and matching screen/print beams. `pnpm exec playwright test tests/e2e/beaming.spec.ts` checks real input, selection inside beams, deletion/undo re-grouping, 6/8 native-file loading, triplets and offline PDF output. Review artifacts are `logs/beaming-preview.png`, `logs/beaming-export.pdf` and the independently rendered `logs/beaming-pdf-preview.png`.
