import ReactNativeBlobUtil from 'react-native-blob-util';
import { markItemRemoved, readRemovedIds } from '../../src/files/removedItems';

const mockReadFile = ReactNativeBlobUtil.fs.readFile as jest.Mock;
const mockWriteFile = ReactNativeBlobUtil.fs.writeFile as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockReadFile.mockRejectedValue(new Error('ENOENT'));
  mockWriteFile.mockResolvedValue(undefined);
});

describe('markItemRemoved', () => {
  test('writes a dismissal for the given kind/id/sharedAt', async () => {
    await markItemRemoved('file', 5, '2026-08-10T00:00:00');

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('relay-removed-items.json'),
      JSON.stringify({ file: { '5': { sharedAt: '2026-08-10T00:00:00' } }, folder: {} }),
      'utf8',
    );
  });

  test('keeps file and folder dismissals independent even when ids collide', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ file: { '1': { sharedAt: 'a' } }, folder: {} }),
    );

    await markItemRemoved('folder', 1, 'b');

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({ file: { '1': { sharedAt: 'a' } }, folder: { '1': { sharedAt: 'b' } } }),
      'utf8',
    );
  });
});

describe('readRemovedIds', () => {
  test('returns an empty set when nothing has been removed', async () => {
    const result = await readRemovedIds('file', [{ id: 1, shared_at: 'a' }]);
    expect(result).toEqual(new Set());
  });

  test('includes a live item whose id was dismissed at its current sharedAt', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ file: { '1': { sharedAt: 'a' } }, folder: {} }));

    const result = await readRemovedIds('file', [{ id: 1, shared_at: 'a' }]);
    expect(result).toEqual(new Set([1]));
  });

  // P17: a dismissed id later reused by a different logical file (a
  // re-share after the original was unshared, or a brand-new share that
  // happens to land on the same reused SQLite rowid) must not inherit the
  // old dismissal.
  test('excludes a live item whose id was dismissed under a different sharedAt (id reuse)', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ file: { '1': { sharedAt: 'old' } }, folder: {} }));

    const result = await readRemovedIds('file', [{ id: 1, shared_at: 'new' }]);
    expect(result).toEqual(new Set());
  });

  test('only reports ids that are both dismissed and currently live', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({ file: { '1': { sharedAt: 'a' }, '2': { sharedAt: 'b' } }, folder: {} }),
    );

    // id 2's dismissal exists but it's no longer in the live list (e.g. unshared).
    const result = await readRemovedIds('file', [{ id: 1, shared_at: 'a' }]);
    expect(result).toEqual(new Set([1]));
  });

  test('a corrupted registry file is treated as nothing removed', async () => {
    mockReadFile.mockResolvedValue('not json');

    const result = await readRemovedIds('file', [{ id: 1, shared_at: 'a' }]);
    expect(result).toEqual(new Set());
  });
});
