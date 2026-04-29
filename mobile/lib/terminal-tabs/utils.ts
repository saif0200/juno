import { TAB_OUTPUT_LIMIT } from './constants';

export function nowIso(): string {
  return new Date().toISOString();
}

export function createTabId(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createRequestId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function trimOutput(value: string): string {
  if (value.length <= TAB_OUTPUT_LIMIT) return value;
  return value.slice(value.length - TAB_OUTPUT_LIMIT);
}

export function getPreview(value: string): string {
  if (!value) return '';
  const lines = value.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return '';
  return lines[lines.length - 1].slice(0, 120);
}

export function buildSessionAttachUrl(connectionUrl: string, sessionId: string): string {
  try {
    const url = new URL(connectionUrl);
    url.searchParams.set('sessionId', sessionId);
    return url.toString();
  } catch {
    return connectionUrl;
  }
}
