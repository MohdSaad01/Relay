jest.mock('../../src/files/folderIdentity');

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { useFolderReconciliation } from '../../src/files/useFolderReconciliation';
import { readAllLocalRoots, readAllReconciledChildren } from '../../src/files/folderIdentity';
import { AvailableFolderResponse } from '../../src/api/types';

const mockReadAllReconciledChildren = readAllReconciledChildren as jest.Mock;
const mockReadAllLocalRoots = readAllLocalRoots as jest.Mock;

type HookState = ReturnType<typeof useFolderReconciliation>;

function folder(id: number, sharedAt: string): AvailableFolderResponse {
  return { id, folder_name: `folder-${id}`, total_size: 0, file_count: 0, shared_at: sharedAt };
}

function Harness({ folders, capture }: { folders: AvailableFolderResponse[]; capture: (state: HookState) => void }) {
  const state = useFolderReconciliation(folders);
  capture(state);
  return null;
}

async function renderHook(folders: AvailableFolderResponse[]): Promise<{
  latest: () => HookState;
  rerender: (nextFolders: AvailableFolderResponse[]) => Promise<void>;
}> {
  let capturedState: HookState | undefined;
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(<Harness folders={folders} capture={s => (capturedState = s)} />);
  });
  return {
    latest: () => capturedState as HookState,
    rerender: async nextFolders => {
      await act(async () => {
        renderer?.update(<Harness folders={nextFolders} capture={s => (capturedState = s)} />);
      });
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReadAllReconciledChildren.mockResolvedValue({});
  mockReadAllLocalRoots.mockResolvedValue({});
});

test('starts empty and loads both maps from one initial read', async () => {
  mockReadAllReconciledChildren.mockResolvedValue({ 1: { 'a.txt': 100 } });
  mockReadAllLocalRoots.mockResolvedValue({ 1: 'test', 2: 'Alpha' });

  const { latest } = await renderHook([folder(1, '2026-01-01T00:00:00')]);

  expect(latest().reconciledByFolderId).toEqual({ 1: { 'a.txt': 100 } });
  expect(latest().localRootByFolderId).toEqual({ 1: 'test', 2: 'Alpha' });
});

test('re-reads both maps when the folders array identity changes', async () => {
  const { latest, rerender } = await renderHook([folder(1, '2026-01-01T00:00:00')]);
  expect(mockReadAllReconciledChildren).toHaveBeenCalledTimes(1);
  expect(mockReadAllLocalRoots).toHaveBeenCalledTimes(1);

  mockReadAllLocalRoots.mockResolvedValue({ 3: 'NewFolder' });
  await rerender([folder(1, '2026-01-01T00:00:00'), folder(3, '2026-01-02T00:00:00')]);

  expect(mockReadAllReconciledChildren).toHaveBeenCalledTimes(2);
  expect(mockReadAllLocalRoots).toHaveBeenCalledTimes(2);
  expect(latest().localRootByFolderId).toEqual({ 3: 'NewFolder' });
});

test('refresh() re-reads both maps immediately, independent of a folders rerender', async () => {
  const { latest } = await renderHook([folder(1, '2026-01-01T00:00:00')]);
  expect(mockReadAllReconciledChildren).toHaveBeenCalledTimes(1);

  mockReadAllReconciledChildren.mockResolvedValue({ 5: { 'b.txt': 200 } });
  await act(async () => {
    latest().refresh();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockReadAllReconciledChildren).toHaveBeenCalledTimes(2);
  expect(latest().reconciledByFolderId).toEqual({ 5: { 'b.txt': 200 } });
});

// P17: this hook is what hands folderIdentity.ts's read functions the live
// `{id, shared_at}` set they filter stale (reused-id) entries against — pin
// that it actually passes the folders it was given, not just their ids.
test('passes the live {id, shared_at} set through to both read functions', async () => {
  await renderHook([folder(1, '2026-01-01T00:00:00'), folder(2, '2026-01-02T00:00:00')]);

  const expected = [
    { id: 1, shared_at: '2026-01-01T00:00:00' },
    { id: 2, shared_at: '2026-01-02T00:00:00' },
  ];
  expect(mockReadAllReconciledChildren).toHaveBeenCalledWith(expected);
  expect(mockReadAllLocalRoots).toHaveBeenCalledWith(expected);
});
