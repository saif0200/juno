import { Asset } from 'expo-asset';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';

export type ProjectDefinition = {
  id: string;
  name: string;
  path: string;
};

export type SessionSummary = {
  sessionId: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  hasActiveProcess: boolean;
  clientTabId?: string;
  persistence?: TerminalPersistenceMode;
  backend?: TerminalBackend;
  sharedSessionName?: string;
};

export type TerminalPersistenceMode = 'ephemeral' | 'persisted';
export type TerminalBackend = 'pty' | 'tmux';

export type CreateSessionRequest = {
  type: 'create_session';
  projectId: string;
  clientTabId?: string;
  persistence?: TerminalPersistenceMode;
};

export type WorkspaceFileEntry = {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  size?: number;
  updatedAt?: string;
};

export type ListFilesRequest = {
  type: 'list_files';
  requestId: string;
  path?: string;
};

export type ReadFileRequest = {
  type: 'read_file';
  requestId: string;
  path: string;
};

export type WriteFileRequest = {
  type: 'write_file';
  requestId: string;
  path: string;
  content: string;
};

export type ServerMessage =
  | {
      type: 'projects_list';
      projects: ProjectDefinition[];
    }
  | {
      type: 'sessions_list';
      sessions: SessionSummary[];
    }
  | {
      type: 'session_created' | 'session_resumed';
      sessionId: string;
      projectId: string;
      projectName: string;
      projectPath: string;
      expiresAt: string;
      cols: number;
      rows: number;
      command?: string;
      hasActiveProcess?: boolean;
      clientTabId?: string;
      persistence?: TerminalPersistenceMode;
      backend?: TerminalBackend;
      sharedSessionName?: string;
    }
  | {
      type: 'session_promoted';
      sessionId: string;
      persistence: 'persisted';
      clientTabId?: string;
    }
  | {
      type: 'files_list';
      requestId: string;
      path: string;
      entries: WorkspaceFileEntry[];
    }
  | {
      type: 'file_content';
      requestId: string;
      path: string;
      content: string;
      updatedAt: string;
    }
  | {
      type: 'file_saved';
      requestId: string;
      path: string;
      updatedAt: string;
      bytes: number;
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
      requestId?: string;
    };

export type TerminalBridgeMessage =
  | { type: 'terminal_ready' }
  | { type: 'terminal_runtime_error'; message: string }
  | { type: 'terminal_input'; data: string }
  | { type: 'terminal_resize'; cols: number; rows: number };

const XTERM_JS = require('../assets/terminal/xterm.bundle.txt');
const XTERM_CSS = require('../assets/terminal/xterm.css.txt');
const XTERM_FIT_JS = require('../assets/terminal/xterm-addon-fit.bundle.txt');

export function getDefaultWebSocketUrl(): string {
  const relayPort = (process.env.EXPO_PUBLIC_RELAY_PORT ?? '3001').trim() || '3001';
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.hostUri ?? null;
  const debuggerHost = hostUri?.split(':')[0] ?? null;
  if (!debuggerHost || debuggerHost === 'localhost' || debuggerHost === '127.0.0.1') {
    return `ws://localhost:${relayPort}`;
  }

  return `ws://${debuggerHost}:${relayPort}`;
}

function buildTerminalHtml(xtermCss: string, xtermJs: string, fitAddonJs: string): string {
  return String.raw`
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
    />
    <style>${xtermCss}</style>
    <style>
      :root {
        color-scheme: dark;
      }
      html, body {
        margin: 0;
        height: 100%;
        width: 100%;
        overflow: hidden;
        background: #020617;
        -webkit-text-size-adjust: 100%;
      }
      body {
        display: flex;
        position: fixed;
        inset: 0;
        overscroll-behavior: none;
        touch-action: manipulation;
      }
      #terminal {
        flex: 1 1 auto;
        height: 100%;
        width: 100%;
        box-sizing: border-box;
        background: #020617;
        overflow: hidden;
      }
      .xterm {
        height: 100%;
        padding: 0;
      }
      .xterm-screen,
      .xterm-helpers {
        contain: strict;
      }
      .xterm-viewport {
        overflow-y: auto !important;
        overscroll-behavior: contain;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      .xterm-viewport::-webkit-scrollbar {
        display: none;
      }
    </style>
  </head>
  <body>
    <div id="terminal"></div>
    <script>${xtermJs}</script>
    <script>${fitAddonJs}</script>
    <script>
      function postMessage(message) {
        window.ReactNativeWebView.postMessage(JSON.stringify(message));
      }

      window.addEventListener('error', function (event) {
        const msg = event && event.message ? event.message : 'Unknown WebView script error';
        postMessage({ type: 'terminal_runtime_error', message: msg });
      });

      try {
      const term = new Terminal({
        allowTransparency: true,
        convertEol: true,
        cursorBlink: false,
        cursorStyle: 'bar',
        fastScrollModifier: 'shift',
        fontFamily: 'Menlo, Monaco, Consolas, monospace',
        fontSize: 14,
        lineHeight: 1.08,
        scrollSensitivity: 0.85,
        scrollback: 1500,
        smoothScrollDuration: 0,
        theme: {
          background: '#020617',
          foreground: '#e5eefb',
          cursor: '#f8fafc',
          selectionBackground: 'rgba(148, 163, 184, 0.3)',
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

      if (term.textarea) {
        term.textarea.setAttribute('autocapitalize', 'off');
        term.textarea.setAttribute('autocomplete', 'off');
        term.textarea.setAttribute('autocorrect', 'off');
        term.textarea.setAttribute('spellcheck', 'false');
      }

      function resizeTerminal() {
        fitAddon.fit();
        postMessage({
          type: 'terminal_resize',
          cols: term.cols,
          rows: term.rows,
        });
      }

      function focusTerminal() {
        term.focus();
        if (term.textarea) {
          term.textarea.focus();
        }
      }

      let resizeFrame = null;
      function scheduleResize() {
        if (resizeFrame !== null) {
          cancelAnimationFrame(resizeFrame);
        }
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = null;
          resizeTerminal();
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

      window.__focusTerminal = function () {
        focusTerminal();
      };

      window.__blurTerminal = function () {
        if (term.textarea) {
          term.textarea.blur();
        }
      };

      window.__setTerminalBanner = function (title, subtitle) {
        term.reset();
        term.writeln('\x1b[1;36m' + title + '\x1b[0m');
        if (subtitle) {
          term.writeln('\x1b[90m' + subtitle + '\x1b[0m');
        }
        term.writeln('');
      };

      window.addEventListener('resize', scheduleResize);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', scheduleResize);
      }
      ['touchstart', 'touchend', 'click'].forEach((eventName) => {
        document.addEventListener(eventName, focusTerminal, { passive: true });
      });

      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(scheduleResize);
        ro.observe(document.getElementById('terminal'));
      }

      // Fit in multiple passes: first pass as soon as possible, then a
      // second pass after layout has settled (300 ms is usually safe inside
      // a React-Native WebView).
      requestAnimationFrame(() => {
        resizeTerminal();
        focusTerminal();
        postMessage({ type: 'terminal_ready' });
      });
      setTimeout(resizeTerminal, 300);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        document.body.innerHTML = '<pre style="color:#fda4af;background:#020617;height:100%;margin:0;padding:16px;font:12px Menlo,monospace;white-space:pre-wrap;">Terminal runtime failed to initialize.\n' + message + '</pre>';
        postMessage({ type: 'terminal_runtime_error', message: message });
      }
    </script>
  </body>
</html>
`;
}

export async function loadTerminalHtml(): Promise<string> {
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

  return buildTerminalHtml(cssSource, jsSource, fitSource);
}
