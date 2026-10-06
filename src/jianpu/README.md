# Jianpu notation

This module projects the immutable native score into read-only numbered notation. It has no React, Electron, filesystem or audio dependency. Editing remains in staff notation; both views and playback use the same score. No converted musical copy or layout coordinates enter native files.

## Pitch and rhythm

- The score records fifths but no major/minor mode. Degree 1 uses the corresponding major tonic, with its written octave-four pitch as the register reference. In F, F4 is unmarked 1, C5 is unmarked 5, and C4 is 5 with one dot below. This policy does not infer tonality from melody.
- Written spelling determines degree. Alteration relative to the key scale is explicit on every number; F natural in G is lowered 7. All fifteen signatures and supported double alterations retain meaning.
- Shorter-than-quarter values use one to four underlines. Augmentation dots and native tuplet ratios remain explicit. Half/whole values expand into quarter-value dashes; long rests use repeated zeros. Remaining dots attach to the final unit, preserving double/triple dotted values.
- Digits and rests share a baseline within each voice; chords stack upward from their lowest pitch, with room for register dots. Each voice has a separate row; staves group rows as right/left hand according to document order.
- Only explicitly entered rests become zeros. Gaps and omitted lanes stay blank.

## Layout and marks

projection.ts retains exact onset fractions and source identities. layout.ts joins all voice onsets and continuation instants into shared columns. Voice rows reserve space according to their actual chord, register and annotation bounds; barlines cover the musical band rather than the full annotation area. Dense bars continue with dashed boundaries and a continuation label rather than becoming extra musical measures.

svg.ts preserves ties, slurs, dynamics, pedal and basic repeat counts. Chord ties remain distinct; annotation bands reserve room for overlapping ranges. Ranges continue across systems/pages. Key and meter appear at the opening and actual changes; system-opening measure numbers provide navigation without repeating metadata over every bar. One continuous bracket joins the hands. Complete systems justify shared onset columns to the page width; the last short system retains natural spacing. Short values join their underlines within simple or compound beat groups, never across gaps, bars or tuplet-ratio changes.

Screen and PDF share vector pages and pure physical dimensions in src/shared/print-layout.ts. Workers own layout; obsolete screen results are discarded. Jobs are limited to 200 pages and 32 MiB SVG. Systems too tall for A4 produce an error instead of clipped voices.

Conventions were checked against the maintainer's [jianpu-ly documentation](https://ssb22.user.srcf.net/mwrhome/jianpu-ly.html). Notera uses its own TypeScript/SVG implementation and does not bundle LilyPond, Python or code from that project.

## Verification and limits

pnpm test covers key-relative pitches, registers, dots, tuplets, voices, dense-bar continuation, marks and pagination. Worker lifecycle tests cover obsolete replies and retry cleanup.

The desktop test tests/e2e/jianpu.spec.ts covers editing synchronization, read-only behavior, real offline PDFs and native-state preservation. On 2026-10-06, production and unsigned packaged tests passed in the user’s normal macOS terminal, together with the staff PDF regression. Single/multiple-page PDFs were independently parsed as A4, and the user confirmed visual review. The agent’s restricted launch context still cannot start Electron; this does not invalidate the normal-terminal results.

Review SVG: logs/jianpu/core.svg. The core fixture and pagination examples passed visual acceptance; broader repertoire and complex engraving still need further review. Explicit mode selection, custom register references, manual spacing and Jianpu editing are not provided.
