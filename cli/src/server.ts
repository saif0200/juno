import 'dotenv/config';

import express from 'express';
import { createServer, type Server as HttpServer } from 'http';
import { WebSocketServer } from 'ws';

import { CLEANUP_INTERVAL_MS, PORT, PROJECTS_CONFIG_PATH } from './config';
import { registerHttpRoutes } from './http-routes';
import { ensureConfigDir, seedProjectsFileIfMissing } from './paths';
import { loadProjects } from './projects';
import { cleanupExpiredSessions } from './sessions';
import { setProjects } from './state';
import { printStartupBanner } from './startup-banner';
import { bindWebSocketServer } from './ws-router';

export interface RunningServer {
  httpServer: HttpServer;
  cleanupInterval: NodeJS.Timeout;
  close: () => Promise<void>;
}

export function startServer(): RunningServer {
  ensureConfigDir();
  seedProjectsFileIfMissing(PROJECTS_CONFIG_PATH);

  setProjects(loadProjects(PROJECTS_CONFIG_PATH));

  const app = express();
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer });

  registerHttpRoutes(app);
  bindWebSocketServer(wss);

  const cleanupInterval = setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL_MS);

  httpServer.listen(PORT, () => {
    printStartupBanner();
  });

  return {
    httpServer,
    cleanupInterval,
    close() {
      return new Promise<void>((resolve) => {
        clearInterval(cleanupInterval);
        wss.close(() => {
          httpServer.close(() => resolve());
        });
      });
    },
  };
}
