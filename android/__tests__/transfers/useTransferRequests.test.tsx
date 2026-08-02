jest.mock('../../src/api/endpoints/transfers');

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { useTransferRequests } from '../../src/transfers/useTransferRequests';
import { listTransferRequests } from '../../src/api/endpoints/transfers';
import { ApiError } from '../../src/api/client';
import { TransferRequestResponse } from '../../src/api/types';

const mockListTransferRequests = listTransferRequests as jest.Mock;

type HookState = ReturnType<typeof useTransferRequests>;

function Harness({ capture }: { capture: (state: HookState) => void }) {
  const state = useTransferRequests();
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

const sampleRequest: TransferRequestResponse = {
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
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('loads pending requests on mount', async () => {
  mockListTransferRequests.mockResolvedValueOnce([sampleRequest]);

  const { latest } = await renderHook();

  expect(latest().loading).toBe(false);
  expect(latest().requests).toEqual([sampleRequest]);
  expect(latest().error).toBeNull();
});

test('surfaces an ApiError message on failure', async () => {
  mockListTransferRequests.mockRejectedValueOnce(new ApiError('Session expired.', 401));

  const { latest } = await renderHook();

  expect(latest().error).toBe('Session expired.');
  expect(latest().requests).toEqual([]);
});

test('refresh() re-fetches', async () => {
  mockListTransferRequests.mockResolvedValueOnce([]);
  const { latest } = await renderHook();

  mockListTransferRequests.mockResolvedValueOnce([sampleRequest]);
  await act(async () => {
    await latest().refresh();
  });

  expect(mockListTransferRequests).toHaveBeenCalledTimes(2);
  expect(latest().requests).toEqual([sampleRequest]);
});
