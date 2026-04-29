import { useCallback, useEffect, useMemo, useState } from 'react';

import { terminalTabsManager } from '@/lib/terminal-tabs';
import type { WorkspaceFileEntry } from '@/lib/terminal';

export type ExplorerNode = {
  entry: WorkspaceFileEntry;
  depth: number;
  expanded: boolean;
  loading: boolean;
  loaded: boolean;
  children: string[];
};

export interface UseFileTree {
  visibleNodes: ExplorerNode[];
  isLoading: boolean;
  statusMessage: string | null;
  setStatusMessage: (message: string | null) => void;
  reload: () => Promise<void>;
  toggleDirectory: (path: string) => Promise<void>;
  rootPaths: string[];
}

export function useFileTree(activeTabId: string | undefined): UseFileTree {
  const [roots, setRoots] = useState<string[]>([]);
  const [nodes, setNodes] = useState<Record<string, ExplorerNode>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    if (!activeTabId) {
      setRoots([]);
      setNodes({});
      setStatusMessage('No active session. Open a project from Workspace.');
      return;
    }

    setIsLoading(true);
    const result = await terminalTabsManager.listFilesForActive('');
    setIsLoading(false);

    if (result.error) {
      setStatusMessage(result.error);
      return;
    }

    const next: Record<string, ExplorerNode> = {};
    for (const entry of result.entries) {
      next[entry.path] = {
        entry,
        depth: 0,
        expanded: false,
        loading: false,
        loaded: false,
        children: [],
      };
    }
    setNodes(next);
    setRoots(result.entries.map((entry) => entry.path));
    setStatusMessage(null);
  }, [activeTabId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggleDirectory = useCallback(
    async (path: string): Promise<void> => {
      const node = nodes[path];
      if (!node || node.entry.kind !== 'directory') return;

      if (node.loaded) {
        setNodes((prev) => ({
          ...prev,
          [path]: { ...prev[path], expanded: !prev[path].expanded },
        }));
        return;
      }

      setNodes((prev) => ({
        ...prev,
        [path]: { ...prev[path], expanded: true, loading: true },
      }));

      const result = await terminalTabsManager.listFilesForActive(path);
      if (result.error) {
        setStatusMessage(result.error);
        setNodes((prev) => ({
          ...prev,
          [path]: { ...prev[path], loading: false },
        }));
        return;
      }

      setNodes((prev) => {
        const next = { ...prev };
        const parentDepth = prev[path]?.depth ?? 0;
        next[path] = {
          ...prev[path],
          expanded: true,
          loading: false,
          loaded: true,
          children: result.entries.map((entry) => entry.path),
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
    [nodes],
  );

  const visibleNodes = useMemo(() => {
    const ordered: ExplorerNode[] = [];
    function walk(paths: string[]): void {
      for (const p of paths) {
        const node = nodes[p];
        if (!node) continue;
        ordered.push(node);
        if (node.entry.kind === 'directory' && node.expanded && node.children.length > 0) {
          walk(node.children);
        }
      }
    }
    walk(roots);
    return ordered;
  }, [nodes, roots]);

  return {
    visibleNodes,
    isLoading,
    statusMessage,
    setStatusMessage,
    reload,
    toggleDirectory,
    rootPaths: roots,
  };
}
