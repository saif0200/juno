import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
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
    type ServerMessage,
    type TerminalBridgeMessage,
    getDefaultWebSocketUrl,
    loadTerminalHtml,
} from '@/lib/terminal';

type RouteParams = {
  mode?: string | string[];
  projectId?: string | string[];
  projectName?: string | string[];
  projectPath?: string | string[];
  sessionId?: string | string[];
  url?: string | string[];
};

type OverlayTone = 'neutral' | 'warning' | 'danger';

export default function FullscreenTerminalScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<RouteParams>();
  const webViewRef = useRef<WebView>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const outputFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingOutputRef = useRef('');
  const activeSessionIdRef = useRef<string | null>(null);
  const activeProjectNameRef = useRef<string | null>(null);
  const didExitRef = useRef(false);
  const [terminalHtml, setTerminalHtml] = useState<string | null>(null);
  const [isTerminalReady, setIsTerminalReady] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Preparing terminal...');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeProjectName, setActiveProjectName] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [didExit, setDidExit] = useState(false);
  const [exitMessage, setExitMessage] = useState<string | null>(null);

  const mode = firstParam(params.mode) === 'resume' ? 'resume' : 'create';
  const url = firstParam(params.url) ?? getDefaultWebSocketUrl();
  const routeProjectId = firstParam(params.projectId);
  const routeProjectName = firstParam(params.projectName);
  const routeSessionId = firstParam(params.sessionId);

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
        setConnectionStatus('Terminal runtime failed');
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
      pingIntervalRef.current && clearInterval(pingIntervalRef.current);
      outputFlushTimeoutRef.current && clearTimeout(outputFlushTimeoutRef.current);
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    activeProjectNameRef.current = activeProjectName;
  }, [activeProjectName]);

  useEffect(() => {
    didExitRef.current = didExit;
  }, [didExit]);


  function escapeForBridge(value: string): string {
    return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  const runInTerminal = useCallback((script: string): void => {
    webViewRef.current?.injectJavaScript(`${script}\ntrue;`);
  }, []);

  const dismissKeyboard = useCallback((): void => {
    Keyboard.dismiss();
    runInTerminal('window.__blurTerminal?.();');
  }, [runInTerminal]);

  const sendKey = useCallback((sequence: string): void => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'terminal_input', data: sequence }));
    }
  }, []);

  const flushTerminalOutput = useCallback((): void => {
    outputFlushTimeoutRef.current = null;
    if (!pendingOutputRef.current) {
      return;
    }

    const nextChunk = pendingOutputRef.current;
    pendingOutputRef.current = '';
    runInTerminal(`window.__writeTerminal(${escapeForBridge(nextChunk)});`);
  }, [runInTerminal]);

  const pushTerminalData = useCallback((data: string): void => {
    pendingOutputRef.current += data;
    if (outputFlushTimeoutRef.current) {
      return;
    }

    outputFlushTimeoutRef.current = setTimeout(flushTerminalOutput, 16);
  }, [flushTerminalOutput]);

  const showTerminalBanner = useCallback((title: string, subtitle?: string): void => {
    flushTerminalOutput();
    runInTerminal(
      `window.__setTerminalBanner(${escapeForBridge(title)}, ${escapeForBridge(subtitle ?? '')});`,
    );
  }, [flushTerminalOutput, runInTerminal]);

  const clearTerminal = useCallback((): void => {
    flushTerminalOutput();
    runInTerminal('window.__clearTerminal();');
  }, [flushTerminalOutput, runInTerminal]);

  const startPingLoop = useCallback((): void => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }

    pingIntervalRef.current = setInterval(() => {
      if (
        !socketRef.current ||
        socketRef.current.readyState !== WebSocket.OPEN ||
        !activeSessionIdRef.current
      ) {
        return;
      }

      socketRef.current.send(JSON.stringify({ type: 'ping' }));
    }, 20000);
  }, []);

  const connect = useCallback(
    (shouldResumeExisting: boolean): void => {
      pingIntervalRef.current && clearInterval(pingIntervalRef.current);
      socketRef.current?.close();
      setLastError(null);
      setDidExit(false);
      setExitMessage(null);
      setConnectionStatus(shouldResumeExisting ? 'Reconnecting...' : 'Connecting...');
      showTerminalBanner(
        shouldResumeExisting ? 'Reconnecting session' : 'Connecting to relay',
        activeProjectNameRef.current ?? routeProjectName ?? url,
      );

      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnectionStatus(shouldResumeExisting ? 'Resuming session...' : 'Starting Claude...');

        if (shouldResumeExisting && (activeSessionIdRef.current ?? routeSessionId)) {
          socket.send(
            JSON.stringify({
              type: 'resume_session',
              sessionId: activeSessionIdRef.current ?? routeSessionId,
            }),
          );
          return;
        }

        if (!routeProjectId) {
          setConnectionStatus('Missing project');
          setLastError('No project was selected before entering the terminal.');
          showTerminalBanner('Missing project', 'Go back and choose a project first.');
          return;
        }

        clearTerminal();
        showTerminalBanner('Launching Claude', routeProjectName ?? routeProjectId);
        socket.send(
          JSON.stringify({
            type: 'create_session',
            projectId: routeProjectId,
          }),
        );
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as ServerMessage;

        if (message.type === 'session_created' || message.type === 'session_resumed') {
          setActiveSessionId(message.sessionId);
          setActiveProjectName(message.projectName);
          setConnectionStatus(
            message.type === 'session_created' ? 'Live session' : 'Session resumed',
          );
          startPingLoop();
          return;
        }

        if (message.type === 'terminal_output' || message.type === 'terminal_snapshot') {
          pushTerminalData(message.data);
          return;
        }

        if (message.type === 'terminal_exit') {
          const statusText = `Process exited with code ${message.exitCode}${
            message.signal ? `, signal ${message.signal}` : ''
          }.`;
          setConnectionStatus(`Exited (${message.exitCode})`);
          setDidExit(true);
          setExitMessage(statusText);
          pushTerminalData(`\r\n\x1b[90m[${statusText}]\x1b[0m\r\n`);
          return;
        }

        if (message.type === 'pong') {
          return;
        }

        if (message.type === 'error') {
          setConnectionStatus('Relay error');
          setLastError(`${message.code}: ${message.message}`);
          pushTerminalData(`\r\n\x1b[31m[${message.code}] ${message.message}\x1b[0m\r\n`);
        }
      };

      socket.onerror = () => {
        setConnectionStatus('Connection failed');
        setLastError('WebSocket connection failed.');
      };

      socket.onclose = () => {
        socketRef.current = null;
        pingIntervalRef.current && clearInterval(pingIntervalRef.current);
        if (didExitRef.current) {
          setConnectionStatus('Session closed');
          return;
        }

        setConnectionStatus(activeSessionIdRef.current ? 'Disconnected' : 'Connection closed');
      };
    },
    [
      pushTerminalData,
      routeProjectId,
      routeProjectName,
      routeSessionId,
      clearTerminal,
      showTerminalBanner,
      startPingLoop,
      url,
    ],
  );

  useEffect(() => {
    if (!isTerminalReady || !terminalHtml) {
      return;
    }

    connect(mode === 'resume');
  }, [connect, isTerminalReady, mode, terminalHtml]);

  function handleTerminalBridgeMessage(event: WebViewMessageEvent): void {
    const message = JSON.parse(event.nativeEvent.data) as TerminalBridgeMessage;

    if (message.type === 'terminal_ready') {
      setIsTerminalReady(true);
      showTerminalBanner('Claude Terminal', 'Preparing immersive session...');
      return;
    }

    if (message.type === 'terminal_runtime_error') {
      setConnectionStatus('Terminal runtime failed');
      setLastError(`WebView terminal error: ${message.message}`);
      return;
    }

    if (
      !socketRef.current ||
      socketRef.current.readyState !== WebSocket.OPEN ||
      activeSessionId === null
    ) {
      return;
    }

    if (message.type === 'terminal_input') {
      socketRef.current.send(
        JSON.stringify({
          type: 'terminal_input',
          data: message.data,
        }),
      );
      return;
    }

    socketRef.current.send(
      JSON.stringify({
        type: 'terminal_resize',
        cols: message.cols,
        rows: message.rows,
      }),
    );
  }

  function reconnect(): void {
    connect(didExit ? mode === 'resume' : Boolean(activeSessionId ?? routeSessionId));
  }

  const overlay = useMemo(() => {
    if (lastError) {
      return {
        tone: 'danger' as const,
        title: 'Relay error',
        subtitle: lastError,
      };
    }

    if (didExit) {
      return {
        tone: 'warning' as const,
        title: 'Session exited',
        subtitle: exitMessage ?? 'The Claude process has ended.',
      };
    }

    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      return {
        tone: 'neutral' as const,
        title: activeSessionId ? 'Disconnected' : 'Connecting',
        subtitle: activeSessionId
          ? 'Reconnect to reattach before the relay session expires.'
          : connectionStatus,
      };
    }

    return null;
  }, [activeSessionId, connectionStatus, didExit, exitMessage, lastError]);

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
          <View style={styles.topBarLead}>
            <Pressable onPress={() => router.back()} style={styles.topBarButton}>
              <ThemedText style={styles.topBarButtonText}>Workspace</ThemedText>
            </Pressable>
            {activeProjectName || routeProjectName ? (
              <View style={styles.projectBadge}>
                <ThemedText numberOfLines={1} style={styles.projectBadgeText}>
                  {activeProjectName ?? routeProjectName}
                </ThemedText>
              </View>
            ) : null}
          </View>
          <View style={styles.topBarActions}>
            <Pressable onPress={dismissKeyboard} style={styles.iconButton}>
              <ThemedText style={styles.topBarButtonText}>Hide keys</ThemedText>
            </Pressable>
            <Pressable onPress={() => runInTerminal('window.__focusTerminal?.();')} style={styles.iconButton}>
              <ThemedText style={styles.topBarButtonText}>Focus</ThemedText>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex1}
      >
        <View style={styles.webviewShell}>
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
                setConnectionStatus('Terminal runtime failed');
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

        <View style={styles.toolbarContainer}>
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="always"
            scrollEnabled
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.toolbarContent}
          >
            {controlKeys.map((key) => (
              <Pressable
                key={key.label}
                onPress={() => sendKey(key.sequence)}
                style={styles.controlKeyButton}
              >
                <ThemedText style={styles.controlKeyText}>{key.label}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      {overlay ? (
        <SafeAreaView edges={['bottom']} pointerEvents="box-none" style={styles.bottomSafeArea}>
          <View style={[styles.overlayCard, overlayToneStyles[overlay.tone]]}>
            <ThemedText style={styles.overlayTitle}>{overlay.title}</ThemedText>
            <ThemedText style={styles.overlaySubtitle}>{overlay.subtitle}</ThemedText>
            <View style={styles.overlayActions}>
              <Pressable onPress={() => router.back()} style={styles.secondaryAction}>
                <ThemedText style={styles.secondaryActionText}>Projects</ThemedText>
              </Pressable>
              {activeSessionId || routeSessionId || !didExit ? (
                <Pressable onPress={reconnect} style={styles.primaryAction}>
                  <ThemedText style={styles.primaryActionText}>
                    {didExit ? 'Reopen session' : 'Reconnect'}
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          </View>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

function firstParam(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const overlayToneStyles: Record<OverlayTone, object> = {
  neutral: {
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderColor: 'rgba(148, 163, 184, 0.22)',
  },
  warning: {
    backgroundColor: 'rgba(69, 26, 3, 0.92)',
    borderColor: 'rgba(251, 191, 36, 0.28)',
  },
  danger: {
    backgroundColor: 'rgba(69, 10, 10, 0.94)',
    borderColor: 'rgba(248, 113, 113, 0.24)',
  },
};

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
    gap: 10,
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  topBarLead: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minWidth: 0,
  },
  topBarActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  topBarButton: {
    backgroundColor: '#141418',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  iconButton: {
    backgroundColor: '#141418',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  topBarButtonText: {
    color: '#f4f4f5',
    fontFamily: Fonts.mono,
    fontSize: 11,
    fontWeight: '700',
  },
  projectBadge: {
    alignItems: 'center',
    backgroundColor: '#141418',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    maxWidth: 176,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  projectBadgeText: {
    color: '#e4e4e7',
    fontFamily: Fonts.mono,
    fontSize: 11,
    fontWeight: '600',
  },
  bottomSafeArea: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  overlayCard: {
    borderRadius: 26,
    borderWidth: 1,
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 18,
  },
  overlayTitle: {
    color: '#fafafa',
    fontFamily: Fonts.rounded,
    fontSize: 20,
  },
  overlaySubtitle: {
    color: '#d4d4d8',
    fontSize: 14,
    lineHeight: 21,
  },
  overlayActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  primaryAction: {
    alignItems: 'center',
    backgroundColor: '#fafafa',
    borderRadius: 16,
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  primaryActionText: {
    color: '#09090b',
    fontFamily: Fonts.mono,
    fontSize: 12,
    fontWeight: '700',
  },
  secondaryAction: {
    alignItems: 'center',
    backgroundColor: 'rgba(20, 20, 24, 0.86)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  secondaryActionText: {
    color: '#e2e8f0',
    fontFamily: Fonts.mono,
    fontSize: 12,
    fontWeight: '700',
  },
  toolbarContainer: {
    backgroundColor: '#09090b',
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
  },
  toolbarContent: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  controlKeyButton: {
    alignItems: 'center',
    backgroundColor: '#141418',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minWidth: 40,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  controlKeyText: {
    color: '#f4f4f5',
    fontFamily: Fonts.mono,
    fontSize: 11,
    fontWeight: '700',
  },
});
