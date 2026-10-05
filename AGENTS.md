# Repository Guidelines

## Project Status & Architecture

Notera is a desktop music notation editor. The agreed stack is Electron, Vite, React, TypeScript, and shadcn/ui, with independent score files for persistence. The desktop shell, musical core, basic piano editor, native file operations, recovery, MusicXML/MXL interchange, offline piano playback and staff PDF export are implemented.

Keep the score model and editing commands independent of React and Electron. React manages the interface; Electron's main process handles filesystem operations through a narrow preload API. Native score strings use versioned JSON. Before changing musical invariants, commands, or serialization, read `src/core/README.md`. Before changing document IPC, save/close coordination or recovery, read `src/main/README.md`. Before changing MusicXML conversion, loss reports or MXL parsing, read `src/exchange/README.md`. Before changing PDF export, read `src/main/PDF.md`. Before changing playback compilation, audio resources or transport lifecycle, read `src/playback/README.md`. Add SQLite when library indexing requires it.

## Project Structure & Module Organization

Use these locations:

- `src/main/`: Electron lifecycle, authorized document paths, atomic file replacement, recovery and IPC handlers.
- `src/preload/`: typed APIs exposed to the renderer.
- `src/renderer/`: React screens, hooks, and shadcn/ui components.
- `src/core/`: musical schema, validation, editing transactions, undo/redo, and native JSON encoding.
- `src/editor/`: input session, musical cursor and selection independent of React.
- `src/notation/`: MEI projection, SVG identity mapping and offline engraving worker.
- `src/exchange/`: independent MusicXML/MXL conversion, identity metadata and loss reporting.
- `src/playback/`: independent performance compilation, cancellable transport and local sampled piano.
- `src/shared/`: shared IPC definitions and types.
- `src/assets/`: bundled musical examples and future fonts/icons.
- `tests/e2e/`: Electron editing, offline engraving and IPC integration tests.
- `tests/fixtures/`: hand-authored musical examples and file expectations.
- `scripts/`: development and packaging helpers.

## Build, Test, and Development Commands

Use pnpm for dependency management and script execution. Install locked dependencies with `pnpm install --frozen-lockfile`. Available commands:

- `pnpm run dev`: launch Vite and Electron locally.
- `pnpm run build`: compile the application for production.
- `pnpm run lint`: run ESLint.
- `pnpm run typecheck`: check TypeScript types.
- `pnpm test`: run Vitest unit tests, including the musical core in a Node environment.
- `pnpm run test:e2e`: build and test the real Electron application.
- `pnpm run package`: build an unpacked application for the current platform.
- `pnpm run format:check`: check Prettier formatting.

## Coding Style & Naming Conventions

Use TypeScript with strict checking and two-space indentation. Use the configured ESLint and Prettier rules. Name React components with PascalCase, hooks with `useCamelCase`, and functions and variables with camelCase. Give editing commands explicit names such as `InsertNoteCommand`. Keep score semantics separate from rendering coordinates.

## Comments & Documentation

- Add a header comment to each source file explaining its purpose and responsibility.
- Document classes, functions, and methods with JSDoc or TSDoc. Explain their purpose and describe relevant inputs, outputs, side effects, and error conditions.
- Comment core or important logic, including domain rules, algorithms, IPC validation, persistence, and undo/redo. Explain the reasoning, constraints, and edge cases rather than restating the code.
- Update comments alongside code changes so they remain accurate.

## Code Quality & Maintainability

- Keep modules, classes, and functions focused on a clear responsibility. Extract meaningful helpers when logic becomes difficult to follow, and keep dependencies explicit.
- Use descriptive names and straightforward control flow. Handle errors explicitly and replace duplicated logic or unexplained constants with named abstractions.
- Write readable, expanded code: use one statement per line and multiline blocks for conditionals, loops, and error handling. Put statements inside braces on separate lines, including single-statement branches.
- Split complex expressions and long argument lists across lines. Let Prettier format the code while preserving logical structure; keep code easy to scan instead of compressing it into one line.
- Before submitting changes, check that comments, module boundaries, and formatting make the code understandable to the next contributor.

## Testing Guidelines

Use Vitest for core logic, React Testing Library for UI behavior, and Playwright for desktop integration. Desktop tests need a graphical environment. Name tests `*.test.ts` or `*.test.tsx` beside their modules. Prioritize score serialization round trips, rhythmic duration rules, undo/redo, and file error handling. No coverage threshold is established; cover changed behavior and regression cases.

## Commit & Pull Request Guidelines

There is no commit history yet. Use concise imperative messages, preferably `feat:`, `fix:`, or `docs:` prefixes. PRs should explain the change, link relevant issues, report verification and any unavailable checks, and include screenshots for visible UI changes.

## Security & File Integrity

Enable context isolation and keep Node.js access in the main process. Validate IPC payloads and imported score files. Save through temporary files and replacement to reduce corruption risk. Keep generated logs, build outputs, and credentials out of version control.

## Agent skills

### Issue tracker

Track issues and specs as local Markdown under `.scratch/<feature>/`.
Before reading or writing tickets, read `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels.
Before assigning ticket status, read `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context layout: root `CONTEXT.md` and `docs/adr/`.
Before exploring domain concepts or architecture, read `docs/agents/domain.md`.
