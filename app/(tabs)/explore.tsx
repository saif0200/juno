import { Asset } from 'expo-asset';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type ServerMessage =
  | {
      type: 'session_created';
      sessionId: string;
      expiresAt: string;
      cols: number;
      rows: number;
      command: string;
    }
  | {
      type: 'session_resumed';
      sessionId: string;
      expiresAt: string;
      cols: number;
      rows: number;
      hasActiveProcess: boolean;
    }
  | {
      type: 'terminal_output' | 'terminal_snapshot';
      sessionId: string;
      data: string;
    }
  | {
      type: 'terminal_exit';
      sessionId: string;
      exitCode: number;
      signal?: number;
    }
  | {
      type: 'pong';
      sessionId: string;
      expiresAt: string;
    }
  | {
      type: 'error';
      code: string;
      message: string;
    };

type TerminalBridgeMessage =
  | { type: 'terminal_ready' }
  | { type: 'terminal_input'; data: string }
  | { type: 'terminal_resize'; cols: number; rows: number };

const DEFAULT_WS_URL = getDefaultWebSocketUrl();
// These are bundled as text assets, then read and injected into the WebView at runtime.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const XTERM_JS = require('../../assets/terminal/xterm.bundle.txt');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const XTERM_CSS = require('../../assets/terminal/xterm.css.txt');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const XTERM_FIT_JS = require('../../assets/terminal/xterm-addon-fit.bundle.txt');

function buildTerminalHtml(xtermCss: string, xtermJs: string, fitAddonJs: string): string {
  return String.raw`
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
    />
    <style>${xtermCss}</style>
    <style>
      html, body {
        margin: 0;
        height: 100%;
        width: 100%;
        overflow: hidden;
        background: #0b1220;
      }
      #terminal {
        height: 100%;
        width: 100%;
        padding: 12px 10px 8px;
        box-sizing: border-box;
        background:
          radial-gradient(circle at top, rgba(56, 189, 248, 0.16), transparent 35%),
          linear-gradient(180deg, #111827 0%, #020617 100%);
      }
      .xterm {
        height: 100%;
      }
      .xterm-viewport {
        overflow-y: auto !important;
      }
    </style>
  </head>
  <body>
    <div id="terminal"></div>
    <script>${xtermJs}</script>
    <script>${fitAddonJs}</script>
    <script>
      const term = new Terminal({
        allowTransparency: true,
        convertEol: true,
        cursorBlink: true,
        cursorStyle: 'bar',
        fontFamily: 'Menlo, Monaco, Consolas, monospace',
        fontSize: 15,
        lineHeight: 1.2,
        scrollback: 5000,
        theme: {
          background: '#020617',
          foreground: '#e5eefb',
          cursor: '#f59e0b',
          selectionBackground: 'rgba(125, 211, 252, 0.35)',
          black: '#0f172a',
          red: '#f87171',
          green: '#34d399',
          yellow: '#fbbf24',
          blue: '#60a5fa',
          magenta: '#f472b6',
          cyan: '#22d3ee',
          white: '#dbeafe',
          brightBlack: '#475569',
          brightRed: '#fb7185',
          brightGreen: '#4ade80',
          brightYellow: '#facc15',
          brightBlue: '#93c5fd',
          brightMagenta: '#f9a8d4',
          brightCyan: '#67e8f9',
          brightWhite: '#ffffff',
        },
      });
      const fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(document.getElementById('terminal'));

      function postMessage(message) {
        window.ReactNativeWebView.postMessage(JSON.stringify(message));
      }

      function resizeTerminal() {
        fitAddon.fit();
        postMessage({
          type: 'terminal_resize',
          cols: term.cols,
          rows: term.rows,
        });
      }

      term.onData((data) => {
        postMessage({
          type: 'terminal_input',
          data,
        });
      });

      window.__writeTerminal = function (data) {
        term.write(data);
      };

      window.__clearTerminal = function () {
        term.reset();
      };

      window.__setTerminalBanner = function (title, subtitle) {
        term.reset();
        term.writeln('\\x1b[1;36m' + title + '\\x1b[0m');
        if (subtitle) {
          term.writeln('\\x1b[90m' + subtitle + '\\x1b[0m');
        }
        term.writeln('');
      };

      window.addEventListener('resize', resizeTerminal);

      setTimeout(() => {
        resizeTerminal();
        term.focus();
        postMessage({ type: 'terminal_ready' });
      }, 60);
    </script>
  </body>
</html>
`;
}

export default function TerminalScreen() {
  const colorScheme = useColorScheme() ?? 'dark';
  const palette = Colors[colorScheme];
  const detectedUrl = DEFAULT_WS_URL;
  const webViewRef = useRef<WebView>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [url, setUrl] = useState(DEFAULT_WS_URL);
  const [isTerminalReady, setIsTerminalReady] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [terminalHtml, setTerminalHtml] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadTerminalAssets(): Promise<void> {
      const cssAsset = Asset.fromModule(XTERM_CSS);
      const jsAsset = Asset.fromModule(XTERM_JS);
      const fitAsset = Asset.fromModule(XTERM_FIT_JS);

      await Promise.all([cssAsset.downloadAsync(), jsAsset.downloadAsync(), fitAsset.downloadAsync()]);

      const cssUri = cssAsset.localUri ?? cssAsset.uri;
      const jsUri = jsAsset.localUri ?? jsAsset.uri;
      const fitUri = fitAsset.localUri ?? fitAsset.uri;
      const [cssSource, jsSource, fitSource] = await Promise.all([
        FileSystem.readAsStringAsync(cssUri),
        FileSystem.readAsStringAsync(jsUri),
        FileSystem.readAsStringAsync(fitUri),
      ]);

      if (!isMounted) {
        return;
      }

      setTerminalHtml(buildTerminalHtml(cssSource, jsSource, fitSource));
    }

    void loadTerminalAssets();

    return () => {
      isMounted = false;
    };
  }, []);

  function escapeForBridge(value: string): string {
    return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  function runInTerminal(script: string): void {
    webViewRef.current?.injectJavaScript(`${script}\ntrue;`);
  }

  function pushTerminalData(data: string): void {
    runInTerminal(`window.__writeTerminal(${escapeForBridge(data)});`);
  }

  function showTerminalBanner(title: string, subtitle?: string): void {
    runInTerminal(
      `window.__setTerminalBanner(${escapeForBridge(title)}, ${escapeForBridge(subtitle ?? '')});`,
    );
  }

  function connect(): void {
    socketRef.current?.close();
    setConnectionStatus('Connecting...');
    setLastError(null);
    setSessionId(null);

    if (isTerminalReady) {
      showTerminalBanner('Connecting to relay', url);
    }

    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.onopen = () => {
      setConnectionStatus('Connected');
    };

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;

      if (message.type === 'session_created' || message.type === 'session_resumed') {
        setSessionId(message.sessionId);
        setConnectionStatus(message.type === 'session_created' ? 'Live session' : 'Session resumed');
        if (isTerminalReady && message.type === 'session_created') {
          runInTerminal('window.__clearTerminal();');
        }
        return;
      }

      if (message.type === 'terminal_output' || message.type === 'terminal_snapshot') {
        pushTerminalData(message.data);
        return;
      }

      if (message.type === 'terminal_exit') {
        setConnectionStatus(`Exited (${message.exitCode})`);
        pushTerminalData(
          `\r\n\x1b[90m[process exited with code ${message.exitCode}${
            message.signal ? `, signal ${message.signal}` : ''
          }]\x1b[0m\r\n`,
        );
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
      setConnectionStatus('Disconnected');
    };
  }

  function disconnect(): void {
    socketRef.current?.close();
    socketRef.current = null;
    setConnectionStatus('Disconnected');
  }

  function handleTerminalBridgeMessage(event: WebViewMessageEvent): void {
    const message = JSON.parse(event.nativeEvent.data) as TerminalBridgeMessage;

    if (message.type === 'terminal_ready') {
      setIsTerminalReady(true);
      showTerminalBanner('Claude Terminal', 'Tap Connect to attach to your relay.');
      return;
    }

    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
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

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: 'padding', default: undefined })}
        style={styles.keyboardAvoider}>
        <View
          style={[
            styles.controlBar,
            {
              backgroundColor: colorScheme === 'dark' ? '#0f172a' : '#eaf4ff',
              borderColor: colorScheme === 'dark' ? '#1e293b' : '#bfdbfe',
            },
          ]}>
          <View style={styles.headerRow}>
            <View style={styles.headerCopy}>
              <ThemedText type="subtitle" style={styles.title}>
                Claude Terminal
              </ThemedText>
              <ThemedText
                style={[
                  styles.status,
                  {
                    color: colorScheme === 'dark' ? '#7dd3fc' : '#075985',
                  },
                ]}>
                {connectionStatus}
                {sessionId ? ` • ${sessionId}` : ''}
              </ThemedText>
            </View>
            <Pressable
              onPress={socketRef.current ? disconnect : connect}
              style={[
                styles.actionButton,
                {
                  backgroundColor: socketRef.current ? '#7f1d1d' : '#0f766e',
                },
              ]}>
              <ThemedText style={styles.actionButtonText}>
                {socketRef.current ? 'Disconnect' : 'Connect'}
              </ThemedText>
            </Pressable>
          </View>

          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={setUrl}
            placeholder="ws://192.168.1.10:3000"
            placeholderTextColor={colorScheme === 'dark' ? '#64748b' : '#94a3b8'}
            style={[
              styles.urlInput,
              {
                backgroundColor: colorScheme === 'dark' ? '#020617' : '#ffffff',
                borderColor: colorScheme === 'dark' ? '#334155' : '#cbd5e1',
                color: palette.text,
              },
            ]}
            value={url}
          />

          {detectedUrl !== 'ws://localhost:3000' ? (
            <Pressable
              onPress={() => setUrl(detectedUrl)}
              style={[
                styles.detectedButton,
                {
                  backgroundColor: colorScheme === 'dark' ? '#082f49' : '#dbeafe',
                  borderColor: colorScheme === 'dark' ? '#155e75' : '#93c5fd',
                },
              ]}>
              <ThemedText
                style={[
                  styles.detectedButtonText,
                  {
                    color: colorScheme === 'dark' ? '#bae6fd' : '#1d4ed8',
                  },
                ]}>
                Use detected host: {detectedUrl}
              </ThemedText>
            </Pressable>
          ) : null}

          <ThemedText
            style={[
              styles.helperText,
              {
                color: colorScheme === 'dark' ? '#94a3b8' : '#475569',
              },
            ]}>
            On a physical phone, use your Mac&apos;s LAN IP. If the detected host looks wrong, replace
            it manually with something like `ws://192.168.1.25:3000`.
          </ThemedText>

          {lastError ? (
            <ThemedText style={styles.errorText}>{lastError}</ThemedText>
          ) : null}
        </View>

        <View style={styles.terminalShell}>
          {terminalHtml ? (
            <WebView
              ref={webViewRef}
              allowFileAccess
              allowsInlineMediaPlayback
              bounces={false}
              javaScriptEnabled
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
    </SafeAreaView>
  );
}

function getDefaultWebSocketUrl(): string {
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.hostUri ?? null;
  const debuggerHost = hostUri?.split(':')[0] ?? null;
  if (!debuggerHost || debuggerHost === 'localhost' || debuggerHost === '127.0.0.1') {
    return 'ws://localhost:3000';
  }

  return `ws://${debuggerHost}:3000`;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  keyboardAvoider: {
    flex: 1,
  },
  controlBar: {
    borderBottomWidth: 1,
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 10,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: 24,
  },
  status: {
    fontFamily: Fonts.mono,
    fontSize: 12,
  },
  actionButton: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  actionButtonText: {
    color: '#f8fafc',
    fontFamily: Fonts.mono,
    fontSize: 13,
    fontWeight: '700',
  },
  urlInput: {
    borderRadius: 14,
    borderWidth: 1,
    fontFamily: Fonts.mono,
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  detectedButton: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  detectedButtonText: {
    fontFamily: Fonts.mono,
    fontSize: 12,
  },
  helperText: {
    fontSize: 12,
    lineHeight: 18,
  },
  errorText: {
    color: '#ef4444',
    fontFamily: Fonts.mono,
    fontSize: 12,
  },
  terminalShell: {
    flex: 1,
    backgroundColor: '#020617',
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
  webview: {
    backgroundColor: '#020617',
    flex: 1,
  },
});
