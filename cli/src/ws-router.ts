import type { Request } from 'express';
import WebSocket, { type WebSocketServer } from 'ws';

import { PORT } from './config';
import { handleListFiles, handleReadFile, handleWriteFile } from './handlers/files';
import { handleListProjects } from './handlers/projects';
import {
  buildResumePayloadForReconnect,
  handleCreateSession,
  handleKillSession,
  handlePromoteSession,
  handleResumeSession,
  handleListSessions,
} from './handlers/sessions';
import {
  handlePing,
  handleTerminalInput,
  handleTerminalResize,
} from './handlers/terminal';
import {
  getRequestIdFromMessage,
  parseMessage,
  resolveSessionIdFromRequest,
  sendError,
  sendMessage,
} from './protocol';
import {
  attachSocket,
  detachSocketByInstance,
  sendSnapshot,
} from './sessions';
import { sessions, socketSessionBindings } from './state';

export function bindWebSocketServer(wss: WebSocketServer): void {
  wss.on('connection', (socket: WebSocket, request: Request) => {
    const requestedSessionId = resolveSessionIdFromRequest(request.url, PORT);

    if (requestedSessionId) {
      const existingSession = sessions.get(requestedSessionId);
      if (existingSession) {
        attachSocket(existingSession, socket);
        console.log(`✅ Client reconnected: ${existingSession.id}`);
        sendMessage(socket, buildResumePayloadForReconnect(existingSession));
        sendSnapshot(socket, existingSession);
      }
    }

    socket.on('message', (raw: WebSocket.RawData) => {
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

        if (message.type === 'list_projects') {
          handleListProjects(socket);
          return;
        }

        if (message.type === 'list_sessions') {
          handleListSessions(socket);
          return;
        }

        if (message.type === 'create_session') {
          handleCreateSession(socket, message);
          return;
        }

        if (message.type === 'resume_session') {
          handleResumeSession(socket, message);
          return;
        }

        const requestId = getRequestIdFromMessage(message);
        const activeSessionId = socketSessionBindings.get(socket) ?? requestedSessionId ?? null;
        if (!activeSessionId) {
          sendError(socket, {
            type: 'error',
            ...(requestId ? { requestId } : {}),
            code: 'SESSION_NOT_FOUND',
            message: 'No active session is attached to this socket.',
          });
          return;
        }

        const activeSession = sessions.get(activeSessionId);
        if (!activeSession) {
          sendError(socket, {
            type: 'error',
            ...(requestId ? { requestId } : {}),
            code: 'SESSION_NOT_FOUND',
            message: `Session not found: ${activeSessionId}`,
          });
          return;
        }

        if (message.type === 'ping') {
          handlePing(socket, activeSession, message);
          return;
        }

        if (message.type === 'list_files') {
          handleListFiles(socket, activeSession, message);
          return;
        }

        if (message.type === 'read_file') {
          handleReadFile(socket, activeSession, message);
          return;
        }

        if (message.type === 'write_file') {
          handleWriteFile(socket, activeSession, message);
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

        if (message.type === 'promote_session') {
          handlePromoteSession(socket, activeSession, message);
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

    socket.on('close', () => {
      const attachedSessionId = socketSessionBindings.get(socket);
      const attachedSession = attachedSessionId ? sessions.get(attachedSessionId) : null;
      if (attachedSession) {
        console.log(`❌ Client disconnected: ${attachedSession.id}`);
      }
      detachSocketByInstance(socket);
    });

    socket.on('error', (error: Error) => {
      const attachedSessionId = socketSessionBindings.get(socket);
      const attachedSession = attachedSessionId ? sessions.get(attachedSessionId) : null;
      console.error(
        `❌ WebSocket error${attachedSession ? ` for ${attachedSession.id}` : ''}: ${error.message}`,
      );
      detachSocketByInstance(socket);
    });
  });
}
