/**
 * Owns the app's current download-location setting: in-memory state plus
 * persistence (via downloadLocationStore.ts) — same shape as
 * session/SessionManager.ts. Deliberately not a React Context, for the same
 * reason SessionManager isn't one: the download pipeline
 * (files/downloadExistence.ts, streaming/blobUtil.ts) needs to read the
 * current setting synchronously from plain (non-component) async
 * functions, not just from React components.
 *
 * getLocation() returns `{ mode: 'default' }` until restore() completes —
 * the same safe fallback the setting would have if it had never been
 * changed, so a download started in the (practically instantaneous)
 * window before App.tsx's boot-time restore() resolves still behaves
 * exactly like pre-P14.3 Relay rather than reading an unloaded value.
 */
import { readDownloadLocation, writeDownloadLocation } from './downloadLocationStore';
import { DownloadLocation } from './types';

type Listener = () => void;

const DEFAULT_LOCATION: DownloadLocation = { mode: 'default' };

let current: DownloadLocation = DEFAULT_LOCATION;
let restored = false;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach(listener => listener());
}

export const DownloadLocationManager = {
  /** Loads the persisted setting into memory. Call once at app startup (see App.tsx). */
  async restore(): Promise<DownloadLocation> {
    current = await readDownloadLocation();
    restored = true;
    notify();
    return current;
  },

  /** False until restore() completes. */
  isRestored(): boolean {
    return restored;
  },

  getLocation(): DownloadLocation {
    return current;
  },

  /** Persists a newly chosen location and makes it the active one. */
  async setLocation(location: DownloadLocation): Promise<void> {
    await writeDownloadLocation(location);
    current = location;
    notify();
  },

  /** Resets to the default location (public Downloads/Relay). */
  async resetToDefault(): Promise<void> {
    await DownloadLocationManager.setLocation(DEFAULT_LOCATION);
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
