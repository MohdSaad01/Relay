/**
 * Thin wrapper around @supersami/rn-foreground-service. Keeps the JS runtime
 * alive (not throttled by Android's background execution limits) for the
 * duration of an active transfer, per the approved M15 design's
 * "Background/foreground lifecycle" section: started the moment a stream
 * begins, stopped once it reaches a terminal state.
 *
 * `icon: 'ic_launcher'` is passed explicitly — the library's own default,
 * `ic_notification`, is not a drawable this project ships, and an unresolved
 * icon resource would crash the notification at runtime.
 */

import ReactNativeForegroundService from '@supersami/rn-foreground-service';

const NOTIFICATION_ID = 1;

// Must run at module load, not inside a component (library requirement).
ReactNativeForegroundService.register({
  config: {
    alert: false,
    onServiceErrorCallBack: () => {
      console.warn('Foreground service failed to start.');
    },
  },
});

function buildNotification(fileName: string, progress: number) {
  return {
    id: NOTIFICATION_ID,
    title: 'Relay',
    message: `Transferring ${fileName} — ${Math.round(progress * 100)}%`,
    icon: 'ic_launcher',
    ServiceType: 'dataSync',
    importance: 'low',
    setOnlyAlertOnce: 'true',
    progress: { max: 100, curr: Math.round(progress * 100) },
  };
}

export async function startTransferNotification(fileName: string, progress: number): Promise<void> {
  await ReactNativeForegroundService.start(buildNotification(fileName, progress));
}

export async function updateTransferNotification(fileName: string, progress: number): Promise<void> {
  await ReactNativeForegroundService.update(buildNotification(fileName, progress));
}

export async function stopTransferNotification(): Promise<void> {
  await ReactNativeForegroundService.stop();
}
