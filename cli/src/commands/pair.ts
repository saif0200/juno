import fs from 'fs';

import { PORT, PROJECTS_CONFIG_PATH } from '../config';
import { ensureConfigDir, getDaemonPidPath } from '../paths';
import { persistProjectIfNew } from '../projects';
import { buildProjectFromPath, startServer } from '../server';
import type { ProjectDefinition } from '../types';
import { getDaemonStatus } from './status';

function writePidFile(): void {
  ensureConfigDir();
  fs.writeFileSync(getDaemonPidPath(), `${process.pid}\n`, 'utf8');
}

function removePidFile(): void {
  try {
    fs.unlinkSync(getDaemonPidPath());
  } catch {
    // ignore - already gone
  }
}

function buildCwdProject(): ProjectDefinition | null {
  const cwd = process.cwd();
  // Skip auto-add when invoked from a hosting dir that wouldn't make sense as a project
  // (e.g. /, $HOME, or the cli source itself during dev).
  if (cwd === '/' || cwd === process.env.HOME) return null;
  return buildProjectFromPath(cwd, { favorite: true, source: 'config' });
}

export function runPair(): void {
  const existingDaemon = getDaemonStatus();
  if (existingDaemon.running) {
    console.error(
      `❌ A juno daemon is already running (pid ${existingDaemon.pid}, port ${PORT}).`,
    );
    console.error('   Run `juno stop` to stop it, or set `PORT=...` to start a second instance.');
    process.exit(1);
  }

  writePidFile();

  const cwdProject = buildCwdProject();
  if (cwdProject) {
    console.log(`📂 Project: ${cwdProject.name} (${cwdProject.path})`);
    try {
      const saved = persistProjectIfNew(PROJECTS_CONFIG_PATH, cwdProject);
      if (saved) console.log(`💾 Added to ${PROJECTS_CONFIG_PATH}`);
    } catch (error) {
      console.warn(
        `⚠️  Could not persist project: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const server = startServer({
    extraProjects: cwdProject ? [cwdProject] : [],
    onListenError: (error) => {
      removePidFile();
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use by another process.`);
        console.error(
          `   Run \`lsof -i :${PORT}\` to find it, or set \`PORT=...\` to pick a free port.`,
        );
      } else {
        console.error(`❌ ${error.message}`);
      }
      process.exit(1);
    },
  });

  const shutdown = async (): Promise<void> => {
    removePidFile();
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  process.on('exit', removePidFile);
}
