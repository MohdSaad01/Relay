import { Linking } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import notifee, { EventType } from '@notifee/react-native';
import {
  __resetNotificationChannelForTests,
  notifyDownloadComplete,
  notifyFolderDownloadComplete,
} from '../../src/streaming/downloadNotification';

const mockCreateChannel = notifee.createChannel as jest.Mock;
const mockDisplayNotification = notifee.displayNotification as jest.Mock;
const mockOnForegroundEvent = notifee.onForegroundEvent as jest.Mock;
const mockOnBackgroundEvent = notifee.onBackgroundEvent as jest.Mock;

// Captured once, right after downloadNotification.ts is imported above --
// it registers these handlers exactly once at module load, not per
// notifyDownloadComplete() call, so they must be grabbed before any test's
// jest.clearAllMocks() wipes the mocks' recorded call history.
const foregroundHandler = mockOnForegroundEvent.mock.calls[0][0] as (event: {
  type: EventType;
  detail: unknown;
}) => void;
const backgroundHandler = mockOnBackgroundEvent.mock.calls[0][0] as (event: {
  type: EventType;
  detail: unknown;
}) => Promise<void>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  // ensureChannel()'s cache is module-level state that would otherwise leak
  // between tests in this file (it persists for as long as the module stays
  // loaded, same as it would for a real app session) -- reset it so every
  // test starts from "channel not yet created".
  __resetNotificationChannelForTests();
});

test('a failed channel creation is retried on the next call, not cached forever', async () => {
  // Regression test: ensureChannel() used to cache the *rejected* promise
  // from a failed createChannel() call, so one transient failure permanently
  // disabled every future notification for the rest of the app session.
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  mockCreateChannel.mockRejectedValueOnce(new Error('boom'));

  await notifyDownloadComplete('first.pdf', null);
  expect(mockDisplayNotification).not.toHaveBeenCalled();

  await notifyDownloadComplete('second.pdf', null);

  expect(mockCreateChannel).toHaveBeenCalledTimes(2);
  expect(mockDisplayNotification).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining('second.pdf') }));
  warnSpy.mockRestore();
});

test('notifyDownloadComplete creates the channel once and displays a completion notification', async () => {
  await notifyDownloadComplete('report.pdf', 'content://media/downloads/1');
  await notifyDownloadComplete('other.pdf', null);

  expect(mockCreateChannel).toHaveBeenCalledTimes(1);
  expect(mockCreateChannel).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'relay-downloads', name: 'Relay Downloads' }),
  );
});

// Regression test for Milestone P8.1: notifee plays no sound at all unless a
// channel explicitly opts in ("The default value is to play no sound. To
// play the default system sound use 'default'." -- notifee's own
// NotificationAndroid.d.ts) -- confirmed on a physical device via `adb shell
// dumpsys notification` showing the channel's mSound as null. See
// docs/15_QA_NOTEBOOK.md's Milestone P8.1 entry.
test('the download-complete channel is created with the default system sound', async () => {
  await notifyDownloadComplete('report.pdf', null);

  expect(mockCreateChannel).toHaveBeenCalledWith(expect.objectContaining({ sound: 'default' }));
});

test('notifyDownloadComplete includes the content URI as data and a press action that opens it', async () => {
  await notifyDownloadComplete('report.pdf', 'content://media/downloads/1');

  expect(mockDisplayNotification).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Relay',
      body: '✓ report.pdf downloaded successfully',
      data: { contentUri: 'content://media/downloads/1' },
      android: expect.objectContaining({
        pressAction: { id: 'open-download' },
      }),
    }),
  );
});

test('notifyDownloadComplete falls back to a plain press action when no content URI is available', async () => {
  await notifyDownloadComplete('report.pdf', null);

  expect(mockDisplayNotification).toHaveBeenCalledWith(
    expect.objectContaining({
      data: undefined,
      android: expect.objectContaining({ pressAction: { id: 'default' } }),
    }),
  );
});

test('pressing the notification opens the content URI via Linking', async () => {
  foregroundHandler({
    type: EventType.PRESS,
    detail: { notification: { data: { contentUri: 'content://media/downloads/1' } } },
  });
  await Promise.resolve();

  expect(Linking.openURL).toHaveBeenCalledWith('content://media/downloads/1');
});

test('pressing the notification without a content URI does not call Linking', async () => {
  foregroundHandler({ type: EventType.PRESS, detail: { notification: { data: {} } } });
  await Promise.resolve();

  expect(Linking.openURL).not.toHaveBeenCalled();
});

test('a non-press event is ignored', async () => {
  foregroundHandler({
    type: 'dismissed' as unknown as EventType,
    detail: { notification: { data: { contentUri: 'content://media/downloads/1' } } },
  });
  await Promise.resolve();

  expect(Linking.openURL).not.toHaveBeenCalled();
});

test('the background event handler also opens the content URI on press', async () => {
  await backgroundHandler({
    type: EventType.PRESS,
    detail: { notification: { data: { contentUri: 'content://media/downloads/1' } } },
  });

  expect(Linking.openURL).toHaveBeenCalledWith('content://media/downloads/1');
});

// P13.1 (Issue 3)
test('notifyFolderDownloadComplete includes the folder URI as data and a press action that opens it', async () => {
  await notifyFolderDownloadComplete('University Notes', 'content://com.android.externalstorage.documents/document/x');

  expect(mockDisplayNotification).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Relay',
      body: '✓ University Notes downloaded successfully',
      data: { folderUri: 'content://com.android.externalstorage.documents/document/x' },
      android: expect.objectContaining({
        pressAction: { id: 'open-download-folder' },
      }),
    }),
  );
});

test('notifyFolderDownloadComplete falls back to a plain press action when no folder URI is available', async () => {
  await notifyFolderDownloadComplete('University Notes', null);

  expect(mockDisplayNotification).toHaveBeenCalledWith(
    expect.objectContaining({
      data: undefined,
      android: expect.objectContaining({ pressAction: { id: 'default' } }),
    }),
  );
});

test('pressing a folder notification opens the folder via actionViewIntent with the directory MIME type, not Linking', async () => {
  foregroundHandler({
    type: EventType.PRESS,
    detail: { notification: { data: { folderUri: 'content://com.android.externalstorage.documents/document/x' } } },
  });
  await Promise.resolve();

  expect(ReactNativeBlobUtil.android.actionViewIntent).toHaveBeenCalledWith(
    'content://com.android.externalstorage.documents/document/x',
    'vnd.android.document/directory',
    undefined,
  );
  expect(Linking.openURL).not.toHaveBeenCalled();
});

test('a file notification\'s contentUri still wins over Linking and never touches actionViewIntent', async () => {
  foregroundHandler({
    type: EventType.PRESS,
    detail: { notification: { data: { contentUri: 'content://media/downloads/1' } } },
  });
  await Promise.resolve();

  expect(Linking.openURL).toHaveBeenCalledWith('content://media/downloads/1');
  expect(ReactNativeBlobUtil.android.actionViewIntent).not.toHaveBeenCalled();
});

test('notifyDownloadComplete swallows a displayNotification failure instead of throwing', async () => {
  // Regression test: notifyDownloadComplete used to be awaited unguarded by
  // TransferStreamManager.start() -- any failure here (a denied
  // POST_NOTIFICATIONS permission, a native-bridge error, etc.) propagated
  // up and flipped an otherwise-successful download to 'failed'. This
  // asymmetry with publishDownload's own best-effort contract (blobUtil.ts)
  // was the bug; notifyDownloadComplete must never reject.
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  mockDisplayNotification.mockRejectedValueOnce(new Error('boom'));

  await expect(notifyDownloadComplete('report.pdf', null)).resolves.toBeUndefined();

  expect(warnSpy).toHaveBeenCalled();
  warnSpy.mockRestore();
});
