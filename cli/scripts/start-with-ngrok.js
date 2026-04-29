#!/usr/bin/env node
'use strict';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load .env so PUBLIC_URL overrides are respected
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const PORT = process.env.PORT ?? '3001';
const NGROK_ENABLED = (process.env.NGROK_ENABLED ?? 'true') !== 'false';
const TUNNEL_TIMEOUT_MS = 20_000;

const SERVER_DIR = path.join(__dirname, '..');
const TS_NODE = path.join(SERVER_DIR, 'node_modules', '.bin', 'ts-node');

let tunnelProc = null;
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

function findCloudflared() {
  const candidates = [];
  if (process.env.CLOUDFLARED_BIN) candidates.push(process.env.CLOUDFLARED_BIN);

  try {
    const result = execFileSync('which', ['cloudflared'], { encoding: 'utf8' }).trim();
    if (result) candidates.push(result);
  } catch {}

  candidates.push('/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared');

  const seen = new Set();
  for (const bin of candidates) {
    if (!bin || seen.has(bin)) continue;
    seen.add(bin);
    try {
      fs.accessSync(bin, fs.constants.X_OK);
      return bin;
    } catch {}
  }

  return null;
}

function spawnServer(env) {
  serverProc = spawn(TS_NODE, ['src/cli.ts', 'pair'], {
    cwd: SERVER_DIR,
    env,
    stdio: 'inherit',
  });
  serverProc.on('exit', (code) => {
    if (tunnelProc) { try { tunnelProc.kill('SIGTERM'); } catch {} }
    process.exit(code ?? 0);
  });
}

process.on('SIGINT', () => {
  if (serverProc) { try { serverProc.kill('SIGTERM'); } catch {} }
  if (tunnelProc) { try { tunnelProc.kill('SIGTERM'); } catch {} }
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (serverProc) { try { serverProc.kill('SIGTERM'); } catch {} }
  if (tunnelProc) { try { tunnelProc.kill('SIGTERM'); } catch {} }
  process.exit(0);
});

function startNgrok(bin) {
  return new Promise((resolve) => {
    const args = ['http', PORT, '--log=stdout', '--log-format=json'];
    if (process.env.NGROK_AUTHTOKEN) {
      args.push(`--authtoken=${process.env.NGROK_AUTHTOKEN}`);
    }

    tunnelProc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'inherit'] });

    const timer = setTimeout(() => {
      console.warn('[ngrok] timed out - trying cloudflared...');
      tunnelProc.kill('SIGTERM');
      tunnelProc = null;
      resolve(null);
    }, TUNNEL_TIMEOUT_MS);

    let buf = '';
    tunnelProc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        if (entry.lvl === 'eror' || entry.lvl === 'crit') {
          console.error(`[ngrok] ${entry.msg}${entry.err ? ': ' + entry.err : ''}`);
        }
        if (entry.msg === 'started tunnel' && typeof entry.url === 'string') {
          clearTimeout(timer);
          resolve(entry.url);
        }
      }
    });

    tunnelProc.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) console.warn(`[ngrok] exited with code ${code} - trying cloudflared...`);
      tunnelProc = null;
      resolve(null);
    });
  });
}

function startCloudflared(bin) {
  return new Promise((resolve) => {
    const args = ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'];

    tunnelProc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const timer = setTimeout(() => {
      console.warn('[cloudflared] timed out waiting for tunnel URL');
      resolve(null);
    }, TUNNEL_TIMEOUT_MS);

    const urlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

    function checkChunk(chunk) {
      const text = chunk.toString();
      const match = text.match(urlPattern);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    }

    tunnelProc.stdout.on('data', checkChunk);
    tunnelProc.stderr.on('data', checkChunk);

    tunnelProc.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) console.warn(`[cloudflared] exited with code ${code}`);
      tunnelProc = null;
      resolve(null);
    });
  });
}

async function main() {
  if (!NGROK_ENABLED) {
    console.log('ℹ️  NGROK_ENABLED=false - starting without tunnel');
    spawnServer(process.env);
    return;
  }

  if (process.env.PUBLIC_URL) {
    console.log(`ℹ️  Using PUBLIC_URL from config: ${process.env.PUBLIC_URL}`);
    spawnServer(process.env);
    return;
  }

  // Try ngrok first
  const ngrokBin = findNgrok();
  if (ngrokBin) {
    console.log(`ℹ️  Using ngrok binary: ${ngrokBin}`);
    console.log(`🚇 Starting ngrok tunnel on port ${PORT}...`);
    const tunnelUrl = await startNgrok(ngrokBin);
    if (tunnelUrl) {
      console.log(`🌍 ngrok tunnel ready: ${tunnelUrl}`);
      spawnServer({ ...process.env, PUBLIC_URL: tunnelUrl });
      return;
    }
  }

  // Fall back to cloudflared
  const cloudflaredBin = findCloudflared();
  if (cloudflaredBin) {
    console.log(`ℹ️  Using cloudflared binary: ${cloudflaredBin}`);
    console.log(`🚇 Starting cloudflared tunnel on port ${PORT}...`);
    const tunnelUrl = await startCloudflared(cloudflaredBin);
    if (tunnelUrl) {
      console.log(`🌍 cloudflared tunnel ready: ${tunnelUrl}`);
      spawnServer({ ...process.env, PUBLIC_URL: tunnelUrl });
      return;
    }
  }

  console.warn('⚠️  No tunnel available - starting LAN only');
  spawnServer(process.env);
}

main().catch((err) => {
  console.error('start-with-ngrok fatal error:', err);
  process.exit(1);
});
