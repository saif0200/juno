import { randomUUID } from 'crypto';
import WebSocket from 'ws';

import { DEFAULT_COLS, DEFAULT_ROWS, SESSION_TTL_MS } from './config';
import { spawnSessionPty } from './pty';
import { createTerminalExitMessage, sendMessage } from './protocol';
import { sessions, socketSessionBindings } from './state';
import type {
  ProjectDefinition,
  ServerMessage,
  SessionRecord,
  SessionSummary,
  TerminalPersistenceMode,
} from './types';
import { now, trimBuffer } from './util';

export function refreshSession(session: SessionRecord): void {
  session.updatedAt = now();
  session.expiresAt = session.updatedAt + SESSION_TTL_MS;
}

export function createSessionSummary(session: SessionRecord): SessionSummary {
  return {
    sessionId: session.id,
    projectId: session.projectId,
    projectName: session.projectName,
    projectPath: session.projectPath,
    projectSource: session.projectSource,
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.updatedAt).toISOString(),
    expiresAt: new Date(session.expiresAt).toISOString(),
    hasActiveProcess: !session.hasExited,
    persistence: session.persistence,
    backend: session.backend,
    ...(session.sharedSessionName ? { sharedSessionName: session.sharedSessionName } : {}),
    ...(session.clientTabId ? { clientTabId: session.clientTabId } : {}),
  };
}

export function broadcastToSession(session: SessionRecord, message: ServerMessage): void {
  for (const clientSocket of session.sockets) {
    sendMessage(clientSocket, message);
  }
}

export function attachSocket(session: SessionRecord, socket: WebSocket): void {
  const previouslyAttachedSessionId = socketSessionBindings.get(socket);
  if (previouslyAttachedSessionId && previouslyAttachedSessionId !== session.id) {
    const previousSession = sessions.get(previouslyAttachedSessionId);
    if (previousSession) {
      previousSession.sockets.delete(socket);
      refreshSession(previousSession);
    }
  }

  socketSessionBindings.set(socket, session.id);
  session.sockets.add(socket);
  refreshSession(session);
}

export function detachSocket(sessionId: string, socket: WebSocket): void {
  const session = sessions.get(sessionId);
  if (socketSessionBindings.get(socket) === sessionId) {
    socketSessionBindings.delete(socket);
  }

  if (!session) return;

  if (session.sockets.delete(socket)) {
    refreshSession(session);
  }
}

export function detachSocketByInstance(socket: WebSocket): void {
  const sessionId = socketSessionBindings.get(socket);
  if (!sessionId) return;
  detachSocket(sessionId, socket);
}

export function cleanupExpiredSessions(): void {
  const timestamp = now();
  for (const [sessionId, session] of sessions.entries()) {
    if (session.expiresAt > timestamp) continue;

    console.log(`🧹 Session expired: ${sessionId}`);
    for (const clientSocket of Array.from(session.sockets)) {
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.close(4000, 'Session expired');
      }
      detachSocket(sessionId, clientSocket);
    }
    if (!session.hasExited) {
      session.pty.kill();
    }
    sessions.delete(sessionId);
  }
}

export function createSession(
  project: ProjectDefinition,
  options?: {
    clientTabId?: string;
    persistence?: TerminalPersistenceMode;
  },
): SessionRecord {
  const id = `session-${randomUUID()}`;
  const createdAt = now();
  const spawned = spawnSessionPty(id, DEFAULT_COLS, DEFAULT_ROWS, project.path, project.id);
  const processPty = spawned.pty;

  const session: SessionRecord = {
    id,
    sockets: new Set(),
    pty: processPty,
    projectId: project.id,
    projectName: project.name,
    projectPath: project.path,
    projectSource: project.source,
    outputBuffer: '',
    createdAt,
    updatedAt: createdAt,
    expiresAt: createdAt + SESSION_TTL_MS,
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    hasExited: false,
    exitCode: null,
    signal: null,
    clientTabId: options?.clientTabId ?? null,
    persistence: options?.persistence ?? 'persisted',
    backend: spawned.backend,
    sharedSessionName: spawned.sharedSessionName,
  };

  processPty.onData((data: string) => {
    session.outputBuffer = trimBuffer(session.outputBuffer + data);
    refreshSession(session);
    broadcastToSession(session, {
      type: 'terminal_output',
      sessionId: session.id,
      data,
    });
  });

  processPty.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    session.hasExited = true;
    session.exitCode = exitCode;
    session.signal = signal ?? null;
    refreshSession(session);
    console.log(`🤖 Claude PTY exited for ${session.id}: code=${exitCode}, signal=${signal ?? 0}`);
    broadcastToSession(session, createTerminalExitMessage(session.id, exitCode, signal ?? null));
  });

  sessions.set(id, session);
  return session;
}

export function sendSnapshot(socket: WebSocket, session: SessionRecord): void {
  sendMessage(socket, {
    type: 'terminal_snapshot',
    sessionId: session.id,
    data: session.outputBuffer,
  });

  if (session.hasExited && session.exitCode !== null) {
    sendMessage(socket, createTerminalExitMessage(session.id, session.exitCode, session.signal));
  }
}
