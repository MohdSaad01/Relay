import { useSyncExternalStore } from 'react';
import { DiscoveryService } from './DiscoveryService';

/** Reactive view of DiscoveryService's currently-known desktops, for DiscoveryScreen. */
export function useDiscovery() {
  const desktops = useSyncExternalStore(
    DiscoveryService.subscribe,
    DiscoveryService.getDiscoveredDesktops,
  );
  return { desktops };
}
