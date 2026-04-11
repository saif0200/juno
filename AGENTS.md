# Repository Guidelines

## Project Structure & Module Organization

This repository has two main parts:

- `app/`: Expo Router screens for the mobile client. Route groups such as `app/(tabs)/` define navigation.
- `components/`, `hooks/`, `constants/`, `lib/`: shared UI, theme hooks, config, and app-side utilities such as pairing and terminal helpers.
- `assets/images/` and `assets/terminal/`: app icons and bundled xterm runtime files used by the terminal WebView.
- `server/src/`: local relay server written in TypeScript. Helper scripts live in `server/scripts/`, and relay project metadata lives in `server/projects.json`.

## Build, Test, and Development Commands

- `npm run start`: start the Expo app.
- `npm run ios` / `npm run android` / `npm run web`: launch the app on a target platform.
- `npm run lint`: run Expo ESLint checks for the mobile app.
- `cd server && npm run dev`: start the relay with ngrok fallback.
- `cd server && npm run dev:notunnel`: start the relay in LAN-only mode.
- `cd server && npm run build`: compile the relay to `server/dist/`.
- `cd server && npm run test:client`: run the manual relay client smoke test.

## Coding Style & Naming Conventions

Use TypeScript throughout. Follow the existing style: 2-space indentation, semicolons, single quotes, and trailing commas only where the formatter or existing file already uses them. Prefer:

- PascalCase for React components: `ThemedText`
- camelCase for functions and variables: `parsePairingPayload`
- kebab-case for route files and shared component filenames: `pair-device.tsx`, `themed-view.tsx`

Linting is configured through [`eslint.config.js`](/Users/saif/Documents/zev/eslint.config.js) with `eslint-config-expo`. Keep server output files out of source control; `dist/` is ignored by lint.

## Testing Guidelines

There is not yet a formal unit test suite. For app changes, run `npm run lint` and verify the affected flow in Expo. For relay changes, run `cd server && npm run build` and `cd server && npm run test:client`. Add focused tests or validation scripts when touching protocol, pairing, or session lifecycle logic.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commit-style prefixes with scopes, for example `feat(app): redesign launcher` and `chore(repo): ignore local workspace config`. Keep commits focused and descriptive.

Pull requests should include:

- a short summary of user-visible or protocol-visible changes
- linked issues when applicable
- screenshots or screen recordings for UI updates
- notes about relay setup, environment variables, or manual verification steps
