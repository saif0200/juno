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
import Animated, { FadeInLeft, FadeInRight, FadeOutLeft, FadeOutRight } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { Fonts } from '@/constants/theme';
import { detectEditorLanguage, loadEditorHtml, type EditorBridgeMessage } from '@/lib/editor';
import { type WorkspaceFileEntry } from '@/lib/terminal';
import { terminalTabsManager, type TabsSnapshot } from '@/lib/terminal-tabs';

const C = {
  bg: '#181818',
  surface: '#1d1d1d',
  surfaceActive: '#2a282a',
  selectionBg: '#163761',
  border: '#383838',
  text: '#d1d1d1',
  muted: '#7a797a',
  accent: '#228df2',
  success: '#15ac91',
  danger: '#f14c4c',
  warning: '#ea7620',
};

type ExplorerNode = {
  entry: WorkspaceFileEntry;
  depth: number;
  expanded: boolean;
  loading: boolean;
  loaded: boolean;
  children: string[];
};

function getFileIcon(kind: 'directory' | 'file', name?: string): { name: keyof typeof MaterialIcons.glyphMap; color: string } {
  if (kind === 'directory') return { name: 'folder', color: '#e8b84b' };
  const ext = name?.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'js':   return { name: 'javascript',        color: '#f0c040' };
    case 'jsx':  return { name: 'javascript',        color: '#61dafb' };
    case 'ts':   return { name: 'code',              color: '#3b82f6' };
    case 'tsx':  return { name: 'code',              color: '#61dafb' };
    case 'html': return { name: 'html',              color: '#e44d26' };
    case 'css':  return { name: 'css',               color: '#264de4' };
    case 'json': return { name: 'data-object',       color: '#fbc02d' };
    case 'md':   return { name: 'article',           color: '#88a8b4' };
    case 'env':  return { name: 'lock',              color: '#fdd835' };
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg':
                 return { name: 'image',             color: '#a78bfa' };
    default:     return { name: 'insert-drive-file', color: '#52525b' };
  }
}

export default function ExplorerTabScreen() {
  const editorWebViewRef = useRef<WebView>(null);
  const blockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [snapshot, setSnapshot] = useState<TabsSnapshot>(terminalTabsManager.getSnapshot());
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [editorHtml, setEditorHtml] = useState<string | null>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [explorerRoots, setExplorerRoots] = useState<string[]>([]);
  const [explorerNodes, setExplorerNodes] = useState<Record<string, ExplorerNode>>({});
  const [isExplorerLoading, setIsExplorerLoading] = useState(false);
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
  const paneMode = activeFilePath ? 'editor' : 'explorer';

  const escapeForBridge = useCallback(
    (value: string): string => JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'),
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

  useEffect(() => {
    return () => { if (blockTimeoutRef.current) clearTimeout(blockTimeoutRef.current); };
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function load(): Promise<void> {
      try {
        const html = await loadEditorHtml();
        if (isMounted) setEditorHtml(html);
      } catch (error) {
        if (isMounted) setStatusMessage(`Editor runtime error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    void load();
    return () => { isMounted = false; };
  }, []);

  const loadExplorerRoot = useCallback(async (): Promise<void> => {
    if (!activeTab) {
      setExplorerRoots([]);
      setExplorerNodes({});
      setStatusMessage('No active session. Open a project from Workspace.');
      return;
    }
    setIsExplorerLoading(true);
    const result = await terminalTabsManager.listFilesForActive('');
    setIsExplorerLoading(false);
    if (result.error) { setStatusMessage(result.error); return; }
    const next: Record<string, ExplorerNode> = {};
    for (const entry of result.entries) {
      next[entry.path] = { entry, depth: 0, expanded: false, loading: false, loaded: false, children: [] };
    }
    setExplorerNodes(next);
    setExplorerRoots(result.entries.map((e) => e.path));
    setStatusMessage(null);
  }, [activeTab]);

  useEffect(() => { void loadExplorerRoot(); }, [activeTab?.id, loadExplorerRoot]);

  const openFile = useCallback(async (path: string): Promise<void> => {
    const result = await terminalTabsManager.readFileForActive(path);
    if (result.error || result.content === null) { setStatusMessage(result.error ?? 'Unable to read file.'); return; }
    setActiveFilePath(result.path);
    setActiveFileContent(result.content);
    setIsFileDirty(false);
    setStatusMessage(null);
  }, []);

  const toggleDirectory = useCallback(async (path: string): Promise<void> => {
    const node = explorerNodes[path];
    if (!node || node.entry.kind !== 'directory') return;
    if (node.loaded) {
      setExplorerNodes((prev) => ({ ...prev, [path]: { ...prev[path], expanded: !prev[path].expanded } }));
      return;
    }
    setExplorerNodes((prev) => ({ ...prev, [path]: { ...prev[path], expanded: true, loading: true } }));
    const result = await terminalTabsManager.listFilesForActive(path);
    if (result.error) {
      setStatusMessage(result.error);
      setExplorerNodes((prev) => ({ ...prev, [path]: { ...prev[path], loading: false } }));
      return;
    }
    setExplorerNodes((prev) => {
      const next = { ...prev };
      const parentDepth = prev[path]?.depth ?? 0;
      next[path] = { ...prev[path], expanded: true, loading: false, loaded: true, children: result.entries.map((e) => e.path) };
      for (const entry of result.entries) {
        next[entry.path] = { entry, depth: parentDepth + 1, expanded: false, loading: false, loaded: false, children: [] };
      }
      return next;
    });
  }, [explorerNodes]);

  const visibleNodes = useMemo(() => {
    const ordered: ExplorerNode[] = [];
    function walk(paths: string[]): void {
      for (const p of paths) {
        const node = explorerNodes[p];
        if (!node) continue;
        ordered.push(node);
        if (node.entry.kind === 'directory' && node.expanded && node.children.length > 0) walk(node.children);
      }
    }
    walk(explorerRoots);
    return ordered;
  }, [explorerNodes, explorerRoots]);

  useEffect(() => {
    if (!isEditorReady || !activeFilePath) return;
    const language = detectEditorLanguage(activeFilePath);
    runInEditor(`window.__setEditorContent(${escapeForBridge(activeFileContent)}, ${escapeForBridge(language)});`);
  }, [activeFileContent, activeFilePath, escapeForBridge, isEditorReady, runInEditor]);

  const saveCurrentFileContent = useCallback(async (content: string): Promise<void> => {
    if (!activeFilePath) { setIsSavingFile(false); return; }
    const result = await terminalTabsManager.writeFileForActive(activeFilePath, content);
    setIsSavingFile(false);
    if (result.error) { setStatusMessage(result.error); return; }
    setActiveFileContent(content);
    setIsFileDirty(false);
    setStatusMessage(`Saved`);
  }, [activeFilePath]);

  function handleEditorBridgeMessage(event: WebViewMessageEvent): void {
    const message = JSON.parse(event.nativeEvent.data) as EditorBridgeMessage;
    if (message.type === 'editor_ready') {
      setIsEditorReady(true);
      if (activeFilePath) {
        const language = detectEditorLanguage(activeFilePath);
        runInEditor(`window.__setEditorContent(${escapeForBridge(activeFileContent)}, ${escapeForBridge(language)});`);
      }
      return;
    }
    if (message.type === 'editor_runtime_error') { setStatusMessage(`Editor error: ${message.message}`); return; }
    if (message.type === 'editor_content_changed') { setIsFileDirty(true); return; }
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
    if (!name) { setStatusMessage('Folder name cannot be empty'); return; }
    const parent = explorerRoots[0] ?? '.';
    terminalTabsManager.sendInputToActive(`mkdir -p "${parent}/${name}"\n`);
    setNewFolderName('');
    setIsCreatingFolder(false);
    setTimeout(() => void loadExplorerRoot(), 800);
  }

  return (
    <View onTouchStart={dismissSoftKeyboard} style={styles.screen}>
      <StatusBar style="light" />
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
        <Animated.View
          key={paneMode}
          entering={paneMode === 'editor' ? FadeInRight.duration(160) : FadeInLeft.duration(160)}
          exiting={paneMode === 'editor' ? FadeOutLeft.duration(120) : FadeOutRight.duration(120)}
          style={styles.pane}>

          {/* Header */}
          <View style={styles.header}>
            {paneMode === 'editor' && activeFilePath ? (
              <Pressable onPress={() => { setActiveFilePath(null); setActiveFileContent(''); setIsFileDirty(false); }} style={styles.headerBtn}>
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
                  style={[styles.headerBtn, (!activeFilePath || isSavingFile) && styles.headerBtnDisabled]}>
                  <MaterialIcons color={isFileDirty ? C.warning : C.muted} name="save" size={18} />
                </Pressable>
              ) : (
                <>
                  <Pressable onPress={() => setIsCreatingFolder(!isCreatingFolder)} style={styles.headerBtn}>
                    <MaterialIcons color={C.muted} name="create-new-folder" size={18} />
                  </Pressable>
                  <Pressable onPress={() => void loadExplorerRoot()} style={styles.headerBtn}>
                    <MaterialIcons color={C.muted} name="refresh" size={18} />
                  </Pressable>
                </>
              )}
            </View>
          </View>

          {/* New folder input */}
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
              <Pressable onPress={() => { setIsCreatingFolder(false); setNewFolderName(''); }} style={styles.headerBtn}>
                <MaterialIcons color={C.muted} name="close" size={16} />
              </Pressable>
            </View>
          ) : null}

          {/* Explorer pane */}
          {paneMode === 'explorer' ? (
            isExplorerLoading ? (
              <View style={styles.centered}>
                <ActivityIndicator color={C.muted} size="small" />
              </View>
            ) : visibleNodes.length === 0 ? (
              <View style={styles.centered}>
                <Text style={styles.emptyText}>
                  {activeTab ? 'No files found.' : 'No active session.'}
                </Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={styles.fileList}>
                {visibleNodes.map((node) => {
                  const icon = getFileIcon(node.entry.kind, node.entry.name);
                  const isActive = node.entry.path === activeFilePath;
                  const indent = 12 + node.depth * 14;
                  return (
                    <Pressable
                      key={node.entry.path}
                      onPress={() => {
                        if (node.entry.kind === 'directory') void toggleDirectory(node.entry.path);
                        else void openFile(node.entry.path);
                      }}
                      style={[styles.fileRow, isActive && styles.fileRowActive]}>
                      <View style={[styles.fileRowInner, { paddingLeft: indent }]}>
                        {node.entry.kind === 'directory' ? (
                          <MaterialIcons
                            color={C.muted}
                            name={node.expanded ? 'expand-more' : 'chevron-right'}
                            size={14}
                            style={{ width: 14 }}
                          />
                        ) : <View style={{ width: 14 }} />}
                        <MaterialIcons color={icon.color} name={icon.name} size={14} />
                        <Text style={styles.fileName} numberOfLines={1}>{node.entry.name}</Text>
                        {node.loading ? <ActivityIndicator size="small" color={C.muted} /> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )
          ) : null}

          {/* Editor pane */}
          {paneMode === 'editor' ? (
            <View onTouchStart={preventKeyboardDismiss} pointerEvents={isWebViewBlocked ? 'none' : 'auto'} style={styles.editorWrap}>
              {editorHtml ? (
                <WebView
                  ref={editorWebViewRef}
                  allowFileAccess
                  bounces={false}
                  hideKeyboardAccessoryView
                  javaScriptEnabled
                  keyboardDisplayRequiresUserAction
                  onError={(e) => setStatusMessage(`Editor failed: ${e.nativeEvent.description}`)}
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

      {statusMessage ? (
        <SafeAreaView edges={['bottom']} pointerEvents="none" style={styles.statusBar}>
          <Text style={styles.statusText} numberOfLines={1}>{statusMessage}</Text>
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
  headerFile: {
    color: C.text,
    flex: 1,
    fontFamily: Fonts.mono,
    fontSize: 11,
  },
  headerActions: { alignItems: 'center', flexDirection: 'row', gap: 2 },
  headerBtn: { alignItems: 'center', borderRadius: 6, height: 36, justifyContent: 'center', width: 36 },
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
  fileRow: { marginHorizontal: 0, marginVertical: 0 },
  fileRowActive: { backgroundColor: C.selectionBg },
  fileRowInner: { alignItems: 'center', flexDirection: 'row', gap: 6, minHeight: 36, paddingRight: 12 },
  fileName: { color: C.text, flex: 1, fontFamily: Fonts.sans, fontSize: 13 },
  editorWrap: { flex: 1, minHeight: 0 },
  editorWebview: { backgroundColor: C.bg, flex: 1 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  emptyText: { color: C.muted, fontFamily: Fonts.sans, fontSize: 12, textAlign: 'center' },
  statusBar: { bottom: 0, left: 0, paddingHorizontal: 16, paddingVertical: 6, position: 'absolute', right: 0 },
  statusText: { color: C.muted, fontFamily: Fonts.sans, fontSize: 11 },
});
