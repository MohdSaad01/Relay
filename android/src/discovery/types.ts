/**
 * Mirrors backend/app/schemas/discovery.py's DiscoveryAnnouncePayload — the
 * JSON broadcast over UDP, not an HTTP schema, so it lives here rather than
 * in src/api/types.ts (which is HTTP-contract types only).
 */
export interface DiscoveryAnnouncePayload {
  type: 'relay_discovery_announce';
  protocol_version: number;
  relay_version: string;
  instance_id: string;
  device_display_name: string;
  desktop_ip: string;
  port: number;
}

/** A desktop currently believed to be broadcasting, tracked client-side only. */
export interface DiscoveredDesktop {
  instanceId: string;
  displayName: string;
  desktopIp: string;
  port: number;
  protocolVersion: number;
  relayVersion: string;
  /** Date.now() of the last announcement seen from this instance_id — drives staleness eviction. */
  lastSeenAt: number;
}
