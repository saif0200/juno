import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, type GestureResponderEvent } from 'react-native';
import type { WebView } from 'react-native-webview';

import { terminalTabsManager, type TabsSnapshot } from '@/lib/terminal-tabs';

const FLUSH_INTERVAL_MS = 16;
const KEYBOARD_BLOCK_MS = 250;

function escapeForBridge(value: string): string {
  return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export interface UseTerminalBridge {
  webViewRef: React.MutableRefObject<WebView | null>;
  snapshot: TabsSnapshot;
  isTerminalReady: boolean;
  setIsTerminalReady: (ready: boolean) => void;
  isWebViewBlocked: boolean;
  lastError: string | null;
  setLastError: (error: string | null) => void;
  dismissSoftKeyboard: () => void;
  preventKeyboardDismiss: (event: GestureResponderEvent) => void;
  runInTerminal: (script: string) => void;
  setBanner: (title: string, subtitle: string) => void;
}

export function useTerminalBridge(): UseTerminalBridge {
  const webViewRef = useRef<WebView | null>(null);
  const outputFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingOutputRef = useRef('');

  const [snapshot, setSnapshot] = useState<TabsSnapshot>(terminalTabsManager.getSnapshot());
  const [isTerminalReady, setIsTerminalReady] = useState(false);
  const [isWebViewBlocked, setIsWebViewBlocked] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const runInTerminal = useCallback((script: string): void => {
    webViewRef.current?.injectJavaScript(`${script}\ntrue;`);
  }, []);

  const setBanner = useCallback(
    (title: string, subtitle: string): void => {
      runInTerminal(
        `window.__setTerminalBanner(${escapeForBridge(title)}, ${escapeForBridge(subtitle)});`,
      );
    },
    [runInTerminal],
  );

  const dismissSoftKeyboard = useCallback((): void => {
    Keyboard.dismiss();
    runInTerminal('window.__blurTerminal && window.__blurTerminal();');
    setIsWebViewBlocked(true);
    if (blockTimeoutRef.current) clearTimeout(blockTimeoutRef.current);
    blockTimeoutRef.current = setTimeout(() => setIsWebViewBlocked(false), KEYBOARD_BLOCK_MS);
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
  }, [runInTerminal]);

  const pushTerminalData = useCallback(
    (data: string): void => {
      pendingOutputRef.current += data;
      if (outputFlushTimeoutRef.current) return;
      outputFlushTimeoutRef.current = setTimeout(flushTerminalOutput, FLUSH_INTERVAL_MS);
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
        setBanner('No active tab', 'Tap + to create your first terminal.');
        return;
      }
      const buffer = terminalTabsManager.getTabBuffer(tabId);
      clearTerminal();
      if (!buffer) {
        setBanner('Terminal ready', 'Waiting for process output...');
        return;
      }
      runInTerminal(`window.__writeTerminal(${escapeForBridge(buffer)});`);
    },
    [clearTerminal, runInTerminal, setBanner],
  );

  useEffect(() => {
    const unsubscribe = terminalTabsManager.subscribe((event) => {
      if (event.type === 'tabs_changed') {
        setSnapshot(event.snapshot);
        const currentActive =
          event.snapshot.tabs.find((tab) => tab.id === event.snapshot.activeTabId) ?? null;
        setLastError(currentActive?.lastError ?? null);
        return;
      }
      if (!isTerminalReady) return;
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
      if (outputFlushTimeoutRef.current) clearTimeout(outputFlushTimeoutRef.current);
    };
  }, [clearTerminal, flushTerminalOutput, isTerminalReady, pushTerminalData, runInTerminal]);

  useEffect(() => {
    if (!isTerminalReady) return;
    renderFullBuffer(snapshot.activeTabId);
  }, [isTerminalReady, renderFullBuffer, snapshot.activeTabId]);

  useEffect(
    () => () => {
      if (blockTimeoutRef.current) clearTimeout(blockTimeoutRef.current);
    },
    [],
  );

  return {
    webViewRef,
    snapshot,
    isTerminalReady,
    setIsTerminalReady,
    isWebViewBlocked,
    lastError,
    setLastError,
    dismissSoftKeyboard,
    preventKeyboardDismiss,
    runInTerminal,
    setBanner,
  };
}
