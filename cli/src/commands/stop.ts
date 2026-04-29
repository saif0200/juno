import fs from 'fs';

import { getDaemonPidPath } from '../paths';
import { getDaemonStatus } from './status';

const STOP_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 200;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true;
    return false;
  }
}

async function waitForExit(pid: number): Promise<boolean> {
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return false;
}

export async function runStop(): Promise<void> {
  const status = getDaemonStatus();

  if (!status.running) {
    if (status.pid !== null) {
      try {
        fs.unlinkSync(getDaemonPidPath());
      } catch {
        // ignore
      }
      console.log(`⚠️  Removed stale pid file (pid ${status.pid})`);
    } else {
      console.log('No juno daemon running.');
    }
    process.exit(0);
  }

  const pid = status.pid as number;
  process.kill(pid, 'SIGTERM');
  console.log(`Sent SIGTERM to pid ${pid}…`);

  const exited = await waitForExit(pid);
  if (!exited) {
    console.error(`❌ Daemon (pid ${pid}) did not exit within ${STOP_TIMEOUT_MS}ms.`);
    process.exit(1);
  }

  console.log('✅ juno daemon stopped.');
  process.exit(0);
}
