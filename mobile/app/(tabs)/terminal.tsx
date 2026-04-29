import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { ProjectSheet } from '@/components/terminal/project-sheet';
import { TabSheet } from '@/components/terminal/tab-sheet';
import { Fonts } from '@/constants/theme';
import { useTerminalBridge } from '@/hooks/use-terminal-bridge';
import {
  loadTerminalHtml,
  type ProjectDefinition,
  type TerminalBridgeMessage,
  type TerminalPersistenceMode,
} from '@/lib/terminal';
import { terminalTabsManager } from '@/lib/terminal-tabs';

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
  text: '#d6d6dd',
  muted: '#7a797a',
  accent: '#228df2',
  success: '#15ac91',
  danger: '#f14c4c',
  warning: '#ea7620',
};

function firstParam(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizePersistence(value?: string): TerminalPersistenceMode | undefined {
  if (value === 'persisted') return 'persisted';
  if (value === 'ephemeral') return 'ephemeral';
  return undefined;
}

export default function TerminalTabScreen() {
  const params = useLocalSearchParams<RouteParams>();
  const consumedRequestIdRef = useRef<string | null>(null);
  const bridge = useTerminalBridge();
  const {
    webViewRef,
    snapshot,
    setIsTerminalReady,
    isWebViewBlocked,
    lastError,
    setLastError,
    dismissSoftKeyboard,
    preventKeyboardDismiss,
    setBanner,
  } = bridge;

  const [terminalHtml, setTerminalHtml] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showTabSheet, setShowTabSheet] = useState(false);
  const [showProjectSheet, setShowProjectSheet] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [availableProjects, setAvailableProjects] = useState<ProjectDefinition[]>([]);

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
        if (isMounted) {
          setLastError(
            `Failed to load terminal: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    void loadAssets();
    return () => {
      isMounted = false;
    };
  }, [setLastError]);

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
      if (!snapshot.activeTabId) setBanner('Claude Terminal', 'Open a tab to start.');
      return;
    }
    if (message.type === 'terminal_runtime_error') {
      setLastError(`Runtime error: ${message.message}`);
      return;
    }
    if (!snapshot.activeTabId) return;
    if (message.type === 'terminal_input') {
      terminalTabsManager.sendInputToActive(message.data);
      return;
    }
    terminalTabsManager.resizeActive(message.cols, message.rows);
  }

  async function openProjectChooser(): Promise<void> {
    const connectionUrl = activeTab?.connectionUrl;
    if (!connectionUrl) {
      setStatusMessage('Open a tab first.');
      return;
    }
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
    setStatusMessage(result.error);
  }

  function createTabFromProject(project: ProjectDefinition): void {
    const connectionUrl = activeTab?.connectionUrl;
    if (!connectionUrl) {
      setStatusMessage('Unable to resolve relay connection.');
      return;
    }
    const result = terminalTabsManager.openProjectTab({
      projectId: project.id,
      projectName: project.name,
      connectionUrl,
      persistence: 'persisted',
    });
    if (result.error) {
      setStatusMessage(result.error);
      return;
    }
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
                <View
                  style={[
                    styles.tabDot,
                    { backgroundColor: activeTab.status === 'live' ? C.success : C.muted },
                  ]}
                />
                <Text style={styles.topBarTitle} numberOfLines={1}>
                  {activeTab.projectName}
                </Text>
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
            <Pressable
              onLongPress={() => void openProjectChooser()}
              onPress={createQuickTab}
              style={styles.iconBtn}
            >
              <MaterialIcons color={C.accent} name="add" size={18} />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex1}
      >
        <View
          onTouchStart={preventKeyboardDismiss}
          pointerEvents={isWebViewBlocked ? 'none' : 'auto'}
          style={styles.webviewShell}
        >
          {terminalHtml ? (
            <WebView
              automaticallyAdjustContentInsets={false}
              ref={webViewRef}
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
          <Text style={[styles.statusText, { color: statusColor }]} numberOfLines={1}>
            {compactStatus}
          </Text>
        </SafeAreaView>
      ) : null}

      <TabSheet
        visible={showTabSheet}
        snapshot={snapshot}
        onClose={() => setShowTabSheet(false)}
        onActivate={(tabId) => terminalTabsManager.activateTab(tabId)}
        onCloseTab={(tabId) => terminalTabsManager.closeTab(tabId)}
      />

      <ProjectSheet
        visible={showProjectSheet}
        loading={projectsLoading}
        projects={availableProjects}
        onClose={() => setShowProjectSheet(false)}
        onSelect={createTabFromProject}
      />
    </View>
  );
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
  topBarTitle: {
    color: '#d1d1d1',
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: 12,
    fontWeight: '400',
  },
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
  iconBtn: {
    alignItems: 'center',
    borderRadius: 6,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  flex1: { flex: 1, minHeight: 0 },
  webviewShell: { flex: 1, minHeight: 0, overflow: 'hidden' },
  webview: { backgroundColor: C.bg, flex: 1 },
  loadingState: {
    alignItems: 'center',
    backgroundColor: C.bg,
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
  },
  loadingText: { color: C.muted, fontFamily: Fonts.sans, fontSize: 12 },
  statusBar: {
    bottom: 0,
    left: 0,
    paddingHorizontal: 16,
    paddingVertical: 6,
    position: 'absolute',
    right: 0,
  },
  statusText: { fontFamily: Fonts.sans, fontSize: 11 },
});
