/**
 * A standalone "download complete" notification, distinct from
 * foregroundService.ts's transfer-progress notification. That one is tied to
 * the transfer's foreground service and disappears the moment the service
 * stops (stopTransferNotification(), called right after this fires) — it
 * cannot linger afterward or carry a real tap-to-open action, so a separate
 * library (notifee) owns this one notification instead of stretching
 * @supersami/rn-foreground-service beyond what it's built for.
 */

import { Linking } from 'react-native';
import notifee, { AndroidImportance, EventType } from '@notifee/react-native';

const CHANNEL_ID = 'relay-downloads';
const OPEN_DOWNLOAD_ACTION = 'open-download';

let channelReady: Promise<void> | null = null;

function ensureChannel(): Promise<void> {
  if (!channelReady) {
    channelReady = notifee
      .createChannel({ id: CHANNEL_ID, name: 'Relay Downloads', importance: AndroidImportance.DEFAULT })
      .then(() => undefined);
  }
  return channelReady;
}

/**
 * Shows "✓ <fileName> downloaded successfully". When `contentUri` is
 * available (publishDownload succeeded, API 29+), tapping the notification
 * opens that file directly; otherwise tapping it just opens the app, since
 * there's no shareable URI to hand to another app's viewer (e.g. below API
 * 29, or the pre-API-29 fallback path).
 */
export async function notifyDownloadComplete(fileName: string, contentUri: string | null): Promise<void> {
  await ensureChannel();
  await notifee.displayNotification({
    title: 'Relay',
    body: `✓ ${fileName} downloaded successfully`,
    data: contentUri ? { contentUri } : undefined,
    android: {
      channelId: CHANNEL_ID,
      smallIcon: 'ic_launcher',
      pressAction: { id: contentUri ? OPEN_DOWNLOAD_ACTION : 'default' },
    },
  });
}

async function handlePress(detail: { notification?: { data?: Record<string, unknown> } }): Promise<void> {
  const contentUri = detail.notification?.data?.contentUri;
  if (typeof contentUri === 'string') {
    await Linking.openURL(contentUri).catch(() => undefined);
  }
}

notifee.onForegroundEvent(({ type, detail }) => {
  if (type === EventType.PRESS) {
    handlePress(detail);
  }
});

notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type === EventType.PRESS) {
    await handlePress(detail);
  }
});
