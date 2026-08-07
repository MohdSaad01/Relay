import {
  areAllFolderChildrenDownloaded,
  deriveFolderDownloadStatus,
  isFolderChildReconciled,
} from '../../src/files/folderDownloadStatus';
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

/** A reconciliation record (folderIdentity.ts's shape) matching `children` exactly. */
function reconciledFor(children: AvailableFolderFileResponse[]): Record<string, number> {
  const record: Record<string, number> = {};
  children.forEach(c => {
    record[c.relative_path] = c.file_size;
  });
  return record;
}

test('idle with zero total for an empty folder', () => {
  expect(deriveFolderDownloadStatus([], noRequests, [], undefined)).toEqual({
    kind: 'idle',
    completedCount: 0,
    totalCount: 0,
  });
});

test('idle when no child has been requested or transferred', () => {
  const children = [child(1), child(2)];
  expect(deriveFolderDownloadStatus(children, noRequests, [], undefined)).toEqual({
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
  const status = deriveFolderDownloadStatus(children, noRequests, transfers, undefined);
  expect(status.kind).toBe('in_progress');
  expect(status.completedCount).toBe(1);
  expect(status.totalCount).toBe(2);
});

test('completed once every child is completed and matches the reconciliation record', () => {
  const children = [
    child(1, { relative_path: 'Semester 1/file-1.pdf' }),
    child(2, { relative_path: 'Semester 1/file-2.pdf' }),
  ];
  const transfers = [
    transfer({ shared_file_id: 1, status: 'completed' }),
    transfer({ id: 2, shared_file_id: 2, status: 'completed' }),
  ];
  expect(deriveFolderDownloadStatus(children, noRequests, transfers, reconciledFor(children))).toEqual({
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
  const status = deriveFolderDownloadStatus(children, noRequests, transfers, undefined);
  expect(status.kind).toBe('failed');
  expect(status.completedCount).toBe(1);
});

// P13.2, Issue 2: a folder that was fully downloaded must fall back to
// 'idle' (not 'completed') once its shared content has since drifted from
// its reconciliation record, even though every current child's own Transfer
// still says 'completed'.
describe('staleness (P13.2, Issue 2)', () => {
  test('idle (stale) once a new file has been added to an already-downloaded folder', () => {
    const children = [
      child(1, { relative_path: 'a.txt' }),
      child(2, { relative_path: 'b.txt' }), // never downloaded
    ];
    const transfers = [transfer({ shared_file_id: 1, status: 'completed' })];
    // Only a.txt was ever reconciled — b.txt is new.
    const reconciled = { 'a.txt': 100 };

    const status = deriveFolderDownloadStatus(children, noRequests, transfers, reconciled);
    expect(status.kind).toBe('idle');
  });

  test('idle (stale) once a downloaded file has been removed from the shared folder', () => {
    const children = [child(1, { relative_path: 'a.txt' })];
    const transfers = [transfer({ shared_file_id: 1, status: 'completed' })];
    // b.txt is still in the reconciliation record from a previous download,
    // but is no longer part of the current children list.
    const reconciled = { 'a.txt': 100, 'b.txt': 100 };

    const status = deriveFolderDownloadStatus(children, noRequests, transfers, reconciled);
    expect(status.kind).toBe('idle');
  });

  test('idle (stale) once a downloaded file has been renamed, even at an identical size', () => {
    const children = [child(1, { relative_path: 'renamed.txt', file_size: 100 })];
    const transfers = [transfer({ shared_file_id: 1, status: 'completed' })];
    const reconciled = { 'original.txt': 100 };

    const status = deriveFolderDownloadStatus(children, noRequests, transfers, reconciled);
    expect(status.kind).toBe('idle');
  });

  test('idle (stale) once a downloaded file has changed size at the same path', () => {
    const children = [child(1, { relative_path: 'a.txt', file_size: 500 })];
    const transfers = [transfer({ shared_file_id: 1, status: 'completed' })];
    const reconciled = { 'a.txt': 100 };

    const status = deriveFolderDownloadStatus(children, noRequests, transfers, reconciled);
    expect(status.kind).toBe('idle');
  });

  test('completed again once the reconciliation record has actually been refreshed', () => {
    const children = [child(1, { relative_path: 'a.txt', file_size: 500 })];
    const transfers = [transfer({ shared_file_id: 1, status: 'completed' })];
    const reconciled = { 'a.txt': 500 };

    const status = deriveFolderDownloadStatus(children, noRequests, transfers, reconciled);
    expect(status.kind).toBe('completed');
  });

  // Regression: an earlier version of this fix derived the reconciliation
  // check from Transfer history directly. A file *removed* from the share
  // left an orphaned completed Transfer row behind forever (nothing ever
  // re-downloads it to produce a newer Transfer that supersedes that entry),
  // which permanently poisoned the check with no way to self-heal even
  // after every remaining child was re-confirmed current. The
  // client-owned, always-overwritten reconciliation record fixes this: a
  // folder is 'completed' purely by matching that record, independent of
  // whatever Transfer history happens to contain.
  test('completed again after a removal, once the reconciliation record no longer mentions the removed file', () => {
    const children = [child(1, { relative_path: 'a.txt', file_size: 100 })];
    // History still has a completed transfer for the now-removed b.txt —
    // this must not matter once the record itself has been rewritten.
    const transfers = [
      transfer({ shared_file_id: 1, status: 'completed' }),
      transfer({ id: 2, shared_file_id: 2, status: 'completed', file_name: 'b.txt' }),
    ];
    const reconciled = { 'a.txt': 100 }; // rewritten without b.txt

    const status = deriveFolderDownloadStatus(children, noRequests, transfers, reconciled);
    expect(status.kind).toBe('completed');
  });
});

// P13.3, Problem 1: deriveFolderDownloadStatus's 'completed' verdict must
// also respect a live on-device existence check of the folder's root
// directory, mirroring deriveDownloadStatus's own fileExists handling — a
// folder deleted outside the app must not keep reporting 'completed'
// (offering "Open") forever.
describe('folderExists gating (P13.3, Problem 1)', () => {
  test('completed when every child matches and folderExists is unset (not checked yet)', () => {
    const children = [child(1, { relative_path: 'a.txt', file_size: 100 })];
    const transfers = [transfer({ shared_file_id: 1, status: 'completed' })];
    const reconciled = { 'a.txt': 100 };

    const status = deriveFolderDownloadStatus(children, noRequests, transfers, reconciled, undefined);
    expect(status.kind).toBe('completed');
  });

  test('completed when folderExists is explicitly true', () => {
    const children = [child(1, { relative_path: 'a.txt', file_size: 100 })];
    const transfers = [transfer({ shared_file_id: 1, status: 'completed' })];
    const reconciled = { 'a.txt': 100 };

    const status = deriveFolderDownloadStatus(children, noRequests, transfers, reconciled, true);
    expect(status.kind).toBe('completed');
  });

  test('idle when every child matches but folderExists is explicitly false (folder deleted on-device)', () => {
    const children = [child(1, { relative_path: 'a.txt', file_size: 100 })];
    const transfers = [transfer({ shared_file_id: 1, status: 'completed' })];
    const reconciled = { 'a.txt': 100 };

    const status = deriveFolderDownloadStatus(children, noRequests, transfers, reconciled, false);
    expect(status.kind).toBe('idle');
    expect(status.completedCount).toBe(1);
  });
});

describe('isFolderChildReconciled (P13.2, Issue 2)', () => {
  test('true when the child matches the reconciliation record', () => {
    const c = child(1, { relative_path: 'a.txt', file_size: 100 });
    expect(isFolderChildReconciled(c, { 'a.txt': 100 })).toBe(true);
  });

  test('false when no record exists at all', () => {
    const c = child(1, { relative_path: 'a.txt', file_size: 100 });
    expect(isFolderChildReconciled(c, undefined)).toBe(false);
  });

  test('false when the size no longer matches', () => {
    const c = child(1, { relative_path: 'a.txt', file_size: 500 });
    expect(isFolderChildReconciled(c, { 'a.txt': 100 })).toBe(false);
  });
});

describe('areAllFolderChildrenDownloaded (P13.2, Issue 2)', () => {
  test('false for an empty folder', () => {
    expect(areAllFolderChildrenDownloaded([], noRequests, [])).toBe(false);
  });

  test('false while any child is not yet completed', () => {
    const children = [child(1), child(2)];
    const transfers = [transfer({ shared_file_id: 1, status: 'completed' })];
    expect(areAllFolderChildrenDownloaded(children, noRequests, transfers)).toBe(false);
  });

  test('true once every child is completed, independent of the reconciliation record', () => {
    const children = [child(1), child(2)];
    const transfers = [
      transfer({ shared_file_id: 1, status: 'completed' }),
      transfer({ id: 2, shared_file_id: 2, status: 'completed' }),
    ];
    expect(areAllFolderChildrenDownloaded(children, noRequests, transfers)).toBe(true);
  });
});
