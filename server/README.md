# Claude PTY Relay Server

TypeScript relay server for exposing native Claude Code terminal sessions over WebSocket, with local-network pairing for the mobile app.

## Setup

```bash
cd server
cp .env.example .env
npm install
```

Requirements:

- Node 22
- the `claude` CLI installed and authenticated locally

The default relay port is `3001`.

## Run

Start the relay with ngrok fallback:

```bash
npm run dev
```

Start LAN-only mode if you do not want ngrok:

```bash
npm run dev:notunnel
```

Expected startup logs look like this:

```text
🖥️  Host: darwin 25.x.x
📁 Projects: 1 configured, 0 discovered
📡 Server: your-mac-hostname.local (your-mac-hostname-3001)
🌐 Local:   http://localhost:3001/dashboard
📱 mDNS:    http://your-mac-hostname.local:3001/pairing
📱 LAN IP:  http://192.168.1.25:3001/pairing
✅ Ready to accept connections
```

## Configuration

Copy [.env.example](.env.example) to `.env` and set only what you need.

Useful variables:

- `PORT`: relay port, defaults to `3001`
- `PUBLIC_URL`: explicit public origin when running behind a tunnel or reverse proxy
- `NGROK_ENABLED`: set to `false` to skip ngrok in `npm run dev`
- `NGROK_AUTHTOKEN`: optional override for the ngrok CLI token
- `PAIRING_SERVER_NAME`: override the server name shown in pairing payloads and logs
- `PROJECTS_CONFIG_PATH`: path to the project catalog, defaults to `./projects.json`
- `PROJECT_DISCOVERY_ENABLED`: enable shallow git repo discovery
- `PROJECT_DISCOVERY_PATHS_JSON`: JSON array of parent directories to scan
- `PROJECT_DISCOVERY_MAX_DEPTH`: maximum depth for discovery scans
- `TMUX_SESSION_BRIDGE_ENABLED`: defaults to `true`; when enabled, relay sessions attach to shared tmux sessions for cross-device continuity
- `TMUX_COMMAND`: tmux binary name/path, defaults to `tmux`
- `TMUX_SESSION_PREFIX`: shared tmux session prefix, defaults to `juno`

### VS Code + Mobile Continuity

With `TMUX_SESSION_BRIDGE_ENABLED=true`, each project uses a stable shared tmux session name:

```text
<TMUX_SESSION_PREFIX>-<project-id>
```

Examples:

- mobile creates/attaches relay session for project `zev` -> tmux session `juno-zev`
- VS Code terminal can attach to the same shell state with:

```bash
tmux attach-session -t juno-zev
```

## Projects

The relay reads explicit projects from [projects.json](projects.json) and can optionally discover git repos under a small set of parent directories.

Recommended project config:

```json
{
  "projects": [
    {
      "id": "juno",
      "name": "Juno",
      "path": "..",
      "favorite": true
    }
  ],
  "discovery": {
    "enabled": false,
    "paths": [".."],
    "maxDepth": 2
  }
}
```

Notes:

- `projects[*].path` is required.
- `id` and `name` are optional; the server derives stable values when omitted.
- Explicit config wins over discovery when both point at the same path.
- Discovery is shallow and synchronous at startup.

## Pairing

The mobile app should open the HTTP pairing URL first, then connect to the preferred WebSocket URL it receives.

Local pairing endpoints:

- `GET /health`
- `GET /pairing`
- `GET /dashboard`

QR payloads can be either:

- raw JSON
- a `juno://pair?...` URL
- an HTTP(S) endpoint that returns the pairing JSON

The pairing JSON includes:

- a preferred WebSocket URL
- fallback LAN candidates
- project metadata for the launcher UI
- a QR-friendly HTTP pairing URL

## WebSocket Protocol

Client to server:

- `list_projects`
- `list_sessions`
- `create_session`
- `resume_session`
- `terminal_input`
- `terminal_resize`
- `ping`
- `kill_session`

Server to client:

- `projects_list`
- `sessions_list`
- `session_created`
- `session_resumed`
- `terminal_output`
- `terminal_snapshot`
- `terminal_exit`
- `pong`
- `error`

## Session Flow

1. Open the pairing URL on the phone or scan the QR code from the dashboard.
2. Save the relay device in the app, or enter the WebSocket URL manually.
3. Request `list_projects` and `list_sessions` from the relay.
4. Choose a project and send `create_session`.
5. Reconnect with `resume_session` if the app is reopened before the session expires.

## Project Selection

`list_projects` returns a stable catalog for the mobile client. Each project includes:

- `id`
- `name`
- `path`
- `source`: `config` or `discovered`
- `isFavorite`
- `available`

Configured projects are returned first in file order. Discovered projects follow, sorted by name and path.

## Notes

- Sessions are memory-only and disappear on process restart.
- The relay is local-network-first. There is no cloud service or auth layer yet.
- `npm run dev` will try ngrok first and fall back to LAN-only mode if ngrok fails.

`create_session` still takes only a `projectId`, but the relay now launches Claude with that project's directory as both PTY `cwd` and shell `cd` target.

## Endpoints

### `GET /health`

Basic health and runtime metadata:

```bash
curl http://localhost:3001/health
```

### `GET /pairing`

Returns a local-network pairing document that the mobile app can fetch before opening a WebSocket.

```bash
curl http://localhost:3001/pairing
```

Response shape:

```json
{
  "schema": "juno-relay-pairing.v1",
  "generatedAt": "2026-04-10T18:30:00.000Z",
  "serverId": "your-mac-hostname-3001",
  "serverName": "your-mac-hostname",
  "relayVersion": 1,
  "transport": {
    "port": 3001,
    "websocketPath": "/",
    "pairingPath": "/pairing",
    "dashboardPath": "/dashboard",
    "healthPath": "/health",
    "manualWebSocketEntrySupported": true
  },
  "connection": {
    "preferred": {
      "interfaceName": "en0",
      "family": "IPv4",
      "address": "192.168.1.25",
      "isInternal": false,
      "isPreferred": true,
      "httpBaseUrl": "http://192.168.1.25:3001",
      "wsBaseUrl": "ws://192.168.1.25:3001",
      "pairingUrl": "http://192.168.1.25:3001/pairing",
      "dashboardUrl": "http://192.168.1.25:3001/dashboard",
      "healthUrl": "http://192.168.1.25:3001/health",
      "wsUrl": "ws://192.168.1.25:3001"
    },
    "candidates": []
  },
  "projects": [
    {
      "id": "juno",
      "name": "Juno"
    }
  ],
  "capabilities": {
    "sessionReconnect": true,
    "projectListing": true,
    "pairingDashboard": true
  },
  "qr": {
    "format": "pairing_url",
    "value": "http://192.168.1.10:3000/pairing"
  }
}
```

Notes:

- `connection.preferred` is the target the mobile app should use first.
- `connection.candidates` contains additional reachable addresses, including manual or loopback fallbacks.
- `qr.value` is the QR-friendly payload to encode. It is intentionally a plain HTTP URL, not a raw WebSocket URL, so the phone can discover metadata first.
- `manualWebSocketEntrySupported` stays `true` so the old direct `ws://...` flow remains valid.

### `GET /dashboard`

Human-readable HTML page for the Mac side. It shows:

- the QR-friendly pairing URL to encode or copy
- the preferred WebSocket fallback URL
- all detected network candidates
- the full pairing payload for debugging

This is useful when you want a simple local page to pair from without manually constructing URLs.

## Pairing Flow

Recommended mobile flow:

1. The phone and Mac are on the same local network.
2. The Mac shows or encodes the `qr.value` from `/pairing`, or opens `/dashboard`.
3. The phone fetches `GET /pairing` from that URL.
4. The mobile client reads `connection.preferred.wsUrl`.
5. The mobile client opens that WebSocket and continues using the existing relay protocol.
6. If the preferred address fails, the client can try the other `connection.candidates`.
7. As a fallback, the app can still allow manual `ws://host:port` entry.

This keeps discovery HTTP-based while leaving the PTY relay itself unchanged.

## WebSocket Protocol

Client to server:

- `list_projects`
- `list_sessions`
- `create_session`
- `terminal_input`
- `terminal_resize`
- `resume_session`
- `ping`
- `kill_session`

Server to client:

- `projects_list`
- `sessions_list`
- `session_created`
- `session_resumed`
- `terminal_output`
- `terminal_snapshot`
- `terminal_exit`
- `pong`
- `error`

## Message Schema Notes

Project metadata is now included consistently so the mobile app can label sessions without extra lookups.

`projects_list` example:

```json
{
  "type": "projects_list",
  "projects": [
    {
      "id": "juno",
      "name": "Juno",
      "path": "..",
      "source": "config",
      "isFavorite": true,
      "available": true
    }
  ]
}
```

`session_created`, `session_resumed`, and each entry in `sessions_list.sessions` include:

- `projectId`
- `projectName`
- `projectPath`
- `projectSource`

## WebSocket Example

Connect:

```bash
wscat -c ws://localhost:3000
```

List projects:

```json
{
  "type": "list_projects"
}
```

Create a session:

```json
{
  "type": "create_session",
  "projectId": "juno"
}
```

Example `sessions_list` payload:

```json
{
  "type": "sessions_list",
  "sessions": [
    {
      "sessionId": "session-...",
      "projectId": "juno",
      "projectName": "Juno",
      "projectPath": "/path/to/juno",
      "projectSource": "config",
      "createdAt": "2026-04-10T18:30:00.000Z",
      "updatedAt": "2026-04-10T18:35:00.000Z",
      "expiresAt": "2026-04-10T18:40:00.000Z",
      "hasActiveProcess": true
    }
  ]
}
```

Write input into the running terminal:

```json
{
  "type": "terminal_input",
  "data": "hello\n"
}
```

You will receive raw output chunks:

```json
{
  "type": "terminal_output",
  "sessionId": "session-...",
  "data": "\u001b[?2004h..."
}
```

## Local Test Client

You can test the relay from another terminal without `wscat`:

```bash
cd server
npm run test:client
```

Optional one-shot input on connect:

```bash
INITIAL_INPUT="hello\n" npm run test:client
```

While connected:

- type normally to send keystrokes to Claude
- press `Ctrl+\` to disconnect the test client

## Reconnect

- Reconnect with `ws://localhost:3000?sessionId=session-...` before TTL expiry.
- Or send `{"type":"resume_session","sessionId":"session-..."}` on a new socket.
- On resume the server sends `session_resumed` and then `terminal_snapshot` with buffered scrollback.
- If the PTY already exited, the server also sends `terminal_exit`.

## Session Workflow

1. Discover the relay through `/pairing` or connect manually.
2. Request `list_projects`.
3. Send `create_session` with a `projectId`.
4. Attach the returned session to a terminal UI.
5. Optionally request `list_sessions` later to resume an existing session.

## Notes

- Sessions are memory-only and disappear on process restart.
- Discovery is local-network-first. There is no cloud service and no auth layer yet.
- The mobile client must render ANSI terminal output correctly if you want it to feel native.
- This relay forwards the real Claude terminal stream rather than translating it into structured AI events.
