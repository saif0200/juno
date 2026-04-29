import type { Express, Request, Response } from 'express';

import { CLAUDE_ARGS, CLAUDE_COMMAND, SERVER_ID, SERVER_NAME, TMUX_AVAILABLE } from './config';
import { renderDashboard } from './dashboard';
import { createPairingPayload } from './pairing';
import { getProjects, sessions } from './state';

export function registerHttpRoutes(app: Express): void {
  app.get('/health', (_request: Request, response: Response) => {
    response.json({
      status: 'ok',
      serverId: SERVER_ID,
      serverName: SERVER_NAME,
      command: CLAUDE_COMMAND,
      args: CLAUDE_ARGS,
      tmuxBridge: TMUX_AVAILABLE,
      activeSessions: sessions.size,
      projectCount: getProjects().length,
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
}
