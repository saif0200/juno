import fs from 'fs';

import { ensureConfigDir, getDaemonPidPath } from '../paths';
import { startServer } from '../server';

function writePidFile(): void {
  ensureConfigDir();
  fs.writeFileSync(getDaemonPidPath(), `${process.pid}\n`, 'utf8');
}

function removePidFile(): void {
  try {
    fs.unlinkSync(getDaemonPidPath());
  } catch {
    // ignore — already gone
  }
}

export function runPair(): void {
  writePidFile();

  const server = startServer();

  const shutdown = async (): Promise<void> => {
    removePidFile();
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  process.on('exit', removePidFile);
}
