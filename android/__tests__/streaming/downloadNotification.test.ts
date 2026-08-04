import { Linking } from 'react-native';
import notifee, { EventType } from '@notifee/react-native';
import { notifyDownloadComplete } from '../../src/streaming/downloadNotification';

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
});

test('notifyDownloadComplete creates the channel once and displays a completion notification', async () => {
  await notifyDownloadComplete('report.pdf', 'content://media/downloads/1');
  await notifyDownloadComplete('other.pdf', null);

  expect(mockCreateChannel).toHaveBeenCalledTimes(1);
  expect(mockCreateChannel).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'relay-downloads', name: 'Relay Downloads' }),
  );
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
