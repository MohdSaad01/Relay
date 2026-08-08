import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  applyHistoryReset,
  clearTransferHistory,
  getHistoryClearedAt,
  isHistoricalTransfer,
} from '../../src/transfers/historyReset';
import { TransferResponse } from '../../src/api/types';

const mockReadFile = ReactNativeBlobUtil.fs.readFile as jest.Mock;
const mockWriteFile = ReactNativeBlobUtil.fs.writeFile as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockReadFile.mockRejectedValue(new Error('ENOENT'));
  mockWriteFile.mockResolvedValue(undefined);
});

function makeTransfer(overrides: Partial<TransferResponse>): TransferResponse {
  return {
    id: 1,
    device_id: 1,
    shared_file_id: 5,
    direction: 'send',
    file_name: 'report.pdf',
    file_size: 1000,
    device_name: 'Pixel 7',
    status: 'completed',
    bytes_transferred: 1000,
    failure_reason: null,
    started_at: '2026-01-01T00:00:00.000Z',
    completed_at: '2026-01-01T00:01:00.000Z',
    ...overrides,
  };
}

describe('getHistoryClearedAt', () => {
  test('null when the marker file has never been written', async () => {
    await expect(getHistoryClearedAt()).resolves.toBeNull();
  });

  test('null when the marker file is corrupted', async () => {
    mockReadFile.mockResolvedValue('not valid json');
    await expect(getHistoryClearedAt()).resolves.toBeNull();
  });

  test('returns the stored cutoff', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ clearedAt: '2026-02-01T00:00:00.000Z' }));
    await expect(getHistoryClearedAt()).resolves.toBe('2026-02-01T00:00:00.000Z');
  });
});

describe('clearTransferHistory', () => {
  test('writes a fresh ISO timestamp and returns it', async () => {
    const before = Date.now();
    const clearedAt = await clearTransferHistory();
    const after = Date.now();

    expect(new Date(clearedAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(clearedAt).getTime()).toBeLessThanOrEqual(after);
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('relay-history-reset.json'),
      JSON.stringify({ clearedAt }),
      'utf8',
    );
  });
});

describe('isHistoricalTransfer', () => {
  test('true for every terminal status', () => {
    expect(isHistoricalTransfer(makeTransfer({ status: 'completed' }))).toBe(true);
    expect(isHistoricalTransfer(makeTransfer({ status: 'failed' }))).toBe(true);
    expect(isHistoricalTransfer(makeTransfer({ status: 'cancelled' }))).toBe(true);
  });

  test('false for in_progress — covers both an actively streaming and a locally queued transfer', () => {
    expect(isHistoricalTransfer(makeTransfer({ status: 'in_progress' }))).toBe(false);
  });
});

describe('applyHistoryReset', () => {
  test('returns every transfer unchanged when history has never been cleared', () => {
    const transfers = [makeTransfer({ id: 1, status: 'completed' }), makeTransfer({ id: 2, status: 'in_progress' })];
    expect(applyHistoryReset(transfers, null)).toEqual(transfers);
  });

  test('hides a terminal transfer that finished at or before the clear point', () => {
    const transfer = makeTransfer({ status: 'completed', completed_at: '2026-01-01T00:00:00.000Z' });
    expect(applyHistoryReset([transfer], '2026-01-02T00:00:00.000Z')).toEqual([]);
  });

  test('keeps a terminal transfer that finished after the clear point (a new transfer post-reset)', () => {
    const transfer = makeTransfer({ status: 'completed', completed_at: '2026-01-03T00:00:00.000Z' });
    expect(applyHistoryReset([transfer], '2026-01-02T00:00:00.000Z')).toEqual([transfer]);
  });

  test('never hides an in_progress transfer, however far in the past it started', () => {
    const transfer = makeTransfer({ status: 'in_progress', completed_at: null, started_at: '2000-01-01T00:00:00.000Z' });
    expect(applyHistoryReset([transfer], '2026-06-01T00:00:00.000Z')).toEqual([transfer]);
  });

  test('falls back to started_at for a terminal row with no completed_at', () => {
    const transfer = makeTransfer({
      status: 'cancelled',
      completed_at: null,
      started_at: '2026-01-01T00:00:00.000Z',
    });
    expect(applyHistoryReset([transfer], '2026-01-02T00:00:00.000Z')).toEqual([]);
    expect(applyHistoryReset([transfer], '2025-12-31T00:00:00.000Z')).toEqual([transfer]);
  });

  // Regression: found live on RMX3997 (IST, UTC+5:30). Backend timestamps
  // are naive UTC strings with no 'Z'/offset (backend/app/utils/time.py's
  // utc_now()) — parsing one as local time (JS's default for a
  // timezone-less ISO string) silently shifts it by the device's UTC
  // offset, which incorrectly hid a transfer that had genuinely finished
  // after the reset.
  test('a naive (no "Z"/offset) backend timestamp is treated as UTC, not local time', () => {
    // clearedAt a minute before this UTC instant; completed_at a minute
    // after it, but serialized the way the backend actually sends it —
    // with no timezone designator at all.
    const transfer = makeTransfer({ status: 'completed', completed_at: '2026-01-02T00:01:00.000000' });
    expect(applyHistoryReset([transfer], '2026-01-02T00:00:00.000Z')).toEqual([transfer]);
  });

  test('a mix of active, queued-equivalent, and historical transfers: only the historical, pre-cutoff ones are hidden', () => {
    const active = makeTransfer({ id: 1, status: 'in_progress', completed_at: null });
    const oldCompleted = makeTransfer({ id: 2, status: 'completed', completed_at: '2026-01-01T00:00:00.000Z' });
    const newFailed = makeTransfer({ id: 3, status: 'failed', completed_at: '2026-01-03T00:00:00.000Z' });

    const result = applyHistoryReset([active, oldCompleted, newFailed], '2026-01-02T00:00:00.000Z');

    expect(result).toEqual([active, newFailed]);
  });
});
