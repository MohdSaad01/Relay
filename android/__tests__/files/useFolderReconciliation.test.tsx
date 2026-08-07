jest.mock('../../src/files/folderIdentity');

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { useFolderReconciliation } from '../../src/files/useFolderReconciliation';
import { readAllLocalRoots, readAllReconciledChildren } from '../../src/files/folderIdentity';

const mockReadAllReconciledChildren = readAllReconciledChildren as jest.Mock;
const mockReadAllLocalRoots = readAllLocalRoots as jest.Mock;

type HookState = ReturnType<typeof useFolderReconciliation>;

function Harness({ pollKey, capture }: { pollKey: unknown; capture: (state: HookState) => void }) {
  const state = useFolderReconciliation(pollKey);
  capture(state);
  return null;
}

async function renderHook(pollKey: unknown): Promise<{
  latest: () => HookState;
  rerender: (nextPollKey: unknown) => Promise<void>;
}> {
  let capturedState: HookState | undefined;
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(<Harness pollKey={pollKey} capture={s => (capturedState = s)} />);
  });
  return {
    latest: () => capturedState as HookState,
    rerender: async nextPollKey => {
      await act(async () => {
        renderer?.update(<Harness pollKey={nextPollKey} capture={s => (capturedState = s)} />);
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

  const { latest } = await renderHook(['folder-1']);

  expect(latest().reconciledByFolderId).toEqual({ 1: { 'a.txt': 100 } });
  expect(latest().localRootByFolderId).toEqual({ 1: 'test', 2: 'Alpha' });
});

test('re-reads both maps when pollKey identity changes', async () => {
  const { latest, rerender } = await renderHook(['a']);
  expect(mockReadAllReconciledChildren).toHaveBeenCalledTimes(1);
  expect(mockReadAllLocalRoots).toHaveBeenCalledTimes(1);

  mockReadAllLocalRoots.mockResolvedValue({ 3: 'NewFolder' });
  await rerender(['b']);

  expect(mockReadAllReconciledChildren).toHaveBeenCalledTimes(2);
  expect(mockReadAllLocalRoots).toHaveBeenCalledTimes(2);
  expect(latest().localRootByFolderId).toEqual({ 3: 'NewFolder' });
});

test('refresh() re-reads both maps immediately, independent of pollKey', async () => {
  const { latest } = await renderHook(['a']);
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
