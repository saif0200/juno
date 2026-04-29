import { FILE_REQUEST_TIMEOUT_MS } from './constants';
import type { ManagedTab } from './types';

export function trackFileRequest<TResponse extends { type: string; requestId: string }>(
  tab: ManagedTab,
  requestId: string,
): Promise<TResponse> {
  return new Promise<TResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      tab.pendingFileRequests.delete(requestId);
      reject(new Error('File request timed out.'));
    }, FILE_REQUEST_TIMEOUT_MS);

    tab.pendingFileRequests.set(requestId, {
      timeout,
      resolve: (value) => resolve(value as TResponse),
      reject,
    });
  });
}

export function resolveFileRequest(
  tab: ManagedTab,
  requestId: string,
  value: unknown,
): boolean {
  const pending = tab.pendingFileRequests.get(requestId);
  if (!pending) return false;

  clearTimeout(pending.timeout);
  tab.pendingFileRequests.delete(requestId);
  pending.resolve(value);
  return true;
}

export function rejectFileRequest(
  tab: ManagedTab,
  requestId: string,
  error: Error,
): boolean {
  const pending = tab.pendingFileRequests.get(requestId);
  if (!pending) return false;

  clearTimeout(pending.timeout);
  tab.pendingFileRequests.delete(requestId);
  pending.reject(error);
  return true;
}

export function rejectAllPendingFileRequests(tab: ManagedTab, reason: string): void {
  for (const [requestId, pending] of tab.pendingFileRequests) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(reason));
    tab.pendingFileRequests.delete(requestId);
  }
}
