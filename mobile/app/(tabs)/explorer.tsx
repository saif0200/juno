import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  type GestureResponderEvent,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  FadeInLeft,
  FadeInRight,
  FadeOutLeft,
  FadeOutRight,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { FileTreeRow } from '@/components/explorer/file-tree-row';
import { Fonts } from '@/constants/theme';
import { useFileTree } from '@/hooks/use-file-tree';
import { detectEditorLanguage, loadEditorHtml, type EditorBridgeMessage } from '@/lib/editor';
import { terminalTabsManager, type TabsSnapshot } from '@/lib/terminal-tabs';

const C = {
  bg: '#181818',
  surface: '#1d1d1d',
  surfaceActive: '#2a282a',
  border: '#383838',
  text: '#d1d1d1',
  muted: '#7a797a',
  accent: '#228df2',
  warning: '#ea7620',
};

export default function ExplorerTabScreen() {
  const editorWebViewRef = useRef<WebView>(null);
  const blockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [snapshot, setSnapshot] = useState<TabsSnapshot>(terminalTabsManager.getSnapshot());
  const [editorHtml, setEditorHtml] = useState<string | null>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [activeFileContent, setActiveFileContent] = useState('');
  const [isFileDirty, setIsFileDirty] = useState(false);
  const [isSavingFile, setIsSavingFile] = useState(false);
  const [isWebViewBlocked, setIsWebViewBlocked] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const activeTab = useMemo(
    () => snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId) ?? null,
    [snapshot.activeTabId, snapshot.tabs],
  );
  const tree = useFileTree(activeTab?.id);
  const paneMode = activeFilePath ? 'editor' : 'explorer';

  const escapeForBridge = useCallback(
    (value: string): string =>
      JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'),
    [],
  );
  const runInEditor = useCallback((script: string): void => {
    editorWebViewRef.current?.injectJavaScript(`${script}\ntrue;`);
  }, []);

  const dismissSoftKeyboard = useCallback((): void => {
    Keyboard.dismiss();
    runInEditor('window.__blurEditor && window.__blurEditor();');
    setIsWebViewBlocked(true);
    if (blockTimeoutRef.current) clearTimeout(blockTimeoutRef.current);
    blockTimeoutRef.current = setTimeout(() => setIsWebViewBlocked(false), 250);
  }, [runInEditor]);

  const preventKeyboardDismiss = useCallback((event: GestureResponderEvent): void => {
    event.stopPropagation();
  }, []);

  useEffect(() => {
    const unsub = terminalTabsManager.subscribe((event) => {
      if (event.type === 'tabs_changed') setSnapshot(event.snapshot);
    });
    return unsub;
  }, []);

  useEffect(
    () => () => {
      if (blockTimeoutRef.current) clearTimeout(blockTimeoutRef.current);
    },
    [],
  );

  useEffect(() => {
    let isMounted = true;
    async function load(): Promise<void> {
      try {
        const html = await loadEditorHtml();
        if (isMounted) setEditorHtml(html);
      } catch (error) {
        if (isMounted) {
          tree.setStatusMessage(
            `Editor runtime error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    void load();
    return () => {
      isMounted = false;
    };
  }, [tree]);

  const openFile = useCallback(
    async (path: string): Promise<void> => {
      const result = await terminalTabsManager.readFileForActive(path);
      if (result.error || result.content === null) {
        tree.setStatusMessage(result.error ?? 'Unable to read file.');
        return;
      }
      setActiveFilePath(result.path);
      setActiveFileContent(result.content);
      setIsFileDirty(false);
      tree.setStatusMessage(null);
    },
    [tree],
  );

  useEffect(() => {
    if (!isEditorReady || !activeFilePath) return;
    const language = detectEditorLanguage(activeFilePath);
    runInEditor(
      `window.__setEditorContent(${escapeForBridge(activeFileContent)}, ${escapeForBridge(language)});`,
    );
  }, [activeFileContent, activeFilePath, escapeForBridge, isEditorReady, runInEditor]);

  const saveCurrentFileContent = useCallback(
    async (content: string): Promise<void> => {
      if (!activeFilePath) {
        setIsSavingFile(false);
        return;
      }
      const result = await terminalTabsManager.writeFileForActive(activeFilePath, content);
      setIsSavingFile(false);
      if (result.error) {
        tree.setStatusMessage(result.error);
        return;
      }
      setActiveFileContent(content);
      setIsFileDirty(false);
      tree.setStatusMessage('Saved');
    },
    [activeFilePath, tree],
  );

  function handleEditorBridgeMessage(event: WebViewMessageEvent): void {
    const message = JSON.parse(event.nativeEvent.data) as EditorBridgeMessage;
    if (message.type === 'editor_ready') {
      setIsEditorReady(true);
      if (activeFilePath) {
        const language = detectEditorLanguage(activeFilePath);
        runInEditor(
          `window.__setEditorContent(${escapeForBridge(activeFileContent)}, ${escapeForBridge(language)});`,
        );
      }
      return;
    }
    if (message.type === 'editor_runtime_error') {
      tree.setStatusMessage(`Editor error: ${message.message}`);
      return;
    }
    if (message.type === 'editor_content_changed') {
      setIsFileDirty(true);
      return;
    }
    setIsSavingFile(true);
    void saveCurrentFileContent(message.content);
  }

  function saveActiveFile(): void {
    if (!activeFilePath || !isEditorReady) return;
    setIsSavingFile(true);
    runInEditor('window.__prepareSave && window.__prepareSave();');
  }

  function createNewFolder(): void {
    const name = newFolderName.trim();
    if (!name) {
      tree.setStatusMessage('Folder name cannot be empty');
      return;
    }
    const parent = tree.rootPaths[0] ?? '.';
    terminalTabsManager.sendInputToActive(`mkdir -p "${parent}/${name}"\n`);
    setNewFolderName('');
    setIsCreatingFolder(false);
    setTimeout(() => void tree.reload(), 800);
  }

  function exitEditor(): void {
    setActiveFilePath(null);
    setActiveFileContent('');
    setIsFileDirty(false);
  }

  return (
    <View onTouchStart={dismissSoftKeyboard} style={styles.screen}>
      <StatusBar style="light" />
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
        <Animated.View
          key={paneMode}
          entering={paneMode === 'editor' ? FadeInRight.duration(160) : FadeInLeft.duration(160)}
          exiting={paneMode === 'editor' ? FadeOutLeft.duration(120) : FadeOutRight.duration(120)}
          style={styles.pane}
        >
          <View style={styles.header}>
            {paneMode === 'editor' && activeFilePath ? (
              <Pressable onPress={exitEditor} style={styles.headerBtn}>
                <MaterialIcons color={C.muted} name="chevron-left" size={20} />
              </Pressable>
            ) : (
              <Text style={styles.headerLabel}>EXPLORER</Text>
            )}

            {paneMode === 'editor' && activeFilePath ? (
              <Text style={styles.headerFile} numberOfLines={1}>
                {activeFilePath.split('/').pop()}
                {isFileDirty ? <Text style={{ color: C.warning }}> ●</Text> : null}
              </Text>
            ) : null}

            <View style={styles.headerActions}>
              {paneMode === 'editor' ? (
                <Pressable
                  onPress={saveActiveFile}
                  disabled={!activeFilePath || isSavingFile}
                  style={[
                    styles.headerBtn,
                    (!activeFilePath || isSavingFile) && styles.headerBtnDisabled,
                  ]}
                >
                  <MaterialIcons
                    color={isFileDirty ? C.warning : C.muted}
                    name="save"
                    size={18}
                  />
                </Pressable>
              ) : (
                <>
                  <Pressable
                    onPress={() => setIsCreatingFolder(!isCreatingFolder)}
                    style={styles.headerBtn}
                  >
                    <MaterialIcons color={C.muted} name="create-new-folder" size={18} />
                  </Pressable>
                  <Pressable onPress={() => void tree.reload()} style={styles.headerBtn}>
                    <MaterialIcons color={C.muted} name="refresh" size={18} />
                  </Pressable>
                </>
              )}
            </View>
          </View>

          {isCreatingFolder && paneMode === 'explorer' ? (
            <View style={styles.folderInputRow}>
              <TextInput
                autoFocus
                onChangeText={setNewFolderName}
                onSubmitEditing={createNewFolder}
                placeholder="folder name"
                placeholderTextColor={C.muted}
                style={styles.folderInput}
                value={newFolderName}
              />
              <Pressable onPress={createNewFolder} style={styles.headerBtn}>
                <MaterialIcons color={C.accent} name="check" size={16} />
              </Pressable>
              <Pressable
                onPress={() => {
                  setIsCreatingFolder(false);
                  setNewFolderName('');
                }}
                style={styles.headerBtn}
              >
                <MaterialIcons color={C.muted} name="close" size={16} />
              </Pressable>
            </View>
          ) : null}

          {paneMode === 'explorer' ? (
            tree.isLoading ? (
              <View style={styles.centered}>
                <ActivityIndicator color={C.muted} size="small" />
              </View>
            ) : tree.visibleNodes.length === 0 ? (
              <View style={styles.centered}>
                <Text style={styles.emptyText}>
                  {activeTab ? 'No files found.' : 'No active session.'}
                </Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={styles.fileList}>
                {tree.visibleNodes.map((node) => (
                  <FileTreeRow
                    key={node.entry.path}
                    node={node}
                    isActive={node.entry.path === activeFilePath}
                    onPress={() => {
                      if (node.entry.kind === 'directory') void tree.toggleDirectory(node.entry.path);
                      else void openFile(node.entry.path);
                    }}
                  />
                ))}
              </ScrollView>
            )
          ) : null}

          {paneMode === 'editor' ? (
            <View
              onTouchStart={preventKeyboardDismiss}
              pointerEvents={isWebViewBlocked ? 'none' : 'auto'}
              style={styles.editorWrap}
            >
              {editorHtml ? (
                <WebView
                  ref={editorWebViewRef}
                  allowFileAccess
                  bounces={false}
                  hideKeyboardAccessoryView
                  javaScriptEnabled
                  keyboardDisplayRequiresUserAction
                  onError={(e) =>
                    tree.setStatusMessage(`Editor failed: ${e.nativeEvent.description}`)
                  }
                  onMessage={handleEditorBridgeMessage}
                  originWhitelist={['*']}
                  source={{ html: editorHtml, baseUrl: 'file:///' }}
                  style={styles.editorWebview}
                />
              ) : (
                <View style={styles.centered}>
                  <ActivityIndicator color={C.muted} size="small" />
                </View>
              )}
            </View>
          ) : null}
        </Animated.View>
      </SafeAreaView>

      {tree.statusMessage ? (
        <SafeAreaView edges={['bottom']} pointerEvents="none" style={styles.statusBar}>
          <Text style={styles.statusText} numberOfLines={1}>
            {tree.statusMessage}
          </Text>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: C.bg, flex: 1 },
  safeArea: { flex: 1 },
  pane: { backgroundColor: C.bg, flex: 1, minHeight: 0 },
  header: {
    alignItems: 'center',
    backgroundColor: C.surface,
    borderBottomColor: C.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  headerLabel: {
    color: C.muted,
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.8,
  },
  headerFile: { color: C.text, flex: 1, fontFamily: Fonts.mono, fontSize: 11 },
  headerActions: { alignItems: 'center', flexDirection: 'row', gap: 2 },
  headerBtn: {
    alignItems: 'center',
    borderRadius: 6,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  headerBtnDisabled: { opacity: 0.3 },
  folderInputRow: {
    alignItems: 'center',
    backgroundColor: C.surface,
    borderBottomColor: C.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  folderInput: {
    backgroundColor: C.surfaceActive,
    borderColor: C.border,
    borderRadius: 4,
    borderWidth: 1,
    color: C.text,
    flex: 1,
    fontFamily: Fonts.mono,
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  fileList: { paddingVertical: 2 },
  editorWrap: { flex: 1, minHeight: 0 },
  editorWebview: { backgroundColor: C.bg, flex: 1 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  emptyText: { color: C.muted, fontFamily: Fonts.sans, fontSize: 12, textAlign: 'center' },
  statusBar: {
    bottom: 0,
    left: 0,
    paddingHorizontal: 16,
    paddingVertical: 6,
    position: 'absolute',
    right: 0,
  },
  statusText: { color: C.muted, fontFamily: Fonts.sans, fontSize: 11 },
});
