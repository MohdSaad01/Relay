jest.mock('../../src/api/endpoints/transfers');

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { useTransfers } from '../../src/transfers/useTransfers';
import { listTransfers } from '../../src/api/endpoints/transfers';
import { ApiError } from '../../src/api/client';
import { TransferResponse } from '../../src/api/types';

const mockListTransfers = listTransfers as jest.Mock;

type HookState = ReturnType<typeof useTransfers>;

function Harness({ capture }: { capture: (state: HookState) => void }) {
  const state = useTransfers();
  capture(state);
  return null;
}

async function renderHook(): Promise<{ latest: () => HookState }> {
  let capturedState: HookState | undefined;
  await act(async () => {
    ReactTestRenderer.create(<Harness capture={s => (capturedState = s)} />);
  });
  return { latest: () => capturedState as HookState };
}

const sampleTransfer: TransferResponse = {
  id: 1,
  device_id: 1,
  shared_file_id: 5,
  direction: 'send',
  file_name: 'report.pdf',
  file_size: 2048,
  device_name: 'Pixel 7',
  status: 'in_progress',
  bytes_transferred: 1024,
  failure_reason: null,
  started_at: '2026-01-01T00:00:00Z',
  completed_at: null,
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('loads transfers on mount', async () => {
  mockListTransfers.mockResolvedValueOnce([sampleTransfer]);

  const { latest } = await renderHook();

  expect(latest().loading).toBe(false);
  expect(latest().transfers).toEqual([sampleTransfer]);
  expect(latest().error).toBeNull();
});

test('surfaces an ApiError message on failure', async () => {
  mockListTransfers.mockRejectedValueOnce(new ApiError('Session expired.', 401));

  const { latest } = await renderHook();

  expect(latest().error).toBe('Session expired.');
  expect(latest().transfers).toEqual([]);
});

test('refresh() re-fetches', async () => {
  mockListTransfers.mockResolvedValueOnce([]);
  const { latest } = await renderHook();

  mockListTransfers.mockResolvedValueOnce([sampleTransfer]);
  await act(async () => {
    await latest().refresh();
  });

  expect(mockListTransfers).toHaveBeenCalledTimes(2);
  expect(latest().transfers).toEqual([sampleTransfer]);
});
