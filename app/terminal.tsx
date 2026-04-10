import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
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

  useFocusEffect(
    useCallback(() => {
      webViewRef.current?.injectJavaScript('window.__focusTerminal?.(); true;');
    }, []),
  );

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

  const pushTerminalData = useCallback((data: string): void => {
    runInTerminal(`window.__writeTerminal(${escapeForBridge(data)});`);
  }, [runInTerminal]);

  const showTerminalBanner = useCallback((title: string, subtitle?: string): void => {
    runInTerminal(
      `window.__setTerminalBanner(${escapeForBridge(title)}, ${escapeForBridge(subtitle ?? '')});`,
    );
  }, [runInTerminal]);

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

        runInTerminal('window.__clearTerminal();');
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
          if (isTerminalReady) {
            runInTerminal('window.__focusTerminal?.();');
          }
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
      isTerminalReady,
      pushTerminalData,
      routeProjectId,
      routeProjectName,
      routeSessionId,
      runInTerminal,
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

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <SafeAreaView edges={['top']} style={styles.topSafeArea}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.topBarButton}>
            <ThemedText style={styles.topBarButtonText}>Back</ThemedText>
          </Pressable>
          {activeProjectName || routeProjectName ? (
            <View style={styles.projectBadge}>
              <ThemedText style={styles.projectBadgeText}>
                {activeProjectName ?? routeProjectName}
              </ThemedText>
            </View>
          ) : null}
          <View style={styles.topBarActions}>
            <Pressable onPress={dismissKeyboard} style={styles.topBarButton}>
              <ThemedText style={styles.topBarButtonText}>Hide keyboard</ThemedText>
            </Pressable>
            <Pressable onPress={() => runInTerminal('window.__focusTerminal?.();')} style={styles.topBarButton}>
              <ThemedText style={styles.topBarButtonText}>Focus</ThemedText>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <View style={styles.webviewShell}>
        {terminalHtml ? (
          <WebView
            ref={webViewRef}
            allowFileAccess
            allowsInlineMediaPlayback
            bounces={false}
            contentInsetAdjustmentBehavior="never"
            hideKeyboardAccessoryView
            javaScriptEnabled
            keyboardDisplayRequiresUserAction={false}
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
  webviewShell: {
    flex: 1,
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
    backgroundColor: '#020617',
    borderBottomColor: 'rgba(148, 163, 184, 0.1)',
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
  topBarActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  topBarButton: {
    borderColor: 'rgba(148, 163, 184, 0.22)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  topBarButtonText: {
    color: '#e2e8f0',
    fontFamily: Fonts.mono,
    fontSize: 11,
    fontWeight: '700',
  },
  projectBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.38)',
    borderColor: 'rgba(148, 163, 184, 0.14)',
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 170,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  projectBadgeText: {
    color: '#f8fafc',
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
    borderRadius: 22,
    borderWidth: 1,
    gap: 10,
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 16,
  },
  overlayTitle: {
    color: '#f8fafc',
    fontFamily: Fonts.rounded,
    fontSize: 18,
  },
  overlaySubtitle: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 18,
  },
  overlayActions: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryAction: {
    backgroundColor: '#e2e8f0',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryActionText: {
    color: '#020617',
    fontFamily: Fonts.mono,
    fontSize: 12,
    fontWeight: '700',
  },
  secondaryAction: {
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    borderColor: 'rgba(148, 163, 184, 0.18)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryActionText: {
    color: '#e2e8f0',
    fontFamily: Fonts.mono,
    fontSize: 12,
    fontWeight: '700',
  },
});
