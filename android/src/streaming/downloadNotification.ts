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
      // notifee's own default is to play no sound at all unless a channel
      // explicitly opts in (see docs/15_QA_NOTEBOOK.md's Milestone P8.1
      // entry) — 'default' plays the system's default notification sound.
      .createChannel({ id: CHANNEL_ID, name: 'Relay Downloads', importance: AndroidImportance.DEFAULT, sound: 'default' })
      .then(() => undefined)
      .catch(err => {
        // Don't let one failed attempt (e.g. a transient native-bridge
        // error) permanently disable this channel for the rest of the app
        // session -- without this, `channelReady` would cache the rejected
        // promise forever, and every later notifyDownloadComplete() call
        // would keep failing the exact same way with no chance to recover.
        channelReady = null;
        throw err;
      });
  }
  return channelReady;
}

/**
 * Test-only: resets the module-level channel cache so each test can start
 * from "channel not yet created" instead of leaking state left behind by
 * whichever earlier test in the same file happened to run first.
 */
export function __resetNotificationChannelForTests(): void {
  channelReady = null;
}

/**
 * Shows "✓ <fileName> downloaded successfully". When `contentUri` is
 * available (publishDownload succeeded, API 29+), tapping the notification
 * opens that file directly; otherwise tapping it just opens the app, since
 * there's no shareable URI to hand to another app's viewer (e.g. below API
 * 29, or the pre-API-29 fallback path).
 *
 * Deliberately best-effort, matching publishDownload's own contract in
 * blobUtil.ts: this runs only after a transfer's bytes have already fully
 * arrived, so a failure here (channel creation, the notification post
 * itself, or a denied POST_NOTIFICATIONS permission causing Android to drop
 * the post silently) must never turn an otherwise-successful download into
 * a reported failure. Before this, TransferStreamManager.start() awaited
 * this call unguarded -- any thrown error here was caught by start()'s own
 * try/catch and flipped the transfer to 'failed', even though the file had
 * already been saved correctly.
 */
export async function notifyDownloadComplete(fileName: string, contentUri: string | null): Promise<void> {
  try {
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
  } catch (err) {
    console.warn('Could not show the download-complete notification.', err);
  }
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
