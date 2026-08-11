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
