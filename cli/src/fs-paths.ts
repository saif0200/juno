import fs from 'fs';
import os from 'os';
import path from 'path';

import type { SessionRecord, WorkspaceFileEntry } from './types';
import { toPortablePath } from './util';

export function resolveConfiguredPath(rawPath: string): string {
  if (rawPath.trim().length === 0) return '';

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

export function directoryExists(projectPath: string): boolean {
  try {
    return fs.statSync(projectPath).isDirectory();
  } catch {
    return false;
  }
}

export function normalizeRelativePath(value: string | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed === '.') return '';
  return toPortablePath(path.posix.normalize(trimmed));
}

export function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveExistingPathInProject(
  session: SessionRecord,
  relativePath: string,
): string | null {
  const projectRoot = fs.realpathSync.native(session.projectPath);
  const normalized = normalizeRelativePath(relativePath);

  if (path.posix.isAbsolute(normalized) || normalized.startsWith('../') || normalized === '..') {
    return null;
  }

  const joined = path.resolve(projectRoot, normalized);
  if (!isInsideRoot(projectRoot, joined) || !fs.existsSync(joined)) {
    return null;
  }

  const realTarget = fs.realpathSync.native(joined);
  return isInsideRoot(projectRoot, realTarget) ? realTarget : null;
}

export function resolveWriteTargetInProject(
  session: SessionRecord,
  relativePath: string,
): string | null {
  const projectRoot = fs.realpathSync.native(session.projectPath);
  const normalized = normalizeRelativePath(relativePath);
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    normalized.startsWith('../') ||
    normalized === '..'
  ) {
    return null;
  }

  const target = path.resolve(projectRoot, normalized);
  if (!isInsideRoot(projectRoot, target)) return null;

  const parentDir = path.dirname(target);
  if (!fs.existsSync(parentDir)) return null;

  const realParent = fs.realpathSync.native(parentDir);
  if (!isInsideRoot(projectRoot, realParent)) return null;

  if (fs.existsSync(target)) {
    const realTarget = fs.realpathSync.native(target);
    if (!isInsideRoot(projectRoot, realTarget)) return null;
  }

  return target;
}

export function relativizeProjectPath(session: SessionRecord, absolutePath: string): string {
  const projectRoot = fs.realpathSync.native(session.projectPath);
  const relative = toPortablePath(path.relative(projectRoot, absolutePath));
  return relative === '' ? '' : relative;
}

export function fileStatToEntry(
  session: SessionRecord,
  absolutePath: string,
  name: string,
): WorkspaceFileEntry {
  const stat = fs.statSync(absolutePath);
  const relativePath = relativizeProjectPath(session, absolutePath);
  return {
    name,
    path: relativePath,
    kind: stat.isDirectory() ? 'directory' : 'file',
    ...(stat.isFile() ? { size: stat.size } : {}),
    updatedAt: stat.mtime.toISOString(),
  };
}

export function containsNullByte(buffer: Buffer): boolean {
  return buffer.includes(0);
}
