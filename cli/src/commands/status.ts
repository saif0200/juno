import fs from 'fs';

import { getDaemonPidPath } from '../paths';

interface DaemonStatus {
  running: boolean;
  pid: number | null;
  reason?: string;
}

function readPidFile(): number | null {
  try {
    const raw = fs.readFileSync(getDaemonPidPath(), 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true;
    return false;
  }
}

export function getDaemonStatus(): DaemonStatus {
  const pid = readPidFile();
  if (pid === null) {
    return { running: false, pid: null, reason: 'no pid file' };
  }

  if (!isProcessAlive(pid)) {
    return { running: false, pid, reason: 'pid file stale' };
  }

  return { running: true, pid };
}

export function runStatus(): void {
  const status = getDaemonStatus();

  if (status.running) {
    console.log(`✅ juno daemon running (pid ${status.pid})`);
    process.exit(0);
  }

  if (status.pid !== null) {
    console.log(`⚠️  juno daemon not running (stale pid ${status.pid})`);
    process.exit(1);
  }

  console.log('❌ juno daemon not running');
  process.exit(1);
}
