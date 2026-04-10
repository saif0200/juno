import type { IPty } from 'node-pty';
import type WebSocket from 'ws';

export type ClientMessageType =
  | 'terminal_input'
  | 'terminal_resize'
  | 'resume_session'
  | 'ping'
  | 'kill_session';

export type ServerMessageType =
  | 'session_created'
  | 'session_resumed'
  | 'terminal_output'
  | 'terminal_snapshot'
  | 'terminal_exit'
  | 'pong'
  | 'error';

export interface TerminalInputMessage {
  type: 'terminal_input';
  data: string;
}

export interface TerminalResizeMessage {
  type: 'terminal_resize';
  cols: number;
  rows: number;
}

export interface ResumeSessionMessage {
  type: 'resume_session';
  sessionId: string;
}

export interface PingMessage {
  type: 'ping';
}

export interface KillSessionMessage {
  type: 'kill_session';
}

export type ClientMessage =
  | TerminalInputMessage
  | TerminalResizeMessage
  | ResumeSessionMessage
  | PingMessage
  | KillSessionMessage;

export interface SessionCreatedMessage {
  type: 'session_created';
  sessionId: string;
  expiresAt: string;
  cols: number;
  rows: number;
  command: string;
}

export interface SessionResumedMessage {
  type: 'session_resumed';
  sessionId: string;
  expiresAt: string;
  cols: number;
  rows: number;
  hasActiveProcess: boolean;
}

export interface TerminalOutputMessage {
  type: 'terminal_output';
  sessionId: string;
  data: string;
}

export interface TerminalSnapshotMessage {
  type: 'terminal_snapshot';
  sessionId: string;
  data: string;
}

export interface TerminalExitMessage {
  type: 'terminal_exit';
  sessionId: string;
  exitCode: number;
  signal?: number;
}

export interface PongMessage {
  type: 'pong';
  sessionId: string;
  expiresAt: string;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
  code: 'INVALID_JSON' | 'INVALID_MESSAGE' | 'SESSION_NOT_FOUND' | 'PTY_ERROR' | 'SERVER_ERROR';
}

export type ServerMessage =
  | SessionCreatedMessage
  | SessionResumedMessage
  | TerminalOutputMessage
  | TerminalSnapshotMessage
  | TerminalExitMessage
  | PongMessage
  | ErrorMessage;

export interface SessionRecord {
  id: string;
  socket: WebSocket | null;
  pty: IPty;
  outputBuffer: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  cols: number;
  rows: number;
  hasExited: boolean;
  exitCode: number | null;
  signal: number | null;
}
