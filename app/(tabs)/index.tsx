import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
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

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
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
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [lastError, setLastError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    selectedDeviceIdRef.current = selectedDeviceId;
  }, [selectedDeviceId]);

  useEffect(() => {
    void refreshSavedDevicesRef.current();
    return () => {
      socketRef.current?.close();
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshSavedDevicesRef.current();
    }, []),
  );

  const selectedDevice = useMemo(
    () => savedDevices.find((device) => device.id === selectedDeviceId) ?? null,
    [savedDevices, selectedDeviceId],
  );
  const sessionCards = useMemo(
    () =>
      sessions
        .slice()
        .sort(
          (left, right) =>
            new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
        ),
    [sessions],
  );
  const isConnected = connectionStatus === 'Connected';
  const statusTone = isConnected ? '#38bdf8' : '#94a3b8';

  function requestBootstrapData(): void {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    socketRef.current.send(JSON.stringify({ type: 'list_projects' }));
    socketRef.current.send(JSON.stringify({ type: 'list_sessions' }));
  }

  function applySelection(device: SavedDevice | null): void {
    setSelectedDeviceId(device?.id ?? null);
    setLastError(null);
  }

  function connect(targetDevice?: SavedDevice): void {
    const device = targetDevice ?? selectedDevice;
    if (!device) {
      setLastError('Scan a device QR code first.');
      return;
    }

    applySelection(device);
    setStatusMessage(`Connecting to ${device.name}...`);
    setConnectionStatus('Connecting');
    setLastError(null);
    setProjects([]);
    setSessions([]);
    socketRef.current?.close();

    const socket = new WebSocket(buildWebSocketConnectionUrl(device.wsUrl, device.token));
    socketRef.current = socket;

    socket.onopen = () => {
      if (socketRef.current !== socket) {
        return;
      }
      setConnectionStatus('Connected');
      setStatusMessage(`Connected to ${device.name}.`);
      if (device.id) {
        void markSavedDeviceUsed(device.id).then(() => refreshSavedDevicesRef.current());
      }
      requestBootstrapData();
    };

    socket.onmessage = (event) => {
      if (socketRef.current !== socket) {
        return;
      }
      const message = JSON.parse(event.data as string) as ServerMessage;

      if (message.type === 'projects_list') {
        setProjects(message.projects);
        return;
      }

      if (message.type === 'sessions_list') {
        setSessions(message.sessions);
        return;
      }

      if (message.type === 'error') {
        setConnectionStatus('Relay error');
        setLastError(`${message.code}: ${message.message}`);
      }
    };

    socket.onerror = () => {
      if (socketRef.current !== socket) {
        return;
      }
      setConnectionStatus('Connection failed');
      setLastError('WebSocket connection failed.');
    };

    socket.onclose = () => {
      if (socketRef.current !== socket) {
        return;
      }
      socketRef.current = null;
      setConnectionStatus('Disconnected');
    };
  }

  function disconnect(): void {
    socketRef.current?.close();
    socketRef.current = null;
    setConnectionStatus('Disconnected');
    setStatusMessage(null);
  }

  async function forgetDevice(deviceId: string): Promise<void> {
    if (selectedDeviceIdRef.current === deviceId) {
      disconnect();
    }
    await deleteSavedDevice(deviceId);
    await refreshSavedDevicesRef.current();
  }

  refreshSavedDevicesRef.current = async function refreshSavedDevices(): Promise<void> {
    const [devices, pendingDeviceId] = await Promise.all([
      loadSavedDevices(),
      consumePendingDeviceId(),
    ]);

    setSavedDevices(devices);

    if (pendingDeviceId) {
      const pairedDevice = devices.find((device) => device.id === pendingDeviceId);
      if (pairedDevice) {
        applySelection(pairedDevice);
        setStatusMessage(`Paired ${pairedDevice.name}.`);
        connect(pairedDevice);
        return;
      }
    }

    const currentSelection = selectedDeviceIdRef.current;
    if (currentSelection && devices.some((device) => device.id === currentSelection)) {
      return;
    }

    applySelection(devices[0] ?? null);
  };

  function openNewSession(project: ProjectDefinition): void {
    if (!selectedDevice) {
      setLastError('Select a saved device before starting a session.');
      return;
    }

    router.push({
      pathname: '/terminal',
      params: {
        action: 'open_project',
        requestId: `${Date.now()}-${project.id}`,
        url: buildWebSocketConnectionUrl(selectedDevice.wsUrl, selectedDevice.token),
        projectId: project.id,
        projectName: project.name,
        persistence: 'ephemeral',
      },
    });
  }

  function openExistingSession(session: SessionSummary): void {
    if (!selectedDevice) {
      setLastError('Select a saved device before resuming.');
      return;
    }

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

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: '#090b10' }]}>
      <View pointerEvents="none" style={styles.backgroundGlowTop} />
      <View pointerEvents="none" style={styles.backgroundGlowBottom} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.brandPill}>
              <View style={styles.brandDot} />
              <ThemedText style={styles.brandPillText}>JUNO</ThemedText>
            </View>
            <Pressable
              onPress={() => router.push('/pair-device')}
              style={styles.scanButton}>
              <ThemedText style={styles.scanButtonText}>Pair Device</ThemedText>
            </Pressable>
          </View>

          <View style={styles.heroCopy}>
            <ThemedText style={styles.title}>Juno Workspace</ThemedText>
            <ThemedText style={styles.description}>
              Local-first coding cockpit with persistent terminals, instant code access, and relay sessions that resume fast.
            </ThemedText>
          </View>

          <View style={styles.metrics}>
            <View style={styles.metric}>
              <ThemedText style={styles.metricLabel}>Relay</ThemedText>
              <ThemedText style={[styles.metricValue, { color: statusTone }]}>{connectionStatus}</ThemedText>
            </View>
            <View style={styles.metric}>
              <ThemedText style={styles.metricLabel}>Devices</ThemedText>
              <ThemedText style={styles.metricValue}>{savedDevices.length}</ThemedText>
            </View>
          </View>
        </View>

        <View style={styles.sectionPanel}>
          <View style={styles.sectionHeader}>
            <ThemedText style={styles.sectionTitle}>Devices</ThemedText>
            {isConnected ? (
              <Pressable
                onPress={disconnect}
                style={styles.inlineAction}>
                <ThemedText style={styles.inlineActionText}>Disconnect</ThemedText>
              </Pressable>
            ) : null}
          </View>

          {savedDevices.length === 0 ? (
            <View style={styles.emptyState}>
              <ThemedText style={styles.emptyText}>
                No devices yet. Scan a QR code to add your relay.
              </ThemedText>
            </View>
          ) : (
            savedDevices.map((device) => {
              const isSelected = device.id === selectedDeviceId;
              const isActive = isConnected && isSelected;

              return (
                <View
                  key={device.id}
                  style={[
                    styles.deviceRow,
                    isSelected ? styles.deviceRowSelected : null,
                  ]}>
                  <Pressable onPress={() => applySelection(device)} style={styles.deviceMain}>
                    <View style={styles.deviceTop}>
                      <ThemedText style={styles.deviceName}>{device.name}</ThemedText>
                      <ThemedText
                        style={[
                          styles.deviceStatus,
                          { color: isActive ? '#22c55e' : isSelected ? '#38bdf8' : '#94a3b8' },
                        ]}>
                        {isActive ? 'Connected' : isSelected ? 'Selected' : 'Saved'}
                      </ThemedText>
                    </View>
                    <ThemedText style={styles.deviceUrl}>
                      {device.wsUrl}
                    </ThemedText>
                    <ThemedText style={styles.deviceMeta}>
                      {device.lastUsedAt
                        ? `Last used ${formatTimestamp(device.lastUsedAt)}`
                        : `Saved ${formatTimestamp(device.createdAt)}`}
                    </ThemedText>
                  </Pressable>

                  <View style={styles.deviceActions}>
                    <Pressable
                      onPress={() => connect(device)}
                      style={styles.deviceActionButton}>
                      <ThemedText style={styles.deviceActionText}>
                        {isActive ? 'Refresh' : 'Connect'}
                      </ThemedText>
                    </Pressable>
                    <Pressable onPress={() => void forgetDevice(device.id)} style={styles.deviceForget}>
                      <ThemedText style={styles.deviceForgetText}>
                        Forget
                      </ThemedText>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>

        <View style={styles.sectionPanel}>
          <ThemedText style={styles.sectionTitle}>Projects</ThemedText>
          {projects.length === 0 ? (
            <View style={styles.emptyState}>
              <ThemedText style={styles.emptyText}>
                {isConnected
                  ? 'No projects available from this relay.'
                  : 'Connect a saved device to load projects.'}
              </ThemedText>
            </View>
          ) : (
            projects.map((project) => (
              <Pressable
                disabled={!isConnected}
                key={project.id}
                onPress={() => openNewSession(project)}
                style={[
                  styles.listRow,
                  !isConnected ? styles.listRowDisabled : null,
                ]}>
                <ThemedText style={styles.listTitle}>{project.name}</ThemedText>
                <ThemedText style={styles.listMeta}>{project.path}</ThemedText>
              </Pressable>
            ))
          )}
        </View>

        <View style={styles.sectionPanel}>
          <ThemedText style={styles.sectionTitle}>Recent sessions</ThemedText>
          {sessionCards.length === 0 ? (
            <View style={styles.emptyState}>
              <ThemedText style={styles.emptyText}>
                Previous sessions appear here after the relay reports them.
              </ThemedText>
            </View>
          ) : (
            sessionCards.map((session) => (
              <Pressable
                disabled={!isConnected}
                key={session.sessionId}
                onPress={() => openExistingSession(session)}
                style={[
                  styles.listRow,
                  !isConnected ? styles.listRowDisabled : null,
                ]}>
                <ThemedText style={styles.listTitle}>{session.projectName}</ThemedText>
                <ThemedText style={styles.listMeta}>
                  {session.projectPath}
                </ThemedText>
                <ThemedText style={styles.listMeta}>
                  {session.hasActiveProcess ? 'Running' : 'Exited'} · {formatTimestamp(session.updatedAt)}
                </ThemedText>
              </Pressable>
            ))
          )}
        </View>

        {statusMessage ? <ThemedText style={[styles.messageText, { color: '#22c55e' }]}>{statusMessage}</ThemedText> : null}
        {lastError ? <ThemedText style={[styles.messageText, { color: '#f87171' }]}>{lastError}</ThemedText> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  backgroundGlowTop: {
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderRadius: 220,
    height: 220,
    position: 'absolute',
    right: -60,
    top: -70,
    width: 220,
  },
  backgroundGlowBottom: {
    backgroundColor: 'rgba(45, 212, 191, 0.08)',
    borderRadius: 260,
    bottom: -130,
    height: 260,
    left: -90,
    position: 'absolute',
    width: 260,
  },
  content: {
    gap: 14,
    paddingBottom: 30,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  heroCard: {
    backgroundColor: '#10141d',
    borderColor: '#222938',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  heroTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  brandPill: {
    alignItems: 'center',
    backgroundColor: '#141b27',
    borderColor: '#2a3345',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  brandDot: {
    backgroundColor: '#22d3ee',
    borderRadius: 99,
    height: 7,
    width: 7,
  },
  brandPillText: {
    color: '#ccf7ff',
    fontFamily: Fonts.mono,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  heroCopy: {
    marginTop: 12,
  },
  title: {
    color: '#ecf2ff',
    fontFamily: Fonts.sans,
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 31,
  },
  description: {
    color: '#97a1b1',
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  scanButton: {
    alignItems: 'center',
    backgroundColor: '#1b2433',
    borderColor: '#31405a',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  scanButtonText: {
    color: '#ebf1ff',
    fontFamily: Fonts.sans,
    fontSize: 12,
    fontWeight: '600',
  },
  metrics: {
    borderTopColor: '#252e3f',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
  },
  metric: {
    backgroundColor: '#131927',
    borderColor: '#273247',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  metricLabel: {
    color: '#9aa4b5',
    fontFamily: Fonts.sans,
    fontSize: 11,
  },
  metricValue: {
    color: '#edf2ff',
    fontFamily: Fonts.sans,
    fontSize: 17,
    fontWeight: '700',
  },
  sectionPanel: {
    backgroundColor: '#10141d',
    borderColor: '#222938',
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: '#ecf2ff',
    fontFamily: Fonts.sans,
    fontSize: 19,
    fontWeight: '600',
  },
  inlineAction: {
    backgroundColor: '#1a2230',
    borderColor: '#313d54',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  inlineActionText: {
    color: '#e4ebf8',
    fontFamily: Fonts.sans,
    fontSize: 12,
    fontWeight: '600',
  },
  emptyState: {
    backgroundColor: '#121824',
    borderColor: '#263044',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  emptyText: {
    color: '#9ba4b5',
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 19,
  },
  deviceRow: {
    backgroundColor: '#121824',
    borderColor: '#263044',
    borderRadius: 11,
    borderWidth: 1,
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  deviceRowSelected: {
    borderColor: '#3b82f6',
    backgroundColor: '#121c2f',
  },
  deviceMain: {
    gap: 5,
  },
  deviceTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  deviceName: {
    color: '#edf2ff',
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: 17,
    fontWeight: '600',
    marginRight: 10,
  },
  deviceStatus: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    textTransform: 'capitalize',
  },
  deviceUrl: {
    color: '#9ba5b6',
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 17,
  },
  deviceMeta: {
    color: '#7f8ba0',
    fontFamily: Fonts.sans,
    fontSize: 12,
    lineHeight: 18,
  },
  deviceActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  deviceActionButton: {
    backgroundColor: '#1a2230',
    borderColor: '#313d54',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  deviceActionText: {
    color: '#e4ebf8',
    fontFamily: Fonts.sans,
    fontSize: 12,
    fontWeight: '600',
  },
  deviceForget: {
    paddingVertical: 6,
  },
  deviceForgetText: {
    color: '#f87171',
    fontFamily: Fonts.mono,
    fontSize: 12,
    fontWeight: '700',
  },
  listRow: {
    backgroundColor: '#121824',
    borderColor: '#263044',
    borderRadius: 10,
    borderWidth: 1,
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  listRowDisabled: {
    opacity: 0.45,
  },
  listTitle: {
    color: '#edf2ff',
    fontFamily: Fonts.sans,
    fontSize: 16,
    fontWeight: '600',
  },
  listMeta: {
    color: '#9ba5b6',
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  messageText: {
    backgroundColor: '#10141d',
    borderColor: '#222938',
    borderRadius: 10,
    borderWidth: 1,
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
});
