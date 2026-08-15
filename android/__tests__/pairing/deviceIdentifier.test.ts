import ReactNativeBlobUtil from 'react-native-blob-util';
import { getOrCreateDeviceIdentifier } from '../../src/pairing/deviceIdentifier';

const mockReadFile = ReactNativeBlobUtil.fs.readFile as jest.Mock;
const mockWriteFile = ReactNativeBlobUtil.fs.writeFile as jest.Mock;

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeEach(() => {
  jest.clearAllMocks();
  mockReadFile.mockRejectedValue(new Error('ENOENT'));
  mockWriteFile.mockResolvedValue(undefined);
});

test('generates and persists a well-formed UUID v4 when nothing is stored yet', async () => {
  const identifier = await getOrCreateDeviceIdentifier();

  expect(identifier).toMatch(UUID_V4_PATTERN);
  expect(mockWriteFile).toHaveBeenCalledWith(
    expect.stringContaining('relay-device-identity.json'),
    JSON.stringify({ device_identifier: identifier }),
    'utf8'
  );
});

test('reuses the persisted identifier instead of generating a new one', async () => {
  mockReadFile.mockResolvedValue(JSON.stringify({ device_identifier: 'existing-uuid-1' }));

  const identifier = await getOrCreateDeviceIdentifier();

  expect(identifier).toBe('existing-uuid-1');
  expect(mockWriteFile).not.toHaveBeenCalled();
});

test('treats a corrupted stored file the same as no file — generates a fresh identifier', async () => {
  mockReadFile.mockResolvedValue('not valid json');

  const identifier = await getOrCreateDeviceIdentifier();

  expect(identifier).toMatch(UUID_V4_PATTERN);
  expect(mockWriteFile).toHaveBeenCalled();
});

test('treats an empty stored device_identifier the same as no file — generates a fresh identifier', async () => {
  mockReadFile.mockResolvedValue(JSON.stringify({ device_identifier: '' }));

  const identifier = await getOrCreateDeviceIdentifier();

  expect(identifier).toMatch(UUID_V4_PATTERN);
  expect(mockWriteFile).toHaveBeenCalled();
});
