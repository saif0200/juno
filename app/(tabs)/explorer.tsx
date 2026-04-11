import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, type GestureResponderEvent, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInLeft, FadeInRight, FadeOutLeft, FadeOutRight } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { detectEditorLanguage, loadEditorHtml, type EditorBridgeMessage } from '@/lib/editor';
import { type WorkspaceFileEntry } from '@/lib/terminal';
import { terminalTabsManager, type TabsSnapshot } from '@/lib/terminal-tabs';

type ExplorerNode = {
  entry: WorkspaceFileEntry;
  depth: number;
  expanded: boolean;
  loading: boolean;
  loaded: boolean;
  children: string[];
};

function getLeftIcon(kind: 'directory' | 'file', name?: string): { name: keyof typeof MaterialIcons.glyphMap; color: string } {
  if (kind === 'directory') {
    return { name: 'folder', color: '#e8b84b' };
  }

  const ext = name?.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'js':   return { name: 'javascript',        color: '#f0c040' };
    case 'jsx':  return { name: 'javascript',        color: '#61dafb' };
    case 'ts':   return { name: 'code',              color: '#3b82f6' };
    case 'tsx':  return { name: 'code',              color: '#61dafb' };
    case 'html': return { name: 'html',              color: '#e44d26' };
    case 'css':  return { name: 'css',               color: '#264de4' };
    case 'scss': return { name: 'style',             color: '#cc6699' };
    case 'json': return { name: 'data-object',       color: '#fbc02d' };
    case 'md':   return { name: 'article',           color: '#88a8b4' };
    case 'txt':  return { name: 'article',           color: '#97a1b1' };
    case 'png': case 'jpg': case 'jpeg': case 'gif':
                 return { name: 'image',             color: '#a78bfa' };
    case 'svg':  return { name: 'image',             color: '#ffb300' };
    case 'env':  return { name: 'lock',              color: '#fdd835' };
    default:     return { name: 'insert-drive-file', color: '#6b7280' };
  }
}

function getRightChevron(kind: 'directory' | 'file', expanded?: boolean): { name: keyof typeof MaterialIcons.glyphMap; color: string } | null {
  if (kind === 'directory') {
    return {
      name: expanded ? 'expand-more' : 'chevron-right',
      color: '#6b7280'
    };
  }
  return null;
}

export default function ExplorerTabScreen() {
  const router = useRouter();
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
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const activeTab = useMemo(
    () => snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId) ?? null,
    [snapshot.activeTabId, snapshot.tabs],
  );
  const showFullEditor = Boolean(activeFilePath);
  const paneMode = showFullEditor ? 'editor' : 'explorer';

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
    const unsubscribe = terminalTabsManager.subscribe((event) => {
      if (event.type === 'tabs_changed') {
        setSnapshot(event.snapshot);
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    return () => {
      if (blockTimeoutRef.current) clearTimeout(blockTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadRuntime(): Promise<void> {
      try {
        const html = await loadEditorHtml();
        if (!isMounted) {
          return;
        }

        setEditorHtml(html);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        setStatusMessage(`Failed to load editor runtime: ${message}`);
      }
    }

    void loadRuntime();

    return () => {
      isMounted = false;
    };
  }, []);

  const loadExplorerRoot = useCallback(async (): Promise<void> => {
    if (!activeTab) {
      setExplorerRoots([]);
      setExplorerNodes({});
      setStatusMessage('No active terminal tab. Open a session from Workspace first.');
      return;
    }

    setIsExplorerLoading(true);
    const result = await terminalTabsManager.listFilesForActive('');
    setIsExplorerLoading(false);

    if (result.error) {
      setStatusMessage(result.error);
      return;
    }

    const nextNodes: Record<string, ExplorerNode> = {};
    for (const entry of result.entries) {
      nextNodes[entry.path] = {
        entry,
        depth: 0,
        expanded: false,
        loading: false,
        loaded: false,
        children: [],
      };
    }

    setExplorerNodes(nextNodes);
    setExplorerRoots(result.entries.map((entry) => entry.path));
    setStatusMessage(null);
  }, [activeTab]);

  useEffect(() => {
    void loadExplorerRoot();
  }, [activeTab?.id, loadExplorerRoot]);

  const openFile = useCallback(async (relativePath: string): Promise<void> => {
    const result = await terminalTabsManager.readFileForActive(relativePath);
    if (result.error || result.content === null) {
      setStatusMessage(result.error ?? 'Unable to read file.');
      return;
    }

    setActiveFilePath(result.path);
    setActiveFileContent(result.content);
    setIsFileDirty(false);
    setStatusMessage(null);
  }, []);

  const toggleDirectory = useCallback(
    async (relativePath: string): Promise<void> => {
      const node = explorerNodes[relativePath];
      if (!node || node.entry.kind !== 'directory') {
        return;
      }

      if (node.loaded) {
        setExplorerNodes((prev) => ({
          ...prev,
          [relativePath]: {
            ...prev[relativePath],
            expanded: !prev[relativePath].expanded,
          },
        }));
        return;
      }

      setExplorerNodes((prev) => ({
        ...prev,
        [relativePath]: {
          ...prev[relativePath],
          expanded: true,
          loading: true,
        },
      }));

      const result = await terminalTabsManager.listFilesForActive(relativePath);
      if (result.error) {
        setStatusMessage(result.error);
        setExplorerNodes((prev) => ({
          ...prev,
          [relativePath]: {
            ...prev[relativePath],
            loading: false,
          },
        }));
        return;
      }

      setExplorerNodes((prev) => {
        const next = { ...prev };
        const parentDepth = prev[relativePath]?.depth ?? 0;
        const children = result.entries.map((entry) => entry.path);

        next[relativePath] = {
          ...prev[relativePath],
          expanded: true,
          loading: false,
          loaded: true,
          children,
        };

        for (const entry of result.entries) {
          next[entry.path] = {
            entry,
            depth: parentDepth + 1,
            expanded: false,
            loading: false,
            loaded: false,
            children: [],
          };
        }

        return next;
      });
    },
    [explorerNodes],
  );

  const visibleExplorerNodes = useMemo(() => {
    const ordered: ExplorerNode[] = [];

    function walk(paths: string[]): void {
      for (const nodePath of paths) {
        const node = explorerNodes[nodePath];
        if (!node) {
          continue;
        }

        ordered.push(node);
        if (node.entry.kind === 'directory' && node.expanded && node.children.length > 0) {
          walk(node.children);
        }
      }
    }

    walk(explorerRoots);
    return ordered;
  }, [explorerNodes, explorerRoots]);

  useEffect(() => {
    if (!isEditorReady || !activeFilePath) {
      return;
    }

    const language = detectEditorLanguage(activeFilePath);
    runInEditor(`window.__setEditorContent(${escapeForBridge(activeFileContent)}, ${escapeForBridge(language)});`);
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
        setStatusMessage(result.error);
        return;
      }

      setActiveFileContent(content);
      setIsFileDirty(false);
      setStatusMessage(`Saved ${activeFilePath}`);
    },
    [activeFilePath],
  );

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

    if (message.type === 'editor_runtime_error') {
      setStatusMessage(`Editor runtime error: ${message.message}`);
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
    if (!activeFilePath || !isEditorReady) {
      return;
    }

    setIsSavingFile(true);
    runInEditor('window.__prepareSave && window.__prepareSave();');
  }

  function closeEditorView(): void {
    setActiveFilePath(null);
    setActiveFileContent('');
    setIsFileDirty(false);
  }

  function createNewFolder(): void {
    const folderName = newFolderName.trim();
    if (!folderName) {
      setStatusMessage('Folder name cannot be empty');
      return;
    }

    // Use the first root as the parent directory
    const parentPath = explorerRoots[0] ?? '.';
    const newPath = `${parentPath}/${folderName}`;

    // Send mkdir command to the active terminal session
    terminalTabsManager.sendInputToActive(`mkdir -p "${newPath}"\n`);
    setStatusMessage(`Creating folder: ${folderName}`);
    setNewFolderName('');
    setIsCreatingFolder(false);

    // Reload explorer data after a short delay to let the shell command execute
    setTimeout(() => {
      void loadExplorerRoot();
    }, 800);
  }

  function renderExplorerPane(): React.ReactNode {
    return (
      <View style={styles.explorerPane}>
        <View style={styles.paneHeader}>
          <ThemedText style={styles.paneHeaderTitle}>EXPLORER</ThemedText>
          <View style={styles.paneHeaderActions}>
            <Pressable onPress={() => setIsCreatingFolder(!isCreatingFolder)} style={styles.headerIconButton}>
              <MaterialIcons color="#dbe5f5" name="create-new-folder" size={16} />
            </Pressable>
            <Pressable style={styles.headerIconButton}>
              <MaterialIcons color="#dbe5f5" name="search" size={16} />
            </Pressable>
          </View>
        </View>
        {isCreatingFolder ? (
          <View style={styles.createFolderInput}>
            <TextInput
              style={styles.folderInputField}
              placeholder="Folder name"
              placeholderTextColor="#6b7280"
              value={newFolderName}
              onChangeText={setNewFolderName}
              onSubmitEditing={createNewFolder}
              autoFocus
            />
            <Pressable onPress={createNewFolder} style={styles.folderInputButton}>
              <MaterialIcons color="#4f9cf9" name="check" size={16} />
            </Pressable>
            <Pressable onPress={() => { setIsCreatingFolder(false); setNewFolderName(''); }} style={styles.folderInputButton}>
              <MaterialIcons color="#97a1b1" name="close" size={16} />
            </Pressable>
          </View>
        ) : null}
        {isExplorerLoading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color="#93c5fd" />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.explorerList}>
            {visibleExplorerNodes.map((node) => {
              const isActive = node.entry.path === activeFilePath;
              const indent = 10 + node.depth * 14;
              return (
                <Pressable
                  key={node.entry.path}
                  onPress={() => {
                    if (node.entry.kind === 'directory') {
                      void toggleDirectory(node.entry.path);
                      return;
                    }
                    void openFile(node.entry.path);
                  }}
                  style={[styles.explorerRow, isActive ? styles.explorerRowActive : null]}>
                  <View style={[styles.explorerRowInner, { paddingLeft: indent }]}>
                    {(() => {
                      const icon = getLeftIcon(node.entry.kind, node.entry.name);
                      return <MaterialIcons name={icon.name} size={14} color={icon.color} style={styles.explorerLeftIcon} />;
                    })()}
                    <ThemedText numberOfLines={1} style={styles.explorerLabel}>
                      {node.entry.name}
                    </ThemedText>
                    {node.loading ? <ActivityIndicator size="small" color="#94a3b8" /> : null}
                    {(() => {
                      const chevron = getRightChevron(node.entry.kind, node.expanded);
                      return chevron ? <MaterialIcons name={chevron.name} size={16} color={chevron.color} style={styles.explorerChevron} /> : null;
                    })()}
                  </View>
                </Pressable>
              );
            })}
            {visibleExplorerNodes.length === 0 ? (
              <View style={styles.emptyFilesWrap}>
                <ThemedText style={styles.emptyFilesText}>No files found for this project.</ThemedText>
              </View>
            ) : null}
          </ScrollView>
        )}
      </View>
    );
  }

  function renderEditorPane(): React.ReactNode {
    return (
      <View style={styles.editorPane}>
        {activeFilePath ? (
          <>
            <View style={styles.editorHeaderShell}>
              <View style={styles.editorHeaderMain}>
                <View style={styles.editorHeaderLeft}>
                  <Pressable onPress={closeEditorView} style={styles.headerIconButton}>
                    <MaterialIcons color="#dbe5f5" name="menu" size={18} />
                  </Pressable>
                </View>

                <View style={styles.editorHeaderRight}>
                  <Pressable
                    disabled={!activeFilePath || isSavingFile}
                    onPress={saveActiveFile}
                    style={[styles.headerIconButton, !activeFilePath || isSavingFile ? styles.headerIconButtonDisabled : null]}>
                    <MaterialIcons color={isFileDirty ? '#f8c34a' : '#dbe5f5'} name="save" size={18} />
                  </Pressable>
                  <Pressable style={styles.headerIconButton}>
                    <MaterialIcons color="#dbe5f5" name="search" size={18} />
                  </Pressable>
                  <Pressable style={styles.headerIconButton}>
                    <MaterialIcons color="#dbe5f5" name="create-new-folder" size={18} />
                  </Pressable>
                </View>
              </View>
            </View>

            <View style={styles.editorViewport}>
              {editorHtml ? (
                <View onTouchStart={preventKeyboardDismiss} pointerEvents={isWebViewBlocked ? 'none' : 'auto'} style={styles.editorWebviewWrap}>
                  <WebView
                    ref={editorWebViewRef}
                    allowFileAccess
                    bounces={false}
                    hideKeyboardAccessoryView
                    javaScriptEnabled
                    keyboardDisplayRequiresUserAction
                    onError={(event) => {
                      const message = event.nativeEvent.description || 'Unknown editor WebView error';
                      setStatusMessage(`Editor failed to load: ${message}`);
                    }}
                    onMessage={handleEditorBridgeMessage}
                    originWhitelist={['*']}
                    source={{ html: editorHtml, baseUrl: 'file:///' }}
                    style={styles.editorWebview}
                  />
                </View>
              ) : (
                <View style={styles.loaderWrap}>
                  <ActivityIndicator color="#93c5fd" />
                </View>
              )}
            </View>
          </>
        ) : (
          <View style={styles.emptyState}>
            <ThemedText style={styles.emptyTitle}>Open a file</ThemedText>
            <ThemedText style={styles.emptyText}>
              Pick a file from the tree to start editing.
            </ThemedText>
          </View>
        )}
      </View>
    );
  }

  return (
    <View onTouchStart={dismissSoftKeyboard} style={styles.screen}>
      <StatusBar style="light" />
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
        <View style={styles.layout}>
          <Animated.View
            key={paneMode}
            entering={paneMode === 'editor' ? FadeInRight.duration(180) : FadeInLeft.duration(180)}
            exiting={paneMode === 'editor' ? FadeOutLeft.duration(140) : FadeOutRight.duration(140)}
            style={styles.paneSurface}>
            {showFullEditor ? renderEditorPane() : renderExplorerPane()}
          </Animated.View>
        </View>
      </SafeAreaView>

      {statusMessage ? (
        <SafeAreaView edges={['bottom']} pointerEvents="none" style={styles.statusSafeArea}>
          <View style={styles.statusCard}>
            <ThemedText style={styles.statusText}>{statusMessage}</ThemedText>
          </View>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#0b0d10',
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  layout: {
    flex: 1,
    minHeight: 0,
  },
  paneSurface: {
    flex: 1,
    minHeight: 0,
  },
  explorerPane: {
    backgroundColor: '#0f1115',
    flex: 1,
    minHeight: 0,
  },
  paneHeader: {
    alignItems: 'center',
    borderBottomColor: '#27344b',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  paneHeaderTitle: {
    color: '#d2dae3',
    fontFamily: Fonts.sans,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase' as const,
  },
  paneHeaderActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  createFolderInput: {
    alignItems: 'center',
    backgroundColor: '#0f1115',
    borderBottomColor: '#27344b',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  folderInputField: {
    backgroundColor: '#1a2332',
    borderColor: '#27344b',
    borderRadius: 6,
    borderWidth: 1,
    color: '#e5e7eb',
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: 12,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  folderInputButton: {
    alignItems: 'center',
    height: 26,
    justifyContent: 'center',
    width: 26,
    opacity: 0.6,
  },
  explorerList: {
    paddingVertical: 8,
  },
  emptyFilesWrap: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  emptyFilesText: {
    color: '#98a2b3',
    fontFamily: Fonts.sans,
    fontSize: 12,
    textAlign: 'center',
  },
  explorerRow: {
    backgroundColor: 'transparent',
    borderRadius: 6,
    marginHorizontal: 4,
    marginVertical: 1,
  },
  explorerRowActive: {
    backgroundColor: '#1e2535',
  },
  explorerRowInner: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    minHeight: 32,
    paddingRight: 10,
  },
  explorerLeftIcon: {
    marginRight: 4,
  },
  explorerChevron: {
    marginLeft: 4,
  },
  explorerLabel: {
    color: '#e5e7eb',
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: 12,
  },
  editorPane: {
    backgroundColor: '#0f1115',
    flex: 1,
    minHeight: 0,
  },
  editorHeaderShell: {
    backgroundColor: '#111825',
    borderBottomColor: '#27344b',
    borderBottomWidth: 1,
  },
  editorHeaderMain: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  editorHeaderLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    minWidth: 0,
  },
  editorHeaderRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  headerIconButton: {
    alignItems: 'center',
    borderRadius: 6,
    height: 26,
    justifyContent: 'center',
    width: 26,
    opacity: 0.7,
  },
  headerIconButtonDisabled: {
    opacity: 0.45,
  },
  editorViewport: {
    flex: 1,
    minHeight: 0,
  },
  editorWebview: {
    backgroundColor: '#0f1115',
    flex: 1,
  },
  editorWebviewWrap: {
    flex: 1,
    minHeight: 0,
  },
  editorDock: {
    alignItems: 'center',
    backgroundColor: '#111825',
    borderTopColor: '#27344b',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingBottom: 10,
    paddingTop: 8,
  },
  editorDockItem: {
    alignItems: 'center',
    gap: 4,
    minWidth: 64,
  },
  editorDockItemActive: {
    opacity: 1,
  },
  editorDockLabel: {
    color: '#8d98aa',
    fontFamily: Fonts.sans,
    fontSize: 10,
    fontWeight: '600',
  },
  editorDockLabelActive: {
    color: '#e5eeff',
  },
  loaderWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    flex: 1,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: '#eef2f7',
    fontFamily: Fonts.sans,
    fontSize: 14,
    fontWeight: '600',
  },
  emptyText: {
    color: '#97a1b1',
    fontFamily: Fonts.sans,
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  statusSafeArea: {
    bottom: 10,
    left: 12,
    position: 'absolute',
    right: 12,
  },
  statusCard: {
    backgroundColor: 'rgba(17, 21, 28, 0.96)',
    borderColor: '#29303c',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  statusText: {
    color: '#c2c9d4',
    fontFamily: Fonts.sans,
    fontSize: 12,
  },
});
