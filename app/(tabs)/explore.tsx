import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import {
  consumePendingDeviceId,
  deleteSavedDevice,
  loadSavedDevices,
  markSavedDeviceUsed,
  type SavedDevice,
  upsertSavedDevice,
} from '@/lib/devices';
import { buildWebSocketConnectionUrl } from '@/lib/pairing';
import {
  type ProjectDefinition,
  type ServerMessage,
  type SessionSummary,
  getDefaultWebSocketUrl,
} from '@/lib/terminal';
import { useColorScheme } from '@/hooks/use-color-scheme';

const DEFAULT_WS_URL = getDefaultWebSocketUrl();

function inferDeviceNameFromUrl(wsUrl: string): string {
  try {
    const parsedUrl = new URL(wsUrl);
    return parsedUrl.hostname === 'localhost' ? 'Local relay' : `${parsedUrl.hostname} relay`;
  } catch {
    return 'Manual relay';
  }
}

function summarizeCapabilities(device: SavedDevice | null): string | null {
  if (!device?.capabilities) {
    return null;
  }

  if (Array.isArray(device.capabilities)) {
    return device.capabilities.join(', ');
  }

  return Object.keys(device.capabilities).join(', ');
}

export default function TerminalLauncherScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'dark';
  const palette = Colors[colorScheme];
  const socketRef = useRef<WebSocket | null>(null);
  const selectedDeviceIdRef = useRef<string | null>(null);
  const refreshSavedDevicesRef = useRef<() => Promise<void>>(async () => {});
  const [savedDevices, setSavedDevices] = useState<SavedDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState('');
  const [url, setUrl] = useState(DEFAULT_WS_URL);
  const [httpUrl, setHttpUrl] = useState('');
  const [token, setToken] = useState('');
  const [projects, setProjects] = useState<ProjectDefinition[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [lastError, setLastError] = useState<string | null>(null);
  const [pairingMessage, setPairingMessage] = useState<string | null>(null);
  const detectedUrl = DEFAULT_WS_URL;

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
  const isConnected = socketRef.current?.readyState === WebSocket.OPEN;
  const selectedCapabilities = summarizeCapabilities(selectedDevice);

  function applyDeviceToDraft(device: SavedDevice): void {
    setSelectedDeviceId(device.id);
    setDeviceName(device.name);
    setUrl(device.wsUrl);
    setHttpUrl(device.httpUrl ?? '');
    setToken(device.token ?? '');
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
        applyDeviceToDraft(pairedDevice);
        setPairingMessage(`Paired ${pairedDevice.name}. Connecting to relay…`);
        connect(pairedDevice);
      }
      return;
    }

    const currentSelectedDeviceId = selectedDeviceIdRef.current;
    if (!currentSelectedDeviceId) {
      return;
    }

    const refreshedSelectedDevice = devices.find((device) => device.id === currentSelectedDeviceId);
    if (!refreshedSelectedDevice) {
      setSelectedDeviceId(null);
      return;
    }

    applyDeviceToDraft(refreshedSelectedDevice);
  };

  function requestBootstrapData(): void {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    socketRef.current.send(JSON.stringify({ type: 'list_projects' }));
    socketRef.current.send(JSON.stringify({ type: 'list_sessions' }));
  }

  function getDraftDevice(): SavedDevice | null {
    const trimmedUrl = url.trim();
    if (!/^wss?:\/\//i.test(trimmedUrl)) {
      setLastError('Relay URL must start with ws:// or wss://.');
      return null;
    }

    return {
      id: selectedDeviceId ?? `draft-${Date.now().toString(36)}`,
      name: deviceName.trim() || inferDeviceNameFromUrl(trimmedUrl),
      wsUrl: trimmedUrl,
      httpUrl: httpUrl.trim() || undefined,
      token: token.trim() || undefined,
      capabilities: selectedDevice?.capabilities,
      source: selectedDevice?.source ?? 'manual',
      createdAt: selectedDevice?.createdAt ?? new Date().toISOString(),
      updatedAt: selectedDevice?.updatedAt ?? new Date().toISOString(),
      lastUsedAt: selectedDevice?.lastUsedAt,
    };
  }

  function connect(targetDevice?: SavedDevice): void {
    const draftDevice = targetDevice ?? getDraftDevice();
    if (!draftDevice) {
      return;
    }

    socketRef.current?.close();
    setPairingMessage(targetDevice ? `Connecting to ${draftDevice.name}…` : null);
    setConnectionStatus('Connecting...');
    setLastError(null);
    setProjects([]);
    setSessions([]);

    const socket = new WebSocket(buildWebSocketConnectionUrl(draftDevice.wsUrl, draftDevice.token));
    socketRef.current = socket;

    socket.onopen = () => {
      setConnectionStatus('Connected');
      setPairingMessage(`Connected to ${draftDevice.name}.`);
      if (draftDevice.id && !draftDevice.id.startsWith('draft-')) {
        void markSavedDeviceUsed(draftDevice.id).then(() => refreshSavedDevicesRef.current());
      }
      requestBootstrapData();
    };

    socket.onmessage = (event) => {
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
      setConnectionStatus('Connection failed');
      setLastError('WebSocket connection failed.');
    };

    socket.onclose = () => {
      socketRef.current = null;
      setConnectionStatus('Disconnected');
    };
  }

  async function saveCurrentDevice(): Promise<void> {
    const draftDevice = getDraftDevice();
    if (!draftDevice) {
      return;
    }

    const savedDevice = await upsertSavedDevice({
      id: selectedDeviceId ?? undefined,
      name: draftDevice.name,
      wsUrl: draftDevice.wsUrl,
      httpUrl: draftDevice.httpUrl,
      token: draftDevice.token,
      capabilities: selectedDevice?.capabilities,
      source: selectedDevice?.source ?? 'manual',
    });

    applyDeviceToDraft(savedDevice);
    setPairingMessage(`${savedDevice.name} saved on this phone.`);
    await refreshSavedDevicesRef.current();
  }

  async function forgetDevice(deviceId: string): Promise<void> {
    await deleteSavedDevice(deviceId);
    if (selectedDeviceIdRef.current === deviceId) {
      setSelectedDeviceId(null);
      setDeviceName('');
      setUrl(DEFAULT_WS_URL);
      setHttpUrl('');
      setToken('');
    }
    await refreshSavedDevicesRef.current();
  }

  function clearSelection(): void {
    setSelectedDeviceId(null);
    setDeviceName('');
    setUrl(DEFAULT_WS_URL);
    setHttpUrl('');
    setToken('');
    setPairingMessage(null);
    setLastError(null);
  }

  function openNewSession(project: ProjectDefinition): void {
    const draftDevice = getDraftDevice();
    if (!draftDevice) {
      return;
    }

    router.push({
      pathname: '/terminal',
      params: {
        mode: 'create',
        url: buildWebSocketConnectionUrl(draftDevice.wsUrl, draftDevice.token),
        projectId: project.id,
        projectName: project.name,
      },
    });
  }

  function openExistingSession(session: SessionSummary): void {
    const draftDevice = getDraftDevice();
    if (!draftDevice) {
      return;
    }

    router.push({
      pathname: '/terminal',
      params: {
        mode: 'resume',
        url: buildWebSocketConnectionUrl(draftDevice.wsUrl, draftDevice.token),
        sessionId: session.sessionId,
        projectName: session.projectName,
        projectPath: session.projectPath,
      },
    });
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <View
        style={[
          styles.hero,
          {
            backgroundColor: colorScheme === 'dark' ? '#020617' : '#f8fbff',
            borderColor: colorScheme === 'dark' ? '#1e293b' : '#dbeafe',
          },
        ]}>
        <ThemedText style={styles.eyebrow}>Claude Code on iPhone</ThemedText>
        <ThemedText type="subtitle" style={styles.title}>
          Pair once, save locally, then launch sessions from the relay you trust.
        </ThemedText>
        <ThemedText
          style={[
            styles.subtitle,
            {
              color: colorScheme === 'dark' ? '#94a3b8' : '#475569',
            },
          ]}>
          QR pairing and manual entry both feed the same saved-device list. The fullscreen terminal
          only opens after a project or session is chosen.
        </ThemedText>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}>
        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <ThemedText style={styles.sectionTitle}>Saved devices</ThemedText>
            <Pressable
              onPress={() => router.push('/pair-device')}
              style={[
                styles.secondaryChip,
                {
                  backgroundColor: colorScheme === 'dark' ? '#082f49' : '#dbeafe',
                  borderColor: colorScheme === 'dark' ? '#155e75' : '#93c5fd',
                },
              ]}>
              <ThemedText
                style={[
                  styles.secondaryChipText,
                  {
                    color: colorScheme === 'dark' ? '#bae6fd' : '#1d4ed8',
                  },
                ]}>
                Scan QR
              </ThemedText>
            </Pressable>
          </View>

          {savedDevices.map((device) => {
            const isSelected = device.id === selectedDeviceId;
            return (
              <View
                key={device.id}
                style={[
                  styles.deviceCard,
                  {
                    backgroundColor: colorScheme === 'dark' ? '#0f172a' : '#ffffff',
                    borderColor: isSelected
                      ? '#0f766e'
                      : colorScheme === 'dark'
                        ? '#1e293b'
                        : '#cbd5e1',
                  },
                ]}>
                <Pressable onPress={() => applyDeviceToDraft(device)} style={styles.deviceCardPressable}>
                  <View style={styles.deviceHeader}>
                    <ThemedText style={styles.cardTitle}>{device.name}</ThemedText>
                    <ThemedText style={styles.deviceBadge}>{device.source === 'qr' ? 'QR' : 'Manual'}</ThemedText>
                  </View>
                  <ThemedText style={styles.cardPath}>{device.wsUrl}</ThemedText>
                  {device.httpUrl ? (
                    <ThemedText style={styles.cardPath}>HTTP {device.httpUrl}</ThemedText>
                  ) : null}
                  {device.capabilities ? (
                    <ThemedText style={styles.deviceMeta}>
                      Capabilities: {summarizeCapabilities(device)}
                    </ThemedText>
                  ) : null}
                  <ThemedText style={styles.cardMeta}>
                    {device.lastUsedAt
                      ? `Last used ${new Date(device.lastUsedAt).toLocaleString()}`
                      : `Saved ${new Date(device.createdAt).toLocaleString()}`}
                  </ThemedText>
                </Pressable>
                <Pressable onPress={() => void forgetDevice(device.id)} style={styles.forgetButton}>
                  <ThemedText style={styles.forgetButtonText}>Forget</ThemedText>
                </Pressable>
              </View>
            );
          })}

          {savedDevices.length === 0 ? (
            <ThemedText style={styles.emptyText}>
              Scan a QR from the relay or keep using manual entry below. Devices are stored only on
              this phone.
            </ThemedText>
          ) : null}
        </View>

        <View
          style={[
            styles.panel,
            {
              backgroundColor: colorScheme === 'dark' ? '#0f172a' : '#ffffff',
              borderColor: colorScheme === 'dark' ? '#1e293b' : '#cbd5e1',
            },
          ]}>
          <View style={styles.panelHeader}>
            <View style={styles.panelCopy}>
              <ThemedText style={styles.panelTitle}>Relay connection</ThemedText>
              <ThemedText
                style={[
                  styles.status,
                  {
                    color: colorScheme === 'dark' ? '#7dd3fc' : '#075985',
                  },
                ]}>
                {connectionStatus}
                {selectedDevice ? ` • ${selectedDevice.name}` : ''}
              </ThemedText>
            </View>
            <Pressable
              onPress={() => connect()}
              style={[
                styles.primaryButton,
                {
                  backgroundColor: colorScheme === 'dark' ? '#115e59' : '#0f766e',
                },
              ]}>
              <ThemedText style={styles.primaryButtonText}>
                {isConnected ? 'Refresh' : 'Connect'}
              </ThemedText>
            </Pressable>
          </View>

          <TextInput
            autoCapitalize="words"
            autoCorrect={false}
            onChangeText={setDeviceName}
            placeholder="Friendly device name"
            placeholderTextColor={colorScheme === 'dark' ? '#64748b' : '#94a3b8'}
            style={[
              styles.input,
              {
                backgroundColor: colorScheme === 'dark' ? '#020617' : '#ffffff',
                borderColor: colorScheme === 'dark' ? '#334155' : '#cbd5e1',
                color: palette.text,
              },
            ]}
            value={deviceName}
          />

          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={setUrl}
            placeholder="ws://192.168.1.10:3000"
            placeholderTextColor={colorScheme === 'dark' ? '#64748b' : '#94a3b8'}
            style={[
              styles.input,
              {
                backgroundColor: colorScheme === 'dark' ? '#020617' : '#ffffff',
                borderColor: colorScheme === 'dark' ? '#334155' : '#cbd5e1',
                color: palette.text,
              },
            ]}
            value={url}
          />

          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={setHttpUrl}
            placeholder="Optional http://192.168.1.10:3000"
            placeholderTextColor={colorScheme === 'dark' ? '#64748b' : '#94a3b8'}
            style={[
              styles.input,
              {
                backgroundColor: colorScheme === 'dark' ? '#020617' : '#ffffff',
                borderColor: colorScheme === 'dark' ? '#334155' : '#cbd5e1',
                color: palette.text,
              },
            ]}
            value={httpUrl}
          />

          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setToken}
            placeholder="Optional pairing token"
            placeholderTextColor={colorScheme === 'dark' ? '#64748b' : '#94a3b8'}
            style={[
              styles.input,
              {
                backgroundColor: colorScheme === 'dark' ? '#020617' : '#ffffff',
                borderColor: colorScheme === 'dark' ? '#334155' : '#cbd5e1',
                color: palette.text,
              },
            ]}
            value={token}
          />

          <View style={styles.buttonRow}>
            <Pressable onPress={() => void saveCurrentDevice()} style={styles.secondaryButton}>
              <ThemedText style={styles.secondaryButtonText}>
                {selectedDevice ? 'Update device' : 'Save device'}
              </ThemedText>
            </Pressable>
            <Pressable onPress={clearSelection} style={styles.secondaryButton}>
              <ThemedText style={styles.secondaryButtonText}>Clear</ThemedText>
            </Pressable>
          </View>

          {detectedUrl !== 'ws://localhost:3000' ? (
            <Pressable
              onPress={() => setUrl(detectedUrl)}
              style={[
                styles.detectedButton,
                {
                  backgroundColor: colorScheme === 'dark' ? '#082f49' : '#dbeafe',
                  borderColor: colorScheme === 'dark' ? '#155e75' : '#93c5fd',
                },
              ]}>
              <ThemedText
                style={[
                  styles.detectedButtonText,
                  {
                    color: colorScheme === 'dark' ? '#bae6fd' : '#1d4ed8',
                  },
                ]}>
                Use detected host: {detectedUrl}
              </ThemedText>
            </Pressable>
          ) : null}

          <ThemedText style={styles.helperText}>
            Keep manual entry as fallback, or scan a QR payload with `name` and `wsUrl`.
            Optional `httpUrl`, `token`, and `capabilities` are stored locally.
          </ThemedText>

          {selectedCapabilities ? (
            <ThemedText style={styles.helperText}>Selected capabilities: {selectedCapabilities}</ThemedText>
          ) : null}

          {pairingMessage ? <ThemedText style={styles.noticeText}>{pairingMessage}</ThemedText> : null}
          {lastError ? <ThemedText style={styles.errorText}>{lastError}</ThemedText> : null}
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Projects</ThemedText>
          {projects.map((project) => (
            <Pressable
              disabled={!isConnected}
              key={project.id}
              onPress={() => openNewSession(project)}
              style={[
                styles.card,
                {
                  backgroundColor: colorScheme === 'dark' ? '#0f172a' : '#ffffff',
                  borderColor: colorScheme === 'dark' ? '#1e293b' : '#cbd5e1',
                  opacity: isConnected ? 1 : 0.5,
                },
              ]}>
              <ThemedText style={styles.cardTitle}>{project.name}</ThemedText>
              <ThemedText style={styles.cardPath}>{project.path}</ThemedText>
              <ThemedText style={styles.cardMeta}>Start a fresh Claude session</ThemedText>
            </Pressable>
          ))}
          {projects.length === 0 ? (
            <ThemedText style={styles.emptyText}>
              {isConnected
                ? 'No projects available. Add entries to `server/projects.json`.'
                : 'Connect to the relay to load projects.'}
            </ThemedText>
          ) : null}
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Recent sessions</ThemedText>
          {sessionCards.map((session) => (
            <Pressable
              disabled={!isConnected}
              key={session.sessionId}
              onPress={() => openExistingSession(session)}
              style={[
                styles.card,
                {
                  backgroundColor: colorScheme === 'dark' ? '#0f172a' : '#ffffff',
                  borderColor: colorScheme === 'dark' ? '#1e293b' : '#cbd5e1',
                  opacity: isConnected ? 1 : 0.5,
                },
              ]}>
              <ThemedText style={styles.cardTitle}>{session.projectName}</ThemedText>
              <ThemedText style={styles.cardPath}>{session.projectPath}</ThemedText>
              <ThemedText style={styles.cardMeta}>
                {session.hasActiveProcess ? 'running' : 'exited'} • updated{' '}
                {new Date(session.updatedAt).toLocaleTimeString()}
              </ThemedText>
            </Pressable>
          ))}
          {sessionCards.length === 0 ? (
            <ThemedText style={styles.emptyText}>
              Resume options appear here after the relay reports active or recently exited
              sessions.
            </ThemedText>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  hero: {
    borderBottomWidth: 1,
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 18,
    paddingTop: 16,
  },
  eyebrow: {
    color: '#38bdf8',
    fontFamily: Fonts.mono,
    fontSize: 12,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: 26,
    lineHeight: 30,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 19,
  },
  content: {
    gap: 22,
    padding: 16,
    paddingBottom: 28,
  },
  section: {
    gap: 10,
  },
  sectionHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 18,
  },
  deviceCard: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  deviceCardPressable: {
    gap: 6,
  },
  deviceHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  deviceBadge: {
    color: '#0f766e',
    fontFamily: Fonts.mono,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  deviceMeta: {
    color: '#0f766e',
    fontFamily: Fonts.mono,
    fontSize: 12,
  },
  forgetButton: {
    alignSelf: 'flex-start',
    borderColor: '#fecaca',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  forgetButtonText: {
    color: '#b91c1c',
    fontFamily: Fonts.mono,
    fontSize: 12,
    fontWeight: '700',
  },
  panel: {
    borderRadius: 22,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  panelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  panelCopy: {
    flex: 1,
    gap: 4,
  },
  panelTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 19,
  },
  status: {
    fontFamily: Fonts.mono,
    fontSize: 12,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontFamily: Fonts.mono,
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryButton: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  primaryButtonText: {
    color: '#f8fafc',
    fontFamily: Fonts.mono,
    fontSize: 12,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#cbd5e1',
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  secondaryButtonText: {
    color: '#334155',
    fontFamily: Fonts.mono,
    fontSize: 12,
    fontWeight: '700',
  },
  secondaryChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  secondaryChipText: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    fontWeight: '700',
  },
  detectedButton: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  detectedButtonText: {
    fontFamily: Fonts.mono,
    fontSize: 12,
  },
  helperText: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 18,
  },
  noticeText: {
    color: '#0f766e',
    fontFamily: Fonts.mono,
    fontSize: 12,
  },
  errorText: {
    color: '#ef4444',
    fontFamily: Fonts.mono,
    fontSize: 12,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  cardTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 18,
  },
  cardPath: {
    color: '#64748b',
    fontFamily: Fonts.mono,
    fontSize: 12,
  },
  cardMeta: {
    color: '#2563eb',
    fontFamily: Fonts.mono,
    fontSize: 12,
  },
  emptyText: {
    color: '#64748b',
    fontFamily: Fonts.mono,
    fontSize: 13,
    lineHeight: 18,
  },
});
