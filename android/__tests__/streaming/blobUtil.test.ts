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
});

afterEach(() => {
  versionSpy.mockRestore();
});

describe('downloadFile', () => {
  test('resolves when the response is 2xx', async () => {
    const { promise } = downloadFile('http://x/transfers/1/download', {}, '/dest/a.txt', jest.fn());
    lastTask().__resolve(200);

    await expect(promise).resolves.toBeUndefined();
  });

  test('rejects with a descriptive ApiError and deletes the partial file on a non-2xx response', async () => {
    const { promise } = downloadFile('http://x/transfers/1/download', {}, '/dest/a.txt', jest.fn());
    lastTask().__resolve(404);

    await expect(promise).rejects.toMatchObject({ status: 404, message: 'This transfer no longer exists.' });
    expect(ReactNativeBlobUtil.fs.unlink).toHaveBeenCalledWith('/dest/a.txt');
  });

  test('rejects with the backend message when the error body has one', async () => {
    const { promise } = downloadFile('http://x/transfers/1/download', {}, '/dest/a.txt', jest.fn());
    lastTask().__resolve(400, { message: 'The source file is no longer available.' });

    await expect(promise).rejects.toMatchObject({
      status: 400,
      message: 'The source file is no longer available.',
    });
  });

  test('reports progress via the progress callback', () => {
    const onProgress = jest.fn();
    downloadFile('http://x/transfers/1/download', {}, '/dest/a.txt', onProgress);

    lastTask().__emitProgress(50, 100);

    expect(onProgress).toHaveBeenCalledWith(50, 100);
  });

  test('cancel() rejects with an error isStreamCancelError recognizes', async () => {
    const { promise, cancel } = downloadFile('http://x/transfers/1/download', {}, '/dest/a.txt', jest.fn());

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
});
