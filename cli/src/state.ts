import type WebSocket from 'ws';
import type { ProjectDefinition, SessionRecord } from './types';

export const sessions = new Map<string, SessionRecord>();
export const socketSessionBindings = new Map<WebSocket, string>();

const internal = {
  projects: [] as ProjectDefinition[],
};

export function getProjects(): ProjectDefinition[] {
  return internal.projects;
}

export function setProjects(projects: ProjectDefinition[]): void {
  internal.projects = projects;
}
