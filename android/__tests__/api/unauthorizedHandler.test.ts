jest.mock('../../src/session/secureStorage');

import { apiClient } from '../../src/api/client';
import { clearApiConfig, getApiConfig, setApiConfig } from '../../src/api/config';
import { SessionManager } from '../../src/session/SessionManager';
import * as secureStorage from '../../src/session/secureStorage';

beforeEach(() => {
  jest.clearAllMocks();
  clearApiConfig();
  globalThis.fetch = jest.fn();
});

test('a 401 response clears the session everywhere before the request rejects', async () => {
  setApiConfig({ baseUrl: 'http://desktop:8000/api/v1', sessionToken: 'expired-token' });
  (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    status: 401,
    json: () =>
      Promise.resolve({ success: false, message: 'Invalid or expired session.', data: null }),
  });

  await expect(apiClient.get('/files')).rejects.toMatchObject({ status: 401 });

  expect(secureStorage.clearSession).toHaveBeenCalled();
  expect(SessionManager.getSession()).toBeNull();
  expect(getApiConfig()).toEqual({ baseUrl: null, sessionToken: null });
});

test('a non-401 error does not touch the session', async () => {
  setApiConfig({ baseUrl: 'http://desktop:8000/api/v1', sessionToken: 'still-valid' });
  (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    status: 404,
    json: () => Promise.resolve({ success: false, message: 'Transfer not found.', data: null }),
  });

  await expect(apiClient.get('/transfers/999')).rejects.toMatchObject({ status: 404 });

  expect(secureStorage.clearSession).not.toHaveBeenCalled();
  expect(getApiConfig().sessionToken).toBe('still-valid');
});
