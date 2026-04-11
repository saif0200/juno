import type { IPty } from 'node-pty';
import type WebSocket from 'ws';

export type ProjectSource = 'config' | 'discovered';
export type TerminalPersistenceMode = 'ephemeral' | 'persisted';

export interface ProjectDefinition {
  id: string;
  name: string;
  path: string;
  source: ProjectSource;
  isFavorite: boolean;
  available: boolean;
}

export interface PairingConnectionCandidate {
  interfaceName: string;
  family: 'IPv4' | 'IPv6';
  address: string;
  isInternal: boolean;
  isPreferred: boolean;
  httpBaseUrl: string;
  wsBaseUrl: string;
  pairingUrl: string;
  dashboardUrl: string;
  healthUrl: string;
  wsUrl: string;
}

export interface PairingPayload {
  schema: 'juno-relay-pairing.v1';
  generatedAt: string;
  serverId: string;
  serverName: string;
  relayVersion: number;
  transport: {
    port: number;
    websocketPath: string;
    pairingPath: string;
    dashboardPath: string;
    healthPath: string;
    manualWebSocketEntrySupported: boolean;
  };
  connection: {
    preferred: PairingConnectionCandidate;
    candidates: PairingConnectionCandidate[];
  };
  projects: Array<Pick<ProjectDefinition, 'id' | 'name'>>;
  capabilities: {
    sessionReconnect: boolean;
    projectListing: boolean;
    pairingDashboard: boolean;
  };
  qr: {
    format: 'pairing_url';
    value: string;
  };
}

export type ClientMessageType =
  | 'list_projects'
  | 'list_sessions'
  | 'create_session'
  | 'terminal_input'
  | 'terminal_resize'
  | 'resume_session'
  | 'list_files'
  | 'read_file'
  | 'write_file'
  | 'ping'
  | 'kill_session'
  | 'promote_session';

export type ServerMessageType =
  | 'projects_list'
  | 'sessions_list'
  | 'session_created'
  | 'session_resumed'
  | 'files_list'
  | 'file_content'
  | 'file_saved'
  | 'terminal_output'
  | 'terminal_snapshot'
  | 'terminal_exit'
  | 'session_promoted'
  | 'pong'
  | 'error';

export interface ListProjectsMessage {
  type: 'list_projects';
}

export interface ListSessionsMessage {
  type: 'list_sessions';
}

export interface CreateSessionMessage {
  type: 'create_session';
  projectId: string;
  clientTabId?: string;
  persistence?: TerminalPersistenceMode;
}

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

export interface ListFilesMessage {
  type: 'list_files';
  requestId: string;
  path?: string;
}

export interface ReadFileMessage {
  type: 'read_file';
  requestId: string;
  path: string;
}

export interface WriteFileMessage {
  type: 'write_file';
  requestId: string;
  path: string;
  content: string;
}

export interface PingMessage {
  type: 'ping';
}

export interface KillSessionMessage {
  type: 'kill_session';
}

export interface PromoteSessionMessage {
  type: 'promote_session';
}

export type ClientMessage =
  | ListProjectsMessage
  | ListSessionsMessage
  | CreateSessionMessage
  | TerminalInputMessage
  | TerminalResizeMessage
  | ResumeSessionMessage
  | ListFilesMessage
  | ReadFileMessage
  | WriteFileMessage
  | PingMessage
  | KillSessionMessage
  | PromoteSessionMessage;

export interface WorkspaceFileEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  size?: number;
  updatedAt?: string;
}

export interface SessionSummary {
  sessionId: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  projectSource: ProjectSource;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  hasActiveProcess: boolean;
  clientTabId?: string;
  persistence?: TerminalPersistenceMode;
}

export interface ProjectsListMessage {
  type: 'projects_list';
  projects: ProjectDefinition[];
}

export interface SessionsListMessage {
  type: 'sessions_list';
  sessions: SessionSummary[];
}

export interface SessionCreatedMessage {
  type: 'session_created';
  sessionId: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  projectSource: ProjectSource;
  expiresAt: string;
  cols: number;
  rows: number;
  command: string;
  clientTabId?: string;
  persistence?: TerminalPersistenceMode;
}

export interface SessionResumedMessage {
  type: 'session_resumed';
  sessionId: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  projectSource: ProjectSource;
  expiresAt: string;
  cols: number;
  rows: number;
  hasActiveProcess: boolean;
  clientTabId?: string;
  persistence?: TerminalPersistenceMode;
}

export interface SessionPromotedMessage {
  type: 'session_promoted';
  sessionId: string;
  persistence: 'persisted';
  clientTabId?: string;
}

export interface FilesListMessage {
  type: 'files_list';
  requestId: string;
  path: string;
  entries: WorkspaceFileEntry[];
}

export interface FileContentMessage {
  type: 'file_content';
  requestId: string;
  path: string;
  content: string;
  updatedAt: string;
}

export interface FileSavedMessage {
  type: 'file_saved';
  requestId: string;
  path: string;
  updatedAt: string;
  bytes: number;
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
  requestId?: string;
  message: string;
  code:
    | 'INVALID_JSON'
    | 'INVALID_MESSAGE'
    | 'SESSION_NOT_FOUND'
    | 'PROJECT_NOT_FOUND'
    | 'PTY_ERROR'
    | 'FILE_NOT_FOUND'
    | 'FILE_NOT_DIRECTORY'
    | 'FILE_ACCESS_DENIED'
    | 'FILE_TOO_LARGE'
    | 'FILE_BINARY_UNSUPPORTED'
    | 'SERVER_ERROR';
}

export type ServerMessage =
  | ProjectsListMessage
  | SessionsListMessage
  | SessionCreatedMessage
  | SessionResumedMessage
  | FilesListMessage
  | FileContentMessage
  | FileSavedMessage
  | TerminalOutputMessage
  | TerminalSnapshotMessage
  | TerminalExitMessage
  | SessionPromotedMessage
  | PongMessage
  | ErrorMessage;

export interface SessionRecord {
  id: string;
  socket: WebSocket | null;
  pty: IPty;
  projectId: string;
  projectName: string;
  projectPath: string;
  projectSource: ProjectSource;
  outputBuffer: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  cols: number;
  rows: number;
  hasExited: boolean;
  exitCode: number | null;
  signal: number | null;
  clientTabId: string | null;
  persistence: TerminalPersistenceMode;
}
