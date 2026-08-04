import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { downloadedFileExists } from '../../src/files/downloadExistence';

let versionSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  versionSpy = jest.spyOn(Platform, 'Version', 'get').mockReturnValue(29);
});

afterEach(() => {
  versionSpy.mockRestore();
});

test('checks the public Downloads/Relay path on API 29+, matching publishDownload', async () => {
  (ReactNativeBlobUtil.fs.exists as jest.Mock).mockResolvedValueOnce(true);

  await expect(downloadedFileExists('report.pdf')).resolves.toBe(true);

  expect(ReactNativeBlobUtil.fs.exists).toHaveBeenCalledWith('/mock/downloads/Relay/report.pdf');
});

test('checks the private staging path below API 29, where publishDownload never runs', async () => {
  versionSpy.mockReturnValue(28);
  (ReactNativeBlobUtil.fs.exists as jest.Mock).mockResolvedValueOnce(true);

  await expect(downloadedFileExists('report.pdf')).resolves.toBe(true);

  expect(ReactNativeBlobUtil.fs.exists).toHaveBeenCalledWith('/mock/documents/Downloads/report.pdf');
});

test('returns false when the file is not there', async () => {
  (ReactNativeBlobUtil.fs.exists as jest.Mock).mockResolvedValueOnce(false);

  await expect(downloadedFileExists('report.pdf')).resolves.toBe(false);
});

test('treats a failed check as "not there" rather than throwing', async () => {
  (ReactNativeBlobUtil.fs.exists as jest.Mock).mockRejectedValueOnce(new Error('boom'));

  await expect(downloadedFileExists('report.pdf')).resolves.toBe(false);
});
