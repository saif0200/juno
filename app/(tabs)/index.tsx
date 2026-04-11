import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
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
  const colorScheme = useColorScheme() ?? 'dark';
  const palette = Colors[colorScheme];
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
        mode: 'create',
        url: buildWebSocketConnectionUrl(selectedDevice.wsUrl, selectedDevice.token),
        projectId: project.id,
        projectName: project.name,
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
        mode: 'resume',
        url: buildWebSocketConnectionUrl(selectedDevice.wsUrl, selectedDevice.token),
        sessionId: session.sessionId,
        projectName: session.projectName,
        projectPath: session.projectPath,
      },
    });
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <ThemedText style={[styles.eyebrow, { color: palette.muted }]}>Workspace</ThemedText>
            <ThemedText type="title" style={styles.title}>
              One relay. One flow.
            </ThemedText>
            <ThemedText style={[styles.description, { color: palette.muted }]}>
              Pair by QR, pick a saved device, and jump straight into Claude sessions.
            </ThemedText>
          </View>
          <Pressable
            onPress={() => router.push('/pair-device')}
            style={[styles.scanButton, { backgroundColor: palette.text }]}>
            <ThemedText style={[styles.scanButtonText, { color: palette.background }]}>
              Scan QR
            </ThemedText>
          </Pressable>
        </View>

        <View style={styles.metrics}>
          <View style={[styles.metric, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Status</ThemedText>
            <ThemedText style={styles.metricValue}>{connectionStatus}</ThemedText>
          </View>
          <View style={[styles.metric, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Devices</ThemedText>
            <ThemedText style={styles.metricValue}>{savedDevices.length}</ThemedText>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText style={styles.sectionTitle}>Saved devices</ThemedText>
            {isConnected ? (
              <Pressable
                onPress={disconnect}
                style={[styles.inlineAction, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <ThemedText style={[styles.inlineActionText, { color: palette.text }]}>Disconnect</ThemedText>
              </Pressable>
            ) : null}
          </View>

          {savedDevices.length === 0 ? (
            <View style={[styles.emptyState, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <ThemedText style={[styles.emptyText, { color: palette.muted }]}>
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
                    {
                      backgroundColor: palette.surface,
                      borderColor: isSelected ? palette.text : palette.border,
                    },
                  ]}>
                  <Pressable onPress={() => applySelection(device)} style={styles.deviceMain}>
                    <View style={styles.deviceTop}>
                      <ThemedText style={styles.deviceName}>{device.name}</ThemedText>
                      <ThemedText
                        style={[
                          styles.deviceStatus,
                          { color: isActive ? palette.success : palette.muted },
                        ]}>
                        {isActive ? 'Connected' : isSelected ? 'Selected' : 'Saved'}
                      </ThemedText>
                    </View>
                    <ThemedText style={[styles.deviceUrl, { color: palette.muted }]}>
                      {device.wsUrl}
                    </ThemedText>
                    <ThemedText style={[styles.deviceMeta, { color: palette.muted }]}>
                      {device.lastUsedAt
                        ? `Last used ${formatTimestamp(device.lastUsedAt)}`
                        : `Saved ${formatTimestamp(device.createdAt)}`}
                    </ThemedText>
                  </Pressable>

                  <View style={styles.deviceActions}>
                    <Pressable
                      onPress={() => connect(device)}
                      style={[
                        styles.deviceActionButton,
                        { backgroundColor: palette.surfaceMuted, borderColor: palette.border },
                      ]}>
                      <ThemedText style={[styles.deviceActionText, { color: palette.text }]}>
                        {isActive ? 'Refresh' : 'Connect'}
                      </ThemedText>
                    </Pressable>
                    <Pressable onPress={() => void forgetDevice(device.id)} style={styles.deviceForget}>
                      <ThemedText style={[styles.deviceForgetText, { color: palette.danger }]}>
                        Forget
                      </ThemedText>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Projects</ThemedText>
          {projects.length === 0 ? (
            <View style={[styles.emptyState, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <ThemedText style={[styles.emptyText, { color: palette.muted }]}>
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
                  {
                    backgroundColor: palette.surface,
                    borderColor: palette.border,
                    opacity: isConnected ? 1 : 0.5,
                  },
                ]}>
                <ThemedText style={styles.listTitle}>{project.name}</ThemedText>
                <ThemedText style={[styles.listMeta, { color: palette.muted }]}>{project.path}</ThemedText>
              </Pressable>
            ))
          )}
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Recent sessions</ThemedText>
          {sessionCards.length === 0 ? (
            <View style={[styles.emptyState, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <ThemedText style={[styles.emptyText, { color: palette.muted }]}>
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
                  {
                    backgroundColor: palette.surface,
                    borderColor: palette.border,
                    opacity: isConnected ? 1 : 0.5,
                  },
                ]}>
                <ThemedText style={styles.listTitle}>{session.projectName}</ThemedText>
                <ThemedText style={[styles.listMeta, { color: palette.muted }]}>
                  {session.projectPath}
                </ThemedText>
                <ThemedText style={[styles.listMeta, { color: palette.muted }]}>
                  {session.hasActiveProcess ? 'Running' : 'Exited'} · {formatTimestamp(session.updatedAt)}
                </ThemedText>
              </Pressable>
            ))
          )}
        </View>

        {statusMessage ? (
          <ThemedText style={[styles.messageText, { color: palette.success }]}>{statusMessage}</ThemedText>
        ) : null}
        {lastError ? (
          <ThemedText style={[styles.messageText, { color: palette.danger }]}>{lastError}</ThemedText>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    gap: 18,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 34,
  },
  header: {
    gap: 12,
  },
  headerCopy: {
    gap: 6,
  },
  eyebrow: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: 32,
    lineHeight: 36,
    maxWidth: 280,
  },
  description: {
    fontSize: 14,
    lineHeight: 22,
    maxWidth: 320,
  },
  scanButton: {
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  scanButtonText: {
    fontFamily: Fonts.rounded,
    fontSize: 16,
    fontWeight: '700',
  },
  metrics: {
    flexDirection: 'row',
    gap: 10,
  },
  metric: {
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  metricLabel: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  metricValue: {
    fontFamily: Fonts.rounded,
    fontSize: 18,
  },
  section: {
    gap: 10,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 22,
  },
  inlineAction: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inlineActionText: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    fontWeight: '700',
  },
  emptyState: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
  },
  deviceRow: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
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
    flex: 1,
    fontFamily: Fonts.rounded,
    fontSize: 19,
    marginRight: 10,
  },
  deviceStatus: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  deviceUrl: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 17,
  },
  deviceMeta: {
    fontSize: 12,
    lineHeight: 18,
  },
  deviceActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  deviceActionButton: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  deviceActionText: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  deviceForget: {
    paddingVertical: 6,
  },
  deviceForgetText: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  listRow: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  listTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 18,
  },
  listMeta: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  messageText: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
});
