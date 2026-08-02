jest.mock('../../src/api/endpoints/transfers');

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { useTransfer } from '../../src/transfers/useTransfer';
import { cancelTransfer, getTransfer } from '../../src/api/endpoints/transfers';
import { TransferResponse } from '../../src/api/types';

const mockGetTransfer = getTransfer as jest.Mock;
const mockCancelTransfer = cancelTransfer as jest.Mock;

type HookState = ReturnType<typeof useTransfer>;

function Harness({ capture }: { capture: (state: HookState) => void }) {
  const state = useTransfer(42);
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
  id: 42,
  device_id: 1,
  shared_file_id: 5,
  direction: 'send',
  file_name: 'report.pdf',
  file_size: 2048,
  device_name: 'Pixel 7',
  status: 'in_progress',
  bytes_transferred: 512,
  failure_reason: null,
  started_at: '2026-01-01T00:00:00Z',
  completed_at: null,
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('loads the transfer by id on mount', async () => {
  mockGetTransfer.mockResolvedValueOnce(sampleTransfer);

  const { latest } = await renderHook();

  expect(mockGetTransfer).toHaveBeenCalledWith(42);
  expect(latest().transfer).toEqual(sampleTransfer);
});

test('cancel() applies the returned updated transfer without a second fetch', async () => {
  mockGetTransfer.mockResolvedValueOnce(sampleTransfer);
  const cancelled: TransferResponse = { ...sampleTransfer, status: 'cancelled' };
  mockCancelTransfer.mockResolvedValueOnce(cancelled);

  const { latest } = await renderHook();
  await act(async () => {
    await latest().cancel();
  });

  expect(mockCancelTransfer).toHaveBeenCalledWith(42);
  expect(mockGetTransfer).toHaveBeenCalledTimes(1);
  expect(latest().transfer).toEqual(cancelled);
});
