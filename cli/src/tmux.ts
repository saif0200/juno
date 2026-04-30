import { execFileSync } from 'child_process';

import { resolveAiCommand, TMUX_AVAILABLE, TMUX_BINARY, TMUX_SESSION_PREFIX } from './config';
import { shellEscape } from './util';

function toSessionSlug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : 'workspace';
}

export function buildAiCommandLine(commandKey: string): string {
  const { binary, args } = resolveAiCommand(commandKey);
  return [binary, ...args].map(shellEscape).join(' ');
}

export function buildSharedTmuxSessionName(projectId: string, commandKey: string): string {
  const prefix = toSessionSlug(TMUX_SESSION_PREFIX);
  const projectSlug = toSessionSlug(projectId);
  const commandSlug = toSessionSlug(commandKey);
  const candidate = `${prefix}-${projectSlug}-${commandSlug}`.slice(0, 64);
  return candidate.length > 0 ? candidate : 'juno-workspace';
}

export function tmuxHasSession(sessionName: string): boolean {
  if (!TMUX_AVAILABLE || !TMUX_BINARY) return false;
  try {
    execFileSync(TMUX_BINARY, ['has-session', '-t', sessionName], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function ensureTmuxSession(
  sessionName: string,
  projectPath: string,
  commandKey: string,
): void {
  if (!TMUX_AVAILABLE || !TMUX_BINARY) {
    throw new Error('tmux bridge is not available.');
  }

  if (tmuxHasSession(sessionName)) return;

  const commandLine = buildAiCommandLine(commandKey);
  console.log(`🧩 Creating shared tmux session ${sessionName} in ${projectPath} (${commandKey})`);
  execFileSync(
    TMUX_BINARY,
    ['new-session', '-d', '-s', sessionName, '-c', projectPath, `exec ${commandLine}`],
    { stdio: 'ignore' },
  );
}

export function killTmuxSession(sessionName: string): void {
  if (!TMUX_AVAILABLE || !TMUX_BINARY) return;
  try {
    execFileSync(TMUX_BINARY, ['kill-session', '-t', sessionName], { stdio: 'ignore' });
  } catch (error) {
    console.warn(
      `⚠️ Unable to kill tmux session ${sessionName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
