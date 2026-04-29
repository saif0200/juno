#!/usr/bin/env node
import { runDoctor } from './commands/doctor';
import { runPair } from './commands/pair';
import { runStatus } from './commands/status';
import { runStop } from './commands/stop';

const HELP_TEXT = `juno - mobile IDE relay

Usage:
  juno <command>

Commands:
  pair       Start the relay and print a pairing QR code (default).
  status     Check whether a juno daemon is running.
  stop       Stop the running juno daemon.
  doctor     Diagnose environment (tmux, node, port, config).
  help       Show this message.

Run \`juno pair\` from your project root, then scan the QR with the Juno app.
`;

function printHelp(): void {
  process.stdout.write(HELP_TEXT);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'pair';

  switch (command) {
    case 'pair':
      runPair();
      return;
    case 'status':
      runStatus();
      return;
    case 'stop':
      await runStop();
      return;
    case 'doctor':
      await runDoctor();
      return;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    default:
      console.error(`Unknown command: ${command}\n`);
      printHelp();
      process.exit(2);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
