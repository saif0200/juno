# Zev

Zev is a mobile-first Claude Code client built with Expo and a local Node relay server.

The current architecture is:

- Expo app renders a terminal UI on iOS/Android
- A local WebSocket relay on your Mac launches and manages Claude Code sessions
- The phone connects to the relay and streams the live terminal session

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

Relay server:

- Node.js
- TypeScript
- Express
- ws
- node-pty
- local Claude Code CLI

## How It Works

1. Start the relay server on your Mac.
2. The Expo app connects to the relay over WebSocket.
3. The relay spawns a Claude Code terminal session locally.
4. The app renders terminal output with xterm inside a WebView.
5. Keystrokes and resize events are sent back to the relay.

## Running The Relay

Use Node 20 on macOS for the server.

```bash
cd /Users/saif/Documents/zev/server
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
npm install
npm run dev
```

Expected startup:

```text
Server listening on ws://localhost:3000
✅ Ready to accept connections
```

Health check:

```bash
curl http://localhost:3000/health
```

## Running The Expo App

```bash
cd /Users/saif/Documents/zev
npx expo start -c
```

Open the app in Expo Go or the iOS simulator, then go to the `Terminal` tab.

On a physical phone, use your Mac's LAN IP for the relay URL, for example:

```text
ws://192.168.1.25:3000
```

## Current Status

Implemented:

- local Claude terminal relay
- reconnectable WebSocket sessions
- terminal rendering in the Expo app
- local bundled xterm assets

Not implemented yet:

- authentication
- persistent session storage
- project picker and multi-workspace session creation
- approvals/workflow UI above the raw terminal

## Notes For macOS

`node-pty` may require fixing the bundled macOS helper permissions/signature after install:

```bash
cd /Users/saif/Documents/zev/server
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
codesign --force --sign - node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
find node_modules/node-pty -name "*.node" -exec codesign --force --sign - {} \;
```

## Server Docs

Detailed relay notes live in [server/README.md](/Users/saif/Documents/zev/server/README.md).
