# Juno

Juno is a mobile IDE that pairs your phone to your dev machine. The CLI exposes terminal, filesystem, and pairing capabilities over a WebSocket; the Expo app on your phone is the renderer.

The architecture:

- expo app renders a terminal and file editor on iOS/Android
- a local CLI (`juno`) exposes terminal sessions and filesystem ops over WebSocket
- the phone scans a QR code and connects to the CLI
- sessions bridge through tmux so VS Code and mobile share the same shell

## Quick Start

```bash
# clone + install everything (cli + mobile) and link `juno` globally
git clone https://github.com/juno-dev/juno && cd juno
make install

# in your project root
juno pair          # prints a QR code

# on your phone, open the Juno app and scan
```

## Repository Layout

```
.
├── mobile/                       expo app (workspace, terminal, explorer tabs)
│   ├── app/                      expo router screens
│   ├── components/               mobile-only ui (workspace/, terminal/, explorer/, …)
│   ├── hooks/                    custom hooks (use-workspace-connection, use-file-tree, …)
│   ├── lib/                      mobile modules (terminal-tabs/, pairing, devices, editor)
│   ├── constants/  assets/
│   └── package.json
├── cli/                          juno cli (node + typescript, ships as `juno` binary)
│   ├── bin/juno.js               npm bin entry
│   └── src/
│       ├── cli.ts                argv router (pair / status / stop / doctor / help)
│       ├── server.ts             startServer() — express + ws boot
│       ├── commands/             pair.ts, status.ts, stop.ts, doctor.ts
│       ├── config.ts             env constants + projects path resolution
│       ├── paths.ts              ~/.juno/ helpers (config dir, daemon pid, projects)
│       ├── projects.ts           project loading + discovery
│       ├── pairing.ts            pairing payload + connection candidates
│       ├── dashboard.ts          html dashboard render
│       ├── tmux.ts  pty.ts       session backends
│       ├── sessions.ts           session lifecycle
│       ├── fs-paths.ts           project-rooted path utilities
│       ├── protocol.ts           ws message parse/send
│       ├── ws-router.ts          ws connection routing
│       ├── http-routes.ts        /health /pairing /dashboard
│       ├── startup-banner.ts     boot logging
│       ├── state.ts              shared mutable state (sessions, projects)
│       └── handlers/             per-message handlers (projects, sessions, files, terminal)
├── landing/                      static landing page deployed via vercel
│   ├── index.html
│   └── public/                   device mockup images
├── Makefile                      install / dev / build / lint
└── README.md
```

Each top-level folder is a deployable artifact:

| folder | deploys to |
|---|---|
| `mobile/` | App Store / Play Store / Expo |
| `cli/` | npm registry (`@juno-dev/cli`), Homebrew tap, source install |
| `landing/` | Vercel (set Root Directory to `landing` in project settings) |

## CLI Commands

```
juno pair       Start the relay and print a pairing QR code (default).
juno status     Check whether a juno daemon is running.
juno stop       Stop the running juno daemon.
juno doctor     Diagnose tmux, node, port, config.
juno help       Show usage.
```

The `pair` command runs in the foreground. PID is recorded at `~/.juno/daemon.pid` so `juno status` and `juno stop` work from any other terminal.

## How It Works

1. **start the cli** in your project root - `juno pair`
2. **open the Juno app** - the workspace tab loads first
3. **pair your device** by tapping `+` and scanning the QR code printed in the terminal
4. **select a project** from the workspace screen to open a new terminal session
5. **switch to the terminal tab** to interact with the running session
6. **sessions persist** and reconnect automatically after app restarts or network drops
7. **keystrokes and resize events** are forwarded to the cli in real time

## Installing The CLI

Requirements: node 20+, macOS or Linux, the target shell CLI installed and on PATH.

From source (today):

```bash
git clone https://github.com/juno-dev/juno && cd juno
make install      # installs deps + builds + npm link
juno pair
```

From npm (once published):

```bash
npm install -g @juno-dev/cli
juno pair
```

To run without a globally linked `juno`, use the dev workflow inside `cli/`:

```bash
cd cli
npm install
npm run dev          # tunnel + pair
# or
npm run dev:notunnel # LAN-only
```

## Tunnel Setup

`make cli-dev` (and `cd cli && npm run dev`) tries ngrok first, then falls back to cloudflared, then starts LAN-only if neither is available.

```bash
brew install ngrok        # then: ngrok config add-authtoken <token>
brew install cloudflared
```

The tunnel URL is set as `PUBLIC_URL` and included in the pairing QR code so the phone can reach the cli from outside your local network.

The standalone `juno pair` command does not start a tunnel by itself — set `PUBLIC_URL` manually if you want a public origin in the pairing payload.

## Configuration

The CLI loads `cli/.env` if present (set this when running from source). Variables:

| variable | default | description |
|---|---|---|
| `PORT` | `3000` | relay port |
| `PUBLIC_URL` | - | explicit public origin (set automatically by tunnel scripts) |
| `NGROK_ENABLED` | `true` | set to `false` to skip ngrok in `npm run dev` |
| `NGROK_AUTHTOKEN` | - | override for the ngrok CLI auth token |
| `PAIRING_SERVER_NAME` | hostname | name shown in pairing payloads and dashboard |
| `PROJECTS_CONFIG_PATH` | (resolved, see below) | path to the project catalog |
| `PROJECT_DISCOVERY_ENABLED` | `false` | enable shallow git repo discovery at startup |
| `PROJECT_DISCOVERY_PATHS_JSON` | - | JSON array of parent dirs to scan |
| `PROJECT_DISCOVERY_MAX_DEPTH` | `2` | max depth for discovery scans |
| `TMUX_SESSION_BRIDGE_ENABLED` | `true` | attach relay sessions to shared tmux sessions |
| `TMUX_COMMAND` | `tmux` | tmux binary name or full path |
| `TMUX_SESSION_PREFIX` | `juno` | prefix for shared tmux session names |

`PROJECTS_CONFIG_PATH` resolves in this order:

1. The literal value of `PROJECTS_CONFIG_PATH` if set.
2. `./projects.json` in the current working directory if it exists (handy for repo-local dev).
3. `~/.juno/projects.json` (auto-created on first `juno pair`).

## tmux Bridge

When `TMUX_SESSION_BRIDGE_ENABLED=true` (the default), each project gets a stable shared tmux session named `<prefix>-<project-id>`. Multiple clients - phone, VS Code, another terminal - all attach to the same shell state.

Example: opening project `zev` in the app creates (or reattaches to) the tmux session `juno-zev`. From VS Code's integrated terminal:

```bash
tmux attach-session -t juno-zev
```

To disable tmux bridging and use direct PTY sessions instead:

```
TMUX_SESSION_BRIDGE_ENABLED=false
```

If tmux is installed somewhere outside your shell PATH (common when the cli is spawned as a child process), set the full path:

```
TMUX_COMMAND=/opt/homebrew/bin/tmux
```

## Projects

The CLI reads projects from `~/.juno/projects.json` (or `./projects.json` if you have one in the current working directory). Add your repos there:

```json
{
  "projects": [
    {
      "id": "myapp",
      "name": "My App",
      "path": "/Users/you/code/myapp",
      "favorite": true
    }
  ]
}
```

`id` and `name` are optional - the cli derives stable values from the path when omitted. `path` is required.

To also discover git repos automatically, enable discovery in the same file:

```json
{
  "discovery": {
    "enabled": true,
    "paths": ["/Users/you/code"],
    "maxDepth": 2
  }
}
```

## Running The Expo App

```bash
cd mobile
npx expo start -c
```

Open in Expo Go or the iOS simulator. The workspace tab is the entry point - pair a relay there, then use the terminal and explorer tabs.

On a physical device, either scan the QR code from the cli or enter the LAN IP directly (`ws://192.168.x.x:3000`).

## QR Pairing

The app accepts any of these as a QR payload:

- raw JSON pairing object
- a `juno://pair?...` deep link with payload fields
- an `http://` or `https://` URL that returns the pairing JSON

Pairing JSON shape:

```json
{
  "name": "My MacBook",
  "wsUrl": "ws://192.168.1.25:3000",
  "httpUrl": "http://192.168.1.25:3000",
  "token": "optional-token",
  "capabilities": ["projects", "sessions"]
}
```

`name` and `wsUrl` are required. The rest are optional and stored locally with the device.

## Current Status

working:

- `juno pair` / `juno status` / `juno stop` / `juno doctor`
- local terminal relay with configurable projects
- reconnectable websocket sessions with automatic resume
- terminal rendering with xterm.js
- terminal tabs with independent sessions per project
- session persistence across app restarts and network interruptions
- project picker with config-based and discovered projects
- QR-based device pairing with mDNS discovery
- tmux session bridging for cross-device continuity
- file explorer and in-app editor

not yet:

- npm publish for `@juno-dev/cli`
- Homebrew formula
- Auth / security policies
- Cloud sync for sessions and devices
- Daemonized `juno pair --background`

## Notes for macOS

`node-pty` may need its bundled helper to be re-signed after `npm install`:

```bash
cd cli
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
codesign --force --sign - node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
find node_modules/node-pty -name "*.node" -exec codesign --force --sign - {} \;
```
