import { mergeLiveTransferState } from '../../src/transfers/mergeLiveTransferState';
import { TransferResponse } from '../../src/api/types';
import { StreamState } from '../../src/streaming/types';

const baseTransfer: TransferResponse = {
  id: 1,
  device_id: 1,
  shared_file_id: 5,
  direction: 'send',
  file_name: 'report.pdf',
  file_size: 1000,
  device_name: 'Pixel 7',
  status: 'in_progress',
  bytes_transferred: 200,
  failure_reason: null,
  started_at: '2026-01-01T00:00:00Z',
  completed_at: null,
};

const baseStream: StreamState = {
  transferId: 1,
  direction: 'send',
  fileName: 'report.pdf',
  bytesTransferred: 400,
  totalBytes: 1000,
  status: 'streaming',
  error: null,
};

test('no stream: falls back to server transfer fields entirely', () => {
  const result = mergeLiveTransferState(baseTransfer, null);

  expect(result).toEqual({
    status: 'in_progress',
    bytesTransferred: 200,
    totalBytes: 1000,
    showCancel: true,
  });
});

test('stream for a different transfer: ignored, falls back to server fields', () => {
  const otherStream: StreamState = { ...baseStream, transferId: 2 };

  const result = mergeLiveTransferState(baseTransfer, otherStream);

  expect(result.status).toBe('in_progress');
  expect(result.bytesTransferred).toBe(200);
  expect(result.showCancel).toBe(true);
});

test('server already terminal: server wins outright even if a matching stream still says streaming', () => {
  const completedTransfer: TransferResponse = { ...baseTransfer, status: 'completed', bytes_transferred: 1000 };

  const result = mergeLiveTransferState(completedTransfer, baseStream);

  expect(result).toEqual({
    status: 'completed',
    bytesTransferred: 1000,
    totalBytes: 1000,
    showCancel: false,
  });
});

test('server already completed, stream locally failed: server wins outright — this is what TransferProgressDetail relies on to avoid showing a stale "Download interrupted" error underneath a Completed transfer (P9)', () => {
  const completedTransfer: TransferResponse = { ...baseTransfer, status: 'completed', bytes_transferred: 1000 };
  const failedStream: StreamState = { ...baseStream, status: 'failed', error: 'Download interrupted.' };

  const result = mergeLiveTransferState(completedTransfer, failedStream);

  expect(result).toEqual({
    status: 'completed',
    bytesTransferred: 1000,
    totalBytes: 1000,
    showCancel: false,
  });
});

test('server in_progress, stream streaming: prefers the live byte count', () => {
  const result = mergeLiveTransferState(baseTransfer, baseStream);

  expect(result).toEqual({
    status: 'in_progress',
    bytesTransferred: 400,
    totalBytes: 1000,
    showCancel: true,
  });
});

test('server still in_progress, stream already completed: local terminal status wins ahead of the next poll', () => {
  const finishedStream: StreamState = { ...baseStream, status: 'completed', bytesTransferred: 1000 };

  const result = mergeLiveTransferState(baseTransfer, finishedStream);

  expect(result).toEqual({
    status: 'completed',
    bytesTransferred: 1000,
    totalBytes: 1000,
    showCancel: false,
  });
});

test('server still in_progress, stream already cancelled: local terminal status wins and Cancel is hidden', () => {
  const cancelledStream: StreamState = { ...baseStream, status: 'cancelled' };

  const result = mergeLiveTransferState(baseTransfer, cancelledStream);

  expect(result.status).toBe('cancelled');
  expect(result.showCancel).toBe(false);
});

test('server still in_progress, stream already failed: local terminal status wins', () => {
  const failedStream: StreamState = { ...baseStream, status: 'failed', error: 'Network error' };

  const result = mergeLiveTransferState(baseTransfer, failedStream);

  expect(result.status).toBe('failed');
  expect(result.showCancel).toBe(false);
});
