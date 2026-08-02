jest.mock('../../src/api/endpoints/files');

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { useSharedFiles } from '../../src/files/useSharedFiles';
import { getAvailableFiles } from '../../src/api/endpoints/files';
import { ApiError } from '../../src/api/client';
import { AvailableFileResponse } from '../../src/api/types';

const mockGetAvailableFiles = getAvailableFiles as jest.Mock;

type HookState = ReturnType<typeof useSharedFiles>;

function Harness({ capture }: { capture: (state: HookState) => void }) {
  const state = useSharedFiles();
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

const sampleFile: AvailableFileResponse = {
  id: 1,
  file_name: 'report.pdf',
  file_size: 2048,
  mime_type: 'application/pdf',
  shared_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('loads the shared file list on mount', async () => {
  mockGetAvailableFiles.mockResolvedValueOnce([sampleFile]);

  const { latest } = await renderHook();

  expect(latest().loading).toBe(false);
  expect(latest().files).toEqual([sampleFile]);
  expect(latest().error).toBeNull();
});

test('surfaces an ApiError message on load failure', async () => {
  mockGetAvailableFiles.mockRejectedValueOnce(new ApiError('Session expired.', 401));

  const { latest } = await renderHook();

  expect(latest().loading).toBe(false);
  expect(latest().error).toBe('Session expired.');
  expect(latest().files).toEqual([]);
});

test('refresh() re-fetches the list', async () => {
  mockGetAvailableFiles.mockResolvedValueOnce([]);
  const { latest } = await renderHook();
  expect(mockGetAvailableFiles).toHaveBeenCalledTimes(1);

  mockGetAvailableFiles.mockResolvedValueOnce([sampleFile]);
  await act(async () => {
    await latest().refresh();
  });

  expect(mockGetAvailableFiles).toHaveBeenCalledTimes(2);
  expect(latest().files).toEqual([sampleFile]);
  expect(latest().refreshing).toBe(false);
});
