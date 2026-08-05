import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { downloadFile, isStreamCancelError, publishDownload, uploadFile } from '../../src/streaming/blobUtil';

function lastTask(): any {
  const fetchMock = ReactNativeBlobUtil.fetch as jest.Mock;
  return fetchMock.mock.results[fetchMock.mock.results.length - 1].value;
}

// Platform.Version is a getter-only property on the real module (returns
// Platform.constants.osVersion) — plain assignment silently no-ops, so it
// must be mocked via the accessor form of spyOn instead.
let versionSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  versionSpy = jest.spyOn(Platform, 'Version', 'get').mockReturnValue(29);
  // clearAllMocks() resets calls/results but not a mockImplementation set by
  // an earlier test, so re-pin the shared mock's default here rather than
  // relying on test order for publishDownload's conflict-check calls.
  (ReactNativeBlobUtil.fs.exists as jest.Mock).mockResolvedValue(false);
  // Default: the staged file and its published copy both report the same
  // size, so publishDownload's own post-copy verification (see Milestone
  // P8.1) passes by default — individual tests override this to simulate a
  // copy that silently didn't actually land.
  (ReactNativeBlobUtil.fs.stat as jest.Mock).mockResolvedValue({ size: 100 });
});

afterEach(() => {
  versionSpy.mockRestore();
});

describe('downloadFile', () => {
  test('resolves when the response is 2xx', async () => {
    const { promise } = downloadFile('http://x/transfers/1/download', {}, '/dest/a.txt', 100, jest.fn());
    lastTask().__resolve(200);

    await expect(promise).resolves.toBeUndefined();
  });

  test('rejects with a descriptive ApiError and deletes the partial file on a non-2xx response', async () => {
    const { promise } = downloadFile('http://x/transfers/1/download', {}, '/dest/a.txt', 100, jest.fn());
    lastTask().__resolve(404);

    await expect(promise).rejects.toMatchObject({ status: 404, message: 'This transfer no longer exists.' });
    expect(ReactNativeBlobUtil.fs.unlink).toHaveBeenCalledWith('/dest/a.txt');
  });

  test('rejects with the backend message when the error body has one', async () => {
    const { promise } = downloadFile('http://x/transfers/1/download', {}, '/dest/a.txt', 100, jest.fn());
    lastTask().__resolve(400, { message: 'The source file is no longer available.' });

    await expect(promise).rejects.toMatchObject({
      status: 400,
      message: 'The source file is no longer available.',
    });
  });

  test('reports progress via the progress callback', () => {
    const onProgress = jest.fn();
    downloadFile('http://x/transfers/1/download', {}, '/dest/a.txt', 100, onProgress);

    lastTask().__emitProgress(50, 100);

    expect(onProgress).toHaveBeenCalledWith(50, 100);
  });

  test('cancel() rejects with an error isStreamCancelError recognizes', async () => {
    const { promise, cancel } = downloadFile('http://x/transfers/1/download', {}, '/dest/a.txt', 100, jest.fn());

    cancel();

    let caught: unknown;
    try {
      await promise;
    } catch (err) {
      caught = err;
    }
    expect(isStreamCancelError(caught)).toBe(true);
  });

  // Regression tests for Milestone P7: react-native-blob-util's native
  // FileStorage completion check ("Download interrupted") can false-negative
  // on larger, multi-chunk downloads even though every byte already reached
  // disk — see docs/15_QA_NOTEBOOK.md's Milestone P7 entry.
  describe('a native "Download interrupted" rejection', () => {
    test('is swallowed when the file on disk already matches the declared size', async () => {
      (ReactNativeBlobUtil.fs.stat as jest.Mock).mockResolvedValueOnce({ size: 100 });

      const { promise } = downloadFile('http://x/transfers/1/download', {}, '/dest/a.pdf', 100, jest.fn());
      lastTask().__reject(new Error('Download interrupted.'));

      await expect(promise).resolves.toBeUndefined();
      expect(ReactNativeBlobUtil.fs.stat).toHaveBeenCalledWith('/dest/a.pdf');
    });

    test('still rejects when the file on disk is short of the declared size (a genuine interruption)', async () => {
      (ReactNativeBlobUtil.fs.stat as jest.Mock).mockResolvedValueOnce({ size: 42 });

      const { promise } = downloadFile('http://x/transfers/1/download', {}, '/dest/a.pdf', 100, jest.fn());
      const err = new Error('Download interrupted.');
      lastTask().__reject(err);

      await expect(promise).rejects.toBe(err);
    });

    test('still rejects when stat() itself fails (e.g. the file was never created)', async () => {
      (ReactNativeBlobUtil.fs.stat as jest.Mock).mockRejectedValueOnce(new Error('ENOENT'));

      const { promise } = downloadFile('http://x/transfers/1/download', {}, '/dest/a.pdf', 100, jest.fn());
      const err = new Error('Download interrupted.');
      lastTask().__reject(err);

      await expect(promise).rejects.toBe(err);
    });
  });

  test('cancel() still rejects with the cancel error even if the partial file happens to match the declared size', async () => {
    (ReactNativeBlobUtil.fs.stat as jest.Mock).mockResolvedValueOnce({ size: 100 });

    const { promise, cancel } = downloadFile('http://x/transfers/1/download', {}, '/dest/a.pdf', 100, jest.fn());
    cancel();

    let caught: unknown;
    try {
      await promise;
    } catch (err) {
      caught = err;
    }
    expect(isStreamCancelError(caught)).toBe(true);
  });
});

describe('uploadFile', () => {
  test('wraps the file uri as the raw request body, not multipart', () => {
    uploadFile('http://x/transfers/2/upload', { Authorization: 'Bearer tok' }, 'content://picked/a.txt', jest.fn());

    expect(ReactNativeBlobUtil.wrap).toHaveBeenCalledWith('content://picked/a.txt');
    expect(ReactNativeBlobUtil.fetch).toHaveBeenCalledWith(
      'POST',
      'http://x/transfers/2/upload',
      expect.objectContaining({ Authorization: 'Bearer tok', 'Content-Type': 'application/octet-stream' }),
      'wrapped:content://picked/a.txt',
    );
  });

  test('resolves when the response is 2xx', async () => {
    const { promise } = uploadFile('http://x/transfers/2/upload', {}, 'content://picked/a.txt', jest.fn());
    lastTask().__resolve(200);

    await expect(promise).resolves.toBeUndefined();
  });

  test('rejects with the backend message when the response body has one', async () => {
    const { promise } = uploadFile('http://x/transfers/2/upload', {}, 'content://picked/a.txt', jest.fn());
    lastTask().__resolve(400, { message: 'Upload does not match declared file_size.' });

    await expect(promise).rejects.toMatchObject({
      status: 400,
      message: 'Upload does not match declared file_size.',
    });
  });

  test('falls back to a generic message when the response body has none', async () => {
    const { promise } = uploadFile('http://x/transfers/2/upload', {}, 'content://picked/a.txt', jest.fn());
    lastTask().__resolve(409, {});

    await expect(promise).rejects.toMatchObject({ status: 409 });
  });

  test('reports upload progress', () => {
    const onProgress = jest.fn();
    uploadFile('http://x/transfers/2/upload', {}, 'content://picked/a.txt', onProgress);

    lastTask().__emitUploadProgress(10, 100);

    expect(onProgress).toHaveBeenCalledWith(10, 100);
  });
});

describe('publishDownload', () => {
  test('copies the staged file into MediaStore Downloads/Relay, removes the staging copy, and returns the content URI', async () => {
    const contentUri = await publishDownload('/mock/documents/Downloads/report.pdf', 'report.pdf');

    expect(ReactNativeBlobUtil.MediaCollection.copyToMediaStore).toHaveBeenCalledWith(
      { name: 'report.pdf', parentFolder: 'Relay', mimeType: 'application/octet-stream' },
      'Download',
      '/mock/documents/Downloads/report.pdf',
    );
    expect(ReactNativeBlobUtil.fs.unlink).toHaveBeenCalledWith('/mock/documents/Downloads/report.pdf');
    expect(contentUri).toBe('content://media/downloads/1');
  });

  test('is a no-op below API 29, where MediaStore.Downloads does not exist, and returns null', async () => {
    versionSpy.mockReturnValue(28);

    const contentUri = await publishDownload('/mock/documents/Downloads/report.pdf', 'report.pdf');

    expect(ReactNativeBlobUtil.MediaCollection.copyToMediaStore).not.toHaveBeenCalled();
    expect(ReactNativeBlobUtil.fs.unlink).not.toHaveBeenCalled();
    expect(contentUri).toBeNull();
  });

  test('does not throw when the MediaStore copy fails, leaving the file at its staging path and returning null', async () => {
    (ReactNativeBlobUtil.MediaCollection.copyToMediaStore as jest.Mock).mockRejectedValueOnce(
      new Error('insert failed'),
    );
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(publishDownload('/mock/documents/Downloads/report.pdf', 'report.pdf')).resolves.toBeNull();

    expect(ReactNativeBlobUtil.fs.unlink).not.toHaveBeenCalled();
  });

  // Regression test for Milestone P8.1: on a real device (RMX3997, Android
  // 16/API 36), copyToMediaStore resolved with a seemingly-valid content URI
  // while the file it pointed to was never actually written (a bug in
  // react-native-blob-util's native writeToMediaFile — see
  // docs/15_QA_NOTEBOOK.md's Milestone P8.1 entry) — with no exception for
  // this function's own try/catch to see. publishDownload must not trust the
  // library's return value alone.
  test('treats a copy that reports success but never actually lands at its destination as a failure', async () => {
    (ReactNativeBlobUtil.fs.stat as jest.Mock).mockImplementation((path: string) =>
      path === '/mock/documents/Downloads/report.pdf'
        ? Promise.resolve({ size: 100 })
        : Promise.reject(new Error('ENOENT')),
    );
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const contentUri = await publishDownload('/mock/documents/Downloads/report.pdf', 'report.pdf');

    expect(contentUri).toBeNull();
    expect(ReactNativeBlobUtil.fs.unlink).not.toHaveBeenCalled();
  });

  test('treats a published file whose size does not match the staged file as a failure', async () => {
    (ReactNativeBlobUtil.fs.stat as jest.Mock).mockImplementation((path: string) =>
      Promise.resolve({ size: path === '/mock/documents/Downloads/report.pdf' ? 100 : 0 }),
    );
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const contentUri = await publishDownload('/mock/documents/Downloads/report.pdf', 'report.pdf');

    expect(contentUri).toBeNull();
    expect(ReactNativeBlobUtil.fs.unlink).not.toHaveBeenCalled();
  });

  test('resolves a "name (1).ext" alternative when the requested display name is already published', async () => {
    // Regression test: a second download that happens to share a file name
    // with an already-published one (a re-download, or two different shared
    // files with the same basename) used to be handed to copyToMediaStore
    // verbatim every time — see docs/15_QA_NOTEBOOK.md's Milestone P3 entry.
    (ReactNativeBlobUtil.fs.exists as jest.Mock).mockImplementation((path: string) =>
      Promise.resolve(path === '/mock/downloads/Relay/report.pdf'),
    );

    await publishDownload('/mock/documents/Downloads/report.pdf', 'report.pdf');

    expect(ReactNativeBlobUtil.MediaCollection.copyToMediaStore).toHaveBeenCalledWith(
      { name: 'report (1).pdf', parentFolder: 'Relay', mimeType: 'application/octet-stream' },
      'Download',
      '/mock/documents/Downloads/report.pdf',
    );
  });

  test('keeps incrementing past a taken "(1)" alternative until a free name is found', async () => {
    (ReactNativeBlobUtil.fs.exists as jest.Mock).mockImplementation((path: string) =>
      Promise.resolve(path === '/mock/downloads/Relay/report.pdf' || path === '/mock/downloads/Relay/report (1).pdf'),
    );

    await publishDownload('/mock/documents/Downloads/report.pdf', 'report.pdf');

    expect(ReactNativeBlobUtil.MediaCollection.copyToMediaStore).toHaveBeenCalledWith(
      { name: 'report (2).pdf', parentFolder: 'Relay', mimeType: 'application/octet-stream' },
      'Download',
      '/mock/documents/Downloads/report.pdf',
    );
  });

  test('does not rename when the requested display name is free', async () => {
    await publishDownload('/mock/documents/Downloads/report.pdf', 'report.pdf');

    expect(ReactNativeBlobUtil.MediaCollection.copyToMediaStore).toHaveBeenCalledWith(
      { name: 'report.pdf', parentFolder: 'Relay', mimeType: 'application/octet-stream' },
      'Download',
      '/mock/documents/Downloads/report.pdf',
    );
  });
});
