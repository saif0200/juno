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
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

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

const C = {
  bg: '#181818',
  surface: '#1d1d1d',
  surfaceActive: '#2a282a',
  border: '#383838',
  borderActive: '#163761',
  text: '#d6d6dd',
  muted: '#7a797a',
  accent: '#228df2',
  success: '#15ac91',
  danger: '#f14c4c',
  warning: '#ea7620',
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
        if (isMounted) setTerminalHtml(html);
      } catch (error) {
        if (isMounted) setLastError(`Failed to load terminal: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    void loadAssets();
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    return () => { if (blockTimeoutRef.current) clearTimeout(blockTimeoutRef.current); };
  }, []);

  const escapeForBridge = useCallback(
    (value: string): string => JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'),
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
    if (!pendingOutputRef.current) return;
    const nextChunk = pendingOutputRef.current;
    pendingOutputRef.current = '';
    runInTerminal(`window.__writeTerminal(${escapeForBridge(nextChunk)});`);
  }, [escapeForBridge, runInTerminal]);

  const pushTerminalData = useCallback((data: string): void => {
    pendingOutputRef.current += data;
    if (outputFlushTimeoutRef.current) return;
    outputFlushTimeoutRef.current = setTimeout(flushTerminalOutput, 16);
  }, [flushTerminalOutput]);

  const clearTerminal = useCallback((): void => {
    flushTerminalOutput();
    runInTerminal('window.__clearTerminal();');
  }, [flushTerminalOutput, runInTerminal]);

  const renderFullBuffer = useCallback((tabId: string | null): void => {
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
  }, [clearTerminal, escapeForBridge, runInTerminal]);

  useEffect(() => {
    const unsubscribe = terminalTabsManager.subscribe((event) => {
      if (event.type === 'tabs_changed') {
        setSnapshot(event.snapshot);
        const currentActive = event.snapshot.tabs.find((tab) => tab.id === event.snapshot.activeTabId) ?? null;
        setLastError(currentActive?.lastError ?? null);
        return;
      }
      if (!isTerminalReady) return;
      if (event.type === 'active_output') { pushTerminalData(event.data); return; }
      flushTerminalOutput();
      clearTerminal();
      runInTerminal(`window.__writeTerminal(${escapeForBridge(event.data)});`);
    });
    return () => {
      unsubscribe();
      if (outputFlushTimeoutRef.current) clearTimeout(outputFlushTimeoutRef.current);
    };
  }, [clearTerminal, escapeForBridge, flushTerminalOutput, isTerminalReady, pushTerminalData, runInTerminal]);

  useEffect(() => {
    if (!isTerminalReady || !terminalHtml) return;
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
    if (!requestId || consumedRequestIdRef.current === requestId) return;
    consumedRequestIdRef.current = requestId;
    if (action === 'open_project' && url && projectId && projectName) {
      const result = terminalTabsManager.openProjectTab({ projectId, projectName, connectionUrl: url, persistence });
      setStatusMessage(result.error);
      return;
    }
    if (action === 'open_existing' && url && sessionId && projectId && projectName) {
      const result = terminalTabsManager.openExistingSession({ relaySessionId: sessionId, projectId, projectName, connectionUrl: url, persistence: persistence ?? 'persisted' });
      setStatusMessage(result.error);
    }
  }, [action, persistence, projectId, projectName, requestId, sessionId, url]);

  function handleTerminalBridgeMessage(event: WebViewMessageEvent): void {
    const message = JSON.parse(event.nativeEvent.data) as TerminalBridgeMessage;
    if (message.type === 'terminal_ready') {
      setIsTerminalReady(true);
      if (!snapshot.activeTabId) runInTerminal("window.__setTerminalBanner('Claude Terminal', 'Open a tab to start.');");
      return;
    }
    if (message.type === 'terminal_runtime_error') { setLastError(`Runtime error: ${message.message}`); return; }
    if (!snapshot.activeTabId) return;
    if (message.type === 'terminal_input') { terminalTabsManager.sendInputToActive(message.data); return; }
    terminalTabsManager.resizeActive(message.cols, message.rows);
  }

  async function openProjectChooser(): Promise<void> {
    const connectionUrl = activeTab?.connectionUrl;
    if (!connectionUrl) { setStatusMessage('Open a tab first.'); return; }
    setShowProjectSheet(true);
    const cached = terminalTabsManager.getKnownProjects(connectionUrl);
    if (cached.length > 0) setAvailableProjects(cached);
    setProjectsLoading(true);
    const result = await terminalTabsManager.fetchProjectsForConnection(connectionUrl);
    setProjectsLoading(false);
    setAvailableProjects(result.projects);
    setStatusMessage(result.error);
  }

  function createQuickTab(): void {
    const result = terminalTabsManager.createTabLikeActive();
    if (result.error) setStatusMessage(result.error);
    else setStatusMessage(null);
  }

  function createTabFromProject(project: ProjectDefinition): void {
    const connectionUrl = activeTab?.connectionUrl;
    if (!connectionUrl) { setStatusMessage('Unable to resolve relay connection.'); return; }
    const result = terminalTabsManager.openProjectTab({ projectId: project.id, projectName: project.name, connectionUrl, persistence: 'persisted' });
    if (result.error) { setStatusMessage(result.error); return; }
    setShowProjectSheet(false);
    setStatusMessage(null);
  }

  const compactStatus = useMemo(() => {
    if (statusMessage) return statusMessage;
    if (lastError) return lastError;
    if (!activeTab) return 'Tap + to open a terminal';
    if (activeTab.status === 'live') return null;
    if (activeTab.status === 'exited') return activeTab.exitState?.message ?? 'Process exited';
    return `${activeTab.status} · ${activeTab.projectName}`;
  }, [activeTab, lastError, statusMessage]);

  const statusColor = lastError ? C.danger : statusMessage ? C.warning : C.muted;

  return (
    <View onTouchStart={dismissSoftKeyboard} style={styles.screen}>
      <StatusBar style="light" />
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.topSafeArea}>
        <View style={styles.topBar}>
          <View style={styles.topBarLeft}>
            {activeTab ? (
              <>
                <View style={[styles.tabDot, { backgroundColor: activeTab.status === 'live' ? C.success : C.muted }]} />
                <Text style={styles.topBarTitle} numberOfLines={1}>{activeTab.projectName}</Text>
                {snapshot.tabs.length > 1 ? (
                  <Text style={styles.topBarCount}>{snapshot.tabs.length}</Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.topBarTitle}>terminal</Text>
            )}
          </View>
          <View style={styles.topBarRight}>
            <Pressable onPress={() => setShowTabSheet(true)} style={styles.iconBtn}>
              <MaterialIcons color={C.muted} name="layers" size={18} />
            </Pressable>
            <Pressable onLongPress={() => void openProjectChooser()} onPress={createQuickTab} style={styles.iconBtn}>
              <MaterialIcons color={C.accent} name="add" size={18} />
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
              onError={(e) => setLastError(`WebView error: ${e.nativeEvent.description}`)}
              onMessage={handleTerminalBridgeMessage}
              originWhitelist={['*']}
              scrollEnabled={false}
              source={{ html: terminalHtml, baseUrl: 'file:///' }}
              style={styles.webview}
            />
          ) : (
            <View style={styles.loadingState}>
              <ActivityIndicator color={C.muted} size="small" />
              <Text style={styles.loadingText}>Loading terminal…</Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      {compactStatus ? (
        <SafeAreaView edges={['bottom']} pointerEvents="none" style={styles.statusBar}>
          <Text style={[styles.statusText, { color: statusColor }]} numberOfLines={1}>{compactStatus}</Text>
        </SafeAreaView>
      ) : null}

      {/* Tab sheet */}
      <Modal animationType="slide" transparent visible={showTabSheet} onRequestClose={() => setShowTabSheet(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShowTabSheet(false)}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Terminals</Text>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetContent}>
              {snapshot.tabs.length === 0 ? (
                <Text style={styles.sheetEmpty}>No open terminals.</Text>
              ) : snapshot.tabs.map((tab) => {
                const isActive = tab.id === snapshot.activeTabId;
                return (
                  <View key={tab.id} style={[styles.sheetRow, isActive && styles.sheetRowActive]}>
                    <Pressable onPress={() => { terminalTabsManager.activateTab(tab.id); setShowTabSheet(false); }} style={styles.sheetRowMain}>
                      <View style={styles.sheetRowTop}>
                        <View style={[styles.tabDot, { backgroundColor: tab.status === 'live' ? C.success : C.muted }]} />
                        <Text style={styles.sheetRowName} numberOfLines={1}>{tab.projectName}</Text>
                      </View>
                      <Text style={styles.sheetRowMeta}>{tab.status}</Text>
                    </Pressable>
                    <Pressable onPress={() => terminalTabsManager.closeTab(tab.id)} style={styles.sheetCloseBtn}>
                      <MaterialIcons color={C.muted} name="close" size={14} />
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* Project sheet */}
      <Modal animationType="slide" transparent visible={showProjectSheet} onRequestClose={() => setShowProjectSheet(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShowProjectSheet(false)}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Open project</Text>
            {projectsLoading ? <ActivityIndicator color={C.muted} style={{ marginBottom: 12 }} /> : null}
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetContent}>
              {availableProjects.map((project) => (
                <Pressable key={project.id} onPress={() => createTabFromProject(project)} style={styles.sheetRow}>
                  <Text style={styles.sheetRowName}>{project.name}</Text>
                  <Text style={styles.sheetRowMeta} numberOfLines={1}>{project.path}</Text>
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
  if (value === 'persisted') return 'persisted';
  if (value === 'ephemeral') return 'ephemeral';
  return undefined;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: C.bg, flex: 1 },
  topSafeArea: { backgroundColor: C.surface, borderBottomColor: C.border, borderBottomWidth: 1 },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  topBarLeft: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 8, minWidth: 0 },
  tabDot: { borderRadius: 99, flexShrink: 0, height: 6, width: 6 },
  topBarTitle: { color: '#d1d1d1', flex: 1, fontFamily: Fonts.sans, fontSize: 12, fontWeight: '400' },
  topBarCount: {
    backgroundColor: C.surfaceActive,
    borderRadius: 3,
    color: C.muted,
    fontFamily: Fonts.sans,
    fontSize: 10,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  topBarRight: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  iconBtn: { alignItems: 'center', borderRadius: 6, height: 36, justifyContent: 'center', width: 36 },
  flex1: { flex: 1, minHeight: 0 },
  webviewShell: { flex: 1, minHeight: 0, overflow: 'hidden' },
  webview: { backgroundColor: C.bg, flex: 1 },
  loadingState: { alignItems: 'center', backgroundColor: C.bg, flex: 1, flexDirection: 'row', gap: 10, justifyContent: 'center' },
  loadingText: { color: C.muted, fontFamily: Fonts.sans, fontSize: 12 },
  statusBar: { bottom: 0, left: 0, paddingHorizontal: 16, paddingVertical: 6, position: 'absolute', right: 0 },
  statusText: { fontFamily: Fonts.sans, fontSize: 11 },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.6)', flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface,
    borderTopColor: C.border,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderTopWidth: 1,
    maxHeight: '80%',
    paddingBottom: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  sheetHandle: { alignSelf: 'center', backgroundColor: C.border, borderRadius: 99, height: 4, marginBottom: 14, width: 36 },
  sheetTitle: { color: C.text, fontFamily: Fonts.sans, fontSize: 10, fontWeight: '500', letterSpacing: 0.8, marginBottom: 12, textTransform: 'uppercase' },
  sheetContent: { gap: 1, paddingBottom: 40 },
  sheetEmpty: { color: C.muted, fontFamily: Fonts.sans, fontSize: 12, paddingVertical: 8 },
  sheetRow: {
    backgroundColor: C.surface,
    borderBottomColor: C.border,
    borderBottomWidth: 1,
    gap: 4,
    marginBottom: -1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  sheetRowActive: { backgroundColor: C.surfaceActive },
  sheetRowMain: { flex: 1, gap: 3 },
  sheetRowTop: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  sheetRowName: { color: '#d1d1d1', flex: 1, fontFamily: Fonts.sans, fontSize: 13, fontWeight: '400' },
  sheetRowMeta: { color: C.muted, fontFamily: Fonts.sans, fontSize: 11 },
  sheetCloseBtn: { alignItems: 'center', height: 36, justifyContent: 'center', width: 36 },
});
