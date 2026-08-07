import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  getReconciledChildren,
  markFolderReconciled,
  readAllLocalRoots,
  readAllReconciledChildren,
  resolveLocalFolderRoot,
} from '../../src/files/folderIdentity';

const mockReadFile = ReactNativeBlobUtil.fs.readFile as jest.Mock;
const mockWriteFile = ReactNativeBlobUtil.fs.writeFile as jest.Mock;
const mockExists = ReactNativeBlobUtil.fs.exists as jest.Mock;

let versionSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  // downloadedFilePath (and therefore this module's own on-device existence
  // checks) branches on the MediaStore-capable SDK threshold — pin it to
  // API 29+ so every check below resolves under the public
  // LegacyDownloadDir/Relay path, matching downloadActions.test.ts's own
  // convention.
  versionSpy = jest.spyOn(Platform, 'Version', 'get').mockReturnValue(29);
  mockReadFile.mockRejectedValue(new Error('ENOENT'));
  mockWriteFile.mockResolvedValue(undefined);
  mockExists.mockResolvedValue(false);
});

afterEach(() => {
  versionSpy.mockRestore();
});

describe('resolveLocalFolderRoot (P13.2, Issue 1)', () => {
  test('resolves to the raw folder name when nothing is on-device or registered yet', async () => {
    const localRoot = await resolveLocalFolderRoot(1, 'test');

    expect(localRoot).toBe('test');
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('relay-folder-registry.json'),
      JSON.stringify({ '1': { localRoot: 'test' } }),
      'utf8',
    );
  });

  // P13.2, Issue 1's core scenario: two different shared folders ("id 1" and
  // "id 2") that both happen to be named "test".
  test('appends "(1)" when the raw name is already occupied on-device by a different folder', async () => {
    // id 1 already resolved to the bare "test" directory, which now really
    // exists on disk (a previous download).
    mockReadFile.mockResolvedValue(JSON.stringify({ '1': { localRoot: 'test' } }));
    mockExists.mockImplementation((path: string) => Promise.resolve(path.endsWith('/test')));

    const localRoot = await resolveLocalFolderRoot(2, 'test');

    expect(localRoot).toBe('test (1)');
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({ '1': { localRoot: 'test' }, '2': { localRoot: 'test (1)' } }),
      'utf8',
    );
  });

  test('keeps incrementing past an already-registered "(1)" until a free name is found', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({ '1': { localRoot: 'test' }, '2': { localRoot: 'test (1)' } }),
    );
    mockExists.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith('/test') || path.endsWith('/test (1)')),
    );

    const localRoot = await resolveLocalFolderRoot(3, 'test');

    expect(localRoot).toBe('test (2)');
  });

  test('reuses an already-registered mapping for the same shared_folder_id without touching the filesystem again', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ '5': { localRoot: 'Alpha (1)' } }));

    const localRoot = await resolveLocalFolderRoot(5, 'Alpha');

    expect(localRoot).toBe('Alpha (1)');
    expect(mockExists).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  test('a corrupted registry file is treated as empty rather than thrown', async () => {
    mockReadFile.mockResolvedValue('not valid json');

    const localRoot = await resolveLocalFolderRoot(1, 'test');

    expect(localRoot).toBe('test');
  });

  // Regression: physical-device verification found a registry file written
  // by this feature's own earlier (pre-reconciliation-record) shape still
  // on disk — a bare `{ "1": "test (1)" }` string, not today's
  // `{ localRoot, reconciledChildren }` object. Reading `existing.localRoot`
  // off a raw string silently resolves to undefined rather than throwing,
  // which corrupted every path built from it.
  test('a legacy bare-string registry entry is read as its localRoot, not as undefined', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ '1': 'test (1)' }));

    const localRoot = await resolveLocalFolderRoot(1, 'test');

    expect(localRoot).toBe('test (1)');
    expect(mockExists).not.toHaveBeenCalled();
  });

  test('preserves an existing reconciledChildren record when only the root is being resolved', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({ '1': { localRoot: 'test', reconciledChildren: { 'a.txt': 100 } } }),
    );

    await resolveLocalFolderRoot(1, 'test');

    // Already registered — no write should happen, and therefore nothing to
    // clobber, but this pins the expectation that a *fresh* resolution
    // (below, via markFolderReconciled interleaving) never drops a sibling
    // field it isn't responsible for.
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  test('concurrent resolutions for the same never-before-seen name never race to the same result', async () => {
    // Neither call observes the other's write until this shared mock state is
    // updated — simulates two folders named "test" being downloaded via
    // near-simultaneous taps (e.g. two empty folders, which resolve outside
    // TransferStreamManager's own one-active-stream serialization).
    const disk = new Set<string>();
    mockExists.mockImplementation((path: string) => Promise.resolve(disk.has(path)));
    let registry: Record<string, { localRoot: string }> = {};
    mockReadFile.mockImplementation(() =>
      Object.keys(registry).length > 0
        ? Promise.resolve(JSON.stringify(registry))
        : Promise.reject(new Error('ENOENT')),
    );
    mockWriteFile.mockImplementation((_path: string, data: string) => {
      registry = JSON.parse(data);
      for (const entry of Object.values(registry)) {
        disk.add(`/mock/downloads/Relay/${entry.localRoot}`);
      }
      return Promise.resolve();
    });

    const [first, second] = await Promise.all([
      resolveLocalFolderRoot(10, 'test'),
      resolveLocalFolderRoot(20, 'test'),
    ]);

    expect(new Set([first, second]).size).toBe(2);
    expect([first, second].sort()).toEqual(['test', 'test (1)']);
  });

  // P13.3 (Problem 2): the real bug the test above didn't actually catch.
  // Its mockWriteFile implementation optimistically added every registry
  // entry to `disk` the moment the registry was *written*, which is not how
  // the app behaves in production: writeRegistry only persists the JSON
  // mapping file, the physical directory isn't created until
  // TransferStreamManager actually streams a first child into it (or, for
  // an empty folder, ensureEmptyFolderStaged runs) — which can happen much
  // later (queued behind another transfer, a large first file, etc). This
  // test keeps `disk` genuinely empty throughout (mirroring "neither
  // folder's bytes have started moving yet") to prove the fix (checking
  // already-*reserved* registry names, not just what's materialized on
  // disk) is what actually prevents the collision — confirmed live on
  // device as the root cause of the "test / test(1) / test" naming
  // inconsistency reported in the P13.3 audit.
  test('two never-before-seen same-named folders never collide even before either exists on disk', async () => {
    let registry: Record<string, { localRoot: string }> = {};
    mockExists.mockResolvedValue(false); // neither folder's bytes have landed yet
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
      resolveLocalFolderRoot(10, 'test'),
      resolveLocalFolderRoot(20, 'test'),
    ]);

    expect(new Set([first, second]).size).toBe(2);
    expect([first, second].sort()).toEqual(['test', 'test (1)']);
    expect(mockExists).toHaveBeenCalled(); // still consults the filesystem as a second check
  });

  // A name already claimed by another folder's registry entry is treated as
  // taken even when nothing has verified it against the filesystem at all
  // (mockExists never resolves true here) — the registry itself, not disk
  // state, is what should have decided this the moment the first folder's
  // root was resolved.
  test('a name already reserved in the registry is skipped even if the filesystem has no record of it', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ '1': { localRoot: 'test' } }));
    mockExists.mockResolvedValue(false);

    const localRoot = await resolveLocalFolderRoot(2, 'test');

    expect(localRoot).toBe('test (1)');
  });
});

describe('markFolderReconciled / getReconciledChildren (P13.2, Issue 2)', () => {
  test('writes exactly the given children, keyed by relative_path', async () => {
    await markFolderReconciled(3, [
      { relative_path: 'notes.txt', file_size: 23 },
      { relative_path: 'images/cat.jpg', file_size: 24 },
    ]);

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({
        '3': { localRoot: '', reconciledChildren: { 'notes.txt': 23, 'images/cat.jpg': 24 } },
      }),
      'utf8',
    );
  });

  test('preserves an existing localRoot mapping when reconciling', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ '3': { localRoot: 'Alpha' } }));

    await markFolderReconciled(3, [{ relative_path: 'notes.txt', file_size: 23 }]);

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({ '3': { localRoot: 'Alpha', reconciledChildren: { 'notes.txt': 23 } } }),
      'utf8',
    );
  });

  // The regression this whole design change fixed: re-reconciling with a
  // *smaller* child set (a file removed from the share) must fully replace
  // the previous record, not merge into it — otherwise the removed file's
  // entry would linger forever, exactly like it did in Transfer history.
  test('a later reconciliation with fewer children drops the removed entry entirely', async () => {
    // Stateful across calls (unlike the other tests' one-shot mocks) — this
    // test specifically checks that a *subsequent* read observes what the
    // write actually persisted, not just that writeFile was called with the
    // right JSON.
    let stored = JSON.stringify({
      '3': { localRoot: 'Alpha', reconciledChildren: { 'a.txt': 100, 'b.txt': 200 } },
    });
    mockReadFile.mockImplementation(() => Promise.resolve(stored));
    mockWriteFile.mockImplementation((_path: string, data: string) => {
      stored = data;
      return Promise.resolve();
    });

    await markFolderReconciled(3, [{ relative_path: 'a.txt', file_size: 100 }]);

    const reconciled = await getReconciledChildren(3);
    expect(reconciled).toEqual({ 'a.txt': 100 });
  });

  test('getReconciledChildren returns null for a folder that has never been reconciled', async () => {
    const reconciled = await getReconciledChildren(999);
    expect(reconciled).toBeNull();
  });
});

describe('readAllReconciledChildren (P13.2, Issue 2)', () => {
  test('returns every folder\'s record, keyed numerically, skipping folders with none', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        '1': { localRoot: 'test', reconciledChildren: { 'a.txt': 100 } },
        '2': { localRoot: 'Alpha' }, // resolved but never reconciled
      }),
    );

    const all = await readAllReconciledChildren();

    expect(all).toEqual({ 1: { 'a.txt': 100 } });
  });

  test('empty object when no registry file exists yet', async () => {
    const all = await readAllReconciledChildren();
    expect(all).toEqual({});
  });
});

describe('readAllLocalRoots (P13.3)', () => {
  test('returns every folder\'s resolved root name, keyed numerically', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        '1': { localRoot: 'test', reconciledChildren: { 'a.txt': 100 } },
        '2': { localRoot: 'Alpha' },
      }),
    );

    const all = await readAllLocalRoots();

    expect(all).toEqual({ 1: 'test', 2: 'Alpha' });
  });

  test('empty object when no registry file exists yet', async () => {
    const all = await readAllLocalRoots();
    expect(all).toEqual({});
  });
});
