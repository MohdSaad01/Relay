jest.mock('../../src/files/downloadExistence');

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { useDownloadExistence } from '../../src/files/useDownloadExistence';
import { downloadedFileExists } from '../../src/files/downloadExistence';

const mockExists = downloadedFileExists as jest.Mock;

type HookState = ReturnType<typeof useDownloadExistence>;

function Harness({ capture }: { capture: (state: HookState) => void }) {
  const state = useDownloadExistence();
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

beforeEach(() => {
  jest.clearAllMocks();
});

test('starts with no known existence for any file', async () => {
  const { latest } = await renderHook();
  expect(latest().existence).toEqual({});
});

test('verify() records the check result once it resolves', async () => {
  mockExists.mockResolvedValueOnce(true);
  const { latest } = await renderHook();

  await act(async () => {
    latest().verify('report.pdf');
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockExists).toHaveBeenCalledWith('report.pdf');
  expect(latest().existence).toEqual({ 'report.pdf': true });
});

test('verify() records a false result for a deleted file', async () => {
  mockExists.mockResolvedValueOnce(false);
  const { latest } = await renderHook();

  await act(async () => {
    latest().verify('report.pdf');
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(latest().existence).toEqual({ 'report.pdf': false });
});

test('a second verify() call for the same file while one is still in flight is not duplicated', async () => {
  let resolveCheck: (value: boolean) => void = () => undefined;
  mockExists.mockReturnValueOnce(new Promise(resolve => (resolveCheck = resolve)));
  const { latest } = await renderHook();

  await act(async () => {
    latest().verify('report.pdf');
    latest().verify('report.pdf');
  });

  expect(mockExists).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveCheck(true);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(latest().existence).toEqual({ 'report.pdf': true });
});

test('verify() can re-check a file after its previous check settled — existence is not permanently cached', async () => {
  mockExists.mockResolvedValueOnce(true);
  const { latest } = await renderHook();

  await act(async () => {
    latest().verify('report.pdf');
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(latest().existence).toEqual({ 'report.pdf': true });

  mockExists.mockResolvedValueOnce(false);
  await act(async () => {
    latest().verify('report.pdf');
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockExists).toHaveBeenCalledTimes(2);
  expect(latest().existence).toEqual({ 'report.pdf': false });
});

test('tracks multiple files independently', async () => {
  mockExists.mockImplementation((fileName: string) => Promise.resolve(fileName === 'a.pdf'));
  const { latest } = await renderHook();

  await act(async () => {
    latest().verify('a.pdf');
    latest().verify('b.pdf');
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(latest().existence).toEqual({ 'a.pdf': true, 'b.pdf': false });
});
