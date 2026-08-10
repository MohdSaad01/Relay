jest.mock('../../src/session/secureStorage');

import * as secureStorage from '../../src/session/secureStorage';
import { SessionManager } from '../../src/session/SessionManager';
import { getApiConfig } from '../../src/api/config';
import { Session } from '../../src/session/types';

const sampleSession: Session = {
  device_id: 1,
  device_identifier: 'abc-123',
  device_secret: 'device-secret',
  session_token: 'session-token',
  session_expires_at: '2026-01-01T00:00:00Z',
  desktop_base_url: 'http://192.168.1.10:8000/api/v1',
  device_name: 'Test Phone',
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('restore() loads a persisted session into memory and api config', async () => {
  (secureStorage.loadSession as jest.Mock).mockResolvedValue(sampleSession);

  const result = await SessionManager.restore();

  expect(result).toEqual(sampleSession);
  expect(SessionManager.getSession()).toEqual(sampleSession);
  expect(SessionManager.isRestored()).toBe(true);
  expect(getApiConfig()).toEqual({
    baseUrl: sampleSession.desktop_base_url,
    sessionToken: sampleSession.session_token,
  });
});

test('restore() with nothing persisted leaves the session and api config empty', async () => {
  (secureStorage.loadSession as jest.Mock).mockResolvedValue(null);

  await SessionManager.restore();

  expect(SessionManager.getSession()).toBeNull();
  expect(getApiConfig()).toEqual({ baseUrl: null, sessionToken: null });
});

test('setSession persists it and activates it immediately', async () => {
  await SessionManager.setSession(sampleSession);

  expect(secureStorage.saveSession).toHaveBeenCalledWith(sampleSession);
  expect(SessionManager.getSession()).toEqual(sampleSession);
  expect(getApiConfig()).toEqual({
    baseUrl: sampleSession.desktop_base_url,
    sessionToken: sampleSession.session_token,
  });
});

test('clearSession removes it from storage, memory, and api config', async () => {
  await SessionManager.setSession(sampleSession);

  await SessionManager.clearSession();

  expect(secureStorage.clearSession).toHaveBeenCalled();
  expect(SessionManager.getSession()).toBeNull();
  expect(getApiConfig()).toEqual({ baseUrl: null, sessionToken: null });
});

test('updateDeviceName persists the new name and keeps the rest of the session intact', async () => {
  await SessionManager.setSession(sampleSession);

  await SessionManager.updateDeviceName('New Name');

  const expected = { ...sampleSession, device_name: 'New Name' };
  expect(secureStorage.saveSession).toHaveBeenLastCalledWith(expected);
  expect(SessionManager.getSession()).toEqual(expected);
});

test('updateDeviceName throws when there is no active session', async () => {
  await SessionManager.clearSession();

  await expect(SessionManager.updateDeviceName('New Name')).rejects.toThrow();
});

test('subscribe() notifies listeners on setSession and clearSession, not after unsubscribing', async () => {
  const listener = jest.fn();
  const unsubscribe = SessionManager.subscribe(listener);

  await SessionManager.setSession(sampleSession);
  expect(listener).toHaveBeenCalledTimes(1);

  await SessionManager.clearSession();
  expect(listener).toHaveBeenCalledTimes(2);

  unsubscribe();
  await SessionManager.setSession(sampleSession);
  expect(listener).toHaveBeenCalledTimes(2);
});
