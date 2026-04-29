import fs from 'fs';
import os from 'os';
import path from 'path';

const CONFIG_DIR_NAME = '.juno';

export function getConfigDir(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

export function getDefaultProjectsPath(): string {
  return path.join(getConfigDir(), 'projects.json');
}

export function getDaemonPidPath(): string {
  return path.join(getConfigDir(), 'daemon.pid');
}

export function ensureConfigDir(): void {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function seedProjectsFileIfMissing(targetPath: string): boolean {
  if (fs.existsSync(targetPath)) return false;
  const seed = JSON.stringify(
    {
      projects: [],
      discovery: { enabled: false, paths: [], maxDepth: 2 },
    },
    null,
    2,
  );
  fs.writeFileSync(targetPath, `${seed}\n`, 'utf8');
  return true;
}
