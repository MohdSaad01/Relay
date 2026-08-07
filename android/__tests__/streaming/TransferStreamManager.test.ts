jest.mock('../../src/streaming/blobUtil');
jest.mock('../../src/streaming/foregroundService');
jest.mock('../../src/streaming/downloadNotification');
jest.mock('../../src/streaming/uploadSourceRegistry');
jest.mock('../../src/api/endpoints/transfers');
jest.mock('../../src/api/endpoints/folders');
jest.mock('../../src/session/SessionManager');

import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { TransferStreamManager } from '../../src/streaming/TransferStreamManager';
import { downloadFile, isStreamCancelError, publishDownload, uploadFile } from '../../src/streaming/blobUtil';
import {
  startTransferNotification,
  stopTransferNotification,
} from '../../src/streaming/foregroundService';
import { notifyDownloadComplete, notifyFolderDownloadComplete } from '../../src/streaming/downloadNotification';
import { getUploadSource } from '../../src/streaming/uploadSourceRegistry';
import { cancelTransfer, listTransferRequests, listTransfers } from '../../src/api/endpoints/transfers';
import { getFolderFiles } from '../../src/api/endpoints/folders';
import { SessionManager } from '../../src/session/SessionManager';
import { clearApiConfig, setApiConfig } from '../../src/api/config';
import { ApiError } from '../../src/api/client';
import { TransferResponse } from '../../src/api/types';

const mockDownloadFile = downloadFile as jest.Mock;
const mockUploadFile = uploadFile as jest.Mock;
const mockPublishDownload = publishDownload as jest.Mock;
const mockNotifyDownloadComplete = notifyDownloadComplete as jest.Mock;
const mockNotifyFolderDownloadComplete = notifyFolderDownloadComplete as jest.Mock;
const mockGetUploadSource = getUploadSource as jest.Mock;
const mockCancelTransfer = cancelTransfer as jest.Mock;
const mockListTransferRequests = listTransferRequests as jest.Mock;
const mockListTransfers = listTransfers as jest.Mock;
const mockGetFolderFiles = getFolderFiles as jest.Mock;
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
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue(29);
  mockIsStreamCancelError.mockImplementation(
    (err: unknown) => err instanceof Error && err.name === 'ReactNativeBlobUtilCanceledFetch',
  );
  mockPublishDownload.mockResolvedValue(null);
  // Only exercised by a folder-child transfer (shared_folder_id set) — most
  // tests in this file never touch these, but a default keeps the ones that
  // do from needing to configure every one individually.
  mockListTransferRequests.mockResolvedValue([]);
  mockListTransfers.mockResolvedValue([]);
  mockGetFolderFiles.mockResolvedValue([]);
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
    1000,
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

test('P13: a folder child transfer stages/publishes at its full folder_relative_path, not just file_name', async () => {
  mockDownloadFile.mockReturnValue(makeTask(Promise.resolve()));
  const folderChild: TransferResponse = {
    ...sendTransfer,
    id: 900,
    file_name: 'DBMS.pdf',
    folder_relative_path: 'University Notes/Semester 1/DBMS.pdf',
  };

  await TransferStreamManager.start(folderChild);

  expect(mockDownloadFile).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(Object),
    expect.stringContaining('University Notes/Semester 1/DBMS.pdf'),
    1000,
    expect.any(Function),
  );
  expect(mockPublishDownload).toHaveBeenCalledWith(
    expect.stringContaining('University Notes/Semester 1/DBMS.pdf'),
    'University Notes/Semester 1/DBMS.pdf',
  );
});

test('P13.1: a folder child does not fire the per-file notification, completed or not', async () => {
  mockDownloadFile.mockReturnValue(makeTask(Promise.resolve()));
  const folderChild: TransferResponse = {
    ...sendTransfer,
    id: 901,
    shared_file_id: 5,
    shared_folder_id: 77,
    file_name: 'DBMS.pdf',
    folder_relative_path: 'University Notes/DBMS.pdf',
  };
  // Folder still has an incomplete sibling, so deriveFolderDownloadStatus
  // won't report 'completed' either — neither notification should fire.
  mockGetFolderFiles.mockResolvedValue([
    { id: 5, relative_path: 'DBMS.pdf', file_size: 1000, mime_type: null },
    { id: 6, relative_path: 'Syllabus.pdf', file_size: 500, mime_type: null },
  ]);
  mockListTransfers.mockResolvedValue([{ ...folderChild, status: 'completed' }]);

  await TransferStreamManager.start(folderChild);

  expect(mockNotifyDownloadComplete).not.toHaveBeenCalled();
  expect(mockNotifyFolderDownloadComplete).not.toHaveBeenCalled();
});

test('P13.1: the last folder child to complete fires exactly one folder notification', async () => {
  mockDownloadFile.mockReturnValue(makeTask(Promise.resolve()));
  const lastChild: TransferResponse = {
    ...sendTransfer,
    id: 902,
    shared_file_id: 6,
    shared_folder_id: 77,
    file_name: 'Syllabus.pdf',
    file_size: 500,
    folder_relative_path: 'University Notes/Syllabus.pdf',
  };
  mockGetFolderFiles.mockResolvedValue([
    { id: 5, relative_path: 'DBMS.pdf', file_size: 1000, mime_type: null },
    { id: 6, relative_path: 'Syllabus.pdf', file_size: 500, mime_type: null },
  ]);
  // Both children now show as completed Transfers -- this one and the
  // sibling that finished earlier. Both need shared_folder_id/
  // folder_relative_path set (P13.2's staleness check is folder-scoped and
  // path-keyed, like the backend's own transfer history) and a file_size
  // matching their sibling child above, or deriveFolderDownloadStatus
  // correctly treats the "download" as not actually matching what's shared.
  mockListTransfers.mockResolvedValue([
    {
      ...sendTransfer,
      id: 900,
      shared_file_id: 5,
      shared_folder_id: 77,
      file_size: 1000,
      folder_relative_path: 'University Notes/DBMS.pdf',
      status: 'completed',
    },
    { ...lastChild, status: 'completed' },
  ]);

  await TransferStreamManager.start(lastChild);

  expect(mockNotifyDownloadComplete).not.toHaveBeenCalled();
  expect(mockNotifyFolderDownloadComplete).toHaveBeenCalledTimes(1);
  expect(mockNotifyFolderDownloadComplete).toHaveBeenCalledWith(
    'University Notes',
    expect.stringContaining('University%20Notes'),
  );
});

test('P13.2 (Issue 1): two shared folders with the same raw name stage/publish into distinct local roots', async () => {
  mockDownloadFile.mockReturnValue(makeTask(Promise.resolve()));
  const mockExists = ReactNativeBlobUtil.fs.exists as jest.Mock;
  // Simulates on-device state: a directory "exists" once a file has
  // actually published into it, tracked independently of the (also mocked,
  // and in this test never actually persisted across calls) folder-root
  // registry file — this alone is enough to prove the disambiguation
  // itself, regardless of how the registry is backed.
  const published = new Set<string>();
  mockExists.mockImplementation((path: string) => Promise.resolve(published.has(path)));
  mockPublishDownload.mockImplementation((_stagingPath: string, relativePath: string) => {
    published.add(`/mock/downloads/Relay/${relativePath.split('/')[0]}`);
    return Promise.resolve(null);
  });

  const folderAChild: TransferResponse = {
    ...sendTransfer,
    id: 920,
    shared_file_id: 40,
    shared_folder_id: 200,
    file_name: 'a.txt',
    folder_relative_path: 'Duplicate/a.txt',
  };
  const folderBChild: TransferResponse = {
    ...sendTransfer,
    id: 921,
    shared_file_id: 41,
    shared_folder_id: 201,
    file_name: 'b.txt',
    folder_relative_path: 'Duplicate/b.txt',
  };

  await TransferStreamManager.start(folderAChild);
  expect(mockDownloadFile).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.any(Object),
    expect.stringContaining('Duplicate/a.txt'),
    1000,
    expect.any(Function),
  );

  await TransferStreamManager.start(folderBChild);
  expect(mockDownloadFile).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.any(Object),
    expect.stringContaining('Duplicate (1)/b.txt'),
    1000,
    expect.any(Function),
  );
  expect(mockPublishDownload).toHaveBeenLastCalledWith(expect.any(String), 'Duplicate (1)/b.txt');
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
  // 41 loses the race and is queued (Milestone P11) rather than dropped, so
  // it runs on its own once 40 finishes — mock its own downloadFile call too,
  // and drain it below, so it doesn't run unobserved after this test ends.
  mockDownloadFile.mockReturnValueOnce(makeTask(Promise.resolve()));

  const first = TransferStreamManager.start({ ...sendTransfer, id: 40 });
  const second = TransferStreamManager.start({ ...sendTransfer, id: 41 });

  // second resolves synchronously, in the same tick as first's guard
  // checks (before first's own first `await` yields back to the event
  // loop) — this doesn't depend on first's continuation ever resuming.
  await second;

  await waitUntil(() => mockDownloadFile.mock.calls.length === 1);
  expect(mockDownloadFile).toHaveBeenCalledTimes(1);
  expect(TransferStreamManager.getState()?.transferId).toBe(40);

  resolveFirst();
  await first;

  // 41 was queued behind 40 rather than dropped — let it run to completion
  // so no background work from this test leaks into the next one.
  await waitUntil(() => TransferStreamManager.getState()?.transferId === 41);
  await waitUntil(() => TransferStreamManager.getState()?.status === 'completed');
});

test('start() defers (does not start) a transfer while another is already streaming', async () => {
  let resolveFirst: () => void = () => {};
  mockDownloadFile.mockReturnValueOnce(
    makeTask(
      new Promise<void>(resolve => {
        resolveFirst = resolve;
      }),
    ),
  );
  mockDownloadFile.mockReturnValueOnce(makeTask(Promise.resolve()));

  const firstStart = TransferStreamManager.start({ ...sendTransfer, id: 10 });
  await waitUntil(() => TransferStreamManager.getState()?.status === 'streaming');

  await TransferStreamManager.start({ ...sendTransfer, id: 11 });

  expect(mockDownloadFile).toHaveBeenCalledTimes(1);
  expect(TransferStreamManager.getState()?.transferId).toBe(10);

  resolveFirst();
  await firstStart;
  await waitUntil(() => mockDownloadFile.mock.calls.length === 2);
});

test('start() queued behind an active stream runs automatically once that stream finishes (Milestone P11)', async () => {
  // Regression test: start() used to silently drop a call that arrived
  // while another transfer was streaming, with no path back to running it
  // short of some other code (TransferProgressDetail's own opportunistic
  // effect) calling start() again for that exact transfer later. A
  // transfer proposed anywhere else — e.g. a second rapid tap on
  // FilesScreen — stayed stuck at 0 bytes forever. It must now queue and
  // run on its own once the active stream finishes.
  let resolveFirst: () => void = () => {};
  mockDownloadFile.mockReturnValueOnce(
    makeTask(
      new Promise<void>(resolve => {
        resolveFirst = resolve;
      }),
    ),
  );
  mockDownloadFile.mockReturnValueOnce(makeTask(Promise.resolve()));

  const firstStart = TransferStreamManager.start({ ...sendTransfer, id: 60 });
  await waitUntil(() => TransferStreamManager.getState()?.status === 'streaming');

  // Arrives while 60 is streaming — queued, not dropped, and not started yet.
  await TransferStreamManager.start({ ...sendTransfer, id: 61 });
  expect(mockDownloadFile).toHaveBeenCalledTimes(1);

  resolveFirst();
  await firstStart;

  // 61 starts on its own, with no further start() call from the test.
  await waitUntil(() => TransferStreamManager.getState()?.transferId === 61);
  expect(mockDownloadFile).toHaveBeenCalledTimes(2);
  await waitUntil(() => TransferStreamManager.getState()?.status === 'completed');
});

test('a transfer queued twice behind an active stream only runs once (Milestone P11)', async () => {
  let resolveFirst: () => void = () => {};
  mockDownloadFile.mockReturnValueOnce(
    makeTask(
      new Promise<void>(resolve => {
        resolveFirst = resolve;
      }),
    ),
  );
  mockDownloadFile.mockReturnValueOnce(makeTask(Promise.resolve()));

  const firstStart = TransferStreamManager.start({ ...sendTransfer, id: 70 });
  await waitUntil(() => TransferStreamManager.getState()?.status === 'streaming');

  // Same call site invoked redundantly (e.g. FilesScreen and
  // TransferProgressDetail both observing the same in_progress transfer) —
  // must be deduped rather than queued (and later started) twice.
  await TransferStreamManager.start({ ...sendTransfer, id: 71 });
  await TransferStreamManager.start({ ...sendTransfer, id: 71 });

  resolveFirst();
  await firstStart;

  await waitUntil(() => mockDownloadFile.mock.calls.length === 2);
  expect(mockDownloadFile).toHaveBeenCalledTimes(2);
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
