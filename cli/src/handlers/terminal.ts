import type WebSocket from 'ws';

import { sendMessage } from '../protocol';
import { refreshSession } from '../sessions';
import type {
  PingMessage,
  SessionRecord,
  TerminalInputMessage,
  TerminalResizeMessage,
} from '../types';

export function handlePing(
  socket: WebSocket,
  session: SessionRecord,
  _message: PingMessage,
): void {
  refreshSession(session);
  sendMessage(socket, {
    type: 'pong',
    sessionId: session.id,
    expiresAt: new Date(session.expiresAt).toISOString(),
  });
}

export function handleTerminalInput(
  session: SessionRecord,
  message: TerminalInputMessage,
): void {
  if (session.hasExited) {
    console.warn(`⚠️ Ignoring input for exited session ${session.id}`);
    return;
  }

  session.pty.write(message.data);
  refreshSession(session);
}

export function handleTerminalResize(
  session: SessionRecord,
  message: TerminalResizeMessage,
): void {
  session.cols = message.cols;
  session.rows = message.rows;
  refreshSession(session);

  if (!session.hasExited) {
    session.pty.resize(message.cols, message.rows);
  }
}
