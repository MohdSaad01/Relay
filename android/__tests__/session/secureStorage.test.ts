import * as Keychain from 'react-native-keychain';
import { clearSession, loadSession, saveSession } from '../../src/session/secureStorage';
import { Session } from '../../src/session/types';

const sampleSession: Session = {
  device_id: 1,
  device_identifier: 'abc-123',
  device_secret: 'device-secret',
  session_token: 'session-token',
  session_expires_at: '2026-01-01T00:00:00Z',
  desktop_base_url: 'http://192.168.1.10:8000/api/v1',
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('saveSession stores the session as JSON under the fixed service', async () => {
  await saveSession(sampleSession);

  expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
    'relay-session',
    JSON.stringify(sampleSession),
    { service: 'com.relay.mobile.session' },
  );
});

test('loadSession parses a previously stored session', async () => {
  (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
    username: 'relay-session',
    password: JSON.stringify(sampleSession),
    service: 'com.relay.mobile.session',
    storage: 'Keystore',
  });

  await expect(loadSession()).resolves.toEqual(sampleSession);
  expect(Keychain.getGenericPassword).toHaveBeenCalledWith({ service: 'com.relay.mobile.session' });
});

test('loadSession returns null when nothing is stored', async () => {
  (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);
  await expect(loadSession()).resolves.toBeNull();
});

test('loadSession returns null, not a throw, for a corrupted entry', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({ password: 'not-json' });

  await expect(loadSession()).resolves.toBeNull();
});

test('clearSession resets the keychain entry for the fixed service', async () => {
  await clearSession();
  expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({ service: 'com.relay.mobile.session' });
});
