/**
 * Owns the app's single current Session: in-memory state, persistence
 * (via secureStorage.ts), and keeping api/config.ts in sync so every
 * endpoint call automatically targets the right desktop with the right
 * bearer token, without each call site touching storage itself.
 *
 * Deliberately not a React Context — this holds no UI, just state plus a
 * plain subscribe/notify list, so it can be driven from non-component code
 * (e.g. an interceptor that clears the session on a 401) as easily as from
 * a screen. src/session/useSession.ts is the thin hook that exposes this to
 * React components that need to re-render on session changes.
 */

import { clearApiConfig, setApiConfig } from '../api/config';
import { setUnauthorizedHandler } from '../api/client';
import { clearSession as clearStoredSession, loadSession, saveSession } from './secureStorage';
import { Session } from './types';

type Listener = () => void;

let currentSession: Session | null = null;
let restored = false;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach(listener => listener());
}

function applyToApiConfig(session: Session | null): void {
  if (session) {
    setApiConfig({ baseUrl: session.desktop_base_url, sessionToken: session.session_token });
  } else {
    clearApiConfig();
  }
}

export const SessionManager = {
  /**
   * Loads any persisted session into memory and api/config. Call once at
   * app startup (see App.tsx) before anything reads getSession()/isRestored().
   */
  async restore(): Promise<Session | null> {
    const session = await loadSession();
    currentSession = session;
    applyToApiConfig(session);
    restored = true;
    notify();
    return session;
  },

  /** False until restore() completes — lets callers distinguish "still loading" from "no session". */
  isRestored(): boolean {
    return restored;
  },

  getSession(): Session | null {
    return currentSession;
  },

  /** Persists a newly established session (post-pairing) and makes it the active one. */
  async setSession(session: Session): Promise<void> {
    await saveSession(session);
    currentSession = session;
    applyToApiConfig(session);
    notify();
  },

  /**
   * Updates just the display name on the current session and persists it —
   * called after a successful `PATCH /devices/{id}` (P23's Settings screen
   * rename), never before. Throws if there is no current session; the
   * Settings screen only offers renaming once paired, so this should be
   * unreachable otherwise.
   */
  async updateDeviceName(deviceName: string): Promise<void> {
    if (!currentSession) {
      throw new Error('updateDeviceName called with no active session.');
    }
    const updated: Session = { ...currentSession, device_name: deviceName };
    await saveSession(updated);
    currentSession = updated;
    notify();
  },

  /** Clears the session everywhere: secure storage, memory, and api/config. Used on explicit "forget" or a 401. */
  async clearSession(): Promise<void> {
    await clearStoredSession();
    currentSession = null;
    applyToApiConfig(null);
    notify();
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

// There is no session-renewal endpoint (secure session storage milestone) —
// any 401, from any request, means the session is dead and it's back to
// pairing. Registered here, not in api/client.ts, so client.ts stays
// unaware of SessionManager entirely.
setUnauthorizedHandler(() => SessionManager.clearSession());
