import { TerminalTabsManager } from './manager';

export { TerminalTabsManager };
export type {
  TabsSnapshot,
  TerminalTabState,
  TerminalExitState,
  TabConnectionStatus,
  ManagerEvent,
  OpenProjectTabInput,
  OpenExistingSessionInput,
  OpenTabResult,
  ProjectCatalogResult,
  ListFilesResult,
  ReadFileResult,
  WriteFileResult,
} from './types';

export const terminalTabsManager = new TerminalTabsManager();
