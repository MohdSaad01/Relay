import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import Share from 'react-native-share';
import * as SafX from 'react-native-saf-x';
import { openDownloadedFile, openDownloadedFolder, shareDownloadedFile } from '../../src/files/downloadActions';
import { DownloadLocationManager } from '../../src/settings/DownloadLocationManager';

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

  test('rejects without touching actionViewIntent below the MediaStore-capable SDK (default location)', async () => {
    versionSpy.mockReturnValue(24);

    await expect(openDownloadedFolder('University Notes')).rejects.toThrow(/not available to open/);
    expect(ReactNativeBlobUtil.android.actionViewIntent).not.toHaveBeenCalled();
  });

  test('propagates a rejection when no file manager can handle the folder', async () => {
    (ReactNativeBlobUtil.android.actionViewIntent as jest.Mock).mockRejectedValueOnce(new Error('No activity found'));

    await expect(openDownloadedFolder('University Notes')).rejects.toThrow('No activity found');
  });
});

// P22 (New_Issues.txt §12)
describe('shareDownloadedFile', () => {
  test('shares the file at its resolved on-device path as a file:// URL', async () => {
    await shareDownloadedFile('report.pdf', 'application/pdf');

    expect(Share.open).toHaveBeenCalledWith({
      url: 'file:///mock/downloads/Relay/report.pdf',
      type: 'application/pdf',
      filename: 'report.pdf',
      failOnCancel: false,
    });
  });

  test('falls back to a generic MIME type when the shared file has none', async () => {
    await shareDownloadedFile('report.pdf', null);

    expect(Share.open).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'application/octet-stream' }),
    );
  });

  test('propagates a rejection when no app can handle the share', async () => {
    (Share.open as jest.Mock).mockRejectedValueOnce(new Error('No activity found'));

    await expect(shareDownloadedFile('report.pdf', 'application/pdf')).rejects.toThrow('No activity found');
  });

  test('rejects rather than sharing a broken URL when the download location is a custom SAF tree', async () => {
    const treeUri = 'content://com.android.externalstorage.documents/tree/primary%3APhotos';
    await DownloadLocationManager.setLocation({ mode: 'custom', treeUri, displayName: 'Photos' });
    (SafX.stat as jest.Mock).mockResolvedValueOnce({ uri: `${treeUri}/report.pdf` });

    await expect(shareDownloadedFile('report.pdf', 'application/pdf')).rejects.toThrow(/not available to share/);
    expect(Share.open).not.toHaveBeenCalled();

    await DownloadLocationManager.resetToDefault();
  });
});

describe('a custom SAF download location (P14.3)', () => {
  const treeUri = 'content://com.android.externalstorage.documents/tree/primary%3APhotos';

  beforeEach(async () => {
    await DownloadLocationManager.setLocation({ mode: 'custom', treeUri, displayName: 'Photos' });
  });

  afterEach(async () => {
    await DownloadLocationManager.resetToDefault();
  });

  test('openDownloadedFile opens the resolved SAF content URI', async () => {
    (SafX.stat as jest.Mock).mockResolvedValueOnce({ uri: `${treeUri}/report.pdf` });

    await openDownloadedFile('report.pdf', 'application/pdf');

    expect(ReactNativeBlobUtil.android.actionViewIntent).toHaveBeenCalledWith(
      `${treeUri}/report.pdf`,
      'application/pdf',
      undefined,
    );
  });

  // Regression test: opening a downloaded folder must build a genuine
  // tree-scoped document URI (matching what DocumentsUI recognizes as a
  // browsable root), not react-native-saf-x's own stat().uri — see
  // downloadExistence.ts's buildCustomTreeDocumentUri doc comment for the
  // "Invalid root Uri" defect found live on RMX3997.
  test('openDownloadedFolder works below the MediaStore SDK floor, since SAF has none', async () => {
    versionSpy.mockReturnValue(24);

    await openDownloadedFolder('University Notes');

    expect(ReactNativeBlobUtil.android.actionViewIntent).toHaveBeenCalledWith(
      'content://com.android.externalstorage.documents/tree/primary%3APhotos/document/primary%3APhotos%2FUniversity%20Notes',
      'vnd.android.document/directory',
      undefined,
    );
    expect(SafX.stat).not.toHaveBeenCalled();
  });

  test('openDownloadedFolder rejects when the tree URI is not a recognizable shape', async () => {
    await DownloadLocationManager.setLocation({ mode: 'custom', treeUri: 'content://weird', displayName: 'x' });

    await expect(openDownloadedFolder('University Notes')).rejects.toThrow(/not available to open/);
    expect(ReactNativeBlobUtil.android.actionViewIntent).not.toHaveBeenCalled();
  });
});
