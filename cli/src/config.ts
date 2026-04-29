import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { getDefaultProjectsPath } from './paths';

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  if (value === '1' || value.toLowerCase() === 'true') return true;
  if (value === '0' || value.toLowerCase() === 'false') return false;
  return fallback;
}

function parseJsonStringArray(rawValue: string | undefined, label: string): string[] {
  if (!rawValue || rawValue.trim().length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) {
      return parsed;
    }
  } catch {
    console.warn(`⚠️ ${label} is not valid JSON. Ignoring.`);
  }
  return [];
}

function resolveCommandBinary(command: string): string {
  if (command.includes('/')) return command;
  try {
    const resolved = execFileSync('which', [command], { encoding: 'utf8' }).trim();
    if (resolved.length > 0) return resolved;
  } catch {
    return '';
  }
  return '';
}

function resolveClaudeCommand(command: string): string {
  const resolved = resolveCommandBinary(command);
  if (resolved.length > 0) return resolved;
  console.warn(`⚠️ Could not resolve ${command} with 'which'. Using raw command name.`);
  return command;
}

function parsePublicUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    console.warn('⚠️  PUBLIC_URL is not a valid URL - ignoring.');
    return null;
  }
}

export const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
export const SESSION_TTL_MS = Number.parseInt(process.env.SESSION_TTL_MS ?? '300000', 10);
export const CLEANUP_INTERVAL_MS = Number.parseInt(
  process.env.SESSION_CLEANUP_INTERVAL_MS ?? '30000',
  10,
);
export const DEFAULT_COLS = Number.parseInt(process.env.DEFAULT_TERMINAL_COLS ?? '120', 10);
export const DEFAULT_ROWS = Number.parseInt(process.env.DEFAULT_TERMINAL_ROWS ?? '40', 10);
export const OUTPUT_BUFFER_LIMIT = Number.parseInt(process.env.OUTPUT_BUFFER_LIMIT ?? '200000', 10);
export const MAX_FILE_READ_BYTES = Number.parseInt(process.env.MAX_FILE_READ_BYTES ?? '262144', 10);
export const MAX_FILE_WRITE_BYTES = Number.parseInt(process.env.MAX_FILE_WRITE_BYTES ?? '262144', 10);

export const SHELL = process.env.SHELL ?? '/bin/zsh';
export const CLAUDE_COMMAND = resolveClaudeCommand(process.env.CLAUDE_COMMAND ?? 'claude');
export const CLAUDE_ARGS = parseJsonStringArray(process.env.CLAUDE_ARGS_JSON, 'CLAUDE_ARGS_JSON');

export const TMUX_COMMAND = process.env.TMUX_COMMAND?.trim() || 'tmux';
export const TMUX_SESSION_BRIDGE_ENABLED = parseBooleanEnv(
  process.env.TMUX_SESSION_BRIDGE_ENABLED,
  true,
);
export const TMUX_SESSION_PREFIX = process.env.TMUX_SESSION_PREFIX?.trim() || 'juno';
export const TMUX_BINARY = resolveCommandBinary(TMUX_COMMAND);
export const TMUX_AVAILABLE = TMUX_SESSION_BRIDGE_ENABLED && TMUX_BINARY.length > 0;

if (TMUX_SESSION_BRIDGE_ENABLED && !TMUX_AVAILABLE) {
  console.warn(
    `⚠️ tmux bridge requested but '${TMUX_COMMAND}' was not found. Falling back to direct PTY sessions.`,
  );
}

export const PROJECT_DISCOVERY_ENABLED = parseBooleanEnv(
  process.env.PROJECT_DISCOVERY_ENABLED,
  false,
);
export const PROJECT_DISCOVERY_MAX_DEPTH = Number.parseInt(
  process.env.PROJECT_DISCOVERY_MAX_DEPTH ?? '2',
  10,
);
export const PROJECT_DISCOVERY_PATHS = parseJsonStringArray(
  process.env.PROJECT_DISCOVERY_PATHS_JSON,
  'PROJECT_DISCOVERY_PATHS_JSON',
);

export const SERVER_NAME =
  (process.env.PAIRING_SERVER_NAME ?? os.hostname()).trim() || os.hostname();
export const SERVER_ID = `${SERVER_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${PORT}`;

export const PUBLIC_URL = parsePublicUrl(process.env.PUBLIC_URL);

function resolveProjectsConfigPath(): string {
  if (process.env.PROJECTS_CONFIG_PATH) {
    return path.resolve(process.env.PROJECTS_CONFIG_PATH);
  }

  const cwdProjectsPath = path.resolve(process.cwd(), 'projects.json');
  if (fs.existsSync(cwdProjectsPath)) {
    return cwdProjectsPath;
  }

  return getDefaultProjectsPath();
}

export const PROJECTS_CONFIG_PATH = resolveProjectsConfigPath();
