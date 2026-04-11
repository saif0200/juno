import 'dotenv/config';

import { execFileSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import express from 'express';
import fs from 'fs';
import { createServer } from 'http';
import * as pty from 'node-pty';
import os from 'os';
import path from 'path';
import qrcode from 'qrcode-terminal';
import WebSocket, { WebSocketServer } from 'ws';

import type {
    ClientMessage,
    CreateSessionMessage,
    ErrorMessage,
    KillSessionMessage,
    PairingConnectionCandidate,
    PairingPayload,
    PingMessage,
    ProjectDefinition,
    ProjectSource,
    PromoteSessionMessage,
    ResumeSessionMessage,
    ServerMessage,
    SessionCreatedMessage,
    SessionRecord,
    SessionPromotedMessage,
    SessionResumedMessage,
    SessionSummary,
    TerminalPersistenceMode,
    TerminalInputMessage,
    TerminalResizeMessage,
} from './types';

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const SESSION_TTL_MS = Number.parseInt(process.env.SESSION_TTL_MS ?? '300000', 10);
const CLEANUP_INTERVAL_MS = Number.parseInt(
  process.env.SESSION_CLEANUP_INTERVAL_MS ?? '30000',
  10,
);
const DEFAULT_COLS = Number.parseInt(process.env.DEFAULT_TERMINAL_COLS ?? '120', 10);
const DEFAULT_ROWS = Number.parseInt(process.env.DEFAULT_TERMINAL_ROWS ?? '40', 10);
const OUTPUT_BUFFER_LIMIT = Number.parseInt(process.env.OUTPUT_BUFFER_LIMIT ?? '200000', 10);
const CLAUDE_COMMAND = resolveClaudeCommand(process.env.CLAUDE_COMMAND ?? 'claude');
const CLAUDE_ARGS = parseCommandArgs(process.env.CLAUDE_ARGS_JSON);
const SHELL = process.env.SHELL ?? '/bin/zsh';
const PROJECT_DISCOVERY_ENABLED = parseBooleanEnv(process.env.PROJECT_DISCOVERY_ENABLED, false);
const PROJECT_DISCOVERY_MAX_DEPTH = Number.parseInt(
  process.env.PROJECT_DISCOVERY_MAX_DEPTH ?? '2',
  10,
);
const PROJECT_DISCOVERY_PATHS = parseJsonStringArray(process.env.PROJECT_DISCOVERY_PATHS_JSON);
const SERVER_NAME = (process.env.PAIRING_SERVER_NAME ?? os.hostname()).trim() || os.hostname();
const SERVER_ID = `${SERVER_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${PORT}`;
const PUBLIC_URL = (() => {
  const raw = process.env.PUBLIC_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin; // e.g. "https://abc123.ngrok.io"
  } catch {
    console.warn('⚠️  PUBLIC_URL is not a valid URL — ignoring.');
    return null;
  }
})();
const PROJECTS_CONFIG_PATH = process.env.PROJECTS_CONFIG_PATH
  ? path.resolve(process.env.PROJECTS_CONFIG_PATH)
  : path.resolve(process.cwd(), 'projects.json');

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });
const sessions = new Map<string, SessionRecord>();
const projects = loadProjects(PROJECTS_CONFIG_PATH);

interface ProjectCatalogConfig {
  projects: ProjectDefinition[];
  discoveryRoots: string[];
  discoveryEnabled: boolean;
  discoveryMaxDepth: number;
}

interface ProjectConfigEntry {
  id?: string;
  name?: string;
  path: string;
  favorite?: boolean;
}

interface ProjectsConfigFile {
  projects?: ProjectConfigEntry[];
  discovery?: {
    enabled?: boolean;
    paths?: string[];
    maxDepth?: number;
  };
}

app.get('/health', (_request: Request, response: Response) => {
  response.json({
    status: 'ok',
    serverId: SERVER_ID,
    serverName: SERVER_NAME,
    command: CLAUDE_COMMAND,
    args: CLAUDE_ARGS,
    activeSessions: sessions.size,
    projectCount: projects.length,
    pairingPath: '/pairing',
    dashboardPath: '/dashboard',
  });
});

app.get('/pairing', (request: Request, response: Response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.json(createPairingPayload(request));
});

app.get('/dashboard', (request: Request, response: Response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.type('html').send(renderDashboard(createPairingPayload(request)));
});

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  if (value === '1' || value.toLowerCase() === 'true') {
    return true;
  }

  if (value === '0' || value.toLowerCase() === 'false') {
    return false;
  }

  return fallback;
}

function parseCommandArgs(rawValue: string | undefined): string[] {
  if (!rawValue || rawValue.trim().length === 0) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) {
      return parsed;
    }
  } catch {
    console.warn('⚠️ CLAUDE_ARGS_JSON is not valid JSON. Falling back to no extra args.');
  }

  return [];
}

function parseJsonStringArray(rawValue: string | undefined): string[] {
  if (!rawValue || rawValue.trim().length === 0) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) {
      return parsed;
    }
  } catch {
    console.warn('⚠️ PROJECT_DISCOVERY_PATHS_JSON is not valid JSON. Ignoring discovery paths.');
  }

  return [];
}

function resolveClaudeCommand(command: string): string {
  if (command.includes('/')) {
    return command;
  }

  try {
    const resolved = execFileSync('which', [command], {
      encoding: 'utf8',
    }).trim();
    if (resolved.length > 0) {
      return resolved;
    }
  } catch {
    console.warn(`⚠️ Could not resolve ${command} with 'which'. Using raw command name.`);
  }

  return command;
}

function loadProjects(configPath: string): ProjectDefinition[] {
  const configured = loadProjectCatalogConfig(configPath);
  const discovered = configured.discoveryEnabled
    ? discoverProjects(configured.discoveryRoots, configured.discoveryMaxDepth)
    : [];
  const merged = mergeProjects(configured.projects, discovered);

  console.log(
    `📁 Loaded ${configured.projects.length} configured project(s) and ${discovered.length} discovered project(s)`,
  );
  return merged;
}

function loadProjectCatalogConfig(configPath: string): ProjectCatalogConfig {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const config = parseProjectsConfig(parsed);
    const configuredProjects = config.projects ?? [];
    const projects = configuredProjects.map((project) =>
      normalizeProject(project, {
        source: 'config',
        fallbackIdPrefix: 'config',
        isFavorite: project.favorite ?? true,
      }),
    );

    return {
      projects,
      discoveryEnabled: config.discovery?.enabled ?? PROJECT_DISCOVERY_ENABLED,
      discoveryRoots: normalizeDiscoveryRoots(config.discovery?.paths ?? PROJECT_DISCOVERY_PATHS),
      discoveryMaxDepth: normalizeDiscoveryDepth(
        config.discovery?.maxDepth ?? PROJECT_DISCOVERY_MAX_DEPTH,
      ),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ Failed to load projects config: ${message}`);
    return {
      projects: [],
      discoveryEnabled: PROJECT_DISCOVERY_ENABLED,
      discoveryRoots: normalizeDiscoveryRoots(PROJECT_DISCOVERY_PATHS),
      discoveryMaxDepth: normalizeDiscoveryDepth(PROJECT_DISCOVERY_MAX_DEPTH),
    };
  }
}

function parseProjectsConfig(value: unknown): ProjectsConfigFile {
  if (Array.isArray(value)) {
    return {
      projects: value.map((entry) => parseProjectConfigEntry(entry)),
    };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('projects.json must contain an array or object.');
  }

  const candidate = value as Record<string, unknown>;
  const projectsValue = candidate.projects;
  const discoveryValue = candidate.discovery;

  if (projectsValue !== undefined && !Array.isArray(projectsValue)) {
    throw new Error('projects.projects must be an array when provided.');
  }

  if (
    discoveryValue !== undefined &&
    (!discoveryValue || typeof discoveryValue !== 'object' || Array.isArray(discoveryValue))
  ) {
    throw new Error('projects.discovery must be an object when provided.');
  }

  const discoveryCandidate = discoveryValue as Record<string, unknown> | undefined;
  const discoveryPaths = discoveryCandidate?.paths;
  if (
    discoveryPaths !== undefined &&
    (!Array.isArray(discoveryPaths) || discoveryPaths.some((entry) => typeof entry !== 'string'))
  ) {
    throw new Error('projects.discovery.paths must be an array of strings when provided.');
  }

  const discoveryMaxDepth = discoveryCandidate?.maxDepth;
  if (discoveryMaxDepth !== undefined && typeof discoveryMaxDepth !== 'number') {
    throw new Error('projects.discovery.maxDepth must be a number when provided.');
  }

  const discoveryEnabled = discoveryCandidate?.enabled;
  if (discoveryEnabled !== undefined && typeof discoveryEnabled !== 'boolean') {
    throw new Error('projects.discovery.enabled must be a boolean when provided.');
  }

  const result: ProjectsConfigFile = {
    projects: Array.isArray(projectsValue)
      ? projectsValue.map((entry) => parseProjectConfigEntry(entry))
      : [],
  };

  if (discoveryCandidate) {
    const discoveryConfig: NonNullable<ProjectsConfigFile['discovery']> = {};
    if (discoveryEnabled !== undefined) {
      discoveryConfig.enabled = discoveryEnabled;
    }
    if (discoveryPaths !== undefined) {
      discoveryConfig.paths = discoveryPaths as string[];
    }
    if (discoveryMaxDepth !== undefined) {
      discoveryConfig.maxDepth = discoveryMaxDepth as number;
    }
    result.discovery = discoveryConfig;
  }

  return result;
}

function parseProjectConfigEntry(value: unknown): ProjectConfigEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Each project entry must be an object.');
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.path !== 'string') {
    throw new Error('Each project entry must include a string path.');
  }

  if (candidate.id !== undefined && typeof candidate.id !== 'string') {
    throw new Error('Project id must be a string when provided.');
  }

  if (candidate.name !== undefined && typeof candidate.name !== 'string') {
    throw new Error('Project name must be a string when provided.');
  }

  if (candidate.favorite !== undefined && typeof candidate.favorite !== 'boolean') {
    throw new Error('Project favorite must be a boolean when provided.');
  }

  const entry: ProjectConfigEntry = {
    path: candidate.path,
  };

  if (typeof candidate.id === 'string') {
    entry.id = candidate.id;
  }

  if (typeof candidate.name === 'string') {
    entry.name = candidate.name;
  }

  if (typeof candidate.favorite === 'boolean') {
    entry.favorite = candidate.favorite;
  }

  return entry;
}

function formatHostForUrl(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

function buildBaseUrls(host: string): { httpBaseUrl: string; wsBaseUrl: string } {
  const formattedHost = formatHostForUrl(host);
  return {
    httpBaseUrl: `http://${formattedHost}:${PORT}`,
    wsBaseUrl: `ws://${formattedHost}:${PORT}`,
  };
}

function buildBaseUrlsFromRequest(
  address: string,
  request: Request,
): { httpBaseUrl: string; wsBaseUrl: string } {
  if (PUBLIC_URL) {
    const u = new URL(PUBLIC_URL);
    return {
      httpBaseUrl: PUBLIC_URL,
      wsBaseUrl: `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}`,
    };
  }

  // Detect tunnel/reverse-proxy via X-Forwarded-Proto
  if (request.get('x-forwarded-proto') === 'https') {
    const formattedHost = formatHostForUrl(address);
    return {
      httpBaseUrl: `https://${formattedHost}`,
      wsBaseUrl: `wss://${formattedHost}`,
    };
  }

  return buildBaseUrls(address);
}

function stripPortFromHostHeader(hostHeader: string): string {
  if (hostHeader.startsWith('[')) {
    const endIndex = hostHeader.indexOf(']');
    return endIndex >= 0 ? hostHeader.slice(1, endIndex) : hostHeader;
  }

  const [hostname] = hostHeader.split(':');
  return hostname ?? hostHeader;
}

function guessAddressFamily(host: string): 'IPv4' | 'IPv6' {
  return host.includes(':') ? 'IPv6' : 'IPv4';
}

function createConnectionCandidate(
  interfaceName: string,
  address: string,
  family: 'IPv4' | 'IPv6',
  isInternal: boolean,
): PairingConnectionCandidate {
  const { httpBaseUrl, wsBaseUrl } = buildBaseUrls(address);

  return {
    interfaceName,
    family,
    address,
    isInternal,
    isPreferred: false,
    httpBaseUrl,
    wsBaseUrl,
    pairingUrl: `${httpBaseUrl}/pairing`,
    dashboardUrl: `${httpBaseUrl}/dashboard`,
    healthUrl: `${httpBaseUrl}/health`,
    wsUrl: wsBaseUrl,
  };
}

function collectConnectionCandidates(): PairingConnectionCandidate[] {
  const seen = new Set<string>();
  const candidates: PairingConnectionCandidate[] = [];
  const interfaces = os.networkInterfaces();

  for (const [interfaceName, addresses] of Object.entries(interfaces)) {
    if (!addresses) {
      continue;
    }

    for (const addressInfo of addresses) {
      if (addressInfo.family !== 'IPv4' && addressInfo.family !== 'IPv6') {
        continue;
      }

      const key = `${addressInfo.family}:${addressInfo.address}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push(
        createConnectionCandidate(
          interfaceName,
          addressInfo.address,
          addressInfo.family,
          addressInfo.internal,
        ),
      );
    }
  }

  if (!seen.has('IPv4:127.0.0.1')) {
    candidates.push(createConnectionCandidate('loopback', '127.0.0.1', 'IPv4', true));
  }

  if (!seen.has('IPv4:localhost')) {
    candidates.push(createConnectionCandidate('loopback-hostname', 'localhost', 'IPv4', true));
  }

  return candidates.sort((left, right) => {
    if (left.isInternal !== right.isInternal) {
      return left.isInternal ? 1 : -1;
    }

    if (left.family !== right.family) {
      return left.family === 'IPv4' ? -1 : 1;
    }

    return left.interfaceName.localeCompare(right.interfaceName);
  });
}

function pickPreferredCandidate(
  request: Request,
  candidates: PairingConnectionCandidate[],
): PairingConnectionCandidate {
  // Explicit PUBLIC_URL always wins
  if (PUBLIC_URL) {
    const u = new URL(PUBLIC_URL);
    const wsProto = u.protocol === 'https:' ? 'wss' : 'ws';
    const wsBaseUrl = `${wsProto}://${u.host}`;
    return {
      interfaceName: 'public-url',
      family: 'IPv4',
      address: u.hostname,
      isInternal: false,
      isPreferred: true,
      httpBaseUrl: PUBLIC_URL,
      wsBaseUrl,
      pairingUrl: `${PUBLIC_URL}/pairing`,
      dashboardUrl: `${PUBLIC_URL}/dashboard`,
      healthUrl: `${PUBLIC_URL}/health`,
      wsUrl: wsBaseUrl,
    };
  }

  const fallbackCandidate =
    candidates[0] ?? createConnectionCandidate('loopback', '127.0.0.1', 'IPv4', true);
  const hostHeader = request.get('host');
  const requestedHost = hostHeader ? stripPortFromHostHeader(hostHeader) : null;

  if (requestedHost && requestedHost.length > 0) {
    const matchingCandidate = candidates.find((candidate) => candidate.address === requestedHost);
    if (matchingCandidate) {
      return matchingCandidate;
    }

    // Use proxy-aware URL builder (handles tunnel X-Forwarded-Proto)
    const { httpBaseUrl, wsBaseUrl } = buildBaseUrlsFromRequest(requestedHost, request);
    const isInternal =
      requestedHost === 'localhost' || requestedHost === '127.0.0.1' || requestedHost === '::1';
    return {
      interfaceName: 'requested-host',
      family: guessAddressFamily(requestedHost),
      address: requestedHost,
      isInternal,
      isPreferred: false,
      httpBaseUrl,
      wsBaseUrl,
      pairingUrl: `${httpBaseUrl}/pairing`,
      dashboardUrl: `${httpBaseUrl}/dashboard`,
      healthUrl: `${httpBaseUrl}/health`,
      wsUrl: wsBaseUrl,
    };
  }

  return (
    candidates.find((candidate) => !candidate.isInternal && candidate.family === 'IPv4') ??
    candidates.find((candidate) => !candidate.isInternal) ??
    fallbackCandidate
  );
}

function createPairingPayload(request: Request): PairingPayload {
  const candidates = collectConnectionCandidates();
  const preferred = pickPreferredCandidate(request, candidates);
  const preferredAddressKey = `${preferred.family}:${preferred.address}`;
  const preferredCandidates = candidates.map((candidate) => ({
    ...candidate,
    isPreferred: `${candidate.family}:${candidate.address}` === preferredAddressKey,
  }));
  const resolvedPreferred =
    preferredCandidates.find((candidate) => candidate.isPreferred) ?? { ...preferred, isPreferred: true };

  return {
    schema: 'juno-relay-pairing.v1',
    generatedAt: new Date().toISOString(),
    serverId: SERVER_ID,
    serverName: SERVER_NAME,
    relayVersion: 1,
    transport: {
      port: PORT,
      websocketPath: '/',
      pairingPath: '/pairing',
      dashboardPath: '/dashboard',
      healthPath: '/health',
      manualWebSocketEntrySupported: true,
    },
    connection: {
      preferred: resolvedPreferred,
      candidates: preferredCandidates,
    },
    projects: projects.map(({ id, name }) => ({ id, name })),
    capabilities: {
      sessionReconnect: true,
      projectListing: true,
      pairingDashboard: true,
    },
    qr: {
      format: 'pairing_url',
      value: resolvedPreferred.pairingUrl,
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderDashboard(payload: PairingPayload): string {
  const candidateItems = payload.connection.candidates
    .map((candidate) => {
      const preferredLabel = candidate.isPreferred ? ' (preferred)' : '';
      const scopeLabel = candidate.isInternal ? 'loopback only' : 'LAN reachable';
      return `<li>
        <strong>${escapeHtml(candidate.address)}</strong>${escapeHtml(preferredLabel)}
        <div>HTTP: <a href="${escapeHtml(candidate.pairingUrl)}">${escapeHtml(candidate.pairingUrl)}</a></div>
        <div>WebSocket fallback: <code>${escapeHtml(candidate.wsUrl)}</code></div>
        <div>${escapeHtml(candidate.interfaceName)} · ${escapeHtml(candidate.family)} · ${escapeHtml(scopeLabel)}</div>
      </li>`;
    })
    .join('');

  const projectItems =
    payload.projects.length > 0
      ? payload.projects
          .map((project) => `<li><code>${escapeHtml(project.id)}</code> ${escapeHtml(project.name)}</li>`)
          .join('')
      : '<li>No projects loaded from projects.json</li>';

  const payloadJson = escapeHtml(JSON.stringify(payload, null, 2));

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(payload.serverName)} Pairing</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f3efe5;
        --panel: #fffdf8;
        --ink: #182126;
        --muted: #58636b;
        --accent: #0a7f5a;
        --border: #d8d0c0;
      }
      body {
        margin: 0;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top right, rgba(10, 127, 90, 0.12), transparent 30%),
          linear-gradient(180deg, #f7f2e8 0%, var(--bg) 100%);
        color: var(--ink);
      }
      main {
        max-width: 920px;
        margin: 0 auto;
        padding: 32px 20px 48px;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 20px;
        box-shadow: 0 20px 50px rgba(24, 33, 38, 0.08);
      }
      h1, h2 {
        margin: 0 0 12px;
      }
      p, li, code, pre {
        line-height: 1.5;
      }
      a {
        color: var(--accent);
      }
      code, pre {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      pre {
        overflow-x: auto;
        padding: 16px;
        border-radius: 14px;
        background: #172127;
        color: #f2f7f5;
      }
      ul {
        padding-left: 20px;
      }
      .grid {
        display: grid;
        gap: 16px;
      }
      @media (min-width: 760px) {
        .grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="panel">
        <p>Claude Relay Pairing</p>
        <h1>${escapeHtml(payload.serverName)}</h1>
        <p>Scan or copy the pairing URL on your phone. The mobile app should fetch pairing metadata first, then connect to the preferred WebSocket URL it receives.</p>
        <p><strong>QR-friendly value:</strong> <code>${escapeHtml(payload.qr.value)}</code></p>
      </section>
      <div class="grid" style="margin-top: 16px;">
        <section class="panel">
          <h2>Connection Targets</h2>
          <ul>${candidateItems}</ul>
        </section>
        <section class="panel">
          <h2>Projects</h2>
          <ul>${projectItems}</ul>
          <p>Manual fallback remains available. A client can still connect directly to <code>${escapeHtml(
            payload.connection.preferred.wsUrl,
          )}</code>.</p>
        </section>
      </div>
      <section class="panel" style="margin-top: 16px;">
        <h2>Pairing Payload</h2>
        <pre>${payloadJson}</pre>
      </section>
    </main>
  </body>
</html>`;
}

function normalizeDiscoveryRoots(roots: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const root of roots) {
    const resolved = resolveConfiguredPath(root);
    if (!resolved || seen.has(resolved)) {
      continue;
    }

    seen.add(resolved);
    normalized.push(resolved);
  }

  return normalized;
}

function normalizeDiscoveryDepth(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 2;
  }

  return Math.floor(value);
}

function resolveConfiguredPath(rawPath: string): string {
  if (rawPath.trim().length === 0) {
    return '';
  }

  const expandedHome =
    rawPath === '~' || rawPath.startsWith('~/')
      ? path.join(os.homedir(), rawPath.slice(2))
      : rawPath;
  const resolved = path.resolve(expandedHome);

  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function normalizeProject(
  project: ProjectConfigEntry,
  options: {
    source: ProjectSource;
    fallbackIdPrefix: string;
    isFavorite: boolean;
  },
): ProjectDefinition {
  const resolvedPath = resolveConfiguredPath(project.path);
  const available = directoryExists(resolvedPath);
  const derivedName = project.name?.trim() || path.basename(resolvedPath) || resolvedPath;
  const baseId =
    project.id?.trim() || deriveProjectId(options.fallbackIdPrefix, resolvedPath, derivedName);

  return {
    id: baseId,
    name: derivedName,
    path: resolvedPath,
    source: options.source,
    isFavorite: options.isFavorite,
    available,
  };
}

function deriveProjectId(prefix: string, projectPath: string, name: string): string {
  const slugBase = slugify(name) || slugify(path.basename(projectPath)) || 'project';
  const hash = createHash('sha1').update(projectPath).digest('hex').slice(0, 8);
  return `${prefix}-${slugBase}-${hash}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function directoryExists(projectPath: string): boolean {
  try {
    return fs.statSync(projectPath).isDirectory();
  } catch {
    return false;
  }
}

function discoverProjects(roots: string[], maxDepth: number): ProjectDefinition[] {
  const discovered: ProjectDefinition[] = [];
  const seenPaths = new Set<string>();

  for (const root of roots) {
    if (!directoryExists(root)) {
      continue;
    }

    walkForGitRepos(root, 0, maxDepth, discovered, seenPaths);
  }

  discovered.sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) {
      return byName;
    }

    return left.path.localeCompare(right.path);
  });
  return discovered;
}

function walkForGitRepos(
  currentPath: string,
  depth: number,
  maxDepth: number,
  discovered: ProjectDefinition[],
  seenPaths: Set<string>,
): void {
  if (depth > maxDepth) {
    return;
  }

  if (isGitRepository(currentPath)) {
    const resolvedPath = resolveConfiguredPath(currentPath);
    if (!seenPaths.has(resolvedPath)) {
      seenPaths.add(resolvedPath);
      discovered.push({
        id: deriveProjectId('discovered', resolvedPath, path.basename(resolvedPath)),
        name: path.basename(resolvedPath) || resolvedPath,
        path: resolvedPath,
        source: 'discovered',
        isFavorite: false,
        available: true,
      });
    }
    return;
  }

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (shouldSkipDirectory(entry.name)) {
      continue;
    }

    walkForGitRepos(path.join(currentPath, entry.name), depth + 1, maxDepth, discovered, seenPaths);
  }
}

function isGitRepository(projectPath: string): boolean {
  const gitPath = path.join(projectPath, '.git');
  try {
    const stat = fs.statSync(gitPath);
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

function shouldSkipDirectory(name: string): boolean {
  return (
    name === '.git' ||
    name === 'node_modules' ||
    name === 'dist' ||
    name === 'build' ||
    name === '.next' ||
    name === '.turbo'
  );
}

function mergeProjects(
  configuredProjects: ProjectDefinition[],
  discoveredProjects: ProjectDefinition[],
): ProjectDefinition[] {
  const merged: ProjectDefinition[] = [];
  const seenPaths = new Set<string>();
  const seenIds = new Set<string>();

  for (const project of [...configuredProjects, ...discoveredProjects]) {
    const resolvedPath = resolveConfiguredPath(project.path);
    if (seenPaths.has(resolvedPath)) {
      continue;
    }

    let id = project.id;
    let duplicateAttempt = 0;
    while (seenIds.has(id)) {
      duplicateAttempt += 1;
      id = `${project.id}-${createHash('sha1')
        .update(`${resolvedPath}:${duplicateAttempt}`)
        .digest('hex')
        .slice(0, 4)}`;
    }

    seenPaths.add(resolvedPath);
    seenIds.add(id);
    merged.push({
      ...project,
      id,
      path: resolvedPath,
      available: directoryExists(resolvedPath),
    });
  }

  return merged;
}

function now(): number {
  return Date.now();
}

function trimBuffer(value: string): string {
  if (value.length <= OUTPUT_BUFFER_LIMIT) {
    return value;
  }

  return value.slice(value.length - OUTPUT_BUFFER_LIMIT);
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sendMessage(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(message));
}

function sendError(socket: WebSocket, error: ErrorMessage): void {
  console.error(`❌ ${error.code}: ${error.message}`);
  sendMessage(socket, error);
}

function createTerminalExitMessage(
  sessionId: string,
  exitCode: number,
  signal: number | null,
): ServerMessage {
  if (signal === null || signal === 0) {
    return {
      type: 'terminal_exit',
      sessionId,
      exitCode,
    };
  }

  return {
    type: 'terminal_exit',
    sessionId,
    exitCode,
    signal,
  };
}

function refreshSession(session: SessionRecord): void {
  session.updatedAt = now();
  session.expiresAt = session.updatedAt + SESSION_TTL_MS;
}

function createSessionSummary(session: SessionRecord): SessionSummary {
  return {
    sessionId: session.id,
    projectId: session.projectId,
    projectName: session.projectName,
    projectPath: session.projectPath,
    projectSource: session.projectSource,
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.updatedAt).toISOString(),
    expiresAt: new Date(session.expiresAt).toISOString(),
    hasActiveProcess: !session.hasExited,
    persistence: session.persistence,
    ...(session.clientTabId ? { clientTabId: session.clientTabId } : {}),
  };
}

function spawnClaudePty(
  sessionId: string,
  cols: number,
  rows: number,
  projectPath: string,
): pty.IPty {
  const commandLine = [CLAUDE_COMMAND, ...CLAUDE_ARGS].map(shellEscape).join(' ');
  console.log(`🤖 Spawning Claude PTY for ${sessionId} in ${projectPath}: ${commandLine}`);

  return pty.spawn(SHELL, ['-lc', `cd ${shellEscape(projectPath)} && exec ${commandLine}`], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: projectPath,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  });
}

function createSession(
  project: ProjectDefinition,
  socket: WebSocket | null,
  options?: {
    clientTabId?: string;
    persistence?: TerminalPersistenceMode;
  },
): SessionRecord {
  const id = `session-${randomUUID()}`;
  const createdAt = now();
  const processPty = spawnClaudePty(id, DEFAULT_COLS, DEFAULT_ROWS, project.path);

  const session: SessionRecord = {
    id,
    socket,
    pty: processPty,
    projectId: project.id,
    projectName: project.name,
    projectPath: project.path,
    projectSource: project.source,
    outputBuffer: '',
    createdAt,
    updatedAt: createdAt,
    expiresAt: createdAt + SESSION_TTL_MS,
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    hasExited: false,
    exitCode: null,
    signal: null,
    clientTabId: options?.clientTabId ?? null,
    persistence: options?.persistence ?? 'ephemeral',
  };

  processPty.onData((data: string) => {
    session.outputBuffer = trimBuffer(session.outputBuffer + data);
    refreshSession(session);

    if (session.socket && session.socket.readyState === WebSocket.OPEN) {
      sendMessage(session.socket, {
        type: 'terminal_output',
        sessionId: session.id,
        data,
      });
    }
  });

  processPty.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    session.hasExited = true;
    session.exitCode = exitCode;
    session.signal = signal ?? null;
    refreshSession(session);
    console.log(`🤖 Claude PTY exited for ${session.id}: code=${exitCode}, signal=${signal ?? 0}`);

    if (session.socket && session.socket.readyState === WebSocket.OPEN) {
      sendMessage(
        session.socket,
        createTerminalExitMessage(session.id, exitCode, signal ?? null),
      );
    }
  });

  sessions.set(id, session);
  return session;
}

function attachSocket(session: SessionRecord, socket: WebSocket): void {
  session.socket = socket;
  refreshSession(session);
}

function detachSocket(sessionId: string, socket: WebSocket): void {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }

  if (session.socket === socket) {
    session.socket = null;
    refreshSession(session);
  }
}

function cleanupExpiredSessions(): void {
  const timestamp = now();
  for (const [sessionId, session] of sessions.entries()) {
    if (session.expiresAt > timestamp) {
      continue;
    }

    console.log(`🧹 Session expired: ${sessionId}`);
    if (session.socket && session.socket.readyState === WebSocket.OPEN) {
      session.socket.close(4000, 'Session expired');
    }
    if (!session.hasExited) {
      session.pty.kill();
    }
    sessions.delete(sessionId);
  }
}

function resolveSessionIdFromRequest(requestUrl: string | undefined): string | null {
  if (!requestUrl) {
    return null;
  }

  const parsedUrl = new URL(requestUrl, `http://localhost:${PORT}`);
  const sessionId = parsedUrl.searchParams.get('sessionId');
  return sessionId && sessionId.length > 0 ? sessionId : null;
}

function parseMessage(raw: WebSocket.RawData): ClientMessage | null {
  const parsed: unknown = JSON.parse(raw.toString());
  if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;

  if (candidate.type === 'list_projects') {
    return { type: 'list_projects' };
  }

  if (candidate.type === 'list_sessions') {
    return { type: 'list_sessions' };
  }

  if (candidate.type === 'create_session' && typeof candidate.projectId === 'string') {
    const clientTabId =
      typeof candidate.clientTabId === 'string' && candidate.clientTabId.trim().length > 0
        ? candidate.clientTabId
        : undefined;
    const persistence =
      candidate.persistence === 'persisted' || candidate.persistence === 'ephemeral'
        ? candidate.persistence
        : undefined;

    const payload: CreateSessionMessage = {
      type: 'create_session',
      projectId: candidate.projectId,
    };
    if (clientTabId) {
      payload.clientTabId = clientTabId;
    }
    if (persistence) {
      payload.persistence = persistence;
    }

    return payload;
  }

  if (candidate.type === 'terminal_input' && typeof candidate.data === 'string') {
    return { type: 'terminal_input', data: candidate.data };
  }

  if (
    candidate.type === 'terminal_resize' &&
    typeof candidate.cols === 'number' &&
    typeof candidate.rows === 'number' &&
    Number.isInteger(candidate.cols) &&
    Number.isInteger(candidate.rows) &&
    candidate.cols > 0 &&
    candidate.rows > 0
  ) {
    return {
      type: 'terminal_resize',
      cols: candidate.cols,
      rows: candidate.rows,
    };
  }

  if (candidate.type === 'resume_session' && typeof candidate.sessionId === 'string') {
    return {
      type: 'resume_session',
      sessionId: candidate.sessionId,
    };
  }

  if (candidate.type === 'ping') {
    return { type: 'ping' };
  }

  if (candidate.type === 'kill_session') {
    return { type: 'kill_session' };
  }

  if (candidate.type === 'promote_session') {
    return { type: 'promote_session' };
  }

  return null;
}

function sendSnapshot(socket: WebSocket, session: SessionRecord): void {
  sendMessage(socket, {
    type: 'terminal_snapshot',
    sessionId: session.id,
    data: session.outputBuffer,
  });

  if (session.hasExited && session.exitCode !== null) {
    sendMessage(socket, createTerminalExitMessage(session.id, session.exitCode, session.signal));
  }
}

function handleListProjects(socket: WebSocket): void {
  sendMessage(socket, {
    type: 'projects_list',
    projects,
  });
}

function handleListSessions(socket: WebSocket): void {
  const sessionList = Array.from(sessions.values())
    .filter((session) => session.persistence === 'persisted')
    .map(createSessionSummary)
    .sort((left, right) => {
      const updatedDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      if (updatedDelta !== 0) {
        return updatedDelta;
      }

      const createdDelta = Date.parse(right.createdAt) - Date.parse(left.createdAt);
      if (createdDelta !== 0) {
        return createdDelta;
      }

      return left.sessionId.localeCompare(right.sessionId);
    });

  sendMessage(socket, {
    type: 'sessions_list',
    sessions: sessionList,
  });
}

function handleCreateSession(socket: WebSocket, message: CreateSessionMessage): SessionRecord | null {
  const project = projects.find((entry) => entry.id === message.projectId);
  if (!project) {
    sendError(socket, {
      type: 'error',
      code: 'PROJECT_NOT_FOUND',
      message: `Project not found: ${message.projectId}`,
    });
    return null;
  }

  if (!project.available || !directoryExists(project.path)) {
    sendError(socket, {
      type: 'error',
      code: 'PROJECT_NOT_FOUND',
      message: `Project path does not exist: ${project.path}`,
    });
    return null;
  }

  const createOptions: { clientTabId?: string; persistence?: TerminalPersistenceMode } = {};
  if (message.clientTabId) {
    createOptions.clientTabId = message.clientTabId;
  }
  if (message.persistence) {
    createOptions.persistence = message.persistence;
  }

  const session = createSession(project, socket, createOptions);
  attachSocket(session, socket);
  console.log(`✅ New project session created: ${session.id} (${project.name})`);

  const payload: SessionCreatedMessage = {
    type: 'session_created',
    sessionId: session.id,
    projectId: session.projectId,
    projectName: session.projectName,
    projectPath: session.projectPath,
    projectSource: session.projectSource,
    expiresAt: new Date(session.expiresAt).toISOString(),
    cols: session.cols,
    rows: session.rows,
    command: [CLAUDE_COMMAND, ...CLAUDE_ARGS].join(' ').trim(),
    persistence: session.persistence,
    ...(session.clientTabId ? { clientTabId: session.clientTabId } : {}),
  };
  sendMessage(socket, payload);
  sendSnapshot(socket, session);
  return session;
}

function handleResumeSession(socket: WebSocket, message: ResumeSessionMessage): SessionRecord | null {
  const existingSession = sessions.get(message.sessionId);
  if (!existingSession) {
    sendError(socket, {
      type: 'error',
      code: 'SESSION_NOT_FOUND',
      message: `Session not found: ${message.sessionId}`,
    });
    return null;
  }

  attachSocket(existingSession, socket);
  console.log(`🔄 Session resumed: ${existingSession.id}`);

  const payload: SessionResumedMessage = {
    type: 'session_resumed',
    sessionId: existingSession.id,
    projectId: existingSession.projectId,
    projectName: existingSession.projectName,
    projectPath: existingSession.projectPath,
    projectSource: existingSession.projectSource,
    expiresAt: new Date(existingSession.expiresAt).toISOString(),
    cols: existingSession.cols,
    rows: existingSession.rows,
    hasActiveProcess: !existingSession.hasExited,
    persistence: existingSession.persistence,
    ...(existingSession.clientTabId ? { clientTabId: existingSession.clientTabId } : {}),
  };
  sendMessage(socket, payload);
  sendSnapshot(socket, existingSession);
  return existingSession;
}

function handlePing(socket: WebSocket, session: SessionRecord, _message: PingMessage): void {
  refreshSession(session);
  sendMessage(socket, {
    type: 'pong',
    sessionId: session.id,
    expiresAt: new Date(session.expiresAt).toISOString(),
  });
}

function handleTerminalInput(session: SessionRecord, message: TerminalInputMessage): void {
  if (session.hasExited) {
    console.warn(`⚠️ Ignoring input for exited session ${session.id}`);
    return;
  }

  session.pty.write(message.data);
  refreshSession(session);
}

function handleTerminalResize(session: SessionRecord, message: TerminalResizeMessage): void {
  session.cols = message.cols;
  session.rows = message.rows;
  refreshSession(session);

  if (!session.hasExited) {
    session.pty.resize(message.cols, message.rows);
  }
}

function handleKillSession(socket: WebSocket, session: SessionRecord, _message: KillSessionMessage): void {
  console.log(`🛑 Kill requested for ${session.id}`);

  if (!session.hasExited) {
    session.pty.kill();
  }

  sessions.delete(session.id);
  sendMessage(socket, createTerminalExitMessage(session.id, session.exitCode ?? 0, session.signal));
}

function handlePromoteSession(
  socket: WebSocket,
  session: SessionRecord,
  _message: PromoteSessionMessage,
): void {
  if (session.persistence === 'persisted') {
    sendMessage(socket, {
      type: 'session_promoted',
      sessionId: session.id,
      persistence: 'persisted',
      ...(session.clientTabId ? { clientTabId: session.clientTabId } : {}),
    });
    return;
  }

  session.persistence = 'persisted';
  refreshSession(session);

  const payload: SessionPromotedMessage = {
    type: 'session_promoted',
    sessionId: session.id,
    persistence: 'persisted',
    ...(session.clientTabId ? { clientTabId: session.clientTabId } : {}),
  };
  sendMessage(socket, payload);
}

setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL_MS);

wss.on('connection', (socket: WebSocket, request: Request) => {
  const requestedSessionId = resolveSessionIdFromRequest(request.url);

  if (requestedSessionId) {
    const existingSession = sessions.get(requestedSessionId);
    if (existingSession) {
      attachSocket(existingSession, socket);
      console.log(`✅ Client reconnected: ${existingSession.id}`);

      const payload: SessionResumedMessage = {
        type: 'session_resumed',
        sessionId: existingSession.id,
        projectId: existingSession.projectId,
        projectName: existingSession.projectName,
        projectPath: existingSession.projectPath,
        projectSource: existingSession.projectSource,
        expiresAt: new Date(existingSession.expiresAt).toISOString(),
        cols: existingSession.cols,
        rows: existingSession.rows,
        hasActiveProcess: !existingSession.hasExited,
        persistence: existingSession.persistence,
        ...(existingSession.clientTabId ? { clientTabId: existingSession.clientTabId } : {}),
      };
      sendMessage(socket, payload);
      sendSnapshot(socket, existingSession);
    }
  }

  socket.on('message', (raw: WebSocket.RawData) => {
    try {
      const message = parseMessage(raw);
      if (!message) {
        sendError(socket, {
          type: 'error',
          code: 'INVALID_MESSAGE',
          message: 'Message must match the expected schema.',
        });
        return;
      }

      if (message.type === 'list_projects') {
        handleListProjects(socket);
        return;
      }

      if (message.type === 'list_sessions') {
        handleListSessions(socket);
        return;
      }

      if (message.type === 'create_session') {
        handleCreateSession(socket, message);
        return;
      }

      if (message.type === 'resume_session') {
        handleResumeSession(socket, message);
        return;
      }

      const activeSessionId =
        requestedSessionId ??
        Array.from(sessions.values()).find((session) => session.socket === socket)?.id ??
        null;
      if (!activeSessionId) {
        sendError(socket, {
          type: 'error',
          code: 'SESSION_NOT_FOUND',
          message: 'No active session is attached to this socket.',
        });
        return;
      }

      const activeSession = sessions.get(activeSessionId);
      if (!activeSession) {
        sendError(socket, {
          type: 'error',
          code: 'SESSION_NOT_FOUND',
          message: `Session not found: ${activeSessionId}`,
        });
        return;
      }

      if (message.type === 'ping') {
        handlePing(socket, activeSession, message);
        return;
      }

      if (message.type === 'terminal_input') {
        handleTerminalInput(activeSession, message);
        return;
      }

      if (message.type === 'terminal_resize') {
        handleTerminalResize(activeSession, message);
        return;
      }

      if (message.type === 'promote_session') {
        handlePromoteSession(socket, activeSession, message);
        return;
      }

      handleKillSession(socket, activeSession, message);
    } catch (error: unknown) {
      const messageText =
        error instanceof SyntaxError
          ? 'Invalid JSON payload.'
          : error instanceof Error
            ? error.message
            : 'Unknown server error';

      sendError(socket, {
        type: 'error',
        code: error instanceof SyntaxError ? 'INVALID_JSON' : 'SERVER_ERROR',
        message: messageText,
      });
    }
  });

  socket.on('close', () => {
    const attachedSession = Array.from(sessions.values()).find((session) => session.socket === socket);
    if (!attachedSession) {
      return;
    }

    console.log(`❌ Client disconnected: ${attachedSession.id}`);
    detachSocket(attachedSession.id, socket);
  });

  socket.on('error', (error: Error) => {
    const attachedSession = Array.from(sessions.values()).find((session) => session.socket === socket);
    console.error(`❌ WebSocket error${attachedSession ? ` for ${attachedSession.id}` : ''}: ${error.message}`);
    if (attachedSession) {
      detachSocket(attachedSession.id, socket);
    }
  });
});

httpServer.listen(PORT, () => {
  const discoveryCandidates = collectConnectionCandidates().filter((candidate) => !candidate.isInternal);
  const configuredProjectCount = projects.filter((project) => project.source === 'config').length;
  const discoveredProjectCount = projects.filter((project) => project.source === 'discovered').length;

  console.log(`🖥️  Host: ${os.platform()} ${os.release()}`);
  console.log(`📁 Projects: ${configuredProjectCount} configured, ${discoveredProjectCount} discovered`);
  console.log(`📡 Server: ${SERVER_NAME} (${SERVER_ID})`);
  console.log(`🌐 Local:   http://localhost:${PORT}/dashboard`);

  if (PUBLIC_URL) {
    const tunnelPairingUrl = `${PUBLIC_URL}/pairing`;
    console.log(`🌍 Tunnel:  ${tunnelPairingUrl}`);
    console.log('');
    console.log('Scan with Juno to pair your phone (tunnel):');
    qrcode.generate(tunnelPairingUrl, { small: true });
  } else {
    const preferredCandidate = discoveryCandidates.find((c) => c.family === 'IPv4') ?? discoveryCandidates[0];

    if (preferredCandidate) {
      const rawHostname = os.hostname();
      const mdnsHost = rawHostname.endsWith('.local') ? rawHostname : `${rawHostname}.local`;
      const mdnsPairingUrl = `http://${mdnsHost}:${PORT}/pairing`;

      console.log(`📱 mDNS:    ${mdnsPairingUrl}`);
      console.log(`📱 LAN IP:  ${preferredCandidate.pairingUrl}`);
      console.log('');
      console.log('Scan with Juno to pair your phone:');
      qrcode.generate(mdnsPairingUrl, { small: true });
    } else {
      console.log('');
      console.log('No LAN interface found — phone pairing requires a network connection.');
    }
  }

  console.log('✅ Ready to accept connections');
});
