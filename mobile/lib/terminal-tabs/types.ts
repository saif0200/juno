import type { TerminalPersistenceMode } from '@/lib/terminal';
import type { ProjectDefinition, WorkspaceFileEntry } from '@/lib/terminal';

export type TabConnectionStatus =
  | 'connecting'
  | 'live'
  | 'parked'
  | 'disconnected'
  | 'exited'
  | 'error';

export type TerminalExitState = {
  exitCode: number;
  signal?: number;
  message: string;
};

export type TerminalTabState = {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  connectionUrl: string;
  status: TabConnectionStatus;
  persistence: TerminalPersistenceMode;
  relaySessionId: string | null;
  createdAt: string;
  lastActiveAt: string;
  lastError: string | null;
  outputPreview: string;
  exitState: TerminalExitState | null;
  command: string;
};

export type ManagedTab = TerminalTabState & {
  outputBuffer: string;
  socket: WebSocket | null;
  pingInterval: ReturnType<typeof setInterval> | null;
  disconnectIntent: 'none' | 'parking' | 'closing';
  pendingPromotion: boolean;
  cols: number;
  rows: number;
  pendingFileRequests: Map<
    string,
    {
      timeout: ReturnType<typeof setTimeout>;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >;
};

export type TabsSnapshot = {
  tabs: TerminalTabState[];
  activeTabId: string | null;
  activeTabIndex: number;
  revision: number;
};

export type ManagerEvent =
  | { type: 'tabs_changed'; snapshot: TabsSnapshot }
  | { type: 'active_output'; tabId: string; data: string }
  | { type: 'active_snapshot'; tabId: string; data: string };

export type OpenProjectTabInput = {
  projectId: string;
  projectName: string;
  connectionUrl: string;
  persistence?: TerminalPersistenceMode;
  command?: string;
};

export type OpenExistingSessionInput = {
  relaySessionId: string;
  projectId: string;
  projectName: string;
  connectionUrl: string;
  persistence?: TerminalPersistenceMode;
};

export type OpenTabResult = {
  tabId: string | null;
  error: string | null;
};

export type ProjectCatalogResult = {
  projects: ProjectDefinition[];
  error: string | null;
};

export type ListFilesResult = {
  entries: WorkspaceFileEntry[];
  path: string;
  error: string | null;
};

export type ReadFileResult = {
  path: string;
  content: string | null;
  updatedAt: string | null;
  error: string | null;
};

export type WriteFileResult = {
  path: string;
  updatedAt: string | null;
  bytes: number;
  error: string | null;
};
