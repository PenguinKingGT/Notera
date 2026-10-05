# Editing and musical marks

`EditorSession` translates input intentions into immutable core commands and publishes a cached external-store snapshot. Selection and cursor are interaction state; marks belong to the musical score. `DocumentController` coordinates desktop document operations separately.

## Mark intentions

`putMark(input, existingId?)` allocates identities for new marks and preserves identities during revisions. Passing a removed identity rejects the edit instead of recreating a stale mark. Identical anchors update an existing mark, including a dynamic's value and a repeat's count; moving a revision onto another identical mark is rejected. `deleteMark(id)` removes only the mark, preserving its endpoint music.

Each action uses one core transaction. Semantic failures return false and publish a useful error, without changing score identity, dirty state or history. The core validates exact timing, references, written pitch, voices, staves and repeat ranges. Event deletion cascades to anchored marks; undo restores both.

`marks.ts` owns endpoint choices and descriptions. Ties use individual note IDs, dynamics use event IDs, slurs/pedals use event spans, and repeats use measure IDs. Absolute times use exact fractions so cross-bar and tuplet ties do not depend on pixel coordinates or floating point. Choice filtering guides the UI; core validation remains authoritative for stale drafts and conflicting ranges.

## Interface and projections

`MarkInspector` lists all native marks, including imports, and holds uncommitted form drafts locally. It derives compatible ends from the current score. Forms reset with selection changes, changes to the edited historical mark, and document replacement (via the document capability ID). Deleted endpoints disable submission. Failed core validation keeps the draft available for correction.

No native format change or renderer-only music representation is introduced. Existing MEI, MusicXML and playback adapters consume the same marks. Custom repeat counts are displayed as `3×` etc. in both screen and print projections using an MEI [directive](https://music-encoding.org/guidelines/v5/elements/dir.html), anchored to beat 1 on the upper staff; empty repeat measures still receive the instruction.

The interface currently uses position lists; direct SVG mark selection, dragging endpoints, cross-staff notation, nested repeats and repeat endings are future work. Overlapping pedal/slur spans remain subject to the existing model's capabilities; this editor does not normalize imported music silently.

## Verification

`pnpm test` covers mark identity, exact cross-bar endpoints, history, native round trips, invalid clean-document edits and duplicate-target revisions. `pnpm exec playwright test tests/e2e/marks.spec.ts` exercises all five mark kinds with real offline Verovio, modification/deletion/undo, disk save/reopen, stale-draft reset and invalid endpoint submission. The test writes `logs/mark-editing-preview.png`.
