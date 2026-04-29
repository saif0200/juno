import WebSocket from 'ws';

import { CLAUDE_ARGS, CLAUDE_COMMAND, TMUX_AVAILABLE, TMUX_BINARY } from '../config';
import { directoryExists } from '../fs-paths';
import { createTerminalExitMessage, sendError, sendMessage } from '../protocol';
import {
  attachSocket,
  broadcastToSession,
  createSession,
  createSessionSummary,
  detachSocket,
  refreshSession,
  sendSnapshot,
} from '../sessions';
import { getProjects, sessions } from '../state';
import { buildSharedTmuxSessionName, killTmuxSession } from '../tmux';
import type {
  CreateSessionMessage,
  KillSessionMessage,
  PromoteSessionMessage,
  ResumeSessionMessage,
  SessionCreatedMessage,
  SessionPromotedMessage,
  SessionRecord,
  SessionResumedMessage,
  TerminalPersistenceMode,
} from '../types';

export function handleListSessions(socket: WebSocket): void {
  const sessionList = Array.from(sessions.values())
    .filter((session) => session.persistence === 'persisted')
    .map(createSessionSummary)
    .sort((left, right) => {
      const updatedDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      if (updatedDelta !== 0) return updatedDelta;

      const createdDelta = Date.parse(right.createdAt) - Date.parse(left.createdAt);
      if (createdDelta !== 0) return createdDelta;

      return left.sessionId.localeCompare(right.sessionId);
    });

  sendMessage(socket, {
    type: 'sessions_list',
    sessions: sessionList,
  });
}

export function handleCreateSession(
  socket: WebSocket,
  message: CreateSessionMessage,
): SessionRecord | null {
  const project = getProjects().find((entry) => entry.id === message.projectId);
  if (!project) {
    sendError(socket, {
      type: 'error',
      code: 'PROJECT_NOT_FOUND',
      message: `Project not found: ${message.projectId}`,
    });
    return null;
  }

  if (!project.available || !directoryExists(project.path)) {
    sendError(socket, {
      type: 'error',
      code: 'PROJECT_NOT_FOUND',
      message: `Project path does not exist: ${project.path}`,
    });
    return null;
  }

  const sharedTmuxSessionName = TMUX_AVAILABLE ? buildSharedTmuxSessionName(project.id) : null;
  if (sharedTmuxSessionName) {
    const reusableSession = Array.from(sessions.values()).find(
      (candidate) =>
        candidate.projectId === project.id &&
        candidate.backend === 'tmux' &&
        candidate.sharedSessionName === sharedTmuxSessionName &&
        !candidate.hasExited,
    );

    if (reusableSession) {
      attachSocket(reusableSession, socket);
      console.log(`🔁 Reusing shared tmux relay session: ${reusableSession.id} (${project.name})`);
      const resumedPayload: SessionResumedMessage = {
        type: 'session_resumed',
        sessionId: reusableSession.id,
        projectId: reusableSession.projectId,
        projectName: reusableSession.projectName,
        projectPath: reusableSession.projectPath,
        projectSource: reusableSession.projectSource,
        expiresAt: new Date(reusableSession.expiresAt).toISOString(),
        cols: reusableSession.cols,
        rows: reusableSession.rows,
        hasActiveProcess: !reusableSession.hasExited,
        persistence: reusableSession.persistence,
        backend: reusableSession.backend,
        ...(reusableSession.sharedSessionName
          ? { sharedSessionName: reusableSession.sharedSessionName }
          : {}),
        ...(reusableSession.clientTabId ? { clientTabId: reusableSession.clientTabId } : {}),
      };
      sendMessage(socket, resumedPayload);
      sendSnapshot(socket, reusableSession);
      return reusableSession;
    }
  }

  const createOptions: { clientTabId?: string; persistence?: TerminalPersistenceMode } = {};
  if (message.clientTabId) createOptions.clientTabId = message.clientTabId;
  if (message.persistence) createOptions.persistence = message.persistence;

  const session = createSession(project, createOptions);
  attachSocket(session, socket);
  console.log(`✅ New project session created: ${session.id} (${project.name})`);

  const payload: SessionCreatedMessage = {
    type: 'session_created',
    sessionId: session.id,
    projectId: session.projectId,
    projectName: session.projectName,
    projectPath: session.projectPath,
    projectSource: session.projectSource,
    expiresAt: new Date(session.expiresAt).toISOString(),
    cols: session.cols,
    rows: session.rows,
    command:
      session.backend === 'tmux' && session.sharedSessionName
        ? `${TMUX_BINARY} attach-session -t ${session.sharedSessionName}`
        : [CLAUDE_COMMAND, ...CLAUDE_ARGS].join(' ').trim(),
    persistence: session.persistence,
    backend: session.backend,
    ...(session.sharedSessionName ? { sharedSessionName: session.sharedSessionName } : {}),
    ...(session.clientTabId ? { clientTabId: session.clientTabId } : {}),
  };
  sendMessage(socket, payload);
  sendSnapshot(socket, session);
  return session;
}

export function handleResumeSession(
  socket: WebSocket,
  message: ResumeSessionMessage,
): SessionRecord | null {
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
    projectId: existingSession.projectId,
    projectName: existingSession.projectName,
    projectPath: existingSession.projectPath,
    projectSource: existingSession.projectSource,
    expiresAt: new Date(existingSession.expiresAt).toISOString(),
    cols: existingSession.cols,
    rows: existingSession.rows,
    hasActiveProcess: !existingSession.hasExited,
    persistence: existingSession.persistence,
    backend: existingSession.backend,
    ...(existingSession.sharedSessionName
      ? { sharedSessionName: existingSession.sharedSessionName }
      : {}),
    ...(existingSession.clientTabId ? { clientTabId: existingSession.clientTabId } : {}),
  };
  sendMessage(socket, payload);
  sendSnapshot(socket, existingSession);
  return existingSession;
}

export function handleKillSession(
  socket: WebSocket,
  session: SessionRecord,
  _message: KillSessionMessage,
): void {
  console.log(`🛑 Kill requested for ${session.id}`);

  if (session.backend === 'tmux' && session.sharedSessionName) {
    killTmuxSession(session.sharedSessionName);
  }

  if (!session.hasExited) {
    session.pty.kill();
  }

  const exitPayload = createTerminalExitMessage(session.id, session.exitCode ?? 0, session.signal);
  broadcastToSession(session, exitPayload);
  for (const clientSocket of Array.from(session.sockets)) {
    detachSocket(session.id, clientSocket);
    if (clientSocket !== socket && clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.close(4001, 'Session killed');
    }
  }
  sessions.delete(session.id);
}

export function handlePromoteSession(
  _socket: WebSocket,
  session: SessionRecord,
  _message: PromoteSessionMessage,
): void {
  if (session.persistence === 'persisted') {
    broadcastToSession(session, {
      type: 'session_promoted',
      sessionId: session.id,
      persistence: 'persisted',
      ...(session.clientTabId ? { clientTabId: session.clientTabId } : {}),
    });
    return;
  }

  session.persistence = 'persisted';
  refreshSession(session);

  const payload: SessionPromotedMessage = {
    type: 'session_promoted',
    sessionId: session.id,
    persistence: 'persisted',
    ...(session.clientTabId ? { clientTabId: session.clientTabId } : {}),
  };
  broadcastToSession(session, payload);
}

export function buildResumePayloadForReconnect(session: SessionRecord): SessionResumedMessage {
  return {
    type: 'session_resumed',
    sessionId: session.id,
    projectId: session.projectId,
    projectName: session.projectName,
    projectPath: session.projectPath,
    projectSource: session.projectSource,
    expiresAt: new Date(session.expiresAt).toISOString(),
    cols: session.cols,
    rows: session.rows,
    hasActiveProcess: !session.hasExited,
    persistence: session.persistence,
    backend: session.backend,
    ...(session.sharedSessionName ? { sharedSessionName: session.sharedSessionName } : {}),
    ...(session.clientTabId ? { clientTabId: session.clientTabId } : {}),
  };
}
