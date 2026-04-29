import { useCallback, useEffect, useRef, useState } from 'react';

import {
  consumePendingDeviceId,
  deleteSavedDevice,
  loadSavedDevices,
  markSavedDeviceUsed,
  type SavedDevice,
} from '@/lib/devices';
import { buildWebSocketConnectionUrl } from '@/lib/pairing';
import type { ProjectDefinition, ServerMessage, SessionSummary } from '@/lib/terminal';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface UseWorkspaceConnection {
  savedDevices: SavedDevice[];
  selectedDevice: SavedDevice | null;
  selectedDeviceId: string | null;
  projects: ProjectDefinition[];
  sessions: SessionSummary[];
  status: ConnectionStatus;
  lastError: string | null;
  isConnected: boolean;
  selectDevice: (device: SavedDevice | null) => void;
  connect: (device?: SavedDevice) => void;
  disconnect: () => void;
  forgetDevice: (deviceId: string) => Promise<void>;
  refreshDevices: () => Promise<void>;
}

export function useWorkspaceConnection(): UseWorkspaceConnection {
  const socketRef = useRef<WebSocket | null>(null);
  const selectedDeviceIdRef = useRef<string | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  const [savedDevices, setSavedDevices] = useState<SavedDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectDefinition[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    selectedDeviceIdRef.current = selectedDeviceId;
  }, [selectedDeviceId]);

  useEffect(
    () => () => {
      socketRef.current?.close();
    },
    [],
  );

  const requestBootstrapData = useCallback((): void => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'list_projects' }));
    socket.send(JSON.stringify({ type: 'list_sessions' }));
  }, []);

  const selectDevice = useCallback((device: SavedDevice | null): void => {
    setSelectedDeviceId(device?.id ?? null);
    setLastError(null);
  }, []);

  const selectedDevice =
    savedDevices.find((device) => device.id === selectedDeviceId) ?? null;

  const connect = useCallback(
    (target?: SavedDevice): void => {
      const device = target ?? selectedDevice;
      if (!device) {
        setLastError('No device selected.');
        return;
      }

      selectDevice(device);
      setStatus('connecting');
      setLastError(null);
      setProjects([]);
      setSessions([]);
      socketRef.current?.close();

      const socket = new WebSocket(buildWebSocketConnectionUrl(device.wsUrl, device.token));
      socketRef.current = socket;

      socket.onopen = () => {
        if (socketRef.current !== socket) return;
        setStatus('connected');
        if (device.id) {
          void markSavedDeviceUsed(device.id).then(() => refreshRef.current());
        }
        requestBootstrapData();
      };

      socket.onmessage = (event) => {
        if (socketRef.current !== socket) return;
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
          setStatus('error');
          setLastError(`${message.code}: ${message.message}`);
        }
      };

      socket.onerror = () => {
        if (socketRef.current !== socket) return;
        setStatus('error');
        setLastError('Connection failed.');
      };

      socket.onclose = () => {
        if (socketRef.current !== socket) return;
        socketRef.current = null;
        setStatus('disconnected');
      };
    },
    [selectedDevice, selectDevice, requestBootstrapData],
  );

  const disconnect = useCallback((): void => {
    socketRef.current?.close();
    socketRef.current = null;
    setStatus('disconnected');
  }, []);

  const forgetDevice = useCallback(
    async (deviceId: string): Promise<void> => {
      if (selectedDeviceIdRef.current === deviceId) disconnect();
      await deleteSavedDevice(deviceId);
      await refreshRef.current();
    },
    [disconnect],
  );

  refreshRef.current = async function refreshDevices(): Promise<void> {
    const [devices, pendingDeviceId] = await Promise.all([
      loadSavedDevices(),
      consumePendingDeviceId(),
    ]);
    setSavedDevices(devices);

    if (pendingDeviceId) {
      const paired = devices.find((device) => device.id === pendingDeviceId);
      if (paired) {
        selectDevice(paired);
        connect(paired);
        return;
      }
    }

    const current = selectedDeviceIdRef.current;
    if (current && devices.some((device) => device.id === current)) return;
    selectDevice(devices[0] ?? null);
  };

  const refreshDevices = useCallback(() => refreshRef.current(), []);

  return {
    savedDevices,
    selectedDevice,
    selectedDeviceId,
    projects,
    sessions,
    status,
    lastError,
    isConnected: status === 'connected',
    selectDevice,
    connect,
    disconnect,
    forgetDevice,
    refreshDevices,
  };
}
