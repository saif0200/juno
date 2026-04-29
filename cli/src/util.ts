import { OUTPUT_BUFFER_LIMIT } from './config';

export function now(): number {
  return Date.now();
}

export function trimBuffer(value: string): string {
  if (value.length <= OUTPUT_BUFFER_LIMIT) return value;
  return value.slice(value.length - OUTPUT_BUFFER_LIMIT);
}

export function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function toPortablePath(value: string): string {
  return value.replace(/\\/g, '/');
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
