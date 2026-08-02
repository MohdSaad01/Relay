import ReactNativeBlobUtil from 'react-native-blob-util';
import { downloadFile, isStreamCancelError, uploadFile } from '../../src/streaming/blobUtil';

function lastTask(): any {
  const fetchMock = ReactNativeBlobUtil.fetch as jest.Mock;
  return fetchMock.mock.results[fetchMock.mock.results.length - 1].value;
}

beforeEach(() => {
  jest.clearAllMocks();
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
