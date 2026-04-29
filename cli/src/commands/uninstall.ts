import fs from 'fs';
import path from 'path';
import readline from 'readline';

import { getConfigDir } from '../paths';
import { getDaemonStatus } from './status';

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function rmConfigDir(): boolean {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    console.log(`ℹ️  ${dir} does not exist - nothing to remove.`);
    return false;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`🗑️  Removed ${dir}`);
  return true;
}

function printNextSteps(): void {
  console.log('');
  console.log('To finish removing the juno binary itself, also run one of:');
  console.log('  npm uninstall -g @juno-dev/cli       (if installed via npm)');
  console.log('  brew uninstall juno                  (if installed via Homebrew)');
  console.log(`  rm ${path.dirname(process.execPath)}/juno   (if linked manually)`);
}

export async function runUninstall(): Promise<void> {
  const yes = process.argv.includes('--yes') || process.argv.includes('-y');

  if (!yes) {
    const status = getDaemonStatus();
    if (status.running) {
      console.log(`⚠️  juno daemon is running (pid ${status.pid}). Run 'juno stop' first.`);
      process.exit(1);
    }

    const answer = await prompt(
      `This removes ${getConfigDir()} (saved projects, daemon pid).\nProceed? [y/N] `,
    );
    if (answer !== 'y' && answer !== 'yes') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  rmConfigDir();
  printNextSteps();
  process.exit(0);
}
