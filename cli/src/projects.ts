import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import {
  PROJECT_DISCOVERY_ENABLED,
  PROJECT_DISCOVERY_MAX_DEPTH,
  PROJECT_DISCOVERY_PATHS,
} from './config';
import { directoryExists, resolveConfiguredPath } from './fs-paths';
import type { ProjectDefinition, ProjectSource } from './types';
import { slugify } from './util';

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

interface ProjectCatalogConfig {
  projects: ProjectDefinition[];
  discoveryRoots: string[];
  discoveryEnabled: boolean;
  discoveryMaxDepth: number;
}

const SKIP_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
]);

export function loadProjects(configPath: string): ProjectDefinition[] {
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
      discoveryRoots: normalizeDiscoveryRoots(
        config.discovery?.paths ?? PROJECT_DISCOVERY_PATHS,
      ),
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
    return { projects: value.map((entry) => parseProjectConfigEntry(entry)) };
  }

  if (!value || typeof value !== 'object') {
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
    if (discoveryEnabled !== undefined) discoveryConfig.enabled = discoveryEnabled;
    if (discoveryPaths !== undefined) discoveryConfig.paths = discoveryPaths as string[];
    if (discoveryMaxDepth !== undefined) discoveryConfig.maxDepth = discoveryMaxDepth as number;
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

  const entry: ProjectConfigEntry = { path: candidate.path };
  if (typeof candidate.id === 'string') entry.id = candidate.id;
  if (typeof candidate.name === 'string') entry.name = candidate.name;
  if (typeof candidate.favorite === 'boolean') entry.favorite = candidate.favorite;

  return entry;
}

function normalizeDiscoveryRoots(roots: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const root of roots) {
    const resolved = resolveConfiguredPath(root);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    normalized.push(resolved);
  }

  return normalized;
}

function normalizeDiscoveryDepth(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 2;
  return Math.floor(value);
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

export function buildProjectFromPath(
  rawPath: string,
  options: { favorite?: boolean; source?: ProjectSource } = {},
): ProjectDefinition {
  const resolvedPath = resolveConfiguredPath(rawPath);
  const name = path.basename(resolvedPath) || resolvedPath;
  const source = options.source ?? 'config';
  return {
    id: deriveProjectId(source === 'config' ? 'cwd' : 'discovered', resolvedPath, name),
    name,
    path: resolvedPath,
    source,
    isFavorite: options.favorite ?? true,
    available: directoryExists(resolvedPath),
  };
}

/**
 * Append a project to an on-disk projects.json if its resolved path is not
 * already present. Returns true if a write happened. Best-effort: parse errors
 * leave the file untouched.
 */
interface PersistedProjectEntry {
  id?: string;
  name?: string;
  path?: string;
  favorite?: boolean;
}

interface PersistedProjectsFile {
  projects?: PersistedProjectEntry[];
  discovery?: unknown;
}

export function persistProjectIfNew(configPath: string, project: ProjectDefinition): boolean {
  let existing: PersistedProjectsFile = { projects: [] };
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf8')) as PersistedProjectsFile;
    } catch {
      return false;
    }
  }

  const projects = Array.isArray(existing.projects) ? existing.projects : [];
  const resolved = resolveConfiguredPath(project.path);
  const alreadyTracked = projects.some((entry) => {
    if (!entry || typeof entry.path !== 'string') return false;
    return resolveConfiguredPath(entry.path) === resolved;
  });
  if (alreadyTracked) return false;

  projects.push({
    id: project.id,
    name: project.name,
    path: project.path,
    favorite: project.isFavorite,
  });

  const next: PersistedProjectsFile = { ...existing, projects };
  fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return true;
}

/**
 * Remove a project (by absolute path) from an on-disk projects.json. Returns
 * true if a write happened. Best-effort: parse errors leave the file untouched.
 */
export function removeProjectByPath(configPath: string, projectPath: string): boolean {
  if (!fs.existsSync(configPath)) return false;

  let existing: PersistedProjectsFile;
  try {
    existing = JSON.parse(fs.readFileSync(configPath, 'utf8')) as PersistedProjectsFile;
  } catch {
    return false;
  }

  const projects = Array.isArray(existing.projects) ? existing.projects : [];
  const target = resolveConfiguredPath(projectPath);
  const next = projects.filter((entry) => {
    if (!entry || typeof entry.path !== 'string') return true;
    return resolveConfiguredPath(entry.path) !== target;
  });

  if (next.length === projects.length) return false;

  const updated: PersistedProjectsFile = { ...existing, projects: next };
  fs.writeFileSync(configPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return true;
}

function discoverProjects(roots: string[], maxDepth: number): ProjectDefinition[] {
  const discovered: ProjectDefinition[] = [];
  const seenPaths = new Set<string>();

  for (const root of roots) {
    if (!directoryExists(root)) continue;
    walkForGitRepos(root, 0, maxDepth, discovered, seenPaths);
  }

  discovered.sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) return byName;
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
  if (depth > maxDepth) return;

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
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
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

function mergeProjects(
  configuredProjects: ProjectDefinition[],
  discoveredProjects: ProjectDefinition[],
): ProjectDefinition[] {
  const merged: ProjectDefinition[] = [];
  const seenPaths = new Set<string>();
  const seenIds = new Set<string>();

  for (const project of [...configuredProjects, ...discoveredProjects]) {
    const resolvedPath = resolveConfiguredPath(project.path);
    if (seenPaths.has(resolvedPath)) continue;

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
