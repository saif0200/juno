# Juno

Juno is a mobile-first Claude Code client built with Expo and a local Node relay server.

The current architecture is:

- Expo app renders a terminal UI on iOS/Android
- A local WebSocket relay on your Mac launches and manages Claude Code sessions
- The phone connects to the relay and streams the live terminal session
- Sessions can bridge through tmux, so VS Code and mobile can attach to the same active shell

## Repository Layout

```text
.
├── app/                    Expo Router app
├── assets/terminal/        Bundled xterm runtime assets for the WebView terminal
├── server/                 Local Claude relay server
└── README.md
```

## Tech Stack

Mobile app:

- Expo
- React Native
- Expo Router
- react-native-webview
- xterm.js rendered inside a WebView
- Terminal tabs and session management

Relay server:

- Node.js (22+)
- TypeScript
- Express
- ws (WebSocket)
- node-pty
- local Claude Code CLI
- mDNS discovery and QR-based pairing
- Project configuration and discovery
- tmux session bridging

## How It Works

1. **Start the relay server** on your Mac with `npm run dev` in the `server/` directory.
2. **Open the Expo app** and navigate to the terminal screen.
3. **Pair your device** by scanning the QR code from the relay dashboard, or enter the relay URL manually.
4. **Select or create a project** from the project picker.
5. **Create a new terminal tab** to spawn a new Claude Code session.
6. **The app manages tabs** with independent sessions, each with full terminal emulation.
7. **Sessions persist** and can be resumed later, even after app restarts.
8. **Keystrokes and resize events** are sent to the relay in real-time.

Each terminal tab runs a separate Claude Code instance in its own PTY process on the Mac. Sessions use a stable TTL, so reopening the app can reconnect to the same session before it expires.

## Running The Relay

Use Node 22+ on macOS for the server.

```bash
cd server
npm install
npm run dev
```

Expected startup:

```text
🖥️  Host: darwin 25.x.x
📁 Projects: 1 configured, 0 discovered
📡 Server: your-mac-hostname.local (your-mac-hostname-3001)
🌐 Local:   http://localhost:3001/dashboard
📱 mDNS:    http://your-mac-hostname.local:3001/pairing
📱 LAN IP:  http://192.168.1.25:3001/pairing
✅ Ready to accept connections
```

The relay provides:

- **WebSocket relay** on `/` for terminal sessions
- **Pairing endpoint** on `/pairing` with project metadata and network candidates
- **Dashboard** on `/dashboard` for QR code and pairing info
- **Health check** on `/health`

See [server/README.md](server/README.md) for detailed configuration options.

## Running The Expo App

```bash
npx expo start -c
```

Open the app in Expo Go or the iOS simulator, then navigate to the terminal screen.

The app supports multiple terminal tabs with independent sessions, and sessions are persisted locally. You can:

- Create new terminal tabs within a project
- Resume previous sessions
- Switch between saved devices via QR pairing

On a physical phone, use your Mac's LAN IP for the relay URL, or scan the pairing QR code from the relay dashboard.

## QR Pairing Format

The Expo app accepts any of these QR contents:

- raw JSON payload
- a `juno://pair?...` URL with payload fields or an encoded `payload`
- an `http://` or `https://` pairing endpoint URL that returns JSON

Expected payload shape:

```json
{
  "name": "Juno MacBook Pro",
  "wsUrl": "ws://<your-lan-ip>:3001",
  "httpUrl": "http://<your-lan-ip>:3001",
  "token": "optional-local-token",
  "capabilities": ["projects", "sessions"]
}
```

Notes:

- `name` and `wsUrl` are required by the app.
- `httpUrl`, `token`, and `capabilities` are optional and are stored locally with the saved device.
- If a token is present, the app currently appends it to the WebSocket URL as the `token` query param when connecting.
- If the QR contains an HTTP(S) endpoint instead of the payload directly, the app assumes that endpoint returns the JSON shape above.

## Current Status

Implemented:

- **Local Claude terminal relay** with configurable projects
- **Reconnectable WebSocket sessions** with automatic resume
- **Terminal rendering** in the Expo app with xterm.js
- **Terminal tabs** for managing multiple sessions per project
- **Session persistence** across app restarts and network interruptions
- **Project picker** with configuration and discovery
- **Multi-workspace session creation** with per-project isolation
- **QR-based device pairing** with automatic discovery
- **Locally persisted devices and session state**
- **tmux session bridging** for cross-device continuity (Mac/mobile/VS Code)

Not implemented yet:

- authentication and security policies
- cloud sync for sessions and devices
- approvals/workflow UI above the raw terminal

## Notes For macOS

`node-pty` may require fixing the bundled macOS helper permissions/signature after install:

```bash
cd server
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
codesign --force --sign - node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
find node_modules/node-pty -name "*.node" -exec codesign --force --sign - {} \;
```

## Server Docs

Detailed relay notes live in [server/README.md](server/README.md).
