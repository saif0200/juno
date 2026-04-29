import os from 'os';
import type { Request } from 'express';

import { PORT, PUBLIC_URL, SERVER_ID, SERVER_NAME } from './config';
import { getProjects } from './state';
import type { PairingConnectionCandidate, PairingPayload } from './types';

function formatHostForUrl(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

export function buildBaseUrls(host: string): { httpBaseUrl: string; wsBaseUrl: string } {
  const formattedHost = formatHostForUrl(host);
  return {
    httpBaseUrl: `http://${formattedHost}:${PORT}`,
    wsBaseUrl: `ws://${formattedHost}:${PORT}`,
  };
}

function buildBaseUrlsFromRequest(
  address: string,
  request: Request,
): { httpBaseUrl: string; wsBaseUrl: string } {
  if (PUBLIC_URL) {
    const u = new URL(PUBLIC_URL);
    return {
      httpBaseUrl: PUBLIC_URL,
      wsBaseUrl: `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}`,
    };
  }

  if (request.get('x-forwarded-proto') === 'https') {
    const formattedHost = formatHostForUrl(address);
    return {
      httpBaseUrl: `https://${formattedHost}`,
      wsBaseUrl: `wss://${formattedHost}`,
    };
  }

  return buildBaseUrls(address);
}

function stripPortFromHostHeader(hostHeader: string): string {
  if (hostHeader.startsWith('[')) {
    const endIndex = hostHeader.indexOf(']');
    return endIndex >= 0 ? hostHeader.slice(1, endIndex) : hostHeader;
  }
  const [hostname] = hostHeader.split(':');
  return hostname ?? hostHeader;
}

function guessAddressFamily(host: string): 'IPv4' | 'IPv6' {
  return host.includes(':') ? 'IPv6' : 'IPv4';
}

function createConnectionCandidate(
  interfaceName: string,
  address: string,
  family: 'IPv4' | 'IPv6',
  isInternal: boolean,
): PairingConnectionCandidate {
  const { httpBaseUrl, wsBaseUrl } = buildBaseUrls(address);
  return {
    interfaceName,
    family,
    address,
    isInternal,
    isPreferred: false,
    httpBaseUrl,
    wsBaseUrl,
    pairingUrl: `${httpBaseUrl}/pairing`,
    dashboardUrl: `${httpBaseUrl}/dashboard`,
    healthUrl: `${httpBaseUrl}/health`,
    wsUrl: wsBaseUrl,
  };
}

export function collectConnectionCandidates(): PairingConnectionCandidate[] {
  const seen = new Set<string>();
  const candidates: PairingConnectionCandidate[] = [];
  const interfaces = os.networkInterfaces();

  for (const [interfaceName, addresses] of Object.entries(interfaces)) {
    if (!addresses) continue;

    for (const addressInfo of addresses) {
      if (addressInfo.family !== 'IPv4' && addressInfo.family !== 'IPv6') continue;

      const key = `${addressInfo.family}:${addressInfo.address}`;
      if (seen.has(key)) continue;

      seen.add(key);
      candidates.push(
        createConnectionCandidate(
          interfaceName,
          addressInfo.address,
          addressInfo.family,
          addressInfo.internal,
        ),
      );
    }
  }

  if (!seen.has('IPv4:127.0.0.1')) {
    candidates.push(createConnectionCandidate('loopback', '127.0.0.1', 'IPv4', true));
  }

  if (!seen.has('IPv4:localhost')) {
    candidates.push(createConnectionCandidate('loopback-hostname', 'localhost', 'IPv4', true));
  }

  return candidates.sort((left, right) => {
    if (left.isInternal !== right.isInternal) return left.isInternal ? 1 : -1;
    if (left.family !== right.family) return left.family === 'IPv4' ? -1 : 1;
    return left.interfaceName.localeCompare(right.interfaceName);
  });
}

function pickPreferredCandidate(
  request: Request,
  candidates: PairingConnectionCandidate[],
): PairingConnectionCandidate {
  if (PUBLIC_URL) {
    const u = new URL(PUBLIC_URL);
    const wsProto = u.protocol === 'https:' ? 'wss' : 'ws';
    const wsBaseUrl = `${wsProto}://${u.host}`;
    return {
      interfaceName: 'public-url',
      family: 'IPv4',
      address: u.hostname,
      isInternal: false,
      isPreferred: true,
      httpBaseUrl: PUBLIC_URL,
      wsBaseUrl,
      pairingUrl: `${PUBLIC_URL}/pairing`,
      dashboardUrl: `${PUBLIC_URL}/dashboard`,
      healthUrl: `${PUBLIC_URL}/health`,
      wsUrl: wsBaseUrl,
    };
  }

  const fallbackCandidate =
    candidates[0] ?? createConnectionCandidate('loopback', '127.0.0.1', 'IPv4', true);
  const hostHeader = request.get('host');
  const requestedHost = hostHeader ? stripPortFromHostHeader(hostHeader) : null;

  if (requestedHost && requestedHost.length > 0) {
    const matchingCandidate = candidates.find((candidate) => candidate.address === requestedHost);
    if (matchingCandidate) return matchingCandidate;

    const { httpBaseUrl, wsBaseUrl } = buildBaseUrlsFromRequest(requestedHost, request);
    const isInternal =
      requestedHost === 'localhost' || requestedHost === '127.0.0.1' || requestedHost === '::1';
    return {
      interfaceName: 'requested-host',
      family: guessAddressFamily(requestedHost),
      address: requestedHost,
      isInternal,
      isPreferred: false,
      httpBaseUrl,
      wsBaseUrl,
      pairingUrl: `${httpBaseUrl}/pairing`,
      dashboardUrl: `${httpBaseUrl}/dashboard`,
      healthUrl: `${httpBaseUrl}/health`,
      wsUrl: wsBaseUrl,
    };
  }

  return (
    candidates.find((candidate) => !candidate.isInternal && candidate.family === 'IPv4') ??
    candidates.find((candidate) => !candidate.isInternal) ??
    fallbackCandidate
  );
}

export function createPairingPayload(request: Request): PairingPayload {
  const candidates = collectConnectionCandidates();
  const preferred = pickPreferredCandidate(request, candidates);
  const preferredAddressKey = `${preferred.family}:${preferred.address}`;
  const preferredCandidates = candidates.map((candidate) => ({
    ...candidate,
    isPreferred: `${candidate.family}:${candidate.address}` === preferredAddressKey,
  }));
  const resolvedPreferred =
    preferredCandidates.find((candidate) => candidate.isPreferred) ?? {
      ...preferred,
      isPreferred: true,
    };

  return {
    schema: 'juno-relay-pairing.v1',
    generatedAt: new Date().toISOString(),
    serverId: SERVER_ID,
    serverName: SERVER_NAME,
    relayVersion: 1,
    transport: {
      port: PORT,
      websocketPath: '/',
      pairingPath: '/pairing',
      dashboardPath: '/dashboard',
      healthPath: '/health',
      manualWebSocketEntrySupported: true,
    },
    connection: {
      preferred: resolvedPreferred,
      candidates: preferredCandidates,
    },
    projects: getProjects().map(({ id, name }) => ({ id, name })),
    capabilities: {
      sessionReconnect: true,
      projectListing: true,
      pairingDashboard: true,
    },
    qr: {
      format: 'pairing_url',
      value: resolvedPreferred.pairingUrl,
    },
  };
}
