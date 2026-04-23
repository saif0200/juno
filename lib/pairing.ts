import type { DeviceCapabilities } from '@/lib/devices';

export type PairingPayload = {
  name: string;
  wsUrl: string;
  httpUrl?: string;
  token?: string;
  capabilities?: DeviceCapabilities;
};

type PairingPayloadShape = {
  name?: unknown;
  friendlyName?: unknown;
  deviceName?: unknown;
  wsUrl?: unknown;
  httpUrl?: unknown;
  token?: unknown;
  capabilities?: unknown;
};

function decodeMaybeEncodedJson(value: string): string {
  const decodedUriComponent = (() => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  })();

  if (decodedUriComponent.trim().startsWith('{')) {
    return decodedUriComponent;
  }

  if (typeof globalThis.atob !== 'function') {
    return decodedUriComponent;
  }

  const normalized = decodedUriComponent.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  try {
    return globalThis.atob(padded);
  } catch {
    return decodedUriComponent;
  }
}

function inferDeviceName(wsUrl: string): string {
  try {
    const url = new URL(wsUrl);
    return url.hostname === 'localhost' ? 'Local relay' : `${url.hostname} relay`;
  } catch {
    return 'Paired relay';
  }
}

function normalizeCapabilities(value: unknown): DeviceCapabilities | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }

  if (typeof value === 'object') {
    return value as Record<string, unknown>;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      return normalizeCapabilities(JSON.parse(trimmed));
    } catch {
      return [trimmed];
    }
  }

  return trimmed.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function normalizePayload(input: PairingPayloadShape): PairingPayload {
  const nameValue = input.name ?? input.friendlyName ?? input.deviceName;
  const wsUrlValue = input.wsUrl;

  if (typeof wsUrlValue !== 'string' || !/^wss?:\/\//i.test(wsUrlValue.trim())) {
    throw new Error('Pairing payload is missing a valid wsUrl.');
  }

  const wsUrl = wsUrlValue.trim();
  const name = typeof nameValue === 'string' && nameValue.trim() ? nameValue.trim() : inferDeviceName(wsUrl);
  const httpUrl = typeof input.httpUrl === 'string' && input.httpUrl.trim() ? input.httpUrl.trim() : undefined;
  const token = typeof input.token === 'string' && input.token.trim() ? input.token.trim() : undefined;

  return {
    name,
    wsUrl,
    httpUrl,
    token,
    capabilities: normalizeCapabilities(input.capabilities),
  };
}

function parsePayloadFromUrl(url: URL): PairingPayload | null {
  const payloadValue = url.searchParams.get('payload') ?? url.searchParams.get('data');
  if (payloadValue) {
    return normalizePayload(JSON.parse(decodeMaybeEncodedJson(payloadValue)) as PairingPayloadShape);
  }

  const wsUrl = url.searchParams.get('wsUrl');
  if (!wsUrl) {
    return null;
  }

  return normalizePayload({
    name:
      url.searchParams.get('friendlyName') ??
      url.searchParams.get('name') ??
      url.searchParams.get('deviceName') ??
      undefined,
    wsUrl,
    httpUrl: url.searchParams.get('httpUrl') ?? undefined,
    token: url.searchParams.get('token') ?? undefined,
    capabilities: url.searchParams.get('capabilities') ?? undefined,
  });
}

async function fetchPairingPayload(endpoint: string): Promise<PairingPayload> {
  const response = await fetch(endpoint, { headers: { 'ngrok-skip-browser-warning': '1' } });
  if (!response.ok) {
    throw new Error(`Pairing endpoint returned ${response.status}.`);
  }

  const json = (await response.json()) as Record<string, unknown>;

  // Handle the relay server's native pairing payload format.
  if (json.schema === 'juno-relay-pairing.v1') {
    const connection = json.connection as
      | { preferred?: { wsUrl?: string; httpBaseUrl?: string } }
      | undefined;
    return normalizePayload({
      name: json.serverName,
      wsUrl: connection?.preferred?.wsUrl,
      httpUrl: connection?.preferred?.httpBaseUrl,
      capabilities: json.capabilities,
    });
  }

  return normalizePayload(json as PairingPayloadShape);
}

export async function parsePairingScan(rawValue: string): Promise<PairingPayload> {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    throw new Error('Scanned QR code is empty.');
  }

  if (trimmed.startsWith('{')) {
    return normalizePayload(JSON.parse(trimmed) as PairingPayloadShape);
  }

  if (/^wss?:\/\//i.test(trimmed)) {
    return normalizePayload({
      name: inferDeviceName(trimmed),
      wsUrl: trimmed,
    });
  }

  try {
    const url = new URL(trimmed);
    const embeddedPayload = parsePayloadFromUrl(url);
    if (embeddedPayload) {
      return embeddedPayload;
    }

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return fetchPairingPayload(trimmed);
    }
  } catch {
    // Ignore invalid URLs and continue to the generic JSON decode fallback below.
  }

  try {
    return normalizePayload(JSON.parse(decodeMaybeEncodedJson(trimmed)) as PairingPayloadShape);
  } catch {
    throw new Error('QR payload must be JSON, a Juno pairing link, or a pairing endpoint URL.');
  }
}

export function buildWebSocketConnectionUrl(wsUrl: string, token?: string): string {
  if (!token) {
    return wsUrl;
  }

  try {
    const url = new URL(wsUrl);
    if (!url.searchParams.has('token')) {
      url.searchParams.set('token', token);
    }
    return url.toString();
  } catch {
    return wsUrl;
  }
}
