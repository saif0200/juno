import AsyncStorage from '@react-native-async-storage/async-storage';

export type DeviceCapabilities = string[] | Record<string, unknown>;

export type SavedDevice = {
  id: string;
  name: string;
  wsUrl: string;
  httpUrl?: string;
  token?: string;
  capabilities?: DeviceCapabilities;
  source: 'manual' | 'qr';
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
};

type SavedDeviceInput = {
  id?: string;
  name: string;
  wsUrl: string;
  httpUrl?: string;
  token?: string;
  capabilities?: DeviceCapabilities;
  source: SavedDevice['source'];
};

const SAVED_DEVICES_KEY = '@juno/saved-devices';
const PENDING_DEVICE_ID_KEY = '@juno/pending-device-id';

function sortDevices(devices: SavedDevice[]): SavedDevice[] {
  return [...devices].sort((left, right) => {
    const leftStamp = left.lastUsedAt ?? left.updatedAt ?? left.createdAt;
    const rightStamp = right.lastUsedAt ?? right.updatedAt ?? right.createdAt;
    return rightStamp.localeCompare(leftStamp) || left.name.localeCompare(right.name);
  });
}

function createDeviceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function writeDevices(devices: SavedDevice[]): Promise<void> {
  await AsyncStorage.setItem(SAVED_DEVICES_KEY, JSON.stringify(sortDevices(devices)));
}

export async function loadSavedDevices(): Promise<SavedDevice[]> {
  const raw = await AsyncStorage.getItem(SAVED_DEVICES_KEY);
  if (!raw) {
    return [];
  }

  try {
    return sortDevices(JSON.parse(raw) as SavedDevice[]);
  } catch {
    return [];
  }
}

export async function upsertSavedDevice(input: SavedDeviceInput): Promise<SavedDevice> {
  const devices = await loadSavedDevices();
  const now = new Date().toISOString();
  const existing = input.id ? devices.find((device) => device.id === input.id) : undefined;
  const savedDevice: SavedDevice = {
    id: existing?.id ?? input.id ?? createDeviceId(),
    name: input.name,
    wsUrl: input.wsUrl,
    httpUrl: input.httpUrl,
    token: input.token,
    capabilities: input.capabilities,
    source: existing?.source ?? input.source,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastUsedAt: existing?.lastUsedAt,
  };

  const nextDevices = existing
    ? devices.map((device) => (device.id === savedDevice.id ? savedDevice : device))
    : [savedDevice, ...devices];

  await writeDevices(nextDevices);
  return savedDevice;
}

export async function deleteSavedDevice(deviceId: string): Promise<void> {
  const devices = await loadSavedDevices();
  await writeDevices(devices.filter((device) => device.id !== deviceId));
}

export async function markSavedDeviceUsed(deviceId: string): Promise<void> {
  const devices = await loadSavedDevices();
  const now = new Date().toISOString();
  await writeDevices(
    devices.map((device) =>
      device.id === deviceId
        ? {
            ...device,
            updatedAt: now,
            lastUsedAt: now,
          }
        : device,
    ),
  );
}

export async function setPendingDeviceId(deviceId: string | null): Promise<void> {
  if (deviceId === null) {
    await AsyncStorage.removeItem(PENDING_DEVICE_ID_KEY);
    return;
  }

  await AsyncStorage.setItem(PENDING_DEVICE_ID_KEY, deviceId);
}

export async function consumePendingDeviceId(): Promise<string | null> {
  const deviceId = await AsyncStorage.getItem(PENDING_DEVICE_ID_KEY);
  await AsyncStorage.removeItem(PENDING_DEVICE_ID_KEY);
  return deviceId;
}
