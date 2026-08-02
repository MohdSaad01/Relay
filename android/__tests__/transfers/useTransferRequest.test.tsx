jest.mock('../../src/api/endpoints/transfers');

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { useTransferRequest } from '../../src/transfers/useTransferRequest';
import { getTransferRequest, withdrawTransferRequest } from '../../src/api/endpoints/transfers';
import { TransferRequestResponse } from '../../src/api/types';

const mockGetTransferRequest = getTransferRequest as jest.Mock;
const mockWithdrawTransferRequest = withdrawTransferRequest as jest.Mock;

type HookState = ReturnType<typeof useTransferRequest>;

function Harness({ capture }: { capture: (state: HookState) => void }) {
  const state = useTransferRequest('req-1');
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

test('loads the request by id on mount', async () => {
  mockGetTransferRequest.mockResolvedValueOnce(sampleRequest);

  const { latest } = await renderHook();

  expect(mockGetTransferRequest).toHaveBeenCalledWith('req-1');
  expect(latest().request).toEqual(sampleRequest);
  expect(latest().loading).toBe(false);
});

test('withdraw() calls the withdraw endpoint for this request id', async () => {
  mockGetTransferRequest.mockResolvedValueOnce(sampleRequest);
  mockWithdrawTransferRequest.mockResolvedValueOnce(undefined);

  const { latest } = await renderHook();
  await act(async () => {
    await latest().withdraw();
  });

  expect(mockWithdrawTransferRequest).toHaveBeenCalledWith('req-1');
});
