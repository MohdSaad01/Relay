import ReactNativeBlobUtil from 'react-native-blob-util';
import { readDownloadLocation, writeDownloadLocation } from '../../src/settings/downloadLocationStore';

const mockReadFile = ReactNativeBlobUtil.fs.readFile as jest.Mock;
const mockWriteFile = ReactNativeBlobUtil.fs.writeFile as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('readDownloadLocation', () => {
  test('falls back to default when no file exists yet', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

    await expect(readDownloadLocation()).resolves.toEqual({ mode: 'default' });
  });

  test('falls back to default when the stored JSON is corrupted', async () => {
    mockReadFile.mockResolvedValueOnce('not valid json');

    await expect(readDownloadLocation()).resolves.toEqual({ mode: 'default' });
  });

  test('falls back to default when a stored custom location is missing required fields', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ mode: 'custom' }));

    await expect(readDownloadLocation()).resolves.toEqual({ mode: 'default' });
  });

  test('reads back a persisted custom location', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ mode: 'custom', treeUri: 'content://tree/a', displayName: 'MyFolder' }),
    );

    await expect(readDownloadLocation()).resolves.toEqual({
      mode: 'custom',
      treeUri: 'content://tree/a',
      displayName: 'MyFolder',
    });
  });
});

describe('writeDownloadLocation', () => {
  test('persists the location as JSON to the private store path', async () => {
    await writeDownloadLocation({ mode: 'custom', treeUri: 'content://tree/a', displayName: 'MyFolder' });

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('relay-download-location.json'),
      JSON.stringify({ mode: 'custom', treeUri: 'content://tree/a', displayName: 'MyFolder' }),
      'utf8',
    );
  });
});
