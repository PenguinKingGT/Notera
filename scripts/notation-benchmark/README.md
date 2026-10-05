# Notation benchmark

This offline evaluation compares VexFlow 5.0.0 with Verovio 6.3.0. It does not implement the product editor or choose the production engine.

## Run

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run benchmark:notation
```

Chromium installation is only needed when the Playwright browser is missing. The benchmark uses a temporary Vite server bound to `127.0.0.1`, closes it on completion, and makes no model API calls.

Open `test-results/notation-benchmark/index.html` to compare SVG output. This directory is generated and ignored by Git; desktop tests may clear it, so regenerate it after running those tests.

## Corpus and outputs

`fixtures.mjs` defines four original, manually specified 4/4 piano bars. Both engines receive the same pitches, onsets, durations, three voices, chords, rests, accidentals, dots, triplets, tie, slur, dynamic, pedal and repeat. The 48-bar case repeats this material to probe pagination; it is not 48 distinct musical examples.

Cases cover the baseline, a chord/pitch/rhythm edit, a narrower width and a longer score. The runner checks stable event IDs, nonempty visible bounds, clipping, geometry changes after editing, deterministic Verovio geometry after restoring the input, and multi-page output. VexFlow receives application-defined stave positions and line breaks; Verovio calculates its own systems and pages.

Outputs include:

- `results.json`: versions, environment, single-sample timings and geometry checks.
- `*.expected.json`: musical expectations, independent of engine output.
- `*.mei` and `*.musicxml`: benchmark interchange inputs.
- `*.svg` and `*.png`: inspectable renderings.
- `recognition-input.pdf`: synthetic source for a future AI evaluation, paired with `piano-4.expected.json` and `piano-4.verovio.page-1.png`.

## Evidence limits

- Event rectangles establish object mapping, not complete click handling or individual chord-note selection.
- Neither positive bounds nor stable IDs prove collision-free engraving. Visually review the SVG/PNG outputs.
- The VexFlow dynamic uses a text annotation; this adapter is not a production dynamics or page-layout implementation.
- MusicXML import checks pitched-note count only. It does not establish complete semantic preservation or export round trips.
- Verovio runs in Node WASM and VexFlow in Chromium; their single-sample times are not a controlled performance ranking. Electron packaging and worker behavior remain untested here.
- Synthetic clean images do not represent screenshots from other applications, scanned scores or camera photos. No recognition model has been evaluated.

The benchmark converters support only this corpus. Their structure is not the native score-file schema.
