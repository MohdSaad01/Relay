import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import * as SafX from 'react-native-saf-x';
import { readAllLocalFileNames, resolveLocalFileName } from '../../src/files/fileIdentity';
import { DownloadLocationManager } from '../../src/settings/DownloadLocationManager';

const mockReadFile = ReactNativeBlobUtil.fs.readFile as jest.Mock;
const mockWriteFile = ReactNativeBlobUtil.fs.writeFile as jest.Mock;
const mockExists = ReactNativeBlobUtil.fs.exists as jest.Mock;

let versionSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  // downloadedFileExists branches on the MediaStore-capable SDK threshold —
  // pin it to API 29+ so every check below resolves under the public
  // LegacyDownloadDir/Relay path, matching folderIdentity.test.ts's own
  // convention.
  versionSpy = jest.spyOn(Platform, 'Version', 'get').mockReturnValue(29);
  mockReadFile.mockRejectedValue(new Error('ENOENT'));
  mockWriteFile.mockResolvedValue(undefined);
  mockExists.mockResolvedValue(false);
});

afterEach(() => {
  versionSpy.mockRestore();
});

describe('resolveLocalFileName (P16)', () => {
  test('resolves to the raw file name when nothing is on-device or registered yet', async () => {
    const localName = await resolveLocalFileName(1, 'report.txt');

    expect(localName).toBe('report.txt');
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('relay-file-registry.json'),
      JSON.stringify({ '1': 'report.txt' }),
      'utf8',
    );
  });

  // The exact same-basename collision reproduced live on RMX3997
  // (docs/15_QA_NOTEBOOK.md's Milestone P16 entry): two different shared
  // files ("id 1" and "id 2") that both happen to be named "report.txt".
  test('appends "(1)" when the raw name is already occupied on-device by a different file', async () => {
    // id 1 already resolved to the bare "report.txt" name, which now really
    // exists on disk (a previous download).
    mockReadFile.mockResolvedValue(JSON.stringify({ '1': 'report.txt' }));
    mockExists.mockImplementation((path: string) => Promise.resolve(path.endsWith('/report.txt')));

    const localName = await resolveLocalFileName(2, 'report.txt');

    expect(localName).toBe('report (1).txt');
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({ '1': 'report.txt', '2': 'report (1).txt' }),
      'utf8',
    );
  });

  test('keeps incrementing past an already-registered "(1)" until a free name is found', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ '1': 'report.txt', '2': 'report (1).txt' }));
    mockExists.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith('/report.txt') || path.endsWith('/report (1).txt')),
    );

    const localName = await resolveLocalFileName(3, 'report.txt');

    expect(localName).toBe('report (2).txt');
  });

  test('preserves the extension when disambiguating a multi-dot file name', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ '1': 'archive.tar.gz' }));
    mockExists.mockImplementation((path: string) => Promise.resolve(path.endsWith('/archive.tar.gz')));

    const localName = await resolveLocalFileName(2, 'archive.tar.gz');

    expect(localName).toBe('archive.tar (1).gz');
  });

  test('reuses an already-registered mapping for the same shared_file_id without touching the filesystem again', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ '5': 'photo (1).jpg' }));

    const localName = await resolveLocalFileName(5, 'photo.jpg');

    expect(localName).toBe('photo (1).jpg');
    expect(mockExists).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  // Required invariant: re-downloading a file after its physical copy was
  // deleted externally must recover to the exact same on-device name, not
  // drift to a fresh "(1)" sibling — otherwise a second same-named file's
  // own row could suddenly "see" the freed-up bare name and collide again.
  test('a re-download resolves back to the same name even after the physical file no longer exists', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ '1': 'report (1).txt' }));
    mockExists.mockResolvedValue(false); // deleted externally

    const localName = await resolveLocalFileName(1, 'report.txt');

    expect(localName).toBe('report (1).txt');
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  test('a corrupted registry file is treated as empty rather than thrown', async () => {
    mockReadFile.mockResolvedValue('not valid json');

    const localName = await resolveLocalFileName(1, 'report.txt');

    expect(localName).toBe('report.txt');
  });

  test('concurrent resolutions for the same never-before-seen name never race to the same result', async () => {
    const disk = new Set<string>();
    mockExists.mockImplementation((path: string) => Promise.resolve(disk.has(path)));
    let registry: Record<string, string> = {};
    mockReadFile.mockImplementation(() =>
      Object.keys(registry).length > 0
        ? Promise.resolve(JSON.stringify(registry))
        : Promise.reject(new Error('ENOENT')),
    );
    mockWriteFile.mockImplementation((_path: string, data: string) => {
      registry = JSON.parse(data);
      for (const name of Object.values(registry)) {
        disk.add(`/mock/downloads/Relay/${name}`);
      }
      return Promise.resolve();
    });

    const [first, second] = await Promise.all([
      resolveLocalFileName(10, 'report.txt'),
      resolveLocalFileName(20, 'report.txt'),
    ]);

    expect(new Set([first, second]).size).toBe(2);
    expect([first, second].sort()).toEqual(['report (1).txt', 'report.txt']);
  });

  // Mirrors folderIdentity.test.ts's own "reserved before materialized"
  // regression: a name is taken the moment it's reserved in the registry,
  // even before either file's bytes have actually landed on disk.
  test('two never-before-seen same-named files never collide even before either exists on disk', async () => {
    let registry: Record<string, string> = {};
    mockExists.mockResolvedValue(false);
    mockReadFile.mockImplementation(() =>
      Object.keys(registry).length > 0
        ? Promise.resolve(JSON.stringify(registry))
        : Promise.reject(new Error('ENOENT')),
    );
    mockWriteFile.mockImplementation((_path: string, data: string) => {
      registry = JSON.parse(data);
      return Promise.resolve();
    });

    const [first, second] = await Promise.all([
      resolveLocalFileName(10, 'report.txt'),
      resolveLocalFileName(20, 'report.txt'),
    ]);

    expect(new Set([first, second]).size).toBe(2);
    expect([first, second].sort()).toEqual(['report (1).txt', 'report.txt']);
  });

  describe('under a custom SAF download location (P14.3)', () => {
    const treeUri = 'content://com.android.externalstorage.documents/tree/primary%3APhotos';

    beforeEach(async () => {
      await DownloadLocationManager.setLocation({ mode: 'custom', treeUri, displayName: 'Photos' });
    });

    afterEach(async () => {
      await DownloadLocationManager.resetToDefault();
    });

    test('checks name availability against the custom SAF tree, not MediaStore', async () => {
      (SafX.exists as jest.Mock).mockImplementation((uri: string) => Promise.resolve(uri === `${treeUri}/report.txt`));

      const localName = await resolveLocalFileName(1, 'report.txt');

      expect(localName).toBe('report (1).txt');
      expect(SafX.exists).toHaveBeenCalledWith(`${treeUri}/report.txt`);
      expect(mockExists).not.toHaveBeenCalled();
    });
  });
});

describe('readAllLocalFileNames (P16)', () => {
  test('returns every file\'s resolved on-device name, keyed numerically', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ '1': 'report.txt', '2': 'report (1).txt' }));

    const all = await readAllLocalFileNames();

    expect(all).toEqual({ 1: 'report.txt', 2: 'report (1).txt' });
  });

  test('empty object when no registry file exists yet', async () => {
    const all = await readAllLocalFileNames();
    expect(all).toEqual({});
  });
});
