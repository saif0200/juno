import type WebSocket from 'ws';

import { PROJECTS_CONFIG_PATH } from '../config';
import { removeProjectByPath } from '../projects';
import { sendMessage, sendRequestError } from '../protocol';
import { getProjects, setProjects } from '../state';
import type { ProjectRemovedMessage, RemoveProjectMessage } from '../types';

export function handleRemoveProject(socket: WebSocket, message: RemoveProjectMessage): void {
  const projects = getProjects();
  const target = projects.find((project) => project.id === message.projectId);
  if (!target) {
    sendRequestError(
      socket,
      message.requestId,
      'PROJECT_NOT_FOUND',
      `Project not found: ${message.projectId}`,
    );
    return;
  }

  // Persist removal to ~/.juno/projects.json (or whichever path is active).
  removeProjectByPath(PROJECTS_CONFIG_PATH, target.path);

  // Drop from in-memory list so subsequent list_projects reflects the change.
  setProjects(projects.filter((project) => project.id !== message.projectId));

  const payload: ProjectRemovedMessage = {
    type: 'project_removed',
    requestId: message.requestId,
    projectId: message.projectId,
  };
  sendMessage(socket, payload);
  console.log(`🗑️  Removed project ${target.name} (${target.path}) from ${PROJECTS_CONFIG_PATH}`);
}
