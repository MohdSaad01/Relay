/**
 * Thin fetch wrapper around the backend's ApiResponse envelope
 * ({ success, message, data }) — mirrors desktop/src/renderer/api/client.js,
 * extended for two things the desktop client doesn't need: a configurable
 * base URL (Android is never the loopback-trusted caller, so there's no
 * fixed backend address) and a bearer session token attached automatically
 * when one is configured (see ./config.ts).
 *
 * Streaming (GET /transfers/{id}/download, POST /transfers/{id}/upload) is
 * deliberately not handled here — the backend's upload route consumes a raw
 * request-body stream, not JSON, and reading a large response into memory
 * via this wrapper would defeat the point. Those two calls belong to the
 * transfer-streaming milestone (react-native-blob-util), not this client.
 */

import { getApiConfig } from './config';
import { ApiResponse } from './types';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Bounds how long a request waits for a TCP connection/response before
 * giving up. Without this, an unreachable desktop (backend down, wrong
 * network, firewall silently dropping the connection) left fetch() hanging
 * until the OS's own connection timeout — observed as a multi-minute
 * apparent freeze before "Network request failed" ever surfaced. 10s is
 * generous for a LAN request; a real desktop on the same network responds
 * in well under a second.
 */
const REQUEST_TIMEOUT_MS = 10_000;

const UNREACHABLE_MESSAGE =
  'Unable to reach Relay Desktop. Make sure the PC is running Relay and both devices are on the same network.';

type UnauthorizedListener = () => void | Promise<void>;
let unauthorizedListener: UnauthorizedListener | null = null;

/**
 * Registered once by SessionManager so any 401 from any request clears the
 * session automatically — there is no renewal endpoint (secure session
 * storage milestone), so an expired/invalid session always means back to
 * pairing. Kept generic here rather than importing SessionManager directly,
 * so the dependency runs one way: session/ depends on api/, never the
 * reverse.
 */
export function setUnauthorizedHandler(listener: UnauthorizedListener | null): void {
  unauthorizedListener = listener;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  baseUrlOverride?: string,
): Promise<T> {
  const baseUrl = baseUrlOverride ?? getApiConfig().baseUrl;
  if (!baseUrl) {
    throw new ApiError('No backend configured for this request.', 0);
  }

  const headers: Record<string, string> = {};
  const { sessionToken } = getApiConfig();
  if (sessionToken) {
    headers.Authorization = `Bearer ${sessionToken}`;
  }

  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  // Built from AbortController rather than the newer AbortSignal.timeout()
  // static — React Native polyfills AbortController/AbortSignal via the
  // `abort-controller` package (see setUpXHR.js), which does not implement
  // that static method; calling it would throw on-device even though it
  // passes under Jest's Node environment.
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, signal: timeoutController.signal });
  } catch {
    // Every fetch failure — a genuine connection failure, a DNS failure, or
    // the timeout above firing (surfaced as AbortError) — reduces to the
    // same outcome for the caller: the desktop wasn't reachable. None of
    // those raw errors (e.g. "TypeError: Network request failed" or
    // "AbortError: Aborted") mean anything to a non-technical user, so
    // they're intentionally not logged or repeated verbatim here; this
    // ApiError is the real, fully-handled propagation of the failure.
    throw new ApiError(UNREACHABLE_MESSAGE, 0);
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const envelope = (await response.json()) as ApiResponse<T>;
  if (!response.ok || envelope.success === false) {
    if (response.status === 401) {
      // Awaited so callers observing the thrown ApiError are guaranteed to
      // already see the cleared session, not a stale one.
      await unauthorizedListener?.();
    }
    throw new ApiError(envelope.message || `Request failed (${response.status}).`, response.status);
  }
  return envelope.data;
}

export const apiClient = {
  get: <T>(path: string, baseUrlOverride?: string) => request<T>('GET', path, undefined, baseUrlOverride),
  post: <T>(path: string, body?: unknown, baseUrlOverride?: string) =>
    request<T>('POST', path, body ?? {}, baseUrlOverride),
  patch: <T>(path: string, body?: unknown, baseUrlOverride?: string) =>
    request<T>('PATCH', path, body ?? {}, baseUrlOverride),
  del: <T>(path: string, baseUrlOverride?: string) => request<T>('DELETE', path, undefined, baseUrlOverride),
};
