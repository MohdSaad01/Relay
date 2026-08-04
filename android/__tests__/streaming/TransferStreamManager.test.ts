jest.mock('../../src/streaming/blobUtil');
jest.mock('../../src/streaming/foregroundService');
jest.mock('../../src/streaming/downloadNotification');
jest.mock('../../src/streaming/uploadSourceRegistry');
jest.mock('../../src/api/endpoints/transfers');
jest.mock('../../src/session/SessionManager');

import { TransferStreamManager } from '../../src/streaming/TransferStreamManager';
import { downloadFile, isStreamCancelError, publishDownload, uploadFile } from '../../src/streaming/blobUtil';
import {
  startTransferNotification,
  stopTransferNotification,
} from '../../src/streaming/foregroundService';
import { notifyDownloadComplete } from '../../src/streaming/downloadNotification';
import { getUploadSource } from '../../src/streaming/uploadSourceRegistry';
import { cancelTransfer } from '../../src/api/endpoints/transfers';
import { SessionManager } from '../../src/session/SessionManager';
import { clearApiConfig, setApiConfig } from '../../src/api/config';
import { ApiError } from '../../src/api/client';
import { TransferResponse } from '../../src/api/types';

const mockDownloadFile = downloadFile as jest.Mock;
const mockUploadFile = uploadFile as jest.Mock;
const mockPublishDownload = publishDownload as jest.Mock;
const mockNotifyDownloadComplete = notifyDownloadComplete as jest.Mock;
const mockGetUploadSource = getUploadSource as jest.Mock;
const mockCancelTransfer = cancelTransfer as jest.Mock;
const mockIsStreamCancelError = isStreamCancelError as jest.Mock;

const sendTransfer: TransferResponse = {
  id: 1,
  device_id: 1,
  shared_file_id: 5,
  direction: 'send',
  file_name: 'report.pdf',
  file_size: 1000,
  device_name: 'Pixel 7',
  status: 'in_progress',
  bytes_transferred: 0,
  failure_reason: null,
  started_at: '2026-01-01T00:00:00Z',
  completed_at: null,
};

const receiveTransfer: TransferResponse = { ...sendTransfer, id: 2, direction: 'receive' };

function makeTask(promise: Promise<void>) {
  return { promise, cancel: jest.fn() };
}

/**
 * Same as makeTask(Promise.reject(err)), but pre-attaches a no-op .catch so
 * Node's unhandled-rejection detector never sees a window where the promise
 * has no handler at all — start()'s own `await activeTask.promise` still
 * observes and handles the rejection normally; a settled promise can have
 * any number of .then/.catch handlers attached.
 */
function makeRejectedTask(err: Error) {
  const promise = Promise.reject(err);
  promise.catch(() => undefined);
  return { promise, cancel: jest.fn() };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (predicate()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for condition');
}

beforeEach(() => {
  jest.clearAllMocks();
  // PermissionsAndroid warns "works only for Android platform" under Jest's
  // default (iOS-like) test Platform — expected noise, not a real failure.
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  mockIsStreamCancelError.mockImplementation(
    (err: unknown) => err instanceof Error && err.name === 'ReactNativeBlobUtilCanceledFetch',
  );
  mockPublishDownload.mockResolvedValue(null);
  setApiConfig({ baseUrl: 'http://desktop:8000/api/v1', sessionToken: 'tok' });
});

afterEach(() => {
  jest.restoreAllMocks();
  clearApiConfig();
});

test('start() on a send transfer downloads and reaches "completed"', async () => {
  mockDownloadFile.mockReturnValue(makeTask(Promise.resolve()));

  await TransferStreamManager.start(sendTransfer);

  expect(mockDownloadFile).toHaveBeenCalledWith(
    'http://desktop:8000/api/v1/transfers/1/download',
    { Authorization: 'Bearer tok' },
    expect.stringContaining('report.pdf'),
    expect.any(Function),
  );
  expect(TransferStreamManager.getState()).toMatchObject({
    transferId: 1,
    status: 'completed',
    bytesTransferred: 1000,
  });
  expect(startTransferNotification).toHaveBeenCalled();
  expect(stopTransferNotification).toHaveBeenCalled();
});

test('start() on a send transfer publishes the finished download to public storage before completing', async () => {
  mockDownloadFile.mockReturnValue(makeTask(Promise.resolve()));

  await TransferStreamManager.start({ ...sendTransfer, id: 50 });

  expect(mockPublishDownload).toHaveBeenCalledWith(expect.stringContaining('report.pdf'), 'report.pdf');
});

test('start() on a send transfer shows a download-complete notification with the published content URI', async () => {
  mockDownloadFile.mockReturnValue(makeTask(Promise.resolve()));
  mockPublishDownload.mockResolvedValue('content://media/downloads/1');

  await TransferStreamManager.start({ ...sendTransfer, id: 51 });

  expect(mockNotifyDownloadComplete).toHaveBeenCalledWith('report.pdf', 'content://media/downloads/1');
});

test('start() on a send transfer still shows a completion notification when publishing failed (no content URI)', async () => {
  mockDownloadFile.mockReturnValue(makeTask(Promise.resolve()));
  mockPublishDownload.mockResolvedValue(null);

  await TransferStreamManager.start({ ...sendTransfer, id: 52 });

  expect(mockNotifyDownloadComplete).toHaveBeenCalledWith('report.pdf', null);
});

test('start() on a receive transfer uploads the registered source file', async () => {
  mockGetUploadSource.mockReturnValue({ uri: 'content://picked/report.pdf', name: 'report.pdf', size: 1000 });
  mockUploadFile.mockReturnValue(makeTask(Promise.resolve()));

  await TransferStreamManager.start(receiveTransfer);

  expect(mockUploadFile).toHaveBeenCalledWith(
    'http://desktop:8000/api/v1/transfers/2/upload',
    { Authorization: 'Bearer tok' },
    'content://picked/report.pdf',
    expect.any(Function),
  );
  expect(TransferStreamManager.getState()).toMatchObject({ transferId: 2, status: 'completed' });
  expect(mockPublishDownload).not.toHaveBeenCalled();
  expect(mockNotifyDownloadComplete).not.toHaveBeenCalled();
});

test('start() on a receive transfer with no registered source fails without calling uploadFile', async () => {
  mockGetUploadSource.mockReturnValue(undefined);

  await TransferStreamManager.start({ ...receiveTransfer, id: 3 });

  expect(mockUploadFile).not.toHaveBeenCalled();
  expect(TransferStreamManager.getState()).toMatchObject({ transferId: 3, status: 'failed' });
});

test('start() calls fired back-to-back do not both begin streaming', async () => {
  // Regression test: start() only guarded against a concurrent call via
  // `state`, which wasn't committed until after `await`ing the
  // POST_NOTIFICATIONS permission request — a second start() call fired
  // before that await resolved (e.g. from two TransferProgressDetail
  // screens mounting in quick succession) would pass the guard checks too,
  // and both would begin streaming.
  let resolveFirst: () => void = () => {};
  mockDownloadFile.mockReturnValueOnce(
    makeTask(
      new Promise<void>(resolve => {
        resolveFirst = resolve;
      }),
    ),
  );

  const first = TransferStreamManager.start({ ...sendTransfer, id: 40 });
  const second = TransferStreamManager.start({ ...sendTransfer, id: 41 });

  // second is rejected synchronously, in the same tick as first's guard
  // checks (before first's own first `await` yields back to the event
  // loop) — this doesn't depend on first's continuation ever resuming.
  await second;

  await waitUntil(() => mockDownloadFile.mock.calls.length === 1);
  expect(mockDownloadFile).toHaveBeenCalledTimes(1);
  expect(TransferStreamManager.getState()?.transferId).toBe(40);

  resolveFirst();
  await first;
});

test('start() is a no-op while another transfer is already streaming', async () => {
  let resolveFirst: () => void = () => {};
  mockDownloadFile.mockReturnValueOnce(
    makeTask(
      new Promise<void>(resolve => {
        resolveFirst = resolve;
      }),
    ),
  );

  const firstStart = TransferStreamManager.start({ ...sendTransfer, id: 10 });
  await waitUntil(() => TransferStreamManager.getState()?.status === 'streaming');

  await TransferStreamManager.start({ ...sendTransfer, id: 11 });

  expect(mockDownloadFile).toHaveBeenCalledTimes(1);
  expect(TransferStreamManager.getState()?.transferId).toBe(10);

  resolveFirst();
  await firstStart;
});

test('start() does not restart a transfer that already ran to a terminal result', async () => {
  mockDownloadFile.mockReturnValue(makeTask(Promise.resolve()));

  await TransferStreamManager.start(sendTransfer);
  await TransferStreamManager.start(sendTransfer);

  expect(mockDownloadFile).toHaveBeenCalledTimes(1);
});

test('a stream failure sets status "failed" with the error message', async () => {
  mockDownloadFile.mockReturnValue(makeRejectedTask(new ApiError('The file changed.', 400)));

  await TransferStreamManager.start({ ...sendTransfer, id: 20 });

  expect(TransferStreamManager.getState()).toMatchObject({
    transferId: 20,
    status: 'failed',
    error: 'The file changed.',
  });
});

test('a 401 during streaming clears the session', async () => {
  mockDownloadFile.mockReturnValue(makeRejectedTask(new ApiError('Your session has expired.', 401)));

  await TransferStreamManager.start({ ...sendTransfer, id: 21 });

  expect(SessionManager.clearSession).toHaveBeenCalled();
});

test('cancelActive() cancels the running task and calls the backend cancel endpoint', async () => {
  // cancel() rejects the same promise start() is awaiting, matching how the
  // real react-native-blob-util task behaves — a static never-resolving
  // promise wouldn't let start() ever observe the cancellation.
  let rejectTask: (err: Error) => void = () => {};
  const taskPromise = new Promise<void>((_resolve, reject) => {
    rejectTask = reject;
  });
  const cancelMock = jest.fn(() => {
    const err = new Error('cancelled');
    err.name = 'ReactNativeBlobUtilCanceledFetch';
    rejectTask(err);
  });
  mockDownloadFile.mockReturnValue({ promise: taskPromise, cancel: cancelMock });
  mockCancelTransfer.mockResolvedValue(undefined);

  const startPromise = TransferStreamManager.start({ ...sendTransfer, id: 30 });
  await waitUntil(() => TransferStreamManager.getState()?.status === 'streaming');

  await TransferStreamManager.cancelActive();

  expect(cancelMock).toHaveBeenCalled();
  expect(mockCancelTransfer).toHaveBeenCalledWith(30);

  await startPromise;
  expect(TransferStreamManager.getState()).toMatchObject({ transferId: 30, status: 'cancelled' });
});

test('cancelActive() is a no-op when nothing is streaming', async () => {
  await TransferStreamManager.cancelActive();
  expect(mockCancelTransfer).not.toHaveBeenCalled();
});
