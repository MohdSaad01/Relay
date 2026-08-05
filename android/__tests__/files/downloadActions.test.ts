import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { openDownloadedFile } from '../../src/files/downloadActions';

let versionSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  versionSpy = jest.spyOn(Platform, 'Version', 'get').mockReturnValue(29);
});

afterEach(() => {
  versionSpy.mockRestore();
});

test('opens the file at its resolved on-device path with a chooser', async () => {
  await openDownloadedFile('report.pdf', 'application/pdf');

  expect(ReactNativeBlobUtil.android.actionViewIntent).toHaveBeenCalledWith(
    '/mock/downloads/Relay/report.pdf',
    'application/pdf',
    'Open with',
  );
});

test('falls back to a generic MIME type when the shared file has none', async () => {
  await openDownloadedFile('report.pdf', null);

  expect(ReactNativeBlobUtil.android.actionViewIntent).toHaveBeenCalledWith(
    expect.any(String),
    'application/octet-stream',
    'Open with',
  );
});

test('propagates a rejection when no app can handle the file', async () => {
  (ReactNativeBlobUtil.android.actionViewIntent as jest.Mock).mockRejectedValueOnce(new Error('No activity found'));

  await expect(openDownloadedFile('report.pdf', 'application/pdf')).rejects.toThrow('No activity found');
});
