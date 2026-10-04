# Repository Guidelines

## Project Status & Architecture

Notera is a desktop music notation editor. The agreed stack is Electron, Vite, React, TypeScript, and shadcn/ui, with independent score files for persistence. The desktop shell, build tooling, and isolated preload bridge are initialized.

Keep the score model and editing commands independent of React and Electron. React manages the interface; Electron's main process handles filesystem operations through a narrow preload API. Start score files as versioned JSON documents. Add SQLite when library indexing requires it.

## Project Structure & Module Organization

Use these locations:

- `src/main/`: Electron lifecycle, file access, and IPC handlers.
- `src/preload/`: typed APIs exposed to the renderer.
- `src/renderer/`: React screens, hooks, and shadcn/ui components.
- `src/core/`: reserved for score entities, editing commands, and undo/redo.
- `src/shared/`: shared IPC definitions and types.
- `src/assets/`: reserved for fonts, icons, and bundled resources.
- `tests/e2e/`: Electron startup and IPC smoke tests.
- `tests/fixtures/`: reserved for score examples and malformed files.
- `scripts/`: development and packaging helpers.

## Build, Test, and Development Commands

Use pnpm for dependency management and script execution. Install locked dependencies with `pnpm install --frozen-lockfile`. Available commands:

- `pnpm run dev`: launch Vite and Electron locally.
- `pnpm run build`: compile the application for production.
- `pnpm run lint`: run ESLint.
- `pnpm run typecheck`: check TypeScript types.
- `pnpm test`: run Vitest unit tests; currently exits successfully with no unit tests.
- `pnpm run test:e2e`: build and test the real Electron application.
- `pnpm run package`: build an unpacked application for the current platform.
- `pnpm run format:check`: check Prettier formatting.

## Coding Style & Naming Conventions

Use TypeScript with strict checking and two-space indentation. Use the configured ESLint and Prettier rules. Name React components with PascalCase, hooks with `useCamelCase`, and functions and variables with camelCase. Give editing commands explicit names such as `InsertNoteCommand`. Keep score semantics separate from rendering coordinates.

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
