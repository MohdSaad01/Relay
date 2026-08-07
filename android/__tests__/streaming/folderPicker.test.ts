const mockOpenDocumentTree = jest.fn();
const mockListFiles = jest.fn();
const mockCopyFile = jest.fn();

jest.mock('react-native-saf-x', () => ({
  openDocumentTree: (...args: unknown[]) => mockOpenDocumentTree(...args),
  listFiles: (...args: unknown[]) => mockListFiles(...args),
  copyFile: (...args: unknown[]) => mockCopyFile(...args),
}));

import { materializeToLocalCache, pickAndEnumerateFolder } from '../../src/streaming/folderPicker';

beforeEach(() => {
  jest.clearAllMocks();
});

test('returns null when the user cancels the picker', async () => {
  mockOpenDocumentTree.mockResolvedValueOnce(null);

  const result = await pickAndEnumerateFolder();

  expect(result).toBeNull();
  expect(mockListFiles).not.toHaveBeenCalled();
});

test('requests a persisted grant (P13: works around a live "Unsupported Uri" listFiles() failure without it)', async () => {
  mockOpenDocumentTree.mockResolvedValueOnce(null);

  await pickAndEnumerateFolder();

  expect(mockOpenDocumentTree).toHaveBeenCalledWith(true);
});

test('enumerates a flat folder into a file manifest', async () => {
  mockOpenDocumentTree.mockResolvedValueOnce({
    uri: 'content://tree/root',
    name: 'Photos',
    type: 'directory',
    lastModified: 0,
    mime: '',
    size: 0,
  });
  mockListFiles.mockResolvedValueOnce([
    { uri: 'content://tree/root/a.jpg', name: 'a.jpg', type: 'file', size: 10, mime: 'image/jpeg', lastModified: 0 },
    { uri: 'content://tree/root/b.jpg', name: 'b.jpg', type: 'file', size: 20, mime: 'image/jpeg', lastModified: 0 },
  ]);

  const result = await pickAndEnumerateFolder();

  expect(result).toEqual({
    folderName: 'Photos',
    files: [
      { uri: 'content://tree/root/a.jpg', relativePath: 'a.jpg', size: 10, mimeType: 'image/jpeg' },
      { uri: 'content://tree/root/b.jpg', relativePath: 'b.jpg', size: 20, mimeType: 'image/jpeg' },
    ],
  });
});

test('recurses into subdirectories, building POSIX-style relative paths', async () => {
  mockOpenDocumentTree.mockResolvedValueOnce({
    uri: 'content://tree/root',
    name: 'University Notes',
    type: 'directory',
    lastModified: 0,
    mime: '',
    size: 0,
  });
  mockListFiles.mockImplementation(async (uri: string) => {
    if (uri === 'content://tree/root') {
      return [
        { uri: 'content://tree/root/Semester%201', name: 'Semester 1', type: 'directory', size: 0, mime: '', lastModified: 0 },
      ];
    }
    if (uri === 'content://tree/root/Semester%201') {
      return [
        { uri: 'content://tree/root/Semester%201/DBMS.pdf', name: 'DBMS.pdf', type: 'file', size: 5, mime: 'application/pdf', lastModified: 0 },
      ];
    }
    return [];
  });

  const result = await pickAndEnumerateFolder();

  expect(result?.files).toEqual([
    {
      uri: 'content://tree/root/Semester%201/DBMS.pdf',
      relativePath: 'Semester 1/DBMS.pdf',
      size: 5,
      mimeType: 'application/pdf',
    },
  ]);
});

test('returns an empty file list for an empty folder', async () => {
  mockOpenDocumentTree.mockResolvedValueOnce({
    uri: 'content://tree/root',
    name: 'Empty',
    type: 'directory',
    lastModified: 0,
    mime: '',
    size: 0,
  });
  mockListFiles.mockResolvedValueOnce([]);

  const result = await pickAndEnumerateFolder();

  expect(result).toEqual({ folderName: 'Empty', files: [] });
});

describe('materializeToLocalCache', () => {
  // P13, found live on a real device: react-native-blob-util's wrap() reads
  // zero bytes from a react-native-saf-x tree-child URI directly, so every
  // folder-upload file must first be copied to an ordinary local path.
  test('copies the SAF uri to a file:// path under the cache dir and returns the plain path', async () => {
    mockCopyFile.mockResolvedValueOnce({ uri: 'file:///mock/cache/relay-upload-1-a.jpg' });

    const path = await materializeToLocalCache('content://tree/root/a.jpg', 'a.jpg');

    expect(mockCopyFile).toHaveBeenCalledWith(
      'content://tree/root/a.jpg',
      expect.stringMatching(/^file:\/\/\/mock\/cache\/relay-upload-\d+-a\.jpg$/),
      { replaceIfDestinationExists: true },
    );
    expect(path).toMatch(/^\/mock\/cache\/relay-upload-\d+-a\.jpg$/);
  });
});
