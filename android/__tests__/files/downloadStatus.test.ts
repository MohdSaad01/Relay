import { deriveDownloadStatus, latestSendTransferId } from '../../src/files/downloadStatus';
import { TransferRequestResponse, TransferResponse } from '../../src/api/types';

function request(overrides: Partial<TransferRequestResponse> = {}): TransferRequestResponse {
  return {
    request_id: 'req-1',
    direction: 'send',
    status: 'pending',
    device_id: 1,
    device_name: 'Pixel 7',
    shared_file_id: 5,
    file_name: 'report.pdf',
    file_size: 2048,
    created_at: '2026-01-01T00:00:00Z',
    expires_at: '2026-01-01T00:02:00Z',
    transfer_id: null,
    ...overrides,
  };
}

function transfer(overrides: Partial<TransferResponse> = {}): TransferResponse {
  return {
    id: 1,
    device_id: 1,
    shared_file_id: 5,
    direction: 'send',
    file_name: 'report.pdf',
    file_size: 2048,
    device_name: 'Pixel 7',
    status: 'in_progress',
    bytes_transferred: 0,
    failure_reason: null,
    started_at: '2026-01-01T00:00:00Z',
    completed_at: null,
    ...overrides,
  };
}

test('idle when neither a pending request nor a transfer references the file', () => {
  expect(deriveDownloadStatus(5, [], [])).toEqual({ kind: 'idle' });
});

test('pending while a proposed request is still awaiting the desktop decision', () => {
  expect(deriveDownloadStatus(5, [request()], [])).toEqual({ kind: 'pending' });
});

test('in_progress once the desktop accepts and a Transfer row exists', () => {
  // The accepted request has already dropped out of the pending-requests list server-side.
  expect(deriveDownloadStatus(5, [], [transfer({ status: 'in_progress' })])).toEqual({
    kind: 'in_progress',
  });
});

test('completed once the transfer finishes — this is the case that used to stay stuck on "Requested"', () => {
  expect(deriveDownloadStatus(5, [], [transfer({ status: 'completed' })])).toEqual({
    kind: 'completed',
  });
});

test('failed surfaces the failure reason', () => {
  expect(
    deriveDownloadStatus(5, [], [transfer({ status: 'failed', failure_reason: 'Connection lost' })]),
  ).toEqual({ kind: 'failed', message: 'Connection lost' });
});

test('cancelled transfers fall back to idle so the file can be requested again', () => {
  expect(deriveDownloadStatus(5, [], [transfer({ status: 'cancelled' })])).toEqual({ kind: 'idle' });
});

test('a transfer takes priority over a stale pending request for the same file', () => {
  expect(
    deriveDownloadStatus(5, [request()], [transfer({ status: 'completed' })]),
  ).toEqual({ kind: 'completed' });
});

test('the most recent transfer wins when a file was downloaded more than once', () => {
  const older = transfer({ id: 1, status: 'failed', failure_reason: 'boom' });
  const newer = transfer({ id: 2, status: 'completed' });
  expect(deriveDownloadStatus(5, [], [older, newer])).toEqual({ kind: 'completed' });
});

test('ignores requests/transfers for other files', () => {
  expect(
    deriveDownloadStatus(5, [request({ shared_file_id: 9 })], [transfer({ shared_file_id: 9 })]),
  ).toEqual({ kind: 'idle' });
});

test('ignores upload transfers (direction receive) even if shared_file_id happens to match', () => {
  expect(deriveDownloadStatus(5, [], [transfer({ direction: 'receive' })])).toEqual({ kind: 'idle' });
});

test('completed stays completed when fileExists is omitted (not checked yet)', () => {
  expect(deriveDownloadStatus(5, [], [transfer({ status: 'completed' })])).toEqual({ kind: 'completed' });
});

test('completed stays completed when fileExists is true', () => {
  expect(deriveDownloadStatus(5, [], [transfer({ status: 'completed' })], true)).toEqual({ kind: 'completed' });
});

test('completed downgrades to idle when fileExists is explicitly false — the deleted-download case', () => {
  expect(deriveDownloadStatus(5, [], [transfer({ status: 'completed' })], false)).toEqual({ kind: 'idle' });
});

test('fileExists is irrelevant to non-completed statuses', () => {
  expect(deriveDownloadStatus(5, [], [transfer({ status: 'in_progress' })], false)).toEqual({
    kind: 'in_progress',
  });
});

// P13.3 (queue investigation): latestSendTransferId returns a *transfer* id,
// a completely different id space from the shared_file_id every caller here
// otherwise deals in. Regression coverage for a real bug caught during
// physical-device verification: FilesScreen originally passed a
// shared_file_id straight to TransferStreamManager.isActive (which compares
// against a transfer id), so the "is this row's download actually streaming
// right now" check silently always returned false.
describe('latestSendTransferId', () => {
  test('undefined when no transfer references the file', () => {
    expect(latestSendTransferId(5, [])).toBeUndefined();
  });

  test('returns the matching send transfer\'s own id, not the shared_file_id', () => {
    expect(latestSendTransferId(5, [transfer({ id: 999, shared_file_id: 5 })])).toBe(999);
  });

  test('ignores a receive-direction transfer for the same shared_file_id', () => {
    expect(latestSendTransferId(5, [transfer({ id: 999, shared_file_id: 5, direction: 'receive' })])).toBeUndefined();
  });

  test('picks the most recent (highest id) send transfer when several exist for the same file', () => {
    const transfers = [
      transfer({ id: 10, shared_file_id: 5, status: 'failed' }),
      transfer({ id: 30, shared_file_id: 5, status: 'in_progress' }),
      transfer({ id: 20, shared_file_id: 5, status: 'cancelled' }),
    ];
    expect(latestSendTransferId(5, transfers)).toBe(30);
  });
});
