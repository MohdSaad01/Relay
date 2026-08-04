import { deriveDownloadStatus } from '../../src/files/downloadStatus';
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
