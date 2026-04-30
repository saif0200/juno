import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StatusDot } from '@/components/status-dot';
import { CommandPicker, type AiCommandKey } from '@/components/workspace/command-picker';
import { DeviceRow } from '@/components/workspace/device-row';
import { ProjectRow } from '@/components/workspace/project-row';
import { SessionRow } from '@/components/workspace/session-row';
import { C, workspaceStyles as styles } from '@/components/workspace/styles';
import { useWorkspaceConnection } from '@/hooks/use-workspace-connection';
import { buildWebSocketConnectionUrl } from '@/lib/pairing';
import type { ProjectDefinition, SessionSummary } from '@/lib/terminal';

const STATUS_DOT_COLOR: Record<string, string> = {
  connected: '#15ac91',
  connecting: '#ea7620',
  error: '#f14c4c',
  disconnected: '#7a797a',
};

function statusLabel(status: string, deviceName: string | null): string {
  if (status === 'connected' && deviceName) return deviceName;
  if (status === 'connecting') return 'Connecting…';
  if (status === 'error') return 'Error';
  return 'No relay';
}

export default function WorkspaceScreen() {
  const router = useRouter();
  const connection = useWorkspaceConnection();
  const {
    savedDevices,
    selectedDevice,
    selectedDeviceId,
    projects,
    sessions,
    status,
    lastError,
    isConnected,
    selectDevice,
    connect,
    disconnect,
    forgetDevice,
    refreshDevices,
    removeProject,
  } = connection;

  useFocusEffect(
    useCallback(() => {
      void refreshDevices();
    }, [refreshDevices]),
  );

  const sessionCards = useMemo(
    () =>
      sessions
        .slice()
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [sessions],
  );

  const [pickerProject, setPickerProject] = useState<ProjectDefinition | null>(null);

  function requestProjectOpen(project: ProjectDefinition): void {
    if (!selectedDevice) return;
    setPickerProject(project);
  }

  function confirmRemoveProject(project: ProjectDefinition): void {
    Alert.alert(
      'Remove project',
      `Remove "${project.name}" from this relay?\n\nThis updates ~/.juno/projects.json on your laptop. Live shells stay open until you close their tabs.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeProject(project.id),
        },
      ],
    );
  }

  function launchSession(project: ProjectDefinition, command: AiCommandKey): void {
    if (!selectedDevice) return;
    router.push({
      pathname: '/terminal',
      params: {
        action: 'open_project',
        requestId: `${Date.now()}-${project.id}-${command}`,
        url: buildWebSocketConnectionUrl(selectedDevice.wsUrl, selectedDevice.token),
        projectId: project.id,
        projectName: project.name,
        persistence: 'persisted',
        command,
      },
    });
  }

  function openExistingSession(session: SessionSummary): void {
    if (!selectedDevice) return;
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
    <View style={styles.screen}>
      <StatusBar style="light" />
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.topSafe}>
        <View style={styles.topBar}>
          <View style={styles.topBarLeft}>
            <StatusDot color={STATUS_DOT_COLOR[status] ?? STATUS_DOT_COLOR.disconnected!} />
            <Text style={styles.topBarTitle} numberOfLines={1}>
              {statusLabel(status, selectedDevice?.name ?? null)}
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

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>RELAYS</Text>
          {savedDevices.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>No relays saved. Tap + Pair to add one.</Text>
            </View>
          ) : (
            savedDevices.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                isSelected={device.id === selectedDeviceId}
                isActive={isConnected && device.id === selectedDeviceId}
                onSelect={() => selectDevice(device)}
                onConnect={() => connect(device)}
                onForget={() => void forgetDevice(device.id)}
              />
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PROJECTS</Text>
          {projects.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>
                {isConnected ? 'No projects on this relay.' : 'Connect a relay to load projects.'}
              </Text>
            </View>
          ) : (
            projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                disabled={!isConnected}
                onPress={() => requestProjectOpen(project)}
                onLongPress={() => confirmRemoveProject(project)}
              />
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SESSIONS</Text>
          {sessionCards.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>No sessions yet.</Text>
            </View>
          ) : (
            sessionCards.map((session) => (
              <SessionRow
                key={session.sessionId}
                session={session}
                disabled={!isConnected}
                onPress={() => openExistingSession(session)}
              />
            ))
          )}
        </View>

        {lastError ? (
          <View style={styles.errorBar}>
            <Text style={styles.errorText}>{lastError}</Text>
          </View>
        ) : null}
      </ScrollView>

      <CommandPicker
        visible={pickerProject !== null}
        projectName={pickerProject?.name ?? null}
        onCancel={() => setPickerProject(null)}
        onSelect={(command) => {
          const project = pickerProject;
          setPickerProject(null);
          if (project) launchSession(project, command);
        }}
      />
    </View>
  );
}
