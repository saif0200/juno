import type MaterialIcons from '@expo/vector-icons/MaterialIcons';

export type FileIcon = {
  name: keyof typeof MaterialIcons.glyphMap;
  color: string;
};

const EXTENSION_ICONS: Record<string, FileIcon> = {
  js: { name: 'javascript', color: '#f0c040' },
  jsx: { name: 'javascript', color: '#61dafb' },
  ts: { name: 'code', color: '#3b82f6' },
  tsx: { name: 'code', color: '#61dafb' },
  html: { name: 'html', color: '#e44d26' },
  css: { name: 'css', color: '#264de4' },
  json: { name: 'data-object', color: '#fbc02d' },
  md: { name: 'article', color: '#88a8b4' },
  env: { name: 'lock', color: '#fdd835' },
  png: { name: 'image', color: '#a78bfa' },
  jpg: { name: 'image', color: '#a78bfa' },
  jpeg: { name: 'image', color: '#a78bfa' },
  gif: { name: 'image', color: '#a78bfa' },
  svg: { name: 'image', color: '#a78bfa' },
};

const DIRECTORY_ICON: FileIcon = { name: 'folder', color: '#e8b84b' };
const FALLBACK_FILE_ICON: FileIcon = { name: 'insert-drive-file', color: '#52525b' };

export function getFileIcon(kind: 'directory' | 'file', name?: string): FileIcon {
  if (kind === 'directory') return DIRECTORY_ICON;
  const ext = name?.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_ICONS[ext] ?? FALLBACK_FILE_ICON;
}
