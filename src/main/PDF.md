# Score PDF export

Read this before changing PDF layout, engraving workers, hidden print windows or PDF IPC.

## Snapshot and ownership

`DocumentController.exportPdf()` captures one immutable musical snapshot and allows ongoing edits. Main validates the document token, score and notation choice, chooses a native destination, and accepts only `.pdf` paths separate from the active native file. Cancellation returns before engraving. The renderer supplies music, never filenames, SVG or HTML. Export leaves native path, disk baseline, undo history, dirty state and recovery unchanged.

`DocumentService` serializes the operation and injects its PDF renderer for file-failure tests. Only complete PDF bytes reach `atomicWrite()`. Engine, printing and writing failures keep the previous output intact. A queued close resolves after export; print windows are excluded from application document activation/Quit coordination.

## Physical layout

`pdf-layout.ts` defines A4 portrait (210 × 297 mm), 16 mm paper margins and a 6 mm page-number area. Titles wrap with an adaptive reserved area/font size; the worker and HTML use the same remaining music height. Verovio retains a further 5 mm internal safety margin, including space for braces and measure labels. Every page repeats the title and includes `page / total`.

`projectToMei(score, { placeholders: false })` preserves explicit notes/rests/marks and substitutes invisible spaces for unfilled input gaps. This projection is independent of editor SVG, selection and playback state.

## Resource boundary

`pdf-worker.ts` runs packaged Verovio WASM in a fresh Node worker. It validates input, generates all pages and checks that every projected musical identity survives pagination. Limit jobs to 200 pages, 32 MiB SVG and 60 seconds; terminate the worker on every outcome.

`svg-pdf.ts` loads main-generated HTML into a hidden sandboxed window. Each SVG is an isolated data image to avoid cross-page IDs. CSP blocks network/script resources; explicit main-owned image/font readiness runs before printing. The print job has a 60-second deadline and 64 MiB PDF limit; its window is destroyed even after failure. App windows keep their existing CSP and preload capabilities.

## Dependencies, fonts and verification

Printing uses the existing [Electron `printToPDF`](https://www.electronjs.org/docs/latest/api/web-contents#contentsprinttopdfoptions) API, without a new runtime PDF library. Engraving uses existing [Verovio (LGPLv3)](https://book.verovio.org/introduction/licensing.html); default [Leipzig music glyphs use SIL OFL](https://book.verovio.org/advanced-topics/smufl.html). Preserve their package notices when distributing the application. Titles use system font fallbacks; no additional OS font files are shipped.

Unit tests cover file cancellation, failure, obsolete tokens and concurrent editing. Desktop tests export original single/multiple-page scores offline and independently parse dimensions/page counts with `pdf-lib` (MIT, also used at runtime for recognition PDF splitting). Generated review files are `logs/staff-export-{single,multiple}.pdf`. An independent MuPDF inspection verifies readable Chinese titles/page numbers and vector music without raster images. macOS is the tested platform; actual print quality and other platforms remain manual checks.

## Numbered notation

renderJianpuPdf() runs jianpu-pdf-worker.ts using the same pure projection as the screen. pdf-pages.ts owns the shared 60-second worker lifetime and page/SVG bounds. svg-pdf.ts prints either notation with the same sandbox, CSP, physical layout and output checks.

The renderer submits only a notation enum and music snapshot. Omitted notation retains staff export for existing callers; unsupported values fail before destination selection. Jianpu filenames default to a -简谱.pdf suffix, and its page count is independent of staff engraving. Physical dimensions are shared through src/shared/print-layout.ts.

Unit routing and worker output have been checked. Numbered PDF and staff regression checks remain pending because Electron cannot launch in the restricted session; no successful desktop or packaged verification is claimed for this change.
