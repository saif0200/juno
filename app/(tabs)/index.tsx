import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Fonts } from '@/constants/theme';
import {
  consumePendingDeviceId,
  deleteSavedDevice,
  loadSavedDevices,
  markSavedDeviceUsed,
  type SavedDevice,
} from '@/lib/devices';
import { buildWebSocketConnectionUrl } from '@/lib/pairing';
import { type ProjectDefinition, type ServerMessage, type SessionSummary } from '@/lib/terminal';

function timeAgo(value: string): string {
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function StatusDot({ color }: { color: string }) {
  return <View style={[styles.statusDot, { backgroundColor: color }]} />;
}

export default function WorkspaceScreen() {
  const router = useRouter();
  const socketRef = useRef<WebSocket | null>(null);
  const selectedDeviceIdRef = useRef<string | null>(null);
  const refreshSavedDevicesRef = useRef<() => Promise<void>>(async () => {});

  const [savedDevices, setSavedDevices] = useState<SavedDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectDefinition[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => { selectedDeviceIdRef.current = selectedDeviceId; }, [selectedDeviceId]);
  useEffect(() => {
    void refreshSavedDevicesRef.current();
    return () => { socketRef.current?.close(); };
  }, []);
  useFocusEffect(useCallback(() => { void refreshSavedDevicesRef.current(); }, []));

  const selectedDevice = useMemo(
    () => savedDevices.find((d) => d.id === selectedDeviceId) ?? null,
    [savedDevices, selectedDeviceId],
  );
  const sessionCards = useMemo(
    () => sessions.slice().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [sessions],
  );
  const isConnected = connectionStatus === 'connected';

  function requestBootstrapData(): void {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type: 'list_projects' }));
    socketRef.current.send(JSON.stringify({ type: 'list_sessions' }));
  }

  function applySelection(device: SavedDevice | null): void {
    setSelectedDeviceId(device?.id ?? null);
    setLastError(null);
  }

  function connect(targetDevice?: SavedDevice): void {
    const device = targetDevice ?? selectedDevice;
    if (!device) { setLastError('No device selected.'); return; }
    applySelection(device);
    setConnectionStatus('connecting');
    setLastError(null);
    setProjects([]);
    setSessions([]);
    socketRef.current?.close();

    const socket = new WebSocket(buildWebSocketConnectionUrl(device.wsUrl, device.token));
    socketRef.current = socket;

    socket.onopen = () => {
      if (socketRef.current !== socket) return;
      setConnectionStatus('connected');
      if (device.id) void markSavedDeviceUsed(device.id).then(() => refreshSavedDevicesRef.current());
      requestBootstrapData();
    };
    socket.onmessage = (event) => {
      if (socketRef.current !== socket) return;
      const message = JSON.parse(event.data as string) as ServerMessage;
      if (message.type === 'projects_list') { setProjects(message.projects); return; }
      if (message.type === 'sessions_list') { setSessions(message.sessions); return; }
      if (message.type === 'error') { setConnectionStatus('error'); setLastError(`${message.code}: ${message.message}`); }
    };
    socket.onerror = () => {
      if (socketRef.current !== socket) return;
      setConnectionStatus('error');
      setLastError('Connection failed.');
    };
    socket.onclose = () => {
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      setConnectionStatus('disconnected');
    };
  }

  function disconnect(): void {
    socketRef.current?.close();
    socketRef.current = null;
    setConnectionStatus('disconnected');
  }

  async function forgetDevice(deviceId: string): Promise<void> {
    if (selectedDeviceIdRef.current === deviceId) disconnect();
    await deleteSavedDevice(deviceId);
    await refreshSavedDevicesRef.current();
  }

  refreshSavedDevicesRef.current = async function refreshSavedDevices(): Promise<void> {
    const [devices, pendingDeviceId] = await Promise.all([loadSavedDevices(), consumePendingDeviceId()]);
    setSavedDevices(devices);
    if (pendingDeviceId) {
      const paired = devices.find((d) => d.id === pendingDeviceId);
      if (paired) { applySelection(paired); connect(paired); return; }
    }
    const cur = selectedDeviceIdRef.current;
    if (cur && devices.some((d) => d.id === cur)) return;
    applySelection(devices[0] ?? null);
  };

  function openNewSession(project: ProjectDefinition): void {
    if (!selectedDevice) { setLastError('Connect a device first.'); return; }
    router.push({
      pathname: '/terminal',
      params: {
        action: 'open_project',
        requestId: `${Date.now()}-${project.id}`,
        url: buildWebSocketConnectionUrl(selectedDevice.wsUrl, selectedDevice.token),
        projectId: project.id,
        projectName: project.name,
        persistence: 'persisted',
      },
    });
  }

  function openExistingSession(session: SessionSummary): void {
    if (!selectedDevice) { setLastError('Connect a device first.'); return; }
    router.push({
      pathname: '/terminal',
      params: {
        action: 'open_existing',
        requestId: `${Date.now()}-${session.sessionId}`,
        url: buildWebSocketConnectionUrl(selectedDevice.wsUrl, selectedDevice.token),
        sessionId: session.sessionId,
        projectId: session.projectId,
        projectName: session.projectName,
        persistence: session.persistence ?? 'persisted',
      },
    });
  }

  const dotColor =
    connectionStatus === 'connected' ? '#15ac91'
    : connectionStatus === 'connecting' ? '#ea7620'
    : connectionStatus === 'error' ? '#f14c4c'
    : '#7a797a';

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.topSafe}>
        <View style={styles.topBar}>
          <View style={styles.topBarLeft}>
            <StatusDot color={dotColor} />
            <Text style={styles.topBarTitle} numberOfLines={1}>
              {connectionStatus === 'connected' && selectedDevice
                ? selectedDevice.name
                : connectionStatus === 'connecting'
                ? 'Connecting…'
                : connectionStatus === 'error'
                ? 'Error'
                : 'No relay'}
            </Text>
          </View>
          <View style={styles.topBarRight}>
            {isConnected ? (
              <Pressable onPress={disconnect} style={styles.iconBtn}>
                <MaterialIcons color={C.muted} name="link-off" size={16} />
              </Pressable>
            ) : null}
            <Pressable onPress={() => router.push('/pair-device')} style={styles.iconBtn}>
              <MaterialIcons color={C.accent} name="add" size={18} />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Devices */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>RELAYS</Text>
          {savedDevices.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>No relays saved. Tap + Pair to add one.</Text>
            </View>
          ) : savedDevices.map((device) => {
            const isSelected = device.id === selectedDeviceId;
            const isActive = isConnected && isSelected;
            return (
              <View key={device.id} style={[styles.deviceRow, isSelected && styles.deviceRowActive]}>
                <Pressable onPress={() => applySelection(device)} style={styles.deviceMain}>
                  <View style={styles.deviceTopRow}>
                    <StatusDot color={isActive ? '#15ac91' : isSelected ? '#228df2' : '#7a797a'} />
                    <Text style={styles.deviceName}>{device.name}</Text>
                    <Text style={styles.deviceMeta}>
                      {device.lastUsedAt ? timeAgo(device.lastUsedAt) : 'never used'}
                    </Text>
                  </View>
                  <Text style={styles.deviceUrl} numberOfLines={1}>{device.wsUrl}</Text>
                </Pressable>
                <View style={styles.deviceActions}>
                  <Pressable onPress={() => connect(device)} style={styles.actionChip}>
                    <Text style={styles.actionChipText}>{isActive ? 'Refresh' : 'Connect'}</Text>
                  </Pressable>
                  <Pressable onPress={() => void forgetDevice(device.id)}>
                    <Text style={styles.forgetText}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>

        {/* Projects */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PROJECTS</Text>
          {projects.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>
                {isConnected ? 'No projects on this relay.' : 'Connect a relay to load projects.'}
              </Text>
            </View>
          ) : projects.map((project) => (
            <Pressable
              key={project.id}
              onPress={() => openNewSession(project)}
              disabled={!isConnected}
              style={[styles.fileRow, !isConnected && styles.rowDisabled]}
            >
              <Text style={styles.fileIcon}>⬡</Text>
              <View style={styles.fileInfo}>
                <Text style={styles.fileName}>{project.name}</Text>
                <Text style={styles.filePath} numberOfLines={1}>{project.path}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </View>

        {/* Sessions */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SESSIONS</Text>
          {sessionCards.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>No sessions yet.</Text>
            </View>
          ) : sessionCards.map((session) => (
            <Pressable
              key={session.sessionId}
              onPress={() => openExistingSession(session)}
              disabled={!isConnected}
              style={[styles.fileRow, !isConnected && styles.rowDisabled]}
            >
              <StatusDot color={session.hasActiveProcess ? '#15ac91' : '#7a797a'} />
              <View style={styles.fileInfo}>
                <Text style={styles.fileName}>{session.projectName}</Text>
                <Text style={styles.filePath} numberOfLines={1}>
                  {session.hasActiveProcess ? 'running' : 'exited'} · {timeAgo(session.updatedAt)}
                  {session.sharedSessionName ? ` · ${session.sharedSessionName}` : ''}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </View>

        {lastError ? (
          <View style={styles.errorBar}>
            <Text style={styles.errorText}>{lastError}</Text>
          </View>
        ) : null}

      </ScrollView>
    </View>
  );
}

const C = {
  bg: '#181818',
  surface: '#1d1d1d',
  surfaceActive: '#2a282a',
  border: '#383838',
  borderActive: '#163761',
  text: '#d6d6dd',
  muted: '#7a797a',
  accent: '#228df2',
  danger: '#f14c4c',
};

const styles = StyleSheet.create({
  screen: { backgroundColor: C.bg, flex: 1 },
  topSafe: { backgroundColor: C.surface, borderBottomColor: C.border, borderBottomWidth: 1 },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  topBarLeft: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 8, minWidth: 0 },
  topBarTitle: { color: '#d1d1d1', flex: 1, fontFamily: Fonts.sans, fontSize: 12, fontWeight: '400' },
  topBarRight: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  iconBtn: { alignItems: 'center', borderRadius: 6, height: 36, justifyContent: 'center', width: 36 },
  statusDot: { borderRadius: 99, height: 6, width: 6 },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    gap: 16,
    paddingBottom: 40,
    paddingTop: 12,
  },
  section: {
    gap: 1,
  },
  sectionLabel: {
    color: C.muted,
    fontFamily: Fonts.sans,
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.8,
    marginBottom: 4,
    paddingHorizontal: 16,
  },
  emptyRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  emptyText: {
    color: C.muted,
    fontFamily: Fonts.sans,
    fontSize: 12,
  },
  deviceRow: {
    backgroundColor: C.surface,
    borderBottomColor: C.border,
    borderBottomWidth: 1,
    borderTopColor: C.border,
    borderTopWidth: 1,
    gap: 8,
    marginBottom: -1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  deviceRowActive: {
    backgroundColor: C.surfaceActive,
    borderBottomColor: C.borderActive,
    borderTopColor: C.borderActive,
  },
  deviceMain: {
    gap: 3,
  },
  deviceTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  deviceName: {
    color: '#d1d1d1',
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: 13,
    fontWeight: '500',
  },
  deviceMeta: {
    color: C.muted,
    fontFamily: Fonts.sans,
    fontSize: 11,
  },
  deviceUrl: {
    color: C.muted,
    fontFamily: Fonts.mono,
    fontSize: 11,
    paddingLeft: 14,
  },
  deviceActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingLeft: 14,
  },
  actionChip: {
    backgroundColor: C.bg,
    borderColor: C.border,
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionChipText: {
    color: C.accent,
    fontFamily: Fonts.sans,
    fontSize: 11,
    fontWeight: '500',
  },
  forgetText: {
    color: C.muted,
    fontFamily: Fonts.sans,
    fontSize: 11,
    textDecorationLine: 'underline',
  },
  fileRow: {
    alignItems: 'center',
    backgroundColor: C.surface,
    borderBottomColor: C.border,
    borderBottomWidth: 1,
    borderTopColor: C.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: -1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 44,
  },
  rowDisabled: {
    opacity: 0.4,
  },
  fileIcon: {
    color: C.muted,
    fontSize: 13,
    width: 16,
  },
  fileInfo: {
    flex: 1,
    gap: 2,
  },
  fileName: {
    color: '#d1d1d1',
    fontFamily: Fonts.sans,
    fontSize: 13,
    fontWeight: '400',
  },
  filePath: {
    color: C.muted,
    fontFamily: Fonts.mono,
    fontSize: 11,
  },
  chevron: {
    color: C.muted,
    fontFamily: Fonts.sans,
    fontSize: 13,
    fontWeight: '400',
  },
  errorBar: {
    backgroundColor: 'rgba(241,76,76,0.08)',
    borderColor: 'rgba(241,76,76,0.25)',
    borderRadius: 4,
    borderWidth: 1,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorText: {
    color: C.danger,
    fontFamily: Fonts.sans,
    fontSize: 12,
  },
});
