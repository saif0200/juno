# Claude PTY Relay Server

TypeScript WebSocket relay server for exposing a native Claude Code terminal session over WebSocket.

## Features

- Express health endpoint and `ws` WebSocket server
- `node-pty` sessions running the real `claude` CLI
- In-memory session storage with TTL-based reconnect support
- Raw terminal input/output relay for a native Claude Code experience
- Scrollback snapshot replay on reconnect
- Strict TypeScript types with no `any`
- Console logging for connection, PTY, and error events

## File Structure

```text
server/
├── src/
│   ├── index.ts
│   └── types.ts
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── tsconfig.json
```

## Setup

```bash
cd server
cp .env.example .env
npm install
```

Make sure the `claude` CLI is installed and already authenticated on your machine.
Use Node 22 for this project. An `.nvmrc` file is included with `22.22.2`.

## Run

```bash
npm run dev
```

Expected startup logs:

```text
🖥️ Host platform: darwin 25.0.0
Server listening on ws://localhost:3000
✅ Ready to accept connections
```

## Protocol

Client to server:

- `terminal_input`
- `terminal_resize`
- `resume_session`
- `ping`
- `kill_session`

Server to client:

- `session_created`
- `session_resumed`
- `terminal_output`
- `terminal_snapshot`
- `terminal_exit`
- `pong`
- `error`

## Example

Connect:

```bash
wscat -c ws://localhost:3000
```

You will receive:

```json
{
  "type": "session_created",
  "sessionId": "session-...",
  "expiresAt": "2026-04-10T00:00:00.000Z",
  "cols": 120,
  "rows": 40,
  "command": "claude"
}
```

Write input into the real Claude terminal:

```json
{
  "type": "terminal_input",
  "data": "hello\n"
}
```

Resize the PTY:

```json
{
  "type": "terminal_resize",
  "cols": 132,
  "rows": 43
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

## Health Check

```bash
curl http://localhost:3000/health
```

## Notes

- Sessions are memory-only and disappear on process restart.
- The mobile client must render ANSI terminal output correctly if you want it to feel native.
- This relay forwards the real Claude terminal stream rather than translating it into structured AI events.
