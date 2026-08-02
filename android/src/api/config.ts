/**
 * In-memory API configuration: which desktop to talk to, and the bearer
 * token to authenticate as.
 *
 * Deliberately not persisted here — that is the secure session storage
 * milestone's job (react-native-keychain). This module just holds whatever
 * that milestone (or the pairing flow) has loaded into memory for the
 * current app session, and lets the API client read it without every
 * endpoint module needing to know where it came from.
 */

export interface ApiConfig {
  /** e.g. "http://192.168.1.23:8000/api/v1" — set once pairing succeeds. */
  baseUrl: string | null;
  /** DeviceSession bearer token. Absent for the pairing endpoints, which are unauthenticated. */
  sessionToken: string | null;
}

let config: ApiConfig = { baseUrl: null, sessionToken: null };

export function getApiConfig(): ApiConfig {
  return config;
}

export function setApiConfig(next: Partial<ApiConfig>): void {
  config = { ...config, ...next };
}

/** Used when the session is forgotten (user action or a 401) — see docs on session storage milestone. */
export function clearApiConfig(): void {
  config = { baseUrl: null, sessionToken: null };
}
