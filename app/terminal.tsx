import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import {
  terminalTabsManager,
  type TabsSnapshot,
} from '@/lib/terminal-tabs';
import {
  type ProjectDefinition,
  type TerminalBridgeMessage,
  loadTerminalHtml,
  type TerminalPersistenceMode,
} from '@/lib/terminal';

type RouteParams = {
  action?: string | string[];
  requestId?: string | string[];
  url?: string | string[];
  projectId?: string | string[];
  projectName?: string | string[];
  sessionId?: string | string[];
  persistence?: string | string[];
};

export default function FullscreenTerminalScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<RouteParams>();
  const webViewRef = useRef<WebView>(null);
  const outputFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingOutputRef = useRef('');
  const consumedRequestIdRef = useRef<string | null>(null);
  const { width } = useWindowDimensions();

  const [terminalHtml, setTerminalHtml] = useState<string | null>(null);
  const [isTerminalReady, setIsTerminalReady] = useState(false);
  const [snapshot, setSnapshot] = useState<TabsSnapshot>(terminalTabsManager.getSnapshot());
  const [lastError, setLastError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showTabSheet, setShowTabSheet] = useState(false);
  const [showProjectSheet, setShowProjectSheet] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [availableProjects, setAvailableProjects] = useState<ProjectDefinition[]>([]);

  const swipeX = useSharedValue(0);

  const activeTab = useMemo(
    () => snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId) ?? null,
    [snapshot.activeTabId, snapshot.tabs],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadAssets(): Promise<void> {
      try {
        const html = await loadTerminalHtml();
        if (isMounted) {
          setTerminalHtml(html);
        }
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

  const escapeForBridge = useCallback(
    (value: string): string =>
      JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'),
    [],
  );

  const runInTerminal = useCallback((script: string): void => {
    webViewRef.current?.injectJavaScript(`${script}\ntrue;`);
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

  const pushTerminalData = useCallback((data: string): void => {
    pendingOutputRef.current += data;
    if (outputFlushTimeoutRef.current) {
      return;
    }

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
      outputFlushTimeoutRef.current && clearTimeout(outputFlushTimeoutRef.current);
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
        runInTerminal("window.__setTerminalBanner('Claude Terminal', 'Swipe to switch tabs once you have more than one.');");
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

  async function maybeHapticSwitch(): Promise<void> {
    if (Platform.OS === 'ios') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }

  const switchWithGesture = useCallback((direction: 'next' | 'prev'): void => {
    const switched = terminalTabsManager.switchRelative(direction === 'next' ? 1 : -1);
    if (switched) {
      void maybeHapticSwitch();
    }
  }, []);

  const swipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-16, 16])
        .failOffsetY([-10, 10])
        .onUpdate((event) => {
          const maxDrift = Math.min(56, width * 0.16);
          const next = Math.max(-maxDrift, Math.min(maxDrift, event.translationX * 0.22));
          swipeX.value = next;
        })
        .onEnd((event) => {
          const velocity = event.velocityX;
          const travel = event.translationX;
          const passed = Math.abs(travel) > width * 0.14 || Math.abs(velocity) > 720;

          if (passed) {
            if (travel < 0 || velocity < -720) {
              runOnJS(switchWithGesture)('next');
            } else {
              runOnJS(switchWithGesture)('prev');
            }
          }

          swipeX.value = withSpring(0, { damping: 18, stiffness: 220 });
        }),
    [swipeX, switchWithGesture, width],
  );

  const terminalAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: swipeX.value }],
  }));

  const activeStatusColor = useMemo(() => {
    if (!activeTab) {
      return '#71717a';
    }

    if (activeTab.status === 'live') {
      return '#34d399';
    }

    if (activeTab.status === 'connecting') {
      return '#60a5fa';
    }

    if (activeTab.status === 'exited') {
      return '#fbbf24';
    }

    if (activeTab.status === 'error') {
      return '#f87171';
    }

    return '#a1a1aa';
  }, [activeTab]);

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

  const controlKeys = [
    { label: 'ESC', sequence: '\x1b' },
    { label: 'TAB', sequence: '\x09' },
    { label: '↑', sequence: '\x1b[A' },
    { label: '↓', sequence: '\x1b[B' },
    { label: '←', sequence: '\x1b[D' },
    { label: '→', sequence: '\x1b[C' },
    { label: '^C', sequence: '\x03' },
    { label: '^D', sequence: '\x04' },
  ];

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <SafeAreaView edges={['top', 'left', 'right']} style={styles.topSafeArea}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.iconButton}>
            <ThemedText style={styles.topBarButtonText}>←</ThemedText>
          </Pressable>

          <Pressable onPress={() => setShowTabSheet(true)} style={styles.activeCenter}>
            <View style={[styles.statusDot, { backgroundColor: activeStatusColor }]} />
            <View style={styles.activeCenterTextWrap}>
              <ThemedText numberOfLines={1} style={styles.activeProjectText}>
                {activeTab?.projectName ?? 'No terminal'}
              </ThemedText>
              <ThemedText style={styles.activeMetaText}>
                {snapshot.tabs.length > 0 && snapshot.activeTabIndex >= 0
                  ? `${snapshot.activeTabIndex + 1}/${snapshot.tabs.length} · ${activeTab?.status}`
                  : '0/0'}
              </ThemedText>
            </View>
          </Pressable>

          <View style={styles.topBarActions}>
            <Pressable
              onLongPress={() => {
                void openProjectChooser();
              }}
              onPress={createQuickTab}
              style={styles.iconButton}>
              <ThemedText style={styles.topBarButtonText}>+</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => {
                setShowControls((prev) => {
                  const next = !prev;
                  if (!next) {
                    Keyboard.dismiss();
                    runInTerminal('window.__blurTerminal?.();');
                  }
                  return next;
                });
              }}
              style={styles.iconButton}>
              <ThemedText style={styles.topBarButtonText}>{showControls ? '⌄' : '⌃'}</ThemedText>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex1}>
        <GestureDetector gesture={swipeGesture}>
          <Animated.View style={[styles.webviewShell, terminalAnimatedStyle]}>
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
                keyboardDisplayRequiresUserAction={true}
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
          </Animated.View>
        </GestureDetector>

        {showControls ? (
          <View style={styles.toolbarContainer}>
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="always"
              scrollEnabled
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.toolbarContent}>
              {controlKeys.map((key) => (
                <Pressable
                  key={key.label}
                  onPress={() => terminalTabsManager.sendInputToActive(key.sequence)}
                  style={styles.controlKeyButton}>
                  <ThemedText style={styles.controlKeyText}>{key.label}</ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      {compactStatus ? (
        <SafeAreaView edges={['bottom']} pointerEvents="none" style={styles.statusSafeArea}>
          <View style={styles.statusCard}>
            <ThemedText style={styles.statusText}>{compactStatus}</ThemedText>
          </View>
        </SafeAreaView>
      ) : null}

      <Modal
        animationType="slide"
        transparent
        visible={showTabSheet}
        onRequestClose={() => setShowTabSheet(false)}>
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

      <Modal
        animationType="slide"
        transparent
        visible={showProjectSheet}
        onRequestClose={() => setShowProjectSheet(false)}>
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
                <Pressable
                  key={project.id}
                  onPress={() => createTabFromProject(project)}
                  style={styles.projectRow}>
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
    backgroundColor: '#020617',
    flex: 1,
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
    backgroundColor: '#020617',
    flex: 1,
  },
  loadingState: {
    alignItems: 'center',
    backgroundColor: '#020617',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    color: '#cbd5e1',
    fontFamily: Fonts.mono,
    fontSize: 14,
  },
  topSafeArea: {
    backgroundColor: '#09090b',
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 6,
  },
  topBarActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  activeCenter: {
    alignItems: 'center',
    backgroundColor: '#12121a',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  activeCenterTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  activeProjectText: {
    color: '#f4f4f5',
    fontFamily: Fonts.mono,
    fontSize: 11,
    fontWeight: '700',
  },
  activeMetaText: {
    color: '#9ca3af',
    fontFamily: Fonts.mono,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  statusDot: {
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: '#141418',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 999,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  topBarButtonText: {
    color: '#f4f4f5',
    fontFamily: Fonts.mono,
    fontSize: 11,
    fontWeight: '700',
  },
  toolbarContainer: {
    backgroundColor: '#09090b',
    borderTopColor: 'rgba(255, 255, 255, 0.07)',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toolbarContent: {
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  controlKeyButton: {
    backgroundColor: '#18181b',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  controlKeyText: {
    color: '#f4f4f5',
    fontFamily: Fonts.mono,
    fontSize: 12,
    fontWeight: '700',
  },
  statusSafeArea: {
    bottom: 80,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  statusCard: {
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderColor: 'rgba(148, 163, 184, 0.22)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusText: {
    color: '#e2e8f0',
    fontFamily: Fonts.mono,
    fontSize: 11,
  },
  sheetBackdrop: {
    backgroundColor: 'rgba(2, 6, 23, 0.64)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetCard: {
    backgroundColor: '#09090b',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: '62%',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 18,
  },
  sheetTitle: {
    color: '#f8fafc',
    fontFamily: Fonts.rounded,
    fontSize: 18,
    marginBottom: 10,
  },
  sheetList: {
    gap: 8,
    paddingBottom: 10,
  },
  sheetRow: {
    alignItems: 'center',
    backgroundColor: '#111827',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  sheetRowActive: {
    borderColor: 'rgba(96, 165, 250, 0.66)',
  },
  sheetRowMain: {
    flex: 1,
    minWidth: 0,
  },
  sheetRowTitle: {
    color: '#f8fafc',
    fontFamily: Fonts.mono,
    fontSize: 12,
    fontWeight: '700',
  },
  sheetRowMeta: {
    color: '#9ca3af',
    fontFamily: Fonts.mono,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  sheetCloseButton: {
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  sheetCloseText: {
    color: '#d1d5db',
    fontFamily: Fonts.mono,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  loadingProjects: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  projectRow: {
    backgroundColor: '#111827',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  projectRowTitle: {
    color: '#f8fafc',
    fontFamily: Fonts.mono,
    fontSize: 12,
    fontWeight: '700',
  },
  projectRowMeta: {
    color: '#9ca3af',
    fontFamily: Fonts.mono,
    fontSize: 10,
    marginTop: 3,
  },
});
