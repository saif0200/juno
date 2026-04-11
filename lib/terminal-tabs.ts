import {
  type CreateSessionRequest,
  type ProjectDefinition,
  type ServerMessage,
  type TerminalPersistenceMode,
} from '@/lib/terminal';

const TAB_OUTPUT_LIMIT = 200000;
const MAX_TAB_COUNT = 6;
const LIVE_TAB_POOL_SIZE = 3;
const PROJECT_LIST_TIMEOUT_MS = 5000;

type TabConnectionStatus = 'connecting' | 'live' | 'parked' | 'disconnected' | 'exited' | 'error';

type TerminalExitState = {
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
};

type ManagedTab = TerminalTabState & {
  outputBuffer: string;
  socket: WebSocket | null;
  pingInterval: ReturnType<typeof setInterval> | null;
  disconnectIntent: 'none' | 'parking' | 'closing';
  pendingPromotion: boolean;
  cols: number;
  rows: number;
};

export type TabsSnapshot = {
  tabs: TerminalTabState[];
  activeTabId: string | null;
  activeTabIndex: number;
  revision: number;
};

type ManagerEvent =
  | { type: 'tabs_changed'; snapshot: TabsSnapshot }
  | { type: 'active_output'; tabId: string; data: string }
  | { type: 'active_snapshot'; tabId: string; data: string };

type OpenProjectTabInput = {
  projectId: string;
  projectName: string;
  connectionUrl: string;
  persistence?: TerminalPersistenceMode;
};

type OpenExistingSessionInput = {
  relaySessionId: string;
  projectId: string;
  projectName: string;
  connectionUrl: string;
  persistence?: TerminalPersistenceMode;
};

type OpenTabResult = {
  tabId: string | null;
  error: string | null;
};

type ProjectCatalogResult = {
  projects: ProjectDefinition[];
  error: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function createTabId(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function trimOutput(value: string): string {
  if (value.length <= TAB_OUTPUT_LIMIT) {
    return value;
  }

  return value.slice(value.length - TAB_OUTPUT_LIMIT);
}

function getPreview(value: string): string {
  if (!value) {
    return '';
  }

  const lines = value.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return '';
  }

  return lines[lines.length - 1].slice(0, 120);
}

function buildSessionAttachUrl(connectionUrl: string, sessionId: string): string {
  try {
    const url = new URL(connectionUrl);
    url.searchParams.set('sessionId', sessionId);
    return url.toString();
  } catch {
    return connectionUrl;
  }
}

export class TerminalTabsManager {
  private tabs = new Map<string, ManagedTab>();

  private tabOrder: string[] = [];

  private activeTabId: string | null = null;

  private listeners = new Set<(event: ManagerEvent) => void>();

  private revision = 0;

  private projectCatalogCache = new Map<string, ProjectDefinition[]>();

  subscribe(listener: (event: ManagerEvent) => void): () => void {
    this.listeners.add(listener);
    listener({ type: 'tabs_changed', snapshot: this.getSnapshot() });
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): TabsSnapshot {
    const orderedTabs = this.tabOrder
      .map((tabId) => this.tabs.get(tabId))
      .filter((tab): tab is ManagedTab => Boolean(tab))
      .map((tab) => this.toPublicTab(tab));

    const activeTabIndex = this.activeTabId ? orderedTabs.findIndex((tab) => tab.id === this.activeTabId) : -1;

    return {
      tabs: orderedTabs,
      activeTabId: this.activeTabId,
      activeTabIndex,
      revision: this.revision,
    };
  }

  getTabBuffer(tabId: string): string {
    return this.tabs.get(tabId)?.outputBuffer ?? '';
  }

  getActiveTab(): TerminalTabState | null {
    if (!this.activeTabId) {
      return null;
    }

    const tab = this.tabs.get(this.activeTabId);
    return tab ? this.toPublicTab(tab) : null;
  }

  getKnownProjects(connectionUrl: string): ProjectDefinition[] {
    return this.projectCatalogCache.get(connectionUrl) ?? [];
  }

  getMaxTabCount(): number {
    return MAX_TAB_COUNT;
  }

  openProjectTab(input: OpenProjectTabInput): OpenTabResult {
    if (this.tabs.size >= MAX_TAB_COUNT) {
      return {
        tabId: null,
        error: `Tab limit reached (${MAX_TAB_COUNT}). Close an existing tab to open another one.`,
      };
    }

    const id = createTabId();
    const createdAt = nowIso();
    const tab: ManagedTab = {
      id,
      title: input.projectName,
      projectId: input.projectId,
      projectName: input.projectName,
      connectionUrl: input.connectionUrl,
      status: 'connecting',
      persistence: input.persistence ?? 'ephemeral',
      relaySessionId: null,
      createdAt,
      lastActiveAt: createdAt,
      lastError: null,
      outputPreview: '',
      exitState: null,
      outputBuffer: '',
      socket: null,
      pingInterval: null,
      disconnectIntent: 'none',
      pendingPromotion: false,
      cols: 100,
      rows: 28,
    };

    this.tabs.set(tab.id, tab);
    this.tabOrder.push(tab.id);
    this.activeTabId = tab.id;
    this.emitTabsChanged();
    this.connectTab(tab, 'create');
    this.enforceWarmPool();

    return { tabId: tab.id, error: null };
  }

  openExistingSession(input: OpenExistingSessionInput): OpenTabResult {
    const existingBySession = Array.from(this.tabs.values()).find(
      (tab) => tab.relaySessionId === input.relaySessionId,
    );
    if (existingBySession) {
      this.activateTab(existingBySession.id);
      return { tabId: existingBySession.id, error: null };
    }

    if (this.tabs.size >= MAX_TAB_COUNT) {
      return {
        tabId: null,
        error: `Tab limit reached (${MAX_TAB_COUNT}). Close an existing tab to open another one.`,
      };
    }

    const id = createTabId();
    const createdAt = nowIso();
    const tab: ManagedTab = {
      id,
      title: input.projectName,
      projectId: input.projectId,
      projectName: input.projectName,
      connectionUrl: input.connectionUrl,
      status: 'connecting',
      persistence: input.persistence ?? 'persisted',
      relaySessionId: input.relaySessionId,
      createdAt,
      lastActiveAt: createdAt,
      lastError: null,
      outputPreview: '',
      exitState: null,
      outputBuffer: '',
      socket: null,
      pingInterval: null,
      disconnectIntent: 'none',
      pendingPromotion: false,
      cols: 100,
      rows: 28,
    };

    this.tabs.set(tab.id, tab);
    this.tabOrder.push(tab.id);
    this.activeTabId = tab.id;
    this.emitTabsChanged();
    this.connectTab(tab, 'resume');
    this.enforceWarmPool();

    return { tabId: tab.id, error: null };
  }

  createTabLikeActive(): OpenTabResult {
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    if (!active) {
      return {
        tabId: null,
        error: 'No active tab. Open a project first.',
      };
    }

    return this.openProjectTab({
      projectId: active.projectId,
      projectName: active.projectName,
      connectionUrl: active.connectionUrl,
      persistence: 'ephemeral',
    });
  }

  activateTab(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return;
    }

    tab.lastActiveAt = nowIso();
    this.activeTabId = tabId;
    this.emitTabsChanged();

    if (tab.status === 'parked' || tab.status === 'disconnected' || (tab.status === 'error' && tab.relaySessionId)) {
      this.connectTab(tab, tab.relaySessionId ? 'resume' : 'create');
    }

    this.enforceWarmPool();
  }

  switchRelative(offset: 1 | -1): boolean {
    if (this.tabOrder.length <= 1 || !this.activeTabId) {
      return false;
    }

    const activeIndex = this.tabOrder.indexOf(this.activeTabId);
    if (activeIndex < 0) {
      return false;
    }

    const nextIndex = (activeIndex + offset + this.tabOrder.length) % this.tabOrder.length;
    const nextTabId = this.tabOrder[nextIndex];
    if (!nextTabId || nextTabId === this.activeTabId) {
      return false;
    }

    this.activateTab(nextTabId);
    return true;
  }

  closeTab(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return;
    }

    const closedIndex = this.tabOrder.indexOf(tabId);

    this.requestKill(tab);
    this.shutdownSocket(tab, 'closing');
    this.tabs.delete(tabId);
    this.tabOrder = this.tabOrder.filter((id) => id !== tabId);

    if (this.activeTabId === tabId) {
      const nextIndex = Math.max(0, Math.min(closedIndex, this.tabOrder.length - 1));
      const nextTabId = this.tabOrder[nextIndex] ?? this.tabOrder[nextIndex - 1] ?? null;
      this.activeTabId = nextTabId;
      if (nextTabId) {
        const next = this.tabs.get(nextTabId);
        if (next && (next.status === 'parked' || next.status === 'disconnected')) {
          this.connectTab(next, next.relaySessionId ? 'resume' : 'create');
        }
      }
    }

    this.emitTabsChanged();
    this.enforceWarmPool();
  }

  closeAll(): void {
    for (const tab of this.tabs.values()) {
      this.requestKill(tab);
      this.shutdownSocket(tab, 'closing');
    }

    this.tabs.clear();
    this.tabOrder = [];
    this.activeTabId = null;
    this.emitTabsChanged();
  }

  sendInputToActive(data: string): void {
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    if (!active || !active.socket || active.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    active.socket.send(JSON.stringify({ type: 'terminal_input', data }));
  }

  resizeActive(cols: number, rows: number): void {
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    if (!active) {
      return;
    }

    active.cols = cols;
    active.rows = rows;

    if (!active.socket || active.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    active.socket.send(JSON.stringify({ type: 'terminal_resize', cols, rows }));
  }

  reconnectActive(): void {
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    if (!active) {
      return;
    }

    this.connectTab(active, active.relaySessionId ? 'resume' : 'create');
  }

  promoteActiveTab(): void {
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    if (!active || active.persistence === 'persisted') {
      return;
    }

    active.pendingPromotion = true;

    if (active.socket && active.socket.readyState === WebSocket.OPEN) {
      active.socket.send(JSON.stringify({ type: 'promote_session' }));
    }
  }

  async fetchProjectsForConnection(connectionUrl: string, forceRefresh = false): Promise<ProjectCatalogResult> {
    if (!forceRefresh) {
      const cached = this.projectCatalogCache.get(connectionUrl);
      if (cached && cached.length > 0) {
        return { projects: cached, error: null };
      }
    }

    return new Promise((resolve) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const socket = new WebSocket(connectionUrl);

      const finish = (result: ProjectCatalogResult): void => {
        if (settled) {
          return;
        }

        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        socket.close();
        resolve(result);
      };

      timeout = setTimeout(() => {
        finish({
          projects: this.projectCatalogCache.get(connectionUrl) ?? [],
          error: 'Timed out while loading projects.',
        });
      }, PROJECT_LIST_TIMEOUT_MS);

      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'list_projects' }));
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as ServerMessage;
        if (message.type === 'projects_list') {
          this.projectCatalogCache.set(connectionUrl, message.projects);
          finish({ projects: message.projects, error: null });
          return;
        }

        if (message.type === 'error') {
          finish({
            projects: this.projectCatalogCache.get(connectionUrl) ?? [],
            error: `${message.code}: ${message.message}`,
          });
        }
      };

      socket.onerror = () => {
        finish({
          projects: this.projectCatalogCache.get(connectionUrl) ?? [],
          error: 'Unable to connect to relay for project list.',
        });
      };
    });
  }

  private toPublicTab(tab: ManagedTab): TerminalTabState {
    return {
      id: tab.id,
      title: tab.title,
      projectId: tab.projectId,
      projectName: tab.projectName,
      connectionUrl: tab.connectionUrl,
      status: tab.status,
      persistence: tab.persistence,
      relaySessionId: tab.relaySessionId,
      createdAt: tab.createdAt,
      lastActiveAt: tab.lastActiveAt,
      lastError: tab.lastError,
      outputPreview: tab.outputPreview,
      exitState: tab.exitState,
    };
  }

  private emitTabsChanged(): void {
    this.revision += 1;
    const event: ManagerEvent = {
      type: 'tabs_changed',
      snapshot: this.getSnapshot(),
    };
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private emitActiveOutput(tabId: string, data: string): void {
    if (this.activeTabId !== tabId) {
      return;
    }

    const event: ManagerEvent = {
      type: 'active_output',
      tabId,
      data,
    };

    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private emitActiveSnapshot(tabId: string, data: string): void {
    if (this.activeTabId !== tabId) {
      return;
    }

    const event: ManagerEvent = {
      type: 'active_snapshot',
      tabId,
      data,
    };

    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private connectTab(tab: ManagedTab, mode: 'create' | 'resume'): void {
    this.shutdownSocket(tab, 'none');

    tab.lastError = null;
    tab.exitState = null;
    tab.status = 'connecting';
    this.emitTabsChanged();

    const socketUrl = mode === 'resume' && tab.relaySessionId
      ? buildSessionAttachUrl(tab.connectionUrl, tab.relaySessionId)
      : tab.connectionUrl;

    const socket = new WebSocket(socketUrl);
    tab.socket = socket;

    socket.onopen = () => {
      if (tab.socket !== socket) {
        return;
      }

      if (mode === 'resume' && tab.relaySessionId) {
        socket.send(
          JSON.stringify({
            type: 'resume_session',
            sessionId: tab.relaySessionId,
          }),
        );
        return;
      }

      const createPayload: CreateSessionRequest = {
        type: 'create_session',
        projectId: tab.projectId,
        clientTabId: tab.id,
        persistence: tab.persistence,
      };
      socket.send(JSON.stringify(createPayload));
    };

    socket.onmessage = (event) => {
      if (tab.socket !== socket) {
        return;
      }

      const message = JSON.parse(event.data as string) as ServerMessage;
      this.handleServerMessage(tab, message);
    };

    socket.onerror = () => {
      if (tab.socket !== socket) {
        return;
      }

      tab.status = 'error';
      tab.lastError = 'WebSocket connection failed.';
      this.emitTabsChanged();
    };

    socket.onclose = () => {
      if (tab.socket !== socket) {
        return;
      }

      this.stopPing(tab);
      tab.socket = null;

      if (tab.disconnectIntent === 'parking') {
        tab.status = 'parked';
        tab.disconnectIntent = 'none';
        this.emitTabsChanged();
        return;
      }

      if (tab.disconnectIntent === 'closing') {
        tab.disconnectIntent = 'none';
        return;
      }

      if (tab.status !== 'exited') {
        tab.status = tab.relaySessionId ? 'disconnected' : 'error';
      }
      this.emitTabsChanged();
    };
  }

  private handleServerMessage(tab: ManagedTab, message: ServerMessage): void {
    if (message.type === 'session_created' || message.type === 'session_resumed') {
      tab.relaySessionId = message.sessionId;
      tab.projectId = message.projectId;
      tab.projectName = message.projectName;
      tab.title = message.projectName;
      tab.status = 'live';
      tab.lastError = null;
      tab.exitState = null;
      tab.cols = message.cols;
      tab.rows = message.rows;
      tab.lastActiveAt = tab.id === this.activeTabId ? nowIso() : tab.lastActiveAt;
      if (message.persistence) {
        tab.persistence = message.persistence;
      }
      this.startPing(tab);

      if (tab.socket && tab.socket.readyState === WebSocket.OPEN) {
        tab.socket.send(
          JSON.stringify({
            type: 'terminal_resize',
            cols: tab.cols,
            rows: tab.rows,
          }),
        );

        if (tab.pendingPromotion && tab.persistence !== 'persisted') {
          tab.socket.send(JSON.stringify({ type: 'promote_session' }));
        }
      }

      this.emitTabsChanged();
      return;
    }

    if (message.type === 'terminal_output') {
      tab.outputBuffer = trimOutput(tab.outputBuffer + message.data);
      tab.outputPreview = getPreview(tab.outputBuffer);
      this.emitActiveOutput(tab.id, message.data);
      return;
    }

    if (message.type === 'terminal_snapshot') {
      tab.outputBuffer = trimOutput(message.data);
      tab.outputPreview = getPreview(tab.outputBuffer);
      this.emitActiveSnapshot(tab.id, tab.outputBuffer);
      return;
    }

    if (message.type === 'terminal_exit') {
      const statusText = `Process exited with code ${message.exitCode}${
        message.signal ? `, signal ${message.signal}` : ''
      }.`;
      tab.status = 'exited';
      tab.exitState = {
        exitCode: message.exitCode,
        signal: message.signal,
        message: statusText,
      };
      tab.outputBuffer = trimOutput(tab.outputBuffer + `\r\n\x1b[90m[${statusText}]\x1b[0m\r\n`);
      tab.outputPreview = getPreview(tab.outputBuffer);
      this.emitActiveOutput(tab.id, `\r\n\x1b[90m[${statusText}]\x1b[0m\r\n`);
      this.emitTabsChanged();
      return;
    }

    if (message.type === 'session_promoted') {
      tab.persistence = 'persisted';
      tab.pendingPromotion = false;
      this.emitTabsChanged();
      return;
    }

    if (message.type === 'error') {
      tab.status = 'error';
      tab.lastError = `${message.code}: ${message.message}`;
      tab.outputBuffer = trimOutput(
        `${tab.outputBuffer}\r\n\x1b[31m[${message.code}] ${message.message}\x1b[0m\r\n`,
      );
      tab.outputPreview = getPreview(tab.outputBuffer);
      this.emitActiveOutput(tab.id, `\r\n\x1b[31m[${message.code}] ${message.message}\x1b[0m\r\n`);
      this.emitTabsChanged();
      return;
    }
  }

  private startPing(tab: ManagedTab): void {
    this.stopPing(tab);
    tab.pingInterval = setInterval(() => {
      if (!tab.socket || tab.socket.readyState !== WebSocket.OPEN || !tab.relaySessionId) {
        return;
      }

      tab.socket.send(JSON.stringify({ type: 'ping' }));
    }, 20000);
  }

  private stopPing(tab: ManagedTab): void {
    if (!tab.pingInterval) {
      return;
    }

    clearInterval(tab.pingInterval);
    tab.pingInterval = null;
  }

  private shutdownSocket(tab: ManagedTab, intent: ManagedTab['disconnectIntent']): void {
    tab.disconnectIntent = intent;
    this.stopPing(tab);
    if (tab.socket) {
      tab.socket.close();
      tab.socket = null;
    }
  }

  private requestKill(tab: ManagedTab): void {
    if (!tab.relaySessionId) {
      return;
    }

    if (tab.socket && tab.socket.readyState === WebSocket.OPEN) {
      tab.socket.send(JSON.stringify({ type: 'kill_session' }));
      return;
    }

    try {
      const socket = new WebSocket(buildSessionAttachUrl(tab.connectionUrl, tab.relaySessionId));
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'kill_session' }));
        socket.close();
      };
    } catch {
      // Ignore best-effort cleanup errors.
    }
  }

  private enforceWarmPool(): void {
    const liveTabs = Array.from(this.tabs.values())
      .filter((tab) => tab.status === 'live' || tab.status === 'connecting' || tab.status === 'disconnected')
      .sort((left, right) => Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt));

    let budget = LIVE_TAB_POOL_SIZE;
    for (const tab of liveTabs) {
      if (tab.id === this.activeTabId) {
        budget -= 1;
        continue;
      }

      if (budget > 0) {
        budget -= 1;
        continue;
      }

      if (tab.status === 'live' || tab.status === 'connecting' || tab.status === 'disconnected') {
        tab.status = 'parked';
        this.shutdownSocket(tab, 'parking');
      }
    }

    this.emitTabsChanged();
  }
}

export const terminalTabsManager = new TerminalTabsManager();
