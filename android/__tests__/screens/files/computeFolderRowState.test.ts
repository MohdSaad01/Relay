jest.mock('../../../src/streaming/TransferStreamManager');

import { computeFolderRowState } from '../../../src/screens/files/FilesScreen';
import { TransferStreamManager } from '../../../src/streaming/TransferStreamManager';
import { AvailableFolderFileResponse, TransferRequestResponse, TransferResponse } from '../../../src/api/types';
import { StreamState } from '../../../src/streaming/types';

/**
 * P21.1 (Issue 1) regression tests — the folder Download button flickering
 * back to "Download" between "Downloading..." and "Open". Root cause,
 * confirmed live on RMX3997 (frame-by-frame capture of an 8-file folder
 * download): once every child's Transfer independently reaches 'completed'
 * (backend flips status the instant streaming finishes), there is a real
 * window — bounded by TransferStreamManager's own multi-step
 * notifyIfFolderComplete pipeline (getFolderFiles + listTransferRequests +
 * listTransfers, then markFolderReconciled) — where
 * deriveFolderDownloadStatus correctly reports 'idle' (nothing yet proves
 * the download is reconciled/current) even though nothing is actually wrong;
 * the row briefly regresses to "Download" before jumping to "Open" a moment
 * later once reconciliation catches up. These tests pin
 * computeFolderRowState's fix: hold the row at 'in_progress' during that
 * exact window using TransferStreamManager's own live state as the
 * tie-breaker, without masking a genuinely stale/never-downloaded folder or
 * a folder just confirmed deleted from disk.
 */

const mockGetState = TransferStreamManager.getState as jest.Mock;
const mockIsActive = TransferStreamManager.isActive as jest.Mock;
const mockIsQueued = TransferStreamManager.isQueued as jest.Mock;

beforeEach(() => {
  mockGetState.mockReturnValue(null);
  mockIsActive.mockReturnValue(false);
  mockIsQueued.mockReturnValue(false);
});

function child(id: number, overrides: Partial<AvailableFolderFileResponse> = {}): AvailableFolderFileResponse {
  return { id, relative_path: `file-${id}.bin`, file_size: 100, mime_type: null, ...overrides };
}

function transfer(overrides: Partial<TransferResponse> = {}): TransferResponse {
  return {
    id: overrides.id ?? 1,
    device_id: 1,
    shared_file_id: overrides.shared_file_id ?? 1,
    direction: 'send',
    file_name: 'file.bin',
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

function streamState(overrides: Partial<StreamState> = {}): StreamState {
  return {
    transferId: 1,
    direction: 'send',
    fileName: 'file.bin',
    bytesTransferred: 100,
    totalBytes: 100,
    status: 'completed',
    error: null,
    ...overrides,
  };
}

const noRequests: TransferRequestResponse[] = [];

describe('computeFolderRowState (P21.1, Issue 1)', () => {
  test('a one-child folder still mid-stream reads in_progress (baseline, unaffected)', () => {
    const children = [child(1)];
    const transfers = [transfer({ id: 101, shared_file_id: 1, status: 'in_progress' })];
    const { status } = computeFolderRowState(children, noRequests, transfers, undefined, undefined);
    expect(status.kind).toBe('in_progress');
  });

  test('every child completed but not yet reconciled, and this app just streamed one of them: stays in_progress, not idle', () => {
    const children = [child(1), child(2), child(3)];
    const transfers = [
      transfer({ id: 101, shared_file_id: 1, status: 'completed' }),
      transfer({ id: 102, shared_file_id: 2, status: 'completed' }),
      transfer({ id: 103, shared_file_id: 3, status: 'completed' }),
    ];
    // Reconciliation hasn't landed yet (undefined) — the exact window this fix targets.
    mockGetState.mockReturnValue(streamState({ transferId: 103, status: 'completed' }));

    const { status } = computeFolderRowState(children, noRequests, transfers, undefined, undefined);
    expect(status.kind).toBe('in_progress');
    expect(status.completedCount).toBe(3);
    expect(status.totalCount).toBe(3);
  });

  test('same window also covered while TransferStreamManager still reports "streaming" for the last child (backend/local ordering race)', () => {
    const children = [child(1)];
    const transfers = [transfer({ id: 101, shared_file_id: 1, status: 'completed' })];
    // Backend already says 'completed' (poll caught it), but the local
    // engine hasn't flipped its own state to 'completed' yet.
    mockGetState.mockReturnValue(streamState({ transferId: 101, status: 'streaming' }));

    const { status } = computeFolderRowState(children, noRequests, transfers, undefined, undefined);
    expect(status.kind).toBe('in_progress');
  });

  test('once reconciliation actually lands, reports completed (Open), not the in_progress override', () => {
    const children = [child(1, { relative_path: 'a.bin' })];
    const transfers = [transfer({ id: 101, shared_file_id: 1, status: 'completed' })];
    mockGetState.mockReturnValue(streamState({ transferId: 101, status: 'completed' }));

    const { status } = computeFolderRowState(children, noRequests, transfers, { 'a.bin': 100 }, undefined);
    expect(status.kind).toBe('completed');
  });

  test('a folder this app never touched (state null) and whose content is genuinely stale still reads idle (Download), not stuck in_progress', () => {
    const children = [child(1, { relative_path: 'a.bin', file_size: 999 })];
    const transfers = [transfer({ id: 101, shared_file_id: 1, status: 'completed' })];
    // Reconciliation record disagrees (stale size) and nothing local is streaming.
    mockGetState.mockReturnValue(null);

    const { status } = computeFolderRowState(children, noRequests, transfers, { 'a.bin': 100 }, undefined);
    expect(status.kind).toBe('idle');
  });

  test('a different folder entirely (state references an unrelated transfer) is not affected by the override', () => {
    const children = [child(1)];
    const transfers = [transfer({ id: 101, shared_file_id: 1, status: 'completed' })];
    mockGetState.mockReturnValue(streamState({ transferId: 999, status: 'completed' }));

    const { status } = computeFolderRowState(children, noRequests, transfers, undefined, undefined);
    expect(status.kind).toBe('idle');
  });

  test('a folder just confirmed deleted from disk (folderExists === false) still falls to idle even if this app just streamed it', () => {
    const children = [child(1, { relative_path: 'a.bin' })];
    const transfers = [transfer({ id: 101, shared_file_id: 1, status: 'completed' })];
    mockGetState.mockReturnValue(streamState({ transferId: 101, status: 'completed' }));

    const { status } = computeFolderRowState(children, noRequests, transfers, { 'a.bin': 100 }, false);
    expect(status.kind).toBe('idle');
  });

  test('a failed child is reported failed regardless of local stream state', () => {
    const children = [child(1), child(2)];
    const transfers = [
      transfer({ id: 101, shared_file_id: 1, status: 'completed' }),
      transfer({ id: 102, shared_file_id: 2, status: 'failed', failure_reason: 'Connection lost.' }),
    ];
    mockGetState.mockReturnValue(streamState({ transferId: 102, status: 'failed' }));

    const { status } = computeFolderRowState(children, noRequests, transfers, undefined, undefined);
    expect(status.kind).toBe('failed');
  });

  test('intermediate child completions never fall to idle (every child is backend in_progress the instant it is proposed)', () => {
    const children = [child(1), child(2), child(3)];
    const transfers = [
      transfer({ id: 101, shared_file_id: 1, status: 'completed' }),
      transfer({ id: 102, shared_file_id: 2, status: 'in_progress' }),
      transfer({ id: 103, shared_file_id: 3, status: 'in_progress' }),
    ];
    const { status } = computeFolderRowState(children, noRequests, transfers, undefined, undefined);
    expect(status.kind).toBe('in_progress');
    expect(status.completedCount).toBe(1);
  });
});

/**
 * P21.2 regression tests — a large folder's button visibly toggling between
 * "Downloading..." and "Queued" once per child, confirmed live on RMX3997
 * with a 100-file folder via direct instrumentation of this function's own
 * return value (194 label changes across one download, roughly one full
 * Downloading⇄Queued cycle per child). Root cause: every child transfer,
 * not just the first, passes through TransferStreamManager.start()'s own
 * brief `await PermissionsAndroid.request(...)` gate before `state.status`
 * flips to 'streaming' — the same startup gap the P13.3 correction already
 * had to design around for a single lone transfer. Between one child's
 * stream ending and the next one clearing that gate, no transfer anywhere
 * reports `status === 'streaming'` for a few milliseconds, while the
 * remaining not-yet-started children are already genuinely sitting in
 * TransferStreamManager's FIFO `queue` — so `queued` read true at every
 * single child boundary in a large folder, not just at the very start.
 */
describe('computeFolderRowState queued derivation (P21.2)', () => {
  test('mid-download inter-child gap: no child isActive, but a child already completed — must not read as queued', () => {
    const children = [child(1), child(2), child(3)];
    const transfers = [
      transfer({ id: 101, shared_file_id: 1, status: 'completed' }),
      transfer({ id: 102, shared_file_id: 2, status: 'in_progress' }),
      transfer({ id: 103, shared_file_id: 3, status: 'in_progress' }),
    ];
    // Simulates the real gap: the just-finished child's stream ended, the
    // next one's own start() hasn't cleared its permission-request await
    // yet, so nothing reports isActive — but everything still pending is
    // genuinely sitting in the FIFO queue.
    mockIsActive.mockReturnValue(false);
    mockIsQueued.mockImplementation((id: number) => id === 102 || id === 103);

    const { status, queued } = computeFolderRowState(children, noRequests, transfers, undefined, undefined);
    expect(status.kind).toBe('in_progress');
    expect(queued).toBe(false);
  });

  test('a 100-child folder never reads queued at any single child boundary once it has started', () => {
    const children = Array.from({ length: 100 }, (_, i) => child(i + 1));
    for (let completed = 1; completed < 100; completed++) {
      const transfers = children.map((c, i) =>
        transfer({ id: 200 + i, shared_file_id: c.id, status: i < completed ? 'completed' : 'in_progress' }),
      );
      mockIsActive.mockReturnValue(false); // the inter-child gap, every time
      mockIsQueued.mockImplementation((id: number) => id >= 200 + completed);

      const { queued } = computeFolderRowState(children, noRequests, transfers, undefined, undefined);
      expect(queued).toBe(false);
    }
  });

  test('genuinely not started yet (nothing completed, nothing of this folder active) still reads queued behind an unrelated transfer', () => {
    const children = [child(1), child(2)];
    const transfers: TransferResponse[] = [
      transfer({ id: 101, shared_file_id: 1, status: 'in_progress' }),
      transfer({ id: 102, shared_file_id: 2, status: 'in_progress' }),
    ];
    mockIsActive.mockReturnValue(false); // this folder's own children are not the active stream
    mockIsQueued.mockReturnValue(true); // both sitting behind an unrelated transfer

    const { queued } = computeFolderRowState(children, noRequests, transfers, undefined, undefined);
    expect(queued).toBe(true);
  });

  test('the currently-streaming child keeps the folder out of queued, independent of completedCount', () => {
    const children = [child(1), child(2)];
    const transfers = [
      transfer({ id: 101, shared_file_id: 1, status: 'in_progress' }),
      transfer({ id: 102, shared_file_id: 2, status: 'in_progress' }),
    ];
    mockIsActive.mockImplementation((id: number) => id === 101);
    mockIsQueued.mockImplementation((id: number) => id === 102);

    const { queued } = computeFolderRowState(children, noRequests, transfers, undefined, undefined);
    expect(queued).toBe(false);
  });
});
