jest.mock('../../src/api/endpoints/folders');

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { useSharedFolders } from '../../src/files/useSharedFolders';
import { getSharedFolders } from '../../src/api/endpoints/folders';
import { ApiError } from '../../src/api/client';
import { AvailableFolderResponse } from '../../src/api/types';

const mockGetSharedFolders = getSharedFolders as jest.Mock;

type HookState = ReturnType<typeof useSharedFolders>;

function Harness({ capture }: { capture: (state: HookState) => void }) {
  const state = useSharedFolders();
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

const sampleFolder: AvailableFolderResponse = {
  id: 1,
  folder_name: 'University Notes',
  total_size: 4096,
  file_count: 4,
  shared_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('loads the shared folder list on mount', async () => {
  mockGetSharedFolders.mockResolvedValueOnce([sampleFolder]);

  const { latest } = await renderHook();

  expect(latest().loading).toBe(false);
  expect(latest().folders).toEqual([sampleFolder]);
  expect(latest().error).toBeNull();
});

test('surfaces an ApiError message on load failure', async () => {
  mockGetSharedFolders.mockRejectedValueOnce(new ApiError('Session expired.', 401));

  const { latest } = await renderHook();

  expect(latest().error).toBe('Session expired.');
  expect(latest().folders).toEqual([]);
});

test('refresh() re-fetches the list', async () => {
  mockGetSharedFolders.mockResolvedValueOnce([]);
  const { latest } = await renderHook();
  expect(mockGetSharedFolders).toHaveBeenCalledTimes(1);

  mockGetSharedFolders.mockResolvedValueOnce([sampleFolder]);
  await act(async () => {
    await latest().refresh();
  });

  expect(mockGetSharedFolders).toHaveBeenCalledTimes(2);
  expect(latest().folders).toEqual([sampleFolder]);
});

test('refreshSilently() re-fetches without ever setting loading or refreshing', async () => {
  mockGetSharedFolders.mockResolvedValueOnce([]);
  const { latest } = await renderHook();

  mockGetSharedFolders.mockResolvedValueOnce([sampleFolder]);
  let sawLoadingOrRefreshing = false;
  await act(async () => {
    const pending = latest().refreshSilently();
    if (latest().loading || latest().refreshing) {
      sawLoadingOrRefreshing = true;
    }
    await pending;
  });

  expect(sawLoadingOrRefreshing).toBe(false);
  expect(latest().folders).toEqual([sampleFolder]);
});
