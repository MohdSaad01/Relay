jest.mock('../../src/files/fileIdentity');

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { useFileIdentity } from '../../src/files/useFileIdentity';
import { readAllLocalFileNames } from '../../src/files/fileIdentity';

const mockReadAllLocalFileNames = readAllLocalFileNames as jest.Mock;

type HookState = ReturnType<typeof useFileIdentity>;

function Harness({ pollKey, capture }: { pollKey: unknown; capture: (state: HookState) => void }) {
  const state = useFileIdentity(pollKey);
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
  mockReadAllLocalFileNames.mockResolvedValue({});
});

test('starts empty and loads the map from one initial read', async () => {
  mockReadAllLocalFileNames.mockResolvedValue({ 1: 'report.txt', 2: 'report (1).txt' });

  const { latest } = await renderHook(['file-1']);

  expect(latest().localNameByFileId).toEqual({ 1: 'report.txt', 2: 'report (1).txt' });
});

test('re-reads the map when pollKey identity changes', async () => {
  const { latest, rerender } = await renderHook(['a']);
  expect(mockReadAllLocalFileNames).toHaveBeenCalledTimes(1);

  mockReadAllLocalFileNames.mockResolvedValue({ 3: 'newfile.txt' });
  await rerender(['b']);

  expect(mockReadAllLocalFileNames).toHaveBeenCalledTimes(2);
  expect(latest().localNameByFileId).toEqual({ 3: 'newfile.txt' });
});

test('refresh() re-reads the map immediately, independent of pollKey', async () => {
  const { latest } = await renderHook(['a']);
  expect(mockReadAllLocalFileNames).toHaveBeenCalledTimes(1);

  mockReadAllLocalFileNames.mockResolvedValue({ 5: 'b.txt' });
  await act(async () => {
    latest().refresh();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockReadAllLocalFileNames).toHaveBeenCalledTimes(2);
  expect(latest().localNameByFileId).toEqual({ 5: 'b.txt' });
});
