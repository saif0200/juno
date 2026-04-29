import 'dotenv/config';

import express from 'express';
import { createServer, type Server as HttpServer } from 'http';
import { WebSocketServer } from 'ws';

import { CLEANUP_INTERVAL_MS, PORT, PROJECTS_CONFIG_PATH } from './config';
import { registerHttpRoutes } from './http-routes';
import { ensureConfigDir, seedProjectsFileIfMissing } from './paths';
import { buildProjectFromPath, loadProjects } from './projects';
import { cleanupExpiredSessions } from './sessions';
import { setProjects } from './state';
import { printStartupBanner } from './startup-banner';
import type { ProjectDefinition } from './types';
import { bindWebSocketServer } from './ws-router';

export interface StartServerOptions {
  /** Additional projects to expose alongside those loaded from disk. */
  extraProjects?: ProjectDefinition[];
  /** Called when the http listen() emits an error (e.g. EADDRINUSE). */
  onListenError?: (error: NodeJS.ErrnoException) => void;
}

export interface RunningServer {
  httpServer: HttpServer;
  cleanupInterval: NodeJS.Timeout;
  close: () => Promise<void>;
}

function mergeUnique(
  configured: ProjectDefinition[],
  extras: ProjectDefinition[],
): ProjectDefinition[] {
  const seen = new Set<string>();
  const merged: ProjectDefinition[] = [];
  for (const project of [...extras, ...configured]) {
    if (seen.has(project.path)) continue;
    seen.add(project.path);
    merged.push(project);
  }
  return merged;
}

export function startServer(options: StartServerOptions = {}): RunningServer {
  ensureConfigDir();
  seedProjectsFileIfMissing(PROJECTS_CONFIG_PATH);

  const configured = loadProjects(PROJECTS_CONFIG_PATH);
  const projects = mergeUnique(configured, options.extraProjects ?? []);
  setProjects(projects);

  const app = express();
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer });

  registerHttpRoutes(app);
  bindWebSocketServer(wss);

  const cleanupInterval = setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL_MS);

  httpServer.on('error', (error: NodeJS.ErrnoException) => {
    if (options.onListenError) {
      options.onListenError(error);
      return;
    }
    throw error;
  });

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

export { buildProjectFromPath };
