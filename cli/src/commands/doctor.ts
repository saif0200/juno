import { execFileSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';

import { PORT, PROJECTS_CONFIG_PATH, TMUX_AVAILABLE, TMUX_BINARY } from '../config';
import { getConfigDir } from '../paths';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function checkPortFree(port: number): Promise<CheckResult> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      resolve({
        name: `port ${port} available`,
        ok: false,
        detail: code === 'EADDRINUSE' ? 'in use by another process' : code ?? 'unknown error',
      });
    });
    server.once('listening', () => {
      server.close(() => {
        resolve({ name: `port ${port} available`, ok: true, detail: 'free' });
      });
    });
    server.listen(port, '127.0.0.1');
  });
}

function checkTmux(): CheckResult {
  if (TMUX_AVAILABLE) {
    return { name: 'tmux bridge', ok: true, detail: TMUX_BINARY };
  }
  return {
    name: 'tmux bridge',
    ok: false,
    detail: 'tmux not found on PATH (set TMUX_COMMAND or install tmux)',
  };
}

function checkNode(): CheckResult {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  if (major >= 20) {
    return { name: 'node version', ok: true, detail: `v${process.versions.node}` };
  }
  return {
    name: 'node version',
    ok: false,
    detail: `v${process.versions.node} (need >= 20)`,
  };
}

function checkConfigDir(): CheckResult {
  const dir = getConfigDir();
  if (fs.existsSync(dir)) {
    return { name: 'config dir', ok: true, detail: dir };
  }
  return {
    name: 'config dir',
    ok: false,
    detail: `${dir} (will be created on first pair)`,
  };
}

function checkProjectsConfig(): CheckResult {
  if (fs.existsSync(PROJECTS_CONFIG_PATH)) {
    return { name: 'projects.json', ok: true, detail: PROJECTS_CONFIG_PATH };
  }
  return {
    name: 'projects.json',
    ok: false,
    detail: `${PROJECTS_CONFIG_PATH} (will be seeded empty on first pair)`,
  };
}

function checkClaudeCli(): CheckResult {
  try {
    const resolved = execFileSync('which', ['claude'], { encoding: 'utf8' }).trim();
    if (resolved) return { name: 'claude cli', ok: true, detail: resolved };
  } catch {
    // fall through
  }
  return {
    name: 'claude cli',
    ok: false,
    detail: 'not found on PATH (install Claude Code or set CLAUDE_COMMAND)',
  };
}

export async function runDoctor(): Promise<void> {
  console.log(`🔬 juno doctor on ${os.platform()} ${os.release()}`);
  console.log('');

  const checks: CheckResult[] = [
    checkNode(),
    checkConfigDir(),
    checkProjectsConfig(),
    checkTmux(),
    checkClaudeCli(),
    await checkPortFree(PORT),
  ];

  for (const result of checks) {
    const icon = result.ok ? '✅' : '⚠️ ';
    console.log(`${icon} ${result.name.padEnd(22)} ${result.detail}`);
  }

  const failures = checks.filter((c) => !c.ok).length;
  console.log('');
  if (failures === 0) {
    console.log('All checks passed.');
    process.exit(0);
  }

  console.log(`${failures} warning(s) — pair may still work, see details above.`);
  process.exit(failures > 2 ? 1 : 0);
}
