import type WebSocket from 'ws';

import { sendMessage } from '../protocol';
import { getProjects } from '../state';

export function handleListProjects(socket: WebSocket): void {
  sendMessage(socket, {
    type: 'projects_list',
    projects: getProjects(),
  });
}
