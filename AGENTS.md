# Repository Guidelines

## Project Structure

The repo is a monorepo with three top-level deployable units:

- `mobile/` - Expo Router app (workspace, terminal, explorer tabs). Contains `app/` (routes), `components/`, `hooks/`, `lib/`, `constants/`, `assets/`. Self-contained Expo project with its own `package.json` and configs.
- `cli/` - juno CLI (Node + TypeScript). Source under `cli/src/`, bin entry at `cli/bin/juno.js`, helper scripts in `cli/scripts/`. Ships to npm as `@juno-dev/cli`, exposes the `juno` binary with `pair / status / stop / doctor` subcommands. User config lives at `~/.juno/projects.json` (auto-seeded).
- `landing/` - static landing page deployed via Vercel. Marketing only, zero coupling to mobile or cli.

A root `Makefile` orchestrates dev workflows (`make install`, `make dev`, `make build`, `make lint`, `make clean`) and per-subsystem targets (`cli-*`, `mobile-*`, `landing-*`).

Each top-level folder is one deployable artifact. Cross-folder imports are forbidden - if mobile and cli need to share a contract, extract it into a `packages/shared/` workspace package (no such package exists yet; add one when concrete need arises).

## Build, Test, Development Commands

Mobile (run from `mobile/`):

- `npx expo start -c` - start the Expo dev server (clear cache).
- `npx expo lint` - run ESLint via Expo.
- `npx tsc --noEmit` - typecheck.

CLI (run from `cli/`):

- `npm run dev` - start `juno pair` via ts-node with tunnel fallback (ngrok → cloudflared → LAN-only).
- `npm run dev:notunnel` - LAN-only mode.
- `npm run build` - compile to `cli/dist/`.
- `npm run test:client` - manual smoke client.
- `npx tsc --noEmit` - typecheck.
- `node bin/juno.js <command>` - run the compiled binary directly (pair / status / stop / doctor / help).

From the repo root:

- `make install` - install everything and link `juno` globally via `npm link`.
- `make dev` - run `cli` and `mobile` dev servers in parallel.
- `make build` / `make lint` / `make clean` - aggregate targets.

## Coding Style

TypeScript across the repo. 2-space indentation, semicolons, single quotes, trailing commas where the formatter or surrounding file already uses them.

- PascalCase for React components: `ThemedText`, `DeviceRow`.
- camelCase for functions and variables: `parsePairingScan`, `buildSharedTmuxSessionName`.
- kebab-case for file names: `pair-device.tsx`, `device-row.tsx`, `use-workspace-connection.ts`.
- File-level constants screaming snake case: `TAB_OUTPUT_LIMIT`, `SESSION_TTL_MS`.

Linting is configured through `mobile/eslint.config.js` (ESLint with `eslint-config-expo`). Server `dist/` is excluded.

## Coding Guidelines (apply to every change)

### File-size discipline

- Hard ceiling: any source file over **500 lines** must be split before merging. Server `index.ts` and any class file are the most common offenders.
- Soft target: keep most files under **300 lines**.
- A long file with one cohesive class is still a smell - extract helpers, types, constants into siblings.

### Modular structure

- One concern per file. A file mixing routing, state, and rendering should be split.
- Pure helpers (no side effects, no imports beyond types) → `lib/` (in mobile) or top-level (in server).
- Reusable UI → `mobile/components/<feature>/` (e.g. `components/workspace/device-row.tsx`).
- React state machines longer than ~50 lines → custom hook in `mobile/hooks/`.
- CLI message handlers → `cli/src/handlers/<feature>.ts`. Keep the WS router (`ws-router.ts`) as a thin dispatcher.
- New CLI subcommands → `cli/src/commands/<name>.ts`, then wire into the `switch` block in `cli/src/cli.ts`.
- Shared constants → top of file, not buried mid-function. If reused across files, move to a `constants.ts`.

### Comments and naming

- Default to no comments. Code should read like prose. Function names carry the intent.
- A comment is justified only when explaining a non-obvious *why* (workaround, hidden invariant, security note). Never explain *what* - the code already says it.
- Don't write multi-paragraph docstrings or boilerplate JSDoc.
- Don't reference past changes, ticket numbers, or removed code in comments. PR descriptions and `git log` carry that history.

### Function complexity

- Aim for functions under 40 lines. If a function holds more than one mental concept, split it.
- Avoid deeply nested ternaries - extract a helper or use an early return.
- Branching long-form `if … else if …` chains → consider a lookup map if the branches are pure.

### State management

- Pass props/args explicitly. Avoid module-level mutable state unless representing a singleton resource (e.g. the shared tmux registry on server, the `terminalTabsManager` singleton on mobile).
- React: derive state from props/state with `useMemo` rather than mirroring it into another `useState`.
- Avoid effects that fire on every render. Always specify the minimum dependency array.

### Error handling

- Validate at trust boundaries (WS message ingress, file system access, user input). Trust internal helpers.
- CLI: use the typed error message envelope (`sendError`, `sendRequestError` in `cli/src/protocol.ts`).
- Mobile: surface user-actionable errors via the existing status-message channel; don't silently swallow.

### Imports

- Group: external deps → `@/` aliases → relative imports → types. Each group separated by a blank line.
- No deep relative chains (`../../../`). Use the `@/` alias on mobile or relative imports inside the same folder on server.
- Type-only imports use `import type { … }`.

### When adding new features

- Feature touches multiple subsystems (mobile + cli)? Add the protocol message to `cli/src/types.ts` first, then the handler, then the mobile call site. Verify with `tsc --noEmit` after each step.
- New screen → new route under `mobile/app/`. Keep the route file thin: extract hooks for state, components for sub-UI.
- New WS message type → discriminated union member in `types.ts`, parse it in `protocol.ts`, route it in `ws-router.ts`, write a handler in `handlers/<feature>.ts`.

## Testing Guidelines

There is no formal unit suite yet. Until one exists:

- Mobile: run `npx tsc --noEmit` and `npx expo lint`. Verify the affected flow in Expo Go or simulator.
- CLI: run `npm run build` to typecheck-and-emit, then `npm run test:client` for the protocol smoke check, and `node bin/juno.js doctor` for environment.
- Touching protocol, pairing, or session lifecycle: add a focused script under `cli/scripts/` that exercises the change end to end.

When tests are introduced, place them next to the unit under test (`foo.ts` → `foo.test.ts`) and run them via the package's `test` script.

## Commit & Pull Request Guidelines

Conventional Commits with scopes:

- `feat(mobile): add settings screen`
- `fix(cli): handle tunnel reconnect race`
- `feat(cli): add juno status subcommand`
- `refactor(mobile): split terminal-tabs manager`
- `docs(repo): update repository layout`

Subject line ≤ 70 characters. Body explains *why* when the diff alone doesn't.

PR description should include:

- One-line summary of user-visible or protocol-visible changes.
- Linked issue when applicable.
- Screenshot or recording for UI changes.
- Notes on env vars, manual setup, or backwards-incompatible protocol changes.
