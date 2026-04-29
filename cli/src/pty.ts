import * as pty from 'node-pty';

import { SHELL, TMUX_AVAILABLE, TMUX_BINARY } from './config';
import { buildClaudeCommandLine, buildSharedTmuxSessionName, ensureTmuxSession } from './tmux';
import type { TerminalBackend } from './types';
import { shellEscape } from './util';

interface SpawnedPty {
  pty: pty.IPty;
  backend: TerminalBackend;
  sharedSessionName: string | null;
}

function createDirectPty(cols: number, rows: number, projectPath: string): pty.IPty {
  const commandLine = buildClaudeCommandLine();
  return pty.spawn(SHELL, ['-lc', `cd ${shellEscape(projectPath)} && exec ${commandLine}`], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: projectPath,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  });
}

function createTmuxPty(
  cols: number,
  rows: number,
  projectPath: string,
  sessionName: string,
): pty.IPty {
  ensureTmuxSession(sessionName, projectPath);
  return pty.spawn(TMUX_BINARY, ['attach-session', '-t', sessionName], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: projectPath,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  });
}

export function spawnSessionPty(
  sessionId: string,
  cols: number,
  rows: number,
  projectPath: string,
  projectId: string,
): SpawnedPty {
  if (TMUX_AVAILABLE && TMUX_BINARY) {
    const sharedSessionName = buildSharedTmuxSessionName(projectId);
    console.log(
      `🤖 Attaching relay ${sessionId} to tmux session ${sharedSessionName} (${projectPath})`,
    );
    return {
      pty: createTmuxPty(cols, rows, projectPath, sharedSessionName),
      backend: 'tmux',
      sharedSessionName,
    };
  }

  const commandLine = buildClaudeCommandLine();
  console.log(`🤖 Spawning direct PTY for ${sessionId} in ${projectPath}: ${commandLine}`);
  return {
    pty: createDirectPty(cols, rows, projectPath),
    backend: 'pty',
    sharedSessionName: null,
  };
}
