import { useSyncExternalStore } from 'react';
import { DownloadLocationManager } from './DownloadLocationManager';

/** Reactive view of DownloadLocationManager, for the Settings screen. */
export function useDownloadLocation() {
  const location = useSyncExternalStore(DownloadLocationManager.subscribe, DownloadLocationManager.getLocation);
  const isRestored = useSyncExternalStore(DownloadLocationManager.subscribe, DownloadLocationManager.isRestored);
  return { location, isRestored };
}
