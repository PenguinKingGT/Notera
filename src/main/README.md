# Desktop document persistence

Read this document before changing document IPC, selected-path ownership, save/close coordination or recovery. The musical format remains defined by `src/core/README.md`.

## Ownership

- `DocumentService` belongs to one `BrowserWindow`. It assigns an opaque document token and holds the path chosen by a native dialog. Renderer requests contain that token and a score, never a write destination.
- `trustedWindow()` verifies the registered window, top-level frame and loaded application URL. Preload exposes only named document operations and a close-request subscription with cleanup.
- `DocumentController` owns async UI decisions. `EditorSession` owns musical history and confirms the precise snapshot written by a completed save. New edits made during saving stay dirty.
- One active process/profile owns one current-document recovery slot. A process-level `NOTERA_USER_DATA_DIR` override supports isolated desktop tests.

## Files and failures

Native dialogs select `.notera` files; opening also accepts JSON containing the same strict `notera-score` v1 envelope. Open validates before replacing content or its capability. Cancellation and errors retain the current document and history.

`atomicWrite()` writes a unique temporary sibling, syncs and closes it, then renames it over the destination. A pre-commit failure removes the temporary sibling and preserves the previous file. Existing mode bits are reused; new files default to `0600`. Save follows the explicitly selected alias target. Metadata such as ACLs and extended attributes is not preserved, and directory entries are not fsynced; this reduces corruption risk but does not guarantee survival of every power-loss scenario.

Before saving to the current path, the service compares its remembered disk bytes with current bytes. A changed or missing file fails rather than being overwritten silently. This is a pre-write check, not locking or atomic conflict detection against concurrent external writers.

## Interchange ownership

MusicXML import/export uses dedicated native pickers through the same trusted IPC boundary. The service reads bounded bytes, converts and validates before replacing music or recovery. Listed notation losses require native confirmation. Cancellation/failure retains the prior capability. Accepted import creates an untitled native document and writes its recovery first.

Export requests carry a document token, validated score snapshot and compressed/plain flag. The chosen output path stays in main; export cannot overwrite the active native target. Atomic writing accepts text or bytes. Export leaves native dirty state, path, disk baseline and recovery unchanged. Conversion policy and resource limits are defined in `src/exchange/README.md`.

## Staff PDF export

PDF export captures a validated music snapshot, selects a separate `.pdf` target, engraves in an isolated worker and atomically writes a complete printed document. It preserves native save state and recovery. Before changing PDF layout, workers, printing or IPC, read `PDF.md`.

## Recovery and close

Dirty music is checkpointed after 500ms of musical inactivity to `userData/recovery/current.json`. Cursor/selection updates do not postpone it. Checkpoints and file decisions run in the service queue; obsolete tokens fail, including after accepted closure. Recovery is not formal save success.

A renderer reload starts a fresh document capability and inspects recovery again; clean saved files can be reopened from disk. Startup recovery is protected until the user restores, discards or exits while preserving it. Restoration creates an untitled document that needs saving to a selected location. Corrupt recovery remains intact until explicitly discarded. A successful save checkpoints the latest editor state, clearing recovery only if content is now clean. Failed recovery writes remain visible so the user can save manually.

Native close and Quit request a renderer decision. Save-and-continue proceeds only when no newer dirty edits remain. Cancel resets the pending Quit intention. Initialization-failure closure and closure after a renderer crash preserve recovery. This first implementation supports one document/window; abrupt termination can lose edits within the 500ms debounce window or an in-progress write. The renderer's title draft becomes a musical edit on blur, save shortcut or native close; a draft not yet committed is not checkpointed.

## Verification

Unit tests use real temporary files and injected picker outcomes. Desktop tests exercise real IPC, disk writes, cancellation, native Quit and crash/relaunch, while replacing native picker results in the main process. They do not automate the OS dialog widgets themselves. The test-owned child process and isolated profile are explicitly cleaned up.

The native dialog and lifecycle APIs follow the official [Electron dialog](https://www.electronjs.org/docs/latest/api/dialog), [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) and [app](https://www.electronjs.org/docs/latest/api/app) references.
