export type EditorBridgeMessage =
  | { type: 'editor_ready' }
  | { type: 'editor_runtime_error'; message: string }
  | { type: 'editor_content_changed'; content: string }
  | { type: 'editor_save_payload'; content: string };

export function detectEditorLanguage(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.less')) return 'css';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.sh') || lower.endsWith('.bash') || lower.endsWith('.zsh')) return 'shell';
  if (lower.endsWith('.xml')) return 'xml';
  return 'plaintext';
}

export async function loadEditorHtml(): Promise<string> {
  return String.raw`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <style>
      html, body, #editor {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #09090b;
      }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.min.js"></script>
  </head>
  <body>
    <div id="editor"></div>
    <script>
      (function () {
        function postMessage(message) {
          window.ReactNativeWebView.postMessage(JSON.stringify(message));
        }

        window.addEventListener('error', function (event) {
          const msg = event && event.message ? event.message : 'Unknown editor runtime error';
          postMessage({ type: 'editor_runtime_error', message: msg });
        });

        try {
          const monacoBase = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs';
          window.require.config({ paths: { vs: monacoBase } });
          window.require(['vs/editor/editor.main'], function () {
            monaco.editor.defineTheme('juno-dark', {
              base: 'vs-dark',
              inherit: true,
              rules: [],
              colors: {
                'editor.background': '#09090b',
                'editorLineNumber.foreground': '#52525b',
                'editorLineNumber.activeForeground': '#a1a1aa',
              },
            });

            const model = monaco.editor.createModel('', 'plaintext');
            const editor = monaco.editor.create(document.getElementById('editor'), {
              automaticLayout: true,
              fontFamily: "Menlo, Monaco, Consolas, 'Courier New', monospace",
              fontSize: 13,
              lineHeight: 19,
              minimap: { enabled: false },
              model,
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              tabSize: 2,
              theme: 'juno-dark',
              wordWrap: 'on',
            });

            let changeTimer = null;
            editor.onDidChangeModelContent(() => {
              if (changeTimer) {
                clearTimeout(changeTimer);
              }
              changeTimer = setTimeout(() => {
                postMessage({ type: 'editor_content_changed', content: model.getValue() });
              }, 120);
            });

            window.__setEditorContent = function (content, language) {
              monaco.editor.setModelLanguage(model, language || 'plaintext');
              model.setValue(typeof content === 'string' ? content : '');
              editor.setScrollTop(0);
              editor.setScrollLeft(0);
              editor.focus();
            };

            window.__prepareSave = async function () {
              try {
                const action = editor.getAction('editor.action.formatDocument');
                if (action) {
                  await action.run();
                }
              } catch (_) {
                // Format is best effort.
              }

              postMessage({
                type: 'editor_save_payload',
                content: model.getValue(),
              });
            };

            window.__focusEditor = function () {
              editor.focus();
            };

            window.__blurEditor = function () {
              try {
                const node = editor.getDomNode();
                const input = node ? node.querySelector('textarea.inputarea') : null;
                if (input) {
                  input.blur();
                }
              } catch (_) {
                // Blur is best effort.
              }
            };

            postMessage({ type: 'editor_ready' });
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          postMessage({ type: 'editor_runtime_error', message: message });
        }
      })();
    </script>
  </body>
</html>`;
}
