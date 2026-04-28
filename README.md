# Juno

Juno is a mobile IDE client built with Expo. A lightweight Node relay server on your Mac exposes local terminal sessions over WebSocket so the phone app can connect, run commands, and edit files in real time.

The architecture:

- expo app renders a terminal and file editor on iOS/Android
- a local websocket relay on your mac launches and manages terminal sessions
- the phone connects to the relay and streams the live terminal output
- sessions bridge through tmux so VS Code and mobile share the same active shell

## Repository Layout

```
.
├── mobile/                 expo app (workspace, terminal, explorer tabs)
│   ├── app/                expo router screens
│   ├── components/         mobile-only ui components
│   ├── lib/                mobile-only modules (terminal, editor, pairing, devices)
│   ├── hooks/  constants/  assets/
│   └── package.json
├── server/                 local relay server (node + typescript)
├── landing/                static landing page deployed via vercel
│   ├── index.html
│   └── public/             device mockup images
└── README.md
```

Each top-level folder is a deployable artifact:

| folder | deploys to |
|---|---|
| `mobile/` | App Store / Play Store / Expo |
| `server/` | host machine (Mac) or container |
| `landing/` | Vercel (set Root Directory to `landing` in project settings) |

## Tech Stack

mobile app:
- expo + react native + expo router
- react-native-webview
- xterm.js rendered inside a webview
- terminal tabs and session management

relay server:
- node.js 22+, typescript
- express, ws, node-pty
- mDNS discovery and QR-based pairing
- tmux session bridging
- ngrok / cloudflared tunnel support

## How It Works

1. **start the relay** on your mac — `cd server && npm run dev`
2. **open the expo app** — the workspace tab loads first
3. **pair your device** by tapping `+` and scanning the QR code from the relay dashboard
4. **select a project** from the workspace screen to open a new terminal session
5. **switch to the terminal tab** to interact with the running session
6. **sessions persist** and reconnect automatically after app restarts or network drops
7. **keystrokes and resize events** are forwarded to the relay in real time

## Running The Relay

Requirements: node 22+, macOS, the target CLI installed and on your PATH.

```bash
cd server
cp .env.example .env   # only needed once
npm install
npm run dev
```

Expected startup output:

```
🖥️  Host: darwin 25.x.x
📁 Projects: 1 configured, 0 discovered
📡 Server: your-mac.local (your-mac-3001)
🧩 Session bridge: tmux (/opt/homebrew/bin/tmux)
🌐 Local:   http://localhost:3001/dashboard
📱 mDNS:    http://your-mac.local:3001/pairing
📱 LAN IP:  http://192.168.1.25:3001/pairing
✅ Ready to accept connections
```

`npm run dev` tries to start a public tunnel automatically. To skip tunneling and stay LAN-only:

```bash
npm run dev:notunnel
```

## Tunnel Setup

`npm run dev` tries ngrok first, then falls back to cloudflared, then starts LAN-only if neither is available.

Install one of them:

```bash
brew install ngrok        # then: ngrok config add-authtoken <token>
brew install cloudflared
```

The tunnel URL is set as `PUBLIC_URL` and included in the pairing QR code so the phone can reach the relay from outside your local network.

## Configuration

Copy `server/.env.example` to `server/.env` and set what you need.

| variable | default | description |
|---|---|---|
| `PORT` | `3001` | relay port |
| `PUBLIC_URL` | — | explicit public origin (set automatically by tunnel scripts) |
| `NGROK_ENABLED` | `true` | set to `false` to skip ngrok in `npm run dev` |
| `NGROK_AUTHTOKEN` | — | override for the ngrok CLI auth token |
| `PAIRING_SERVER_NAME` | hostname | name shown in pairing payloads and dashboard |
| `PROJECTS_CONFIG_PATH` | `./projects.json` | path to the project catalog |
| `PROJECT_DISCOVERY_ENABLED` | `false` | enable shallow git repo discovery at startup |
| `PROJECT_DISCOVERY_PATHS_JSON` | — | JSON array of parent dirs to scan |
| `PROJECT_DISCOVERY_MAX_DEPTH` | `2` | max depth for discovery scans |
| `TMUX_SESSION_BRIDGE_ENABLED` | `true` | attach relay sessions to shared tmux sessions |
| `TMUX_COMMAND` | `tmux` | tmux binary name or full path |
| `TMUX_SESSION_PREFIX` | `juno` | prefix for shared tmux session names |

## tmux Bridge

When `TMUX_SESSION_BRIDGE_ENABLED=true` (the default), each project gets a stable shared tmux session named `<prefix>-<project-id>`. Multiple clients — phone, VS Code, another terminal — all attach to the same shell state.

Example: opening project `zev` in the app creates (or reattaches to) the tmux session `juno-zev`. From VS Code's integrated terminal:

```bash
tmux attach-session -t juno-zev
```

To disable tmux bridging and use direct PTY sessions instead:

```
TMUX_SESSION_BRIDGE_ENABLED=false
```

If tmux is installed somewhere outside your shell PATH (common when the server is spawned as a child process), set the full path:

```
TMUX_COMMAND=/opt/homebrew/bin/tmux
```

## Projects

The relay reads projects from `server/projects.json`. Add your repos there:

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

`id` and `name` are optional — the server derives stable values from the path when omitted. `path` is required.

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

Open in Expo Go or the iOS simulator. The workspace tab is the entry point — pair a relay there, then use the terminal and explorer tabs.

On a physical device, either scan the QR code from the relay dashboard or enter the LAN IP directly (`ws://192.168.x.x:3001`).

## QR Pairing

The app accepts any of these as a QR payload:

- raw JSON pairing object
- a `juno://pair?...` deep link with payload fields
- an `http://` or `https://` URL that returns the pairing JSON

Pairing JSON shape:

```json
{
  "name": "My MacBook",
  "wsUrl": "ws://192.168.1.25:3001",
  "httpUrl": "http://192.168.1.25:3001",
  "token": "optional-token",
  "capabilities": ["projects", "sessions"]
}
```

`name` and `wsUrl` are required. The rest are optional and stored locally with the device.

## Current Status

working:
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
- auth / security policies
- cloud sync for sessions and devices

## Notes for macOS

`node-pty` may need its bundled helper to be re-signed after `npm install`:

```bash
cd server
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
codesign --force --sign - node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
find node_modules/node-pty -name "*.node" -exec codesign --force --sign - {} \;
```
