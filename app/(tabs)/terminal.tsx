import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  type GestureResponderEvent,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import {
  type ProjectDefinition,
  type TerminalBridgeMessage,
  type TerminalPersistenceMode,
  loadTerminalHtml,
} from '@/lib/terminal';
import { terminalTabsManager, type TabsSnapshot } from '@/lib/terminal-tabs';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

type RouteParams = {
  action?: string | string[];
  requestId?: string | string[];
  url?: string | string[];
  projectId?: string | string[];
  projectName?: string | string[];
  sessionId?: string | string[];
  persistence?: string | string[];
};

export default function TerminalTabScreen() {
  const params = useLocalSearchParams<RouteParams>();
  const terminalWebViewRef = useRef<WebView>(null);
  const outputFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingOutputRef = useRef('');
  const consumedRequestIdRef = useRef<string | null>(null);

  const [terminalHtml, setTerminalHtml] = useState<string | null>(null);
  const [isTerminalReady, setIsTerminalReady] = useState(false);
  const [snapshot, setSnapshot] = useState<TabsSnapshot>(terminalTabsManager.getSnapshot());
  const [lastError, setLastError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showTabSheet, setShowTabSheet] = useState(false);
  const [showProjectSheet, setShowProjectSheet] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [availableProjects, setAvailableProjects] = useState<ProjectDefinition[]>([]);
  const [isWebViewBlocked, setIsWebViewBlocked] = useState(false);

  const activeTab = useMemo(
    () => snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId) ?? null,
    [snapshot.activeTabId, snapshot.tabs],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadAssets(): Promise<void> {
      try {
        const html = await loadTerminalHtml();
        if (!isMounted) {
          return;
        }

        setTerminalHtml(html);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        setLastError(`Failed to load terminal runtime: ${message}`);
      }
    }

    void loadAssets();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (blockTimeoutRef.current) clearTimeout(blockTimeoutRef.current);
    };
  }, []);

  const escapeForBridge = useCallback(
    (value: string): string =>
      JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'),
    [],
  );

  const runInTerminal = useCallback((script: string): void => {
    terminalWebViewRef.current?.injectJavaScript(`${script}\ntrue;`);
  }, []);

  const dismissSoftKeyboard = useCallback((): void => {
    Keyboard.dismiss();
    runInTerminal('window.__blurTerminal && window.__blurTerminal();');
    setIsWebViewBlocked(true);
    if (blockTimeoutRef.current) clearTimeout(blockTimeoutRef.current);
    blockTimeoutRef.current = setTimeout(() => setIsWebViewBlocked(false), 250);
  }, [runInTerminal]);

  const preventKeyboardDismiss = useCallback((event: GestureResponderEvent): void => {
    event.stopPropagation();
  }, []);

  const flushTerminalOutput = useCallback((): void => {
    outputFlushTimeoutRef.current = null;
    if (!pendingOutputRef.current) {
      return;
    }

    const nextChunk = pendingOutputRef.current;
    pendingOutputRef.current = '';
    runInTerminal(`window.__writeTerminal(${escapeForBridge(nextChunk)});`);
  }, [escapeForBridge, runInTerminal]);

  const pushTerminalData = useCallback(
    (data: string): void => {
      pendingOutputRef.current += data;
      if (outputFlushTimeoutRef.current) {
        return;
      }

      outputFlushTimeoutRef.current = setTimeout(flushTerminalOutput, 16);
    },
    [flushTerminalOutput],
  );

  const clearTerminal = useCallback((): void => {
    flushTerminalOutput();
    runInTerminal('window.__clearTerminal();');
  }, [flushTerminalOutput, runInTerminal]);

  const renderFullBuffer = useCallback(
    (tabId: string | null): void => {
      if (!tabId) {
        clearTerminal();
        runInTerminal("window.__setTerminalBanner('No active tab', 'Tap + to create your first terminal.');");
        return;
      }

      const buffer = terminalTabsManager.getTabBuffer(tabId);
      clearTerminal();
      if (!buffer) {
        runInTerminal("window.__setTerminalBanner('Terminal ready', 'Waiting for process output...');");
        return;
      }

      runInTerminal(`window.__writeTerminal(${escapeForBridge(buffer)});`);
    },
    [clearTerminal, escapeForBridge, runInTerminal],
  );

  useEffect(() => {
    const unsubscribe = terminalTabsManager.subscribe((event) => {
      if (event.type === 'tabs_changed') {
        setSnapshot(event.snapshot);

        const currentActive = event.snapshot.tabs.find((tab) => tab.id === event.snapshot.activeTabId) ?? null;
        setLastError(currentActive?.lastError ?? null);
        return;
      }

      if (!isTerminalReady) {
        return;
      }

      if (event.type === 'active_output') {
        pushTerminalData(event.data);
        return;
      }

      flushTerminalOutput();
      clearTerminal();
      runInTerminal(`window.__writeTerminal(${escapeForBridge(event.data)});`);
    });

    return () => {
      unsubscribe();
      if (outputFlushTimeoutRef.current) {
        clearTimeout(outputFlushTimeoutRef.current);
      }
    };
  }, [clearTerminal, escapeForBridge, flushTerminalOutput, isTerminalReady, pushTerminalData, runInTerminal]);

  useEffect(() => {
    if (!isTerminalReady || !terminalHtml) {
      return;
    }

    renderFullBuffer(snapshot.activeTabId);
  }, [isTerminalReady, renderFullBuffer, snapshot.activeTabId, terminalHtml]);

  const action = firstParam(params.action);
  const requestId = firstParam(params.requestId);
  const url = firstParam(params.url);
  const projectId = firstParam(params.projectId);
  const projectName = firstParam(params.projectName);
  const sessionId = firstParam(params.sessionId);
  const persistence = normalizePersistence(firstParam(params.persistence));

  useEffect(() => {
    if (!requestId || consumedRequestIdRef.current === requestId) {
      return;
    }

    consumedRequestIdRef.current = requestId;

    if (action === 'open_project' && url && projectId && projectName) {
      const result = terminalTabsManager.openProjectTab({
        projectId,
        projectName,
        connectionUrl: url,
        persistence,
      });
      setStatusMessage(result.error);
      return;
    }

    if (action === 'open_existing' && url && sessionId && projectId && projectName) {
      const result = terminalTabsManager.openExistingSession({
        relaySessionId: sessionId,
        projectId,
        projectName,
        connectionUrl: url,
        persistence: persistence ?? 'persisted',
      });
      setStatusMessage(result.error);
    }
  }, [action, persistence, projectId, projectName, requestId, sessionId, url]);

  function handleTerminalBridgeMessage(event: WebViewMessageEvent): void {
    const message = JSON.parse(event.nativeEvent.data) as TerminalBridgeMessage;

    if (message.type === 'terminal_ready') {
      setIsTerminalReady(true);
      if (!snapshot.activeTabId) {
        runInTerminal("window.__setTerminalBanner('Claude Terminal', 'Open a tab to start.');");
      }
      return;
    }

    if (message.type === 'terminal_runtime_error') {
      setLastError(`WebView terminal error: ${message.message}`);
      return;
    }

    if (!snapshot.activeTabId) {
      return;
    }

    if (message.type === 'terminal_input') {
      terminalTabsManager.sendInputToActive(message.data);
      return;
    }

    terminalTabsManager.resizeActive(message.cols, message.rows);
  }

  async function openProjectChooser(): Promise<void> {
    const connectionUrl = activeTab?.connectionUrl;
    if (!connectionUrl) {
      setStatusMessage('Open a tab first to load projects from a relay.');
      return;
    }

    setShowProjectSheet(true);

    const cached = terminalTabsManager.getKnownProjects(connectionUrl);
    if (cached.length > 0) {
      setAvailableProjects(cached);
    }

    setProjectsLoading(true);
    const result = await terminalTabsManager.fetchProjectsForConnection(connectionUrl);
    setProjectsLoading(false);
    setAvailableProjects(result.projects);
    setStatusMessage(result.error);
  }

  function createQuickTab(): void {
    const result = terminalTabsManager.createTabLikeActive();
    if (result.error) {
      setStatusMessage(result.error);
      return;
    }

    setStatusMessage(null);
  }

  function createTabFromProject(project: ProjectDefinition): void {
    const connectionUrl = activeTab?.connectionUrl;
    if (!connectionUrl) {
      setStatusMessage('Unable to resolve relay connection for selected project.');
      return;
    }

    const result = terminalTabsManager.openProjectTab({
      projectId: project.id,
      projectName: project.name,
      connectionUrl,
      persistence: 'ephemeral',
    });

    if (result.error) {
      setStatusMessage(result.error);
      return;
    }

    setShowProjectSheet(false);
    setStatusMessage(null);
  }

  function closeTab(tabId: string): void {
    terminalTabsManager.closeTab(tabId);
  }

  function activateTab(tabId: string): void {
    terminalTabsManager.activateTab(tabId);
    setShowTabSheet(false);
  }

  const compactStatus = useMemo(() => {
    if (statusMessage) {
      return statusMessage;
    }

    if (lastError) {
      return lastError;
    }

    if (!activeTab) {
      return 'Tap + to create a terminal';
    }

    if (activeTab.status === 'live') {
      return null;
    }

    if (activeTab.status === 'exited') {
      return activeTab.exitState?.message ?? 'Process exited';
    }

    return `${activeTab.status} · ${activeTab.projectName}`;
  }, [activeTab, lastError, statusMessage]);

  return (
    <View onTouchStart={dismissSoftKeyboard} style={styles.screen}>
      <StatusBar style="light" />
      <View pointerEvents="none" style={styles.brandGlowTop} />

      <SafeAreaView edges={['top', 'left', 'right']} style={styles.topSafeArea}>
        <View style={styles.topCard}>
          <View style={styles.topMeta} />
          <View style={styles.topBarActions}>
            <Pressable onPress={() => setShowTabSheet(true)} style={styles.iconButton}>
              <MaterialIcons color="#e5eeff" name="layers" size={18} />
            </Pressable>
            <Pressable onLongPress={() => void openProjectChooser()} onPress={createQuickTab} style={styles.iconButton}>
              <MaterialIcons color="#e5eeff" name="add" size={18} />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex1}>
        <View onTouchStart={preventKeyboardDismiss} pointerEvents={isWebViewBlocked ? 'none' : 'auto'} style={styles.webviewShell}>
          {terminalHtml ? (
            <WebView
              automaticallyAdjustContentInsets={false}
              ref={terminalWebViewRef}
              allowFileAccess
              allowsInlineMediaPlayback
              bounces={false}
              contentInsetAdjustmentBehavior="never"
              hideKeyboardAccessoryView
              javaScriptEnabled
              keyboardDisplayRequiresUserAction
              onError={(event) => {
                const message = event.nativeEvent.description || 'Unknown WebView error';
                setLastError(`WebView failed to load: ${message}`);
              }}
              onMessage={handleTerminalBridgeMessage}
              originWhitelist={['*']}
              scrollEnabled={false}
              source={{ html: terminalHtml, baseUrl: 'file:///' }}
              style={styles.webview}
            />
          ) : (
            <View style={styles.loadingState}>
              <ThemedText style={styles.loadingText}>Loading terminal runtime…</ThemedText>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      {compactStatus ? (
        <SafeAreaView edges={['bottom']} pointerEvents="none" style={styles.statusSafeArea}>
          <View style={styles.statusCard}>
            <ThemedText style={styles.statusText}>{compactStatus}</ThemedText>
          </View>
        </SafeAreaView>
      ) : null}

      <Modal animationType="slide" transparent visible={showTabSheet} onRequestClose={() => setShowTabSheet(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setShowTabSheet(false)}>
          <View style={styles.sheetCard}>
            <ThemedText style={styles.sheetTitle}>Terminals</ThemedText>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetList}>
              {snapshot.tabs.map((tab) => {
                const isActive = tab.id === snapshot.activeTabId;
                return (
                  <View key={tab.id} style={[styles.sheetRow, isActive ? styles.sheetRowActive : null]}>
                    <Pressable onPress={() => activateTab(tab.id)} style={styles.sheetRowMain}>
                      <ThemedText numberOfLines={1} style={styles.sheetRowTitle}>
                        {tab.projectName}
                      </ThemedText>
                      <ThemedText style={styles.sheetRowMeta}>{tab.status}</ThemedText>
                    </Pressable>
                    <Pressable onPress={() => closeTab(tab.id)} style={styles.sheetCloseButton}>
                      <ThemedText style={styles.sheetCloseText}>Close</ThemedText>
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <Modal animationType="slide" transparent visible={showProjectSheet} onRequestClose={() => setShowProjectSheet(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setShowProjectSheet(false)}>
          <View style={styles.sheetCard}>
            <ThemedText style={styles.sheetTitle}>Open Project In New Tab</ThemedText>
            {projectsLoading ? (
              <View style={styles.loadingProjects}>
                <ActivityIndicator color="#93c5fd" />
              </View>
            ) : null}
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetList}>
              {availableProjects.map((project) => (
                <Pressable key={project.id} onPress={() => createTabFromProject(project)} style={styles.projectRow}>
                  <ThemedText style={styles.projectRowTitle}>{project.name}</ThemedText>
                  <ThemedText style={styles.projectRowMeta}>{project.path}</ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function firstParam(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizePersistence(value?: string): TerminalPersistenceMode | undefined {
  if (value === 'persisted') {
    return 'persisted';
  }

  if (value === 'ephemeral') {
    return 'ephemeral';
  }

  return undefined;
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#0b0d10',
    flex: 1,
  },
  brandGlowTop: {
    backgroundColor: 'rgba(45, 212, 191, 0.08)',
    borderRadius: 220,
    height: 220,
    position: 'absolute',
    right: -90,
    top: -110,
    width: 220,
  },
  flex1: {
    flex: 1,
    minHeight: 0,
  },
  webviewShell: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  webview: {
    backgroundColor: '#0f1115',
    flex: 1,
  },
  loadingState: {
    alignItems: 'center',
    backgroundColor: '#0f1115',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    color: '#aab2bf',
    fontFamily: Fonts.mono,
    fontSize: 13,
  },
  topSafeArea: {
    backgroundColor: 'transparent',
  },
  topCard: {
    alignItems: 'flex-start',
    backgroundColor: '#10141d',
    borderBottomColor: '#1f2634',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    paddingBottom: 11,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  topMeta: {
    flex: 1,
    minWidth: 0,
  },
  topBarActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: '#1a2230',
    borderColor: '#31405a',
    borderRadius: 10,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    minWidth: 58,
    paddingHorizontal: 12,
  },
  statusSafeArea: {
    bottom: 10,
    left: 12,
    position: 'absolute',
    right: 12,
  },
  statusCard: {
    backgroundColor: 'rgba(17, 21, 28, 0.96)',
    borderColor: '#29303c',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  statusText: {
    color: '#c2c9d4',
    fontFamily: Fonts.sans,
    fontSize: 12,
  },
  sheetBackdrop: {
    backgroundColor: 'rgba(6, 8, 10, 0.65)',
    flex: 1,
    justifyContent: 'flex-end',
    padding: 10,
  },
  sheetCard: {
    backgroundColor: '#0f141d',
    borderColor: '#273145',
    borderRadius: 14,
    borderWidth: 1,
    maxHeight: '78%',
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  sheetTitle: {
    color: '#eef2f7',
    fontFamily: Fonts.sans,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
  },
  sheetList: {
    paddingBottom: 20,
  },
  sheetRow: {
    alignItems: 'center',
    backgroundColor: '#141c2a',
    borderColor: '#2d3a50',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  sheetRowActive: {
    borderColor: '#38bdf8',
    backgroundColor: '#182436',
  },
  sheetRowMain: {
    flex: 1,
    minWidth: 0,
  },
  sheetRowTitle: {
    color: '#eef2f7',
    fontFamily: Fonts.sans,
    fontSize: 13,
    fontWeight: '600',
  },
  sheetRowMeta: {
    color: '#98a2b3',
    fontFamily: Fonts.sans,
    fontSize: 11,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  sheetCloseButton: {
    backgroundColor: '#1c2533',
    borderColor: '#32435e',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  sheetCloseText: {
    color: '#e2e8f0',
    fontFamily: Fonts.sans,
    fontSize: 11,
    fontWeight: '600',
  },
  loadingProjects: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  projectRow: {
    backgroundColor: '#141c2a',
    borderColor: '#2d3a50',
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  projectRowTitle: {
    color: '#eef2f7',
    fontFamily: Fonts.sans,
    fontSize: 13,
    fontWeight: '600',
  },
  projectRowMeta: {
    color: '#97a1b1',
    fontFamily: Fonts.mono,
    fontSize: 11,
    marginTop: 3,
  },
});
