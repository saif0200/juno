#!/usr/bin/env node
'use strict';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load .env so PUBLIC_URL overrides are respected
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const PORT = process.env.PORT ?? '3001';
const NGROK_ENABLED = (process.env.NGROK_ENABLED ?? 'true') !== 'false';
const NGROK_TIMEOUT_MS = 20_000;

const SERVER_DIR = path.join(__dirname, '..');
const TS_NODE = path.join(SERVER_DIR, 'node_modules', '.bin', 'ts-node');

let ngrokProc = null;
let serverProc = null;

function findNgrok() {
  const candidates = [];
  if (process.env.NGROK_BIN) candidates.push(process.env.NGROK_BIN);

  try {
    const result = execFileSync('which', ['ngrok'], { encoding: 'utf8' }).trim();
    if (result) candidates.push(result);
  } catch {}

  candidates.push('/opt/homebrew/bin/ngrok');

  const seen = new Set();
  for (const bin of candidates) {
    if (!bin || seen.has(bin)) continue;
    seen.add(bin);

    try {
      fs.accessSync(bin, fs.constants.X_OK);
      const versionOut = execFileSync(bin, ['version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const match = versionOut.match(/(\d+)\.(\d+)\.(\d+)/);
      if (!match) continue;

      const major = Number(match[1]);
      if (major < 3) {
        console.warn(`⚠️  Ignoring old ngrok binary at ${bin} (${versionOut})`);
        continue;
      }

      return bin;
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

function spawnServer(env) {
  serverProc = spawn(TS_NODE, ['src/index.ts'], {
    cwd: SERVER_DIR,
    env,
    stdio: 'inherit',
  });
  serverProc.on('exit', (code) => {
    if (ngrokProc) { try { ngrokProc.kill('SIGTERM'); } catch {} }
    process.exit(code ?? 0);
  });
}

process.on('SIGINT', () => {
  if (serverProc) { try { serverProc.kill('SIGTERM'); } catch {} }
  if (ngrokProc) { try { ngrokProc.kill('SIGTERM'); } catch {} }
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (serverProc) { try { serverProc.kill('SIGTERM'); } catch {} }
  if (ngrokProc) { try { ngrokProc.kill('SIGTERM'); } catch {} }
  process.exit(0);
});

// Start ngrok and resolve with the public https URL, or null on failure.
// Reads ngrok's stdout line-by-line so we never block on unread buffers,
// and we can show users exactly what ngrok says if something goes wrong.
function startNgrok(bin) {
  return new Promise((resolve) => {
    const args = ['http', PORT, '--log=stdout', '--log-format=json'];
    if (process.env.NGROK_AUTHTOKEN) {
      args.push(`--authtoken=${process.env.NGROK_AUTHTOKEN}`);
    }

    ngrokProc = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    const timer = setTimeout(() => {
      console.error('[ngrok] timed out waiting for tunnel — check ngrok auth/config');
      resolve(null);
    }, NGROK_TIMEOUT_MS);

    let buf = '';
    ngrokProc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        // Show errors to the user
        if (entry.lvl === 'eror' || entry.lvl === 'crit') {
          console.error(`[ngrok] ${entry.msg}${entry.err ? ': ' + entry.err : ''}`);
        }
        // Tunnel URL appears in the "started tunnel" event
        if (entry.msg === 'started tunnel' && typeof entry.url === 'string') {
          clearTimeout(timer);
          resolve(entry.url);
        }
      }
    });

    ngrokProc.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        console.error(`[ngrok] exited with code ${code}`);
      }
      resolve(null);
    });
  });
}

async function main() {
  if (!NGROK_ENABLED) {
    console.log('ℹ️  NGROK_ENABLED=false — starting without tunnel');
    spawnServer(process.env);
    return;
  }

  if (process.env.PUBLIC_URL) {
    console.log(`ℹ️  Using PUBLIC_URL from config: ${process.env.PUBLIC_URL}`);
    spawnServer(process.env);
    return;
  }

  const ngrokBin = findNgrok();
  if (!ngrokBin) {
    console.warn('⚠️  ngrok not found — starting without tunnel (LAN only)');
    spawnServer(process.env);
    return;
  }

  console.log(`ℹ️  Using ngrok binary: ${ngrokBin}`);
  console.log(`🚇 Starting ngrok tunnel on port ${PORT}...`);
  const tunnelUrl = await startNgrok(ngrokBin);

  if (!tunnelUrl) {
    console.warn('⚠️  Starting without tunnel (LAN only)');
    spawnServer(process.env);
    return;
  }

  console.log(`🌍 ngrok tunnel ready: ${tunnelUrl}`);
  spawnServer({ ...process.env, PUBLIC_URL: tunnelUrl });
}

main().catch((err) => {
  console.error('start-with-ngrok fatal error:', err);
  process.exit(1);
});
