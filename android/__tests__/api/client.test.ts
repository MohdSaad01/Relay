import { apiClient, ApiError } from '../../src/api/client';
import { clearApiConfig, setApiConfig } from '../../src/api/config';

function mockFetchOnce(status: number, body: unknown) {
  (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  globalThis.fetch = jest.fn();
  clearApiConfig();
});

test('unwraps envelope data on success', async () => {
  setApiConfig({ baseUrl: 'http://desktop:8000/api/v1' });
  mockFetchOnce(200, { success: true, message: 'ok', data: { id: 1 } });

  const result = await apiClient.get('/files');

  expect(result).toEqual({ id: 1 });
  expect(globalThis.fetch).toHaveBeenCalledWith(
    'http://desktop:8000/api/v1/files',
    expect.objectContaining({ method: 'GET' }),
  );
});

test('throws ApiError with the backend message when success is false', async () => {
  setApiConfig({ baseUrl: 'http://desktop:8000/api/v1' });
  mockFetchOnce(404, { success: false, message: 'Transfer not found.', data: null });

  await expect(apiClient.get('/transfers/999')).rejects.toMatchObject(
    new ApiError('Transfer not found.', 404),
  );
});

test('attaches a bearer token when a session is configured', async () => {
  setApiConfig({ baseUrl: 'http://desktop:8000/api/v1', sessionToken: 'abc123' });
  mockFetchOnce(200, { success: true, message: '', data: [] });

  await apiClient.get('/files');

  const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
  expect(init.headers.Authorization).toBe('Bearer abc123');
});

test('omits the Authorization header when no session is configured', async () => {
  setApiConfig({ baseUrl: 'http://desktop:8000/api/v1' });
  mockFetchOnce(200, { success: true, message: '', data: {} });

  await apiClient.post('/pairing/request', { foo: 'bar' });

  const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
  expect(init.headers.Authorization).toBeUndefined();
});

test('an explicit baseUrl overrides the configured one, for pre-session pairing calls', async () => {
  setApiConfig({ baseUrl: 'http://configured:8000/api/v1' });
  mockFetchOnce(200, { success: true, message: '', data: { status: 'awaiting_approval' } });

  await apiClient.post('/pairing/request', { foo: 'bar' }, 'http://scanned-qr:8000/api/v1');

  expect(globalThis.fetch).toHaveBeenCalledWith(
    'http://scanned-qr:8000/api/v1/pairing/request',
    expect.anything(),
  );
});

test('throws without making a request when no base URL is configured or provided', async () => {
  await expect(apiClient.get('/files')).rejects.toMatchObject(
    new ApiError('No backend configured for this request.', 0),
  );
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('returns undefined for a 204 No Content response', async () => {
  setApiConfig({ baseUrl: 'http://desktop:8000/api/v1' });
  (globalThis.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 204 });

  await expect(apiClient.del('/transfers/requests/abc')).resolves.toBeUndefined();
});

test('wraps a network failure as an ApiError with a user-facing message', async () => {
  setApiConfig({ baseUrl: 'http://desktop:8000/api/v1' });
  (globalThis.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network request failed'));

  await expect(apiClient.get('/files')).rejects.toMatchObject(
    new ApiError(
      'Unable to reach Relay Desktop. Make sure the PC is running Relay and both devices are on the same network.',
      0,
    ),
  );
});

// Regression coverage for P31.1: the request-timeout AbortController
// (REQUEST_TIMEOUT_MS) firing produces exactly this shape of rejection —
// a DOMException/Error named "AbortError" — on both a genuine timeout and
// (historically, via the now-removed [QR-DEBUG] console.error) whenever a
// poll happened to outlive its caller. It must be handled the same way as
// any other network failure: converted to the friendly ApiError below,
// never logged as a console error (which triggers React Native's dev-only
// Console Error overlay even though the caller already handles it).
test('wraps an AbortError (request timeout) as the same friendly ApiError, without logging it as an error', async () => {
  setApiConfig({ baseUrl: 'http://desktop:8000/api/v1' });
  const abortError = new Error('Aborted');
  abortError.name = 'AbortError';
  (globalThis.fetch as jest.Mock).mockRejectedValueOnce(abortError);
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

  await expect(apiClient.get('/pairing/result/abc')).rejects.toMatchObject(
    new ApiError(
      'Unable to reach Relay Desktop. Make sure the PC is running Relay and both devices are on the same network.',
      0,
    ),
  );
  expect(consoleErrorSpy).not.toHaveBeenCalled();
  expect(consoleWarnSpy).not.toHaveBeenCalled();

  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

test('a successful request never logs to console.error or console.warn', async () => {
  setApiConfig({ baseUrl: 'http://desktop:8000/api/v1' });
  mockFetchOnce(200, { success: true, message: 'ok', data: { status: 'awaiting_approval' } });
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

  await apiClient.get('/pairing/result/abc');

  expect(consoleErrorSpy).not.toHaveBeenCalled();
  expect(consoleWarnSpy).not.toHaveBeenCalled();

  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});
