import { deriveFolderDownloadStatus } from '../../src/files/folderDownloadStatus';
import { AvailableFolderFileResponse, TransferRequestResponse, TransferResponse } from '../../src/api/types';

function child(id: number, overrides: Partial<AvailableFolderFileResponse> = {}): AvailableFolderFileResponse {
  return {
    id,
    relative_path: `Semester 1/file-${id}.pdf`,
    file_size: 100,
    mime_type: 'application/pdf',
    ...overrides,
  };
}

function transfer(overrides: Partial<TransferResponse> = {}): TransferResponse {
  return {
    id: 1,
    device_id: 1,
    shared_file_id: 5,
    direction: 'send',
    file_name: 'file.pdf',
    file_size: 100,
    device_name: 'Pixel 7',
    status: 'in_progress',
    bytes_transferred: 0,
    failure_reason: null,
    started_at: '2026-01-01T00:00:00Z',
    completed_at: null,
    ...overrides,
  };
}

const noRequests: TransferRequestResponse[] = [];

test('idle with zero total for an empty folder', () => {
  expect(deriveFolderDownloadStatus([], noRequests, [])).toEqual({
    kind: 'idle',
    completedCount: 0,
    totalCount: 0,
  });
});

test('idle when no child has been requested or transferred', () => {
  const children = [child(1), child(2)];
  expect(deriveFolderDownloadStatus(children, noRequests, [])).toEqual({
    kind: 'idle',
    completedCount: 0,
    totalCount: 2,
  });
});

test('in_progress while any child is still streaming', () => {
  const children = [child(1), child(2)];
  const transfers = [
    transfer({ shared_file_id: 1, status: 'completed' }),
    transfer({ id: 2, shared_file_id: 2, status: 'in_progress' }),
  ];
  const status = deriveFolderDownloadStatus(children, noRequests, transfers);
  expect(status.kind).toBe('in_progress');
  expect(status.completedCount).toBe(1);
  expect(status.totalCount).toBe(2);
});

test('completed only once every child is completed', () => {
  const children = [child(1), child(2)];
  const transfers = [
    transfer({ shared_file_id: 1, status: 'completed' }),
    transfer({ id: 2, shared_file_id: 2, status: 'completed' }),
  ];
  expect(deriveFolderDownloadStatus(children, noRequests, transfers)).toEqual({
    kind: 'completed',
    completedCount: 2,
    totalCount: 2,
  });
});

test('failed if any child failed, even if others completed', () => {
  const children = [child(1), child(2)];
  const transfers = [
    transfer({ shared_file_id: 1, status: 'completed' }),
    transfer({ id: 2, shared_file_id: 2, status: 'failed', failure_reason: 'Connection lost.' }),
  ];
  const status = deriveFolderDownloadStatus(children, noRequests, transfers);
  expect(status.kind).toBe('failed');
  expect(status.completedCount).toBe(1);
});
