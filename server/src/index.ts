import 'dotenv/config';

import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import express from 'express';
import { createServer } from 'http';
import * as pty from 'node-pty';
import os from 'os';
import WebSocket, { WebSocketServer } from 'ws';

import type {
  ClientMessage,
  ErrorMessage,
  KillSessionMessage,
  PingMessage,
  ResumeSessionMessage,
  ServerMessage,
  SessionCreatedMessage,
  SessionRecord,
  SessionResumedMessage,
  TerminalInputMessage,
  TerminalResizeMessage,
} from './types';

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const SESSION_TTL_MS = Number.parseInt(process.env.SESSION_TTL_MS ?? '300000', 10);
const CLEANUP_INTERVAL_MS = Number.parseInt(
  process.env.SESSION_CLEANUP_INTERVAL_MS ?? '30000',
  10,
);
const DEFAULT_COLS = Number.parseInt(process.env.DEFAULT_TERMINAL_COLS ?? '120', 10);
const DEFAULT_ROWS = Number.parseInt(process.env.DEFAULT_TERMINAL_ROWS ?? '40', 10);
const OUTPUT_BUFFER_LIMIT = Number.parseInt(process.env.OUTPUT_BUFFER_LIMIT ?? '200000', 10);
const CLAUDE_COMMAND = resolveClaudeCommand(process.env.CLAUDE_COMMAND ?? 'claude');
const CLAUDE_ARGS = parseCommandArgs(process.env.CLAUDE_ARGS_JSON);
const SHELL = process.env.SHELL ?? '/bin/zsh';

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });
const sessions = new Map<string, SessionRecord>();

app.get('/health', (_request, response) => {
  response.json({
    status: 'ok',
    command: CLAUDE_COMMAND,
    args: CLAUDE_ARGS,
    activeSessions: sessions.size,
  });
});

function parseCommandArgs(rawValue: string | undefined): string[] {
  if (!rawValue || rawValue.trim().length === 0) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) {
      return parsed;
    }
  } catch {
    console.warn('⚠️ CLAUDE_ARGS_JSON is not valid JSON. Falling back to no extra args.');
  }

  return [];
}

function resolveClaudeCommand(command: string): string {
  if (command.includes('/')) {
    return command;
  }

  try {
    const resolved = execFileSync('which', [command], {
      encoding: 'utf8',
    }).trim();
    if (resolved.length > 0) {
      return resolved;
    }
  } catch {
    console.warn(`⚠️ Could not resolve ${command} with 'which'. Using raw command name.`);
  }

  return command;
}

function now(): number {
  return Date.now();
}

function trimBuffer(value: string): string {
  if (value.length <= OUTPUT_BUFFER_LIMIT) {
    return value;
  }

  return value.slice(value.length - OUTPUT_BUFFER_LIMIT);
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sendMessage(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(message));
}

function sendError(socket: WebSocket, error: ErrorMessage): void {
  console.error(`❌ ${error.code}: ${error.message}`);
  sendMessage(socket, error);
}

function createTerminalExitMessage(
  sessionId: string,
  exitCode: number,
  signal: number | null,
): ServerMessage {
  if (signal === null || signal === 0) {
    return {
      type: 'terminal_exit',
      sessionId,
      exitCode,
    };
  }

  return {
    type: 'terminal_exit',
    sessionId,
    exitCode,
    signal,
  };
}

function refreshSession(session: SessionRecord): void {
  session.updatedAt = now();
  session.expiresAt = session.updatedAt + SESSION_TTL_MS;
}

function spawnClaudePty(sessionId: string, cols: number, rows: number): pty.IPty {
  const commandLine = [CLAUDE_COMMAND, ...CLAUDE_ARGS].map(shellEscape).join(' ');
  console.log(`🤖 Spawning Claude PTY for ${sessionId}: ${commandLine}`);

  return pty.spawn(SHELL, ['-lc', `exec ${commandLine}`], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.cwd(),
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  });
}

function createSession(socket: WebSocket): SessionRecord {
  const id = `session-${randomUUID()}`;
  const createdAt = now();
  const processPty = spawnClaudePty(id, DEFAULT_COLS, DEFAULT_ROWS);

  const session: SessionRecord = {
    id,
    socket,
    pty: processPty,
    outputBuffer: '',
    createdAt,
    updatedAt: createdAt,
    expiresAt: createdAt + SESSION_TTL_MS,
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    hasExited: false,
    exitCode: null,
    signal: null,
  };

  processPty.onData((data: string) => {
    session.outputBuffer = trimBuffer(session.outputBuffer + data);
    refreshSession(session);

    if (session.socket && session.socket.readyState === WebSocket.OPEN) {
      sendMessage(session.socket, {
        type: 'terminal_output',
        sessionId: session.id,
        data,
      });
    }
  });

  processPty.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    session.hasExited = true;
    session.exitCode = exitCode;
    session.signal = signal ?? null;
    refreshSession(session);
    console.log(`🤖 Claude PTY exited for ${session.id}: code=${exitCode}, signal=${signal ?? 0}`);

    if (session.socket && session.socket.readyState === WebSocket.OPEN) {
      sendMessage(
        session.socket,
        createTerminalExitMessage(session.id, exitCode, signal ?? null),
      );
    }
  });

  sessions.set(id, session);
  return session;
}

function attachSocket(session: SessionRecord, socket: WebSocket): void {
  session.socket = socket;
  refreshSession(session);
}

function detachSocket(sessionId: string, socket: WebSocket): void {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }

  if (session.socket === socket) {
    session.socket = null;
    refreshSession(session);
  }
}

function cleanupExpiredSessions(): void {
  const timestamp = now();
  for (const [sessionId, session] of sessions.entries()) {
    if (session.expiresAt > timestamp) {
      continue;
    }

    console.log(`🧹 Session expired: ${sessionId}`);
    if (session.socket && session.socket.readyState === WebSocket.OPEN) {
      session.socket.close(4000, 'Session expired');
    }
    if (!session.hasExited) {
      session.pty.kill();
    }
    sessions.delete(sessionId);
  }
}

function resolveSessionIdFromRequest(requestUrl: string | undefined): string | null {
  if (!requestUrl) {
    return null;
  }

  const parsedUrl = new URL(requestUrl, `http://localhost:${PORT}`);
  const sessionId = parsedUrl.searchParams.get('sessionId');
  return sessionId && sessionId.length > 0 ? sessionId : null;
}

function parseMessage(raw: WebSocket.RawData): ClientMessage | null {
  const parsed: unknown = JSON.parse(raw.toString());
  if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;

  if (candidate.type === 'terminal_input' && typeof candidate.data === 'string') {
    return { type: 'terminal_input', data: candidate.data };
  }

  if (
    candidate.type === 'terminal_resize' &&
    typeof candidate.cols === 'number' &&
    typeof candidate.rows === 'number' &&
    Number.isInteger(candidate.cols) &&
    Number.isInteger(candidate.rows) &&
    candidate.cols > 0 &&
    candidate.rows > 0
  ) {
    return {
      type: 'terminal_resize',
      cols: candidate.cols,
      rows: candidate.rows,
    };
  }

  if (candidate.type === 'resume_session' && typeof candidate.sessionId === 'string') {
    return {
      type: 'resume_session',
      sessionId: candidate.sessionId,
    };
  }

  if (candidate.type === 'ping') {
    return { type: 'ping' };
  }

  if (candidate.type === 'kill_session') {
    return { type: 'kill_session' };
  }

  return null;
}

function sendSnapshot(socket: WebSocket, session: SessionRecord): void {
  sendMessage(socket, {
    type: 'terminal_snapshot',
    sessionId: session.id,
    data: session.outputBuffer,
  });

  if (session.hasExited && session.exitCode !== null) {
    sendMessage(socket, createTerminalExitMessage(session.id, session.exitCode, session.signal));
  }
}

function handleResumeSession(socket: WebSocket, message: ResumeSessionMessage): SessionRecord | null {
  const existingSession = sessions.get(message.sessionId);
  if (!existingSession) {
    sendError(socket, {
      type: 'error',
      code: 'SESSION_NOT_FOUND',
      message: `Session not found: ${message.sessionId}`,
    });
    return null;
  }

  attachSocket(existingSession, socket);
  console.log(`🔄 Session resumed: ${existingSession.id}`);

  const payload: SessionResumedMessage = {
    type: 'session_resumed',
    sessionId: existingSession.id,
    expiresAt: new Date(existingSession.expiresAt).toISOString(),
    cols: existingSession.cols,
    rows: existingSession.rows,
    hasActiveProcess: !existingSession.hasExited,
  };
  sendMessage(socket, payload);
  sendSnapshot(socket, existingSession);
  return existingSession;
}

function handlePing(socket: WebSocket, session: SessionRecord, _message: PingMessage): void {
  refreshSession(session);
  sendMessage(socket, {
    type: 'pong',
    sessionId: session.id,
    expiresAt: new Date(session.expiresAt).toISOString(),
  });
}

function handleTerminalInput(session: SessionRecord, message: TerminalInputMessage): void {
  if (session.hasExited) {
    console.warn(`⚠️ Ignoring input for exited session ${session.id}`);
    return;
  }

  session.pty.write(message.data);
  refreshSession(session);
  console.log(`⌨️ Input written to ${session.id}: ${JSON.stringify(message.data)}`);
}

function handleTerminalResize(session: SessionRecord, message: TerminalResizeMessage): void {
  session.cols = message.cols;
  session.rows = message.rows;
  refreshSession(session);

  if (!session.hasExited) {
    session.pty.resize(message.cols, message.rows);
  }

  console.log(`📐 Resized ${session.id} to ${message.cols}x${message.rows}`);
}

function handleKillSession(socket: WebSocket, session: SessionRecord, _message: KillSessionMessage): void {
  console.log(`🛑 Kill requested for ${session.id}`);

  if (!session.hasExited) {
    session.pty.kill();
  }

  sessions.delete(session.id);
  sendMessage(socket, createTerminalExitMessage(session.id, session.exitCode ?? 0, session.signal));
}

setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL_MS);

wss.on('connection', (socket, request) => {
  const requestedSessionId = resolveSessionIdFromRequest(request.url);
  const existingSession = requestedSessionId ? sessions.get(requestedSessionId) ?? null : null;
  let session: SessionRecord;

  try {
    session = existingSession ?? createSession(socket);
  } catch (error: unknown) {
    const messageText =
      error instanceof Error ? error.message : 'Failed to create terminal session.';
    console.error(`❌ PTY startup failed: ${messageText}`);
    sendError(socket, {
      type: 'error',
      code: 'PTY_ERROR',
      message: messageText,
    });
    socket.close(1011, 'PTY startup failed');
    return;
  }

  attachSocket(session, socket);

  if (existingSession) {
    console.log(`✅ Client reconnected: ${session.id}`);
    const payload: SessionResumedMessage = {
      type: 'session_resumed',
      sessionId: session.id,
      expiresAt: new Date(session.expiresAt).toISOString(),
      cols: session.cols,
      rows: session.rows,
      hasActiveProcess: !session.hasExited,
    };
    sendMessage(socket, payload);
    sendSnapshot(socket, session);
  } else {
    console.log(`✅ New client connected: ${session.id}`);
    const payload: SessionCreatedMessage = {
      type: 'session_created',
      sessionId: session.id,
      expiresAt: new Date(session.expiresAt).toISOString(),
      cols: session.cols,
      rows: session.rows,
      command: [CLAUDE_COMMAND, ...CLAUDE_ARGS].join(' ').trim(),
    };
    sendMessage(socket, payload);
  }

  socket.on('message', (raw) => {
    console.log(`📩 Raw message from ${session.id}: ${raw.toString()}`);

    try {
      const message = parseMessage(raw);
      if (!message) {
        sendError(socket, {
          type: 'error',
          code: 'INVALID_MESSAGE',
          message: 'Message must match the expected schema.',
        });
        return;
      }

      if (message.type === 'resume_session') {
        handleResumeSession(socket, message);
        return;
      }

      const activeSession = sessions.get(session.id);
      if (!activeSession) {
        sendError(socket, {
          type: 'error',
          code: 'SESSION_NOT_FOUND',
          message: `Session not found: ${session.id}`,
        });
        return;
      }

      if (message.type === 'ping') {
        handlePing(socket, activeSession, message);
        return;
      }

      if (message.type === 'terminal_input') {
        handleTerminalInput(activeSession, message);
        return;
      }

      if (message.type === 'terminal_resize') {
        handleTerminalResize(activeSession, message);
        return;
      }

      handleKillSession(socket, activeSession, message);
    } catch (error: unknown) {
      const messageText =
        error instanceof SyntaxError
          ? 'Invalid JSON payload.'
          : error instanceof Error
            ? error.message
            : 'Unknown server error';

      sendError(socket, {
        type: 'error',
        code: error instanceof SyntaxError ? 'INVALID_JSON' : 'SERVER_ERROR',
        message: messageText,
      });
    }
  });

  socket.on('close', (code, reasonBuffer) => {
    const reason = reasonBuffer.toString() || 'No reason provided';
    console.log(`❌ Client disconnected: ${session.id} (${code} - ${reason})`);
    detachSocket(session.id, socket);
  });

  socket.on('error', (error) => {
    console.error(`❌ WebSocket error for ${session.id}: ${error.message}`);
    detachSocket(session.id, socket);
  });
});

httpServer.listen(PORT, () => {
  console.log(`🖥️ Host platform: ${os.platform()} ${os.release()}`);
  console.log(`Server listening on ws://localhost:${PORT}`);
  console.log('✅ Ready to accept connections');
});
