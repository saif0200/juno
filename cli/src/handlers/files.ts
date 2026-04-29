import fs from 'fs';
import path from 'path';
import type WebSocket from 'ws';

import { MAX_FILE_READ_BYTES, MAX_FILE_WRITE_BYTES } from '../config';
import {
  containsNullByte,
  fileStatToEntry,
  normalizeRelativePath,
  resolveExistingPathInProject,
  resolveWriteTargetInProject,
} from '../fs-paths';
import { sendMessage, sendRequestError } from '../protocol';
import type {
  FileContentMessage,
  FileSavedMessage,
  FilesListMessage,
  ListFilesMessage,
  ReadFileMessage,
  SessionRecord,
  WriteFileMessage,
} from '../types';

export function handleListFiles(
  socket: WebSocket,
  session: SessionRecord,
  message: ListFilesMessage,
): void {
  const relativePath = normalizeRelativePath(message.path);
  const directoryPath = resolveExistingPathInProject(session, relativePath);
  if (!directoryPath) {
    sendRequestError(
      socket,
      message.requestId,
      'FILE_ACCESS_DENIED',
      `Path is outside project root or missing: ${relativePath || '.'}`,
    );
    return;
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(directoryPath);
  } catch (error: unknown) {
    sendRequestError(
      socket,
      message.requestId,
      'FILE_NOT_FOUND',
      error instanceof Error ? error.message : 'Directory not found.',
    );
    return;
  }

  if (!stat.isDirectory()) {
    sendRequestError(
      socket,
      message.requestId,
      'FILE_NOT_DIRECTORY',
      `Expected a directory: ${relativePath || '.'}`,
    );
    return;
  }

  const dirEntries = fs.readdirSync(directoryPath, { withFileTypes: true });
  const entries = dirEntries
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => {
      const absolute = path.resolve(directoryPath, entry.name);
      return fileStatToEntry(session, absolute, entry.name);
    })
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
      return left.name.localeCompare(right.name);
    });

  const payload: FilesListMessage = {
    type: 'files_list',
    requestId: message.requestId,
    path: relativePath,
    entries,
  };
  sendMessage(socket, payload);
}

export function handleReadFile(
  socket: WebSocket,
  session: SessionRecord,
  message: ReadFileMessage,
): void {
  const relativePath = normalizeRelativePath(message.path);
  const filePath = resolveExistingPathInProject(session, relativePath);
  if (!filePath) {
    sendRequestError(
      socket,
      message.requestId,
      'FILE_ACCESS_DENIED',
      `Invalid file path: ${relativePath}`,
    );
    return;
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch (error: unknown) {
    sendRequestError(
      socket,
      message.requestId,
      'FILE_NOT_FOUND',
      error instanceof Error ? error.message : 'File not found.',
    );
    return;
  }

  if (!stat.isFile()) {
    sendRequestError(
      socket,
      message.requestId,
      'FILE_NOT_FOUND',
      `Expected a file: ${relativePath}`,
    );
    return;
  }

  if (stat.size > MAX_FILE_READ_BYTES) {
    sendRequestError(
      socket,
      message.requestId,
      'FILE_TOO_LARGE',
      `File exceeds read limit (${MAX_FILE_READ_BYTES} bytes): ${relativePath}`,
    );
    return;
  }

  const buffer = fs.readFileSync(filePath);
  if (containsNullByte(buffer)) {
    sendRequestError(
      socket,
      message.requestId,
      'FILE_BINARY_UNSUPPORTED',
      `Binary files are not supported in editor view: ${relativePath}`,
    );
    return;
  }

  const payload: FileContentMessage = {
    type: 'file_content',
    requestId: message.requestId,
    path: relativePath,
    content: buffer.toString('utf8'),
    updatedAt: stat.mtime.toISOString(),
  };
  sendMessage(socket, payload);
}

export function handleWriteFile(
  socket: WebSocket,
  session: SessionRecord,
  message: WriteFileMessage,
): void {
  const relativePath = normalizeRelativePath(message.path);
  const targetPath = resolveWriteTargetInProject(session, relativePath);
  if (!targetPath) {
    sendRequestError(
      socket,
      message.requestId,
      'FILE_ACCESS_DENIED',
      `Invalid write path: ${relativePath}`,
    );
    return;
  }

  const byteLength = Buffer.byteLength(message.content, 'utf8');
  if (byteLength > MAX_FILE_WRITE_BYTES) {
    sendRequestError(
      socket,
      message.requestId,
      'FILE_TOO_LARGE',
      `File exceeds write limit (${MAX_FILE_WRITE_BYTES} bytes): ${relativePath}`,
    );
    return;
  }

  try {
    fs.writeFileSync(targetPath, message.content, 'utf8');
    const stat = fs.statSync(targetPath);
    const payload: FileSavedMessage = {
      type: 'file_saved',
      requestId: message.requestId,
      path: relativePath,
      updatedAt: stat.mtime.toISOString(),
      bytes: byteLength,
    };
    sendMessage(socket, payload);
  } catch (error: unknown) {
    sendRequestError(
      socket,
      message.requestId,
      'SERVER_ERROR',
      error instanceof Error ? error.message : 'Unable to write file.',
    );
  }
}
