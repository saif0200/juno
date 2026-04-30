import WebSocket from 'ws';

import type { ClientMessage, CreateSessionMessage, ErrorMessage, ServerMessage } from './types';

export function sendMessage(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

export function sendError(socket: WebSocket, error: ErrorMessage): void {
  console.error(`❌ ${error.code}: ${error.message}`);
  sendMessage(socket, error);
}

export function sendRequestError(
  socket: WebSocket,
  requestId: string,
  code: ErrorMessage['code'],
  message: string,
): void {
  sendError(socket, {
    type: 'error',
    requestId,
    code,
    message,
  });
}

export function getRequestIdFromMessage(message: ClientMessage): string | undefined {
  if (
    message.type === 'list_files' ||
    message.type === 'read_file' ||
    message.type === 'write_file'
  ) {
    return message.requestId;
  }
  return undefined;
}

export function createTerminalExitMessage(
  sessionId: string,
  exitCode: number,
  signal: number | null,
): ServerMessage {
  if (signal === null || signal === 0) {
    return { type: 'terminal_exit', sessionId, exitCode };
  }
  return { type: 'terminal_exit', sessionId, exitCode, signal };
}

export function parseMessage(raw: WebSocket.RawData): ClientMessage | null {
  const parsed: unknown = JSON.parse(raw.toString());
  if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return null;

  const candidate = parsed as Record<string, unknown>;

  if (candidate.type === 'list_projects') return { type: 'list_projects' };
  if (candidate.type === 'list_sessions') return { type: 'list_sessions' };

  if (candidate.type === 'create_session' && typeof candidate.projectId === 'string') {
    const clientTabId =
      typeof candidate.clientTabId === 'string' && candidate.clientTabId.trim().length > 0
        ? candidate.clientTabId
        : undefined;
    const persistence =
      candidate.persistence === 'persisted' || candidate.persistence === 'ephemeral'
        ? candidate.persistence
        : undefined;
    const command =
      typeof candidate.command === 'string' && candidate.command.trim().length > 0
        ? candidate.command.trim().toLowerCase()
        : undefined;

    const payload: CreateSessionMessage = {
      type: 'create_session',
      projectId: candidate.projectId,
    };
    if (clientTabId) payload.clientTabId = clientTabId;
    if (persistence) payload.persistence = persistence;
    if (command) payload.command = command;
    return payload;
  }

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
    return { type: 'terminal_resize', cols: candidate.cols, rows: candidate.rows };
  }

  if (candidate.type === 'resume_session' && typeof candidate.sessionId === 'string') {
    return { type: 'resume_session', sessionId: candidate.sessionId };
  }

  if (
    candidate.type === 'list_files' &&
    typeof candidate.requestId === 'string' &&
    candidate.requestId.trim().length > 0
  ) {
    const requestPath = typeof candidate.path === 'string' ? candidate.path : undefined;
    return {
      type: 'list_files',
      requestId: candidate.requestId,
      ...(requestPath !== undefined ? { path: requestPath } : {}),
    };
  }

  if (
    candidate.type === 'read_file' &&
    typeof candidate.requestId === 'string' &&
    candidate.requestId.trim().length > 0 &&
    typeof candidate.path === 'string'
  ) {
    return {
      type: 'read_file',
      requestId: candidate.requestId,
      path: candidate.path,
    };
  }

  if (
    candidate.type === 'write_file' &&
    typeof candidate.requestId === 'string' &&
    candidate.requestId.trim().length > 0 &&
    typeof candidate.path === 'string' &&
    typeof candidate.content === 'string'
  ) {
    return {
      type: 'write_file',
      requestId: candidate.requestId,
      path: candidate.path,
      content: candidate.content,
    };
  }

  if (candidate.type === 'ping') return { type: 'ping' };
  if (candidate.type === 'kill_session') return { type: 'kill_session' };
  if (candidate.type === 'promote_session') return { type: 'promote_session' };

  if (
    candidate.type === 'remove_project' &&
    typeof candidate.requestId === 'string' &&
    candidate.requestId.trim().length > 0 &&
    typeof candidate.projectId === 'string' &&
    candidate.projectId.trim().length > 0
  ) {
    return {
      type: 'remove_project',
      requestId: candidate.requestId,
      projectId: candidate.projectId,
    };
  }

  return null;
}

export function resolveSessionIdFromRequest(
  requestUrl: string | undefined,
  port: number,
): string | null {
  if (!requestUrl) return null;
  const parsedUrl = new URL(requestUrl, `http://localhost:${port}`);
  const sessionId = parsedUrl.searchParams.get('sessionId');
  return sessionId && sessionId.length > 0 ? sessionId : null;
}
