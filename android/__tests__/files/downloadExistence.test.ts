import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import * as SafX from 'react-native-saf-x';
import {
  deleteDownloadedPath,
  downloadedFileExists,
  downloadedFilePath,
  downloadedFolderContentUri,
} from '../../src/files/downloadExistence';
import { DownloadLocationManager } from '../../src/settings/DownloadLocationManager';

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

test('P13: checks a folder child by its full nested relative path', async () => {
  (ReactNativeBlobUtil.fs.exists as jest.Mock).mockResolvedValueOnce(true);

  await expect(downloadedFileExists('University Notes/Semester 1/DBMS.pdf')).resolves.toBe(true);

  expect(ReactNativeBlobUtil.fs.exists).toHaveBeenCalledWith(
    '/mock/downloads/Relay/University Notes/Semester 1/DBMS.pdf',
  );
});

describe('a custom SAF download location (P14.3)', () => {
  const treeUri = 'content://com.android.externalstorage.documents/tree/primary%3APhotos';

  beforeEach(async () => {
    await DownloadLocationManager.setLocation({ mode: 'custom', treeUri, displayName: 'Photos' });
  });

  afterEach(async () => {
    await DownloadLocationManager.resetToDefault();
  });

  test('downloadedFileExists checks the tree-relative SAF path, not MediaStore', async () => {
    (SafX.exists as jest.Mock).mockResolvedValueOnce(true);

    await expect(downloadedFileExists('report.pdf')).resolves.toBe(true);

    expect(SafX.exists).toHaveBeenCalledWith(`${treeUri}/report.pdf`);
    expect(ReactNativeBlobUtil.fs.exists).not.toHaveBeenCalled();
  });

  test('downloadedFileExists treats a SAF failure (e.g. a revoked grant) as "not there"', async () => {
    (SafX.exists as jest.Mock).mockRejectedValueOnce(new Error('permission denied'));

    await expect(downloadedFileExists('report.pdf')).resolves.toBe(false);
  });

  test('downloadedFilePath resolves the real content:// document URI via stat', async () => {
    (SafX.stat as jest.Mock).mockResolvedValueOnce({ uri: `${treeUri}/report.pdf`, name: 'report.pdf' });

    await expect(downloadedFilePath('report.pdf')).resolves.toBe(`${treeUri}/report.pdf`);
    expect(SafX.stat).toHaveBeenCalledWith(`${treeUri}/report.pdf`);
  });

  // Regression test: handing react-native-saf-x's own stat().uri straight to
  // actionViewIntent opened DocumentsUI on its generic "Download" root
  // instead of the picked folder ("Invalid root Uri", confirmed live on
  // RMX3997) — see downloadedFolderContentUri's own doc comment. The
  // correct shape is a tree-scoped document URI built from the *granted*
  // tree's own document id, not whatever stat() happens to return.
  test('downloadedFolderContentUri builds a tree-scoped document URI, with no MediaStore SDK floor', async () => {
    versionSpy.mockReturnValue(24); // below MEDIASTORE_MIN_SDK — irrelevant in custom mode

    await expect(downloadedFolderContentUri('University Notes')).resolves.toBe(
      'content://com.android.externalstorage.documents/tree/primary%3APhotos/document/primary%3APhotos%2FUniversity%20Notes',
    );
    expect(SafX.stat).not.toHaveBeenCalled();
  });

  test('downloadedFolderContentUri resolves to null when the tree URI is not a recognizable shape', async () => {
    await DownloadLocationManager.setLocation({ mode: 'custom', treeUri: 'content://weird', displayName: 'x' });

    await expect(downloadedFolderContentUri('Missing')).resolves.toBeNull();
  });

  test('deleteDownloadedPath unlinks via SAF and never throws', async () => {
    (SafX.unlink as jest.Mock).mockRejectedValueOnce(new Error('boom'));

    await expect(deleteDownloadedPath('report.pdf')).resolves.toBeUndefined();
    expect(SafX.unlink).toHaveBeenCalledWith(`${treeUri}/report.pdf`);
  });
});

describe('default location folder resolution (P14.3 regression)', () => {
  test('downloadedFolderContentUri returns null below MEDIASTORE_MIN_SDK', async () => {
    versionSpy.mockReturnValue(24);

    await expect(downloadedFolderContentUri('University Notes')).resolves.toBeNull();
  });

  test('downloadedFolderContentUri builds the MediaStore document URI on API 29+', async () => {
    await expect(downloadedFolderContentUri('University Notes')).resolves.toBe(
      'content://com.android.externalstorage.documents/document/primary%3ADownload%2FRelay%2FUniversity%20Notes',
    );
  });
});
