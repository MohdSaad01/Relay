import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { openDownloadedFile, openDownloadedFolder } from '../../src/files/downloadActions';

let versionSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  versionSpy = jest.spyOn(Platform, 'Version', 'get').mockReturnValue(29);
});

afterEach(() => {
  versionSpy.mockRestore();
});

test('opens the file at its resolved on-device path with no chooser title', async () => {
  await openDownloadedFile('report.pdf', 'application/pdf');

  // null, not a custom title: a non-null title makes react-native-blob-util
  // wrap the intent in Intent.createChooser(), which drops the
  // FLAG_ACTIVITY_NEW_TASK flag required when starting from a non-Activity
  // context and throws on every call — see downloadActions.ts's docstring.
  expect(ReactNativeBlobUtil.android.actionViewIntent).toHaveBeenCalledWith(
    '/mock/downloads/Relay/report.pdf',
    'application/pdf',
    undefined,
  );
});

test('falls back to a generic MIME type when the shared file has none', async () => {
  await openDownloadedFile('report.pdf', null);

  expect(ReactNativeBlobUtil.android.actionViewIntent).toHaveBeenCalledWith(
    expect.any(String),
    'application/octet-stream',
    undefined,
  );
});

test('propagates a rejection when no app can handle the file', async () => {
  (ReactNativeBlobUtil.android.actionViewIntent as jest.Mock).mockRejectedValueOnce(new Error('No activity found'));

  await expect(openDownloadedFile('report.pdf', 'application/pdf')).rejects.toThrow('No activity found');
});

// P13.1 (Issue 2)
describe('openDownloadedFolder', () => {
  test('opens the folder via a SAF directory document URI with the directory MIME type', async () => {
    await openDownloadedFolder('University Notes');

    expect(ReactNativeBlobUtil.android.actionViewIntent).toHaveBeenCalledWith(
      'content://com.android.externalstorage.documents/document/primary%3ADownload%2FRelay%2FUniversity%20Notes',
      'vnd.android.document/directory',
      undefined,
    );
  });

  test('rejects without touching actionViewIntent below the MediaStore-capable SDK', async () => {
    versionSpy.mockReturnValue(24);

    await expect(openDownloadedFolder('University Notes')).rejects.toThrow(/Android 10 or later/);
    expect(ReactNativeBlobUtil.android.actionViewIntent).not.toHaveBeenCalled();
  });

  test('propagates a rejection when no file manager can handle the folder', async () => {
    (ReactNativeBlobUtil.android.actionViewIntent as jest.Mock).mockRejectedValueOnce(new Error('No activity found'));

    await expect(openDownloadedFolder('University Notes')).rejects.toThrow('No activity found');
  });
});
