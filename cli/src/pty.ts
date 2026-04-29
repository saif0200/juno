import * as pty from 'node-pty';

import { DEFAULT_AI_COMMAND, SHELL, TMUX_AVAILABLE, TMUX_BINARY } from './config';
import { buildAiCommandLine, buildSharedTmuxSessionName, ensureTmuxSession } from './tmux';
import type { TerminalBackend } from './types';
import { shellEscape } from './util';

interface SpawnedPty {
  pty: pty.IPty;
  backend: TerminalBackend;
  sharedSessionName: string | null;
  command: string;
}

function createDirectPty(
  cols: number,
  rows: number,
  projectPath: string,
  commandKey: string,
): pty.IPty {
  const commandLine = buildAiCommandLine(commandKey);
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
  commandKey: string,
): pty.IPty {
  ensureTmuxSession(sessionName, projectPath, commandKey);
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
  commandKey?: string,
): SpawnedPty {
  const command = (commandKey ?? DEFAULT_AI_COMMAND).toLowerCase();

  if (TMUX_AVAILABLE && TMUX_BINARY) {
    const sharedSessionName = buildSharedTmuxSessionName(projectId, command);
    console.log(
      `🤖 Attaching relay ${sessionId} to tmux session ${sharedSessionName} (${projectPath}, command=${command})`,
    );
    return {
      pty: createTmuxPty(cols, rows, projectPath, sharedSessionName, command),
      backend: 'tmux',
      sharedSessionName,
      command,
    };
  }

  console.log(
    `🤖 Spawning direct PTY for ${sessionId} in ${projectPath}: ${buildAiCommandLine(command)}`,
  );
  return {
    pty: createDirectPty(cols, rows, projectPath, command),
    backend: 'pty',
    sharedSessionName: null,
    command,
  };
}
