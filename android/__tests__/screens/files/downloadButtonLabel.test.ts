import { downloadButtonLabel, folderDownloadButtonLabel } from '../../../src/screens/files/FilesScreen';
import { FileDownloadStatus } from '../../../src/files/downloadStatus';
import { FolderDownloadStatus } from '../../../src/files/folderDownloadStatus';

/**
 * P13.3 correction regression tests. The bug: a single, unqueued download
 * briefly showed "Queued" instead of "Downloading..." because the label was
 * previously driven by the inverse of TransferStreamManager.isActive() —
 * true only once start() gets past its own internal `await`s — rather than
 * genuine FIFO queue membership (TransferStreamManager.isQueued()). These
 * pin the label functions' own contract directly, independent of the
 * TransferStreamManager timing details covered in
 * __tests__/streaming/TransferStreamManager.test.ts.
 */

function folderStatus(overrides: Partial<FolderDownloadStatus> = {}): FolderDownloadStatus {
  return { kind: 'in_progress', completedCount: 0, totalCount: 1, ...overrides };
}

describe('downloadButtonLabel', () => {
  test('a lone in-progress download (not queued) reads "Downloading...", never "Queued"', () => {
    const status: FileDownloadStatus = { kind: 'in_progress' };
    expect(downloadButtonLabel(false, status, false)).toBe('Downloading...');
  });

  test('an in-progress download that is genuinely queued reads "Queued"', () => {
    const status: FileDownloadStatus = { kind: 'in_progress' };
    expect(downloadButtonLabel(false, status, true)).toBe('Queued');
  });

  test('the brief propose/getTransfer round trip reads "Downloading...", regardless of queued', () => {
    const status: FileDownloadStatus = { kind: 'idle' };
    expect(downloadButtonLabel(true, status, false)).toBe('Downloading...');
    expect(downloadButtonLabel(true, status, true)).toBe('Downloading...');
  });

  test('idle/failed/pending are unaffected by queued', () => {
    expect(downloadButtonLabel(false, { kind: 'idle' }, true)).toBe('Download');
    expect(downloadButtonLabel(false, { kind: 'pending' }, true)).toBe('Requested');
    expect(downloadButtonLabel(false, { kind: 'failed', message: null }, true)).toBe('Retry');
  });
});

describe('folderDownloadButtonLabel', () => {
  test('a lone in-progress folder download (not queued) reads "Downloading...", never "Queued"', () => {
    expect(folderDownloadButtonLabel(false, folderStatus(), false)).toBe('Downloading...');
  });

  test('a folder genuinely waiting behind another active stream reads "Queued"', () => {
    expect(folderDownloadButtonLabel(false, folderStatus(), true)).toBe('Queued');
  });

  test('the brief propose round trip reads "Downloading...", regardless of queued', () => {
    expect(folderDownloadButtonLabel(true, folderStatus({ kind: 'idle' }), false)).toBe('Downloading...');
    expect(folderDownloadButtonLabel(true, folderStatus({ kind: 'idle' }), true)).toBe('Downloading...');
  });

  test('idle/failed are unaffected by queued', () => {
    expect(folderDownloadButtonLabel(false, folderStatus({ kind: 'idle' }), true)).toBe('Download');
    expect(folderDownloadButtonLabel(false, folderStatus({ kind: 'failed' }), true)).toBe('Retry');
  });
});
