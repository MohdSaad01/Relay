/**
 * Owns automatic desktop detection: starts/stops the UDP listener, validates
 * and de-dupes incoming DiscoveryAnnouncePayload broadcasts by instance_id,
 * and evicts entries nothing has been heard from in a while.
 *
 * Purely a UX convenience, matching backend/README.md's own framing of
 * DiscoveryService — pairing itself never depends on this (the QR payload
 * carries everything needed on its own). A failure here is logged and
 * swallowed, never thrown, for the same reason.
 *
 * Same plain-module, subscribe/notify shape as SessionManager, for the same
 * reason: this needs to be usable from a screen's focus effect without
 * being a React Context itself.
 */

import { startUdpListener, UdpListenerHandle } from './udpListener';
import { DiscoveredDesktop, DiscoveryAnnouncePayload } from './types';

// Must match backend Settings.DISCOVERY_PORT (docs/09_Networking.md §4, ADR-010).
const DISCOVERY_PORT = 40890;
const EXPECTED_TYPE = 'relay_discovery_announce';

// The backend broadcasts every DISCOVERY_BROADCAST_INTERVAL_SECONDS (2s
// default) — tolerate a few missed beats before dropping an entry, so one
// lost packet doesn't flap the list.
const STALE_AFTER_MS = 8_000;
const EVICTION_INTERVAL_MS = 2_000;

type Listener = () => void;

let listenerHandle: UdpListenerHandle | null = null;
let evictionTimer: ReturnType<typeof setInterval> | null = null;
const discovered = new Map<string, DiscoveredDesktop>();
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach(listener => listener());
}

function isAnnouncePayload(value: unknown): value is DiscoveryAnnouncePayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return (
    payload.type === EXPECTED_TYPE &&
    typeof payload.instance_id === 'string' &&
    typeof payload.device_display_name === 'string' &&
    typeof payload.desktop_ip === 'string' &&
    typeof payload.port === 'number' &&
    typeof payload.protocol_version === 'number' &&
    typeof payload.relay_version === 'string'
  );
}

function handleMessage(data: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return; // not JSON — ignore rather than crash a best-effort convenience feature
  }

  if (!isAnnouncePayload(parsed)) {
    return;
  }

  discovered.set(parsed.instance_id, {
    instanceId: parsed.instance_id,
    displayName: parsed.device_display_name,
    desktopIp: parsed.desktop_ip,
    port: parsed.port,
    protocolVersion: parsed.protocol_version,
    relayVersion: parsed.relay_version,
    lastSeenAt: Date.now(),
  });
  notify();
}

function evictStale(): void {
  const cutoff = Date.now() - STALE_AFTER_MS;
  let changed = false;
  for (const [instanceId, desktop] of discovered) {
    if (desktop.lastSeenAt < cutoff) {
      discovered.delete(instanceId);
      changed = true;
    }
  }
  if (changed) {
    notify();
  }
}

export const DiscoveryService = {
  /** Starts listening for broadcasts. A no-op if already listening. */
  start(): void {
    if (listenerHandle) {
      return;
    }
    discovered.clear();
    listenerHandle = startUdpListener(DISCOVERY_PORT, handleMessage, err => {
      console.warn('Discovery listener error:', err);
    });
    evictionTimer = setInterval(evictStale, EVICTION_INTERVAL_MS);
    notify();
  },

  /** Stops listening and clears the discovered list. */
  stop(): void {
    listenerHandle?.stop();
    listenerHandle = null;
    if (evictionTimer) {
      clearInterval(evictionTimer);
      evictionTimer = null;
    }
    discovered.clear();
    notify();
  },

  isListening(): boolean {
    return listenerHandle !== null;
  },

  getDiscoveredDesktops(): DiscoveredDesktop[] {
    return Array.from(discovered.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
