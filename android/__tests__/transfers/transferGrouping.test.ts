import { groupTransfers } from '../../src/transfers/transferGrouping';
import { TransferResponse } from '../../src/api/types';

/**
 * P21.1 (Issue 2) — the Transfers tab exposing every child of a folder
 * download/upload as its own row instead of one folder-level row. These pin
 * groupTransfers' contract: a standalone transfer stays exactly the flat row
 * it already is, and every child of one folder operation (shared_folder_id
 * for a download, upload_batch_id for an upload — see transferGrouping.ts's
 * own doc comment on why these differ per direction) collapses into one
 * folder item with an aggregate status.
 */

function transfer(overrides: Partial<TransferResponse> = {}): TransferResponse {
  return {
    id: 1,
    device_id: 1,
    shared_file_id: null,
    direction: 'send',
    file_name: 'file.bin',
    file_size: 100,
    device_name: 'Pixel 7',
    status: 'completed',
    bytes_transferred: 100,
    failure_reason: null,
    started_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T00:00:05Z',
    shared_folder_id: null,
    folder_relative_path: null,
    upload_batch_id: null,
    ...overrides,
  };
}

describe('groupTransfers', () => {
  test('a standalone file transfer stays its own single row', () => {
    const t = transfer({ id: 1, shared_file_id: 5, file_name: 'report.pdf' });
    const items = groupTransfers([t]);
    expect(items).toEqual([{ kind: 'single', transfer: t }]);
  });

  test('a folder download\'s children collapse into one folder row', () => {
    const children = [1, 2, 3, 4, 5].map(n =>
      transfer({ id: n, shared_file_id: n, shared_folder_id: 7, folder_relative_path: `Vacation Photos/img${n}.jpg` }),
    );
    const items = groupTransfers(children);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'folder', folderName: 'Vacation Photos', status: 'completed' });
    expect((items[0] as { transfers: TransferResponse[] }).transfers).toHaveLength(5);
  });

  test('a folder upload\'s children collapse into one folder row, keyed by upload_batch_id', () => {
    const children = ['a.txt', 'b.txt'].map((name, i) =>
      transfer({
        id: i + 1,
        direction: 'receive',
        upload_batch_id: 'batch-123',
        folder_relative_path: `Notes/${name}`,
        file_name: name,
      }),
    );
    const items = groupTransfers(children);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'folder', folderName: 'Notes', direction: 'receive' });
  });

  test('two different folders (distinct shared_folder_id) never merge, even with the same display name', () => {
    const folderA = [1, 2].map(n =>
      transfer({ id: n, shared_folder_id: 1, folder_relative_path: `test/f${n}.txt` }),
    );
    const folderB = [3, 4].map(n =>
      transfer({ id: n, shared_folder_id: 2, folder_relative_path: `test/f${n}.txt` }),
    );
    const items = groupTransfers([...folderA, ...folderB]);
    expect(items).toHaveLength(2);
    expect(items.every(item => item.kind === 'folder')).toBe(true);
    const keys = items.map(item => (item.kind === 'folder' ? item.key : null));
    expect(new Set(keys).size).toBe(2);
  });

  test('a mix of a standalone file and a folder renders both independently', () => {
    const single = transfer({ id: 1, shared_file_id: 9, file_name: 'solo.txt' });
    const folderChildren = [2, 3].map(n =>
      transfer({ id: n, shared_folder_id: 5, folder_relative_path: `Docs/f${n}.txt` }),
    );
    const items = groupTransfers([single, ...folderChildren]);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ kind: 'single', transfer: single });
    expect(items[1]).toMatchObject({ kind: 'folder', folderName: 'Docs' });
  });

  test('queued/active/completed aggregate status: in_progress wins while anything is still running', () => {
    const children = [
      transfer({ id: 1, shared_folder_id: 1, folder_relative_path: 'F/a', status: 'completed' }),
      transfer({ id: 2, shared_folder_id: 1, folder_relative_path: 'F/b', status: 'in_progress' }),
    ];
    const items = groupTransfers(children);
    expect(items[0]).toMatchObject({ status: 'in_progress' });
  });

  test('aggregate status is failed if any child failed, even after others completed', () => {
    const children = [
      transfer({ id: 1, shared_folder_id: 1, folder_relative_path: 'F/a', status: 'completed' }),
      transfer({ id: 2, shared_folder_id: 1, folder_relative_path: 'F/b', status: 'failed', failure_reason: 'boom' }),
    ];
    const items = groupTransfers(children);
    expect(items[0]).toMatchObject({ status: 'failed' });
  });

  test('aggregate status is completed only once every child is completed', () => {
    const children = [
      transfer({ id: 1, shared_folder_id: 1, folder_relative_path: 'F/a', status: 'completed' }),
      transfer({ id: 2, shared_folder_id: 1, folder_relative_path: 'F/b', status: 'completed' }),
    ];
    const items = groupTransfers(children);
    expect(items[0]).toMatchObject({ status: 'completed' });
  });

  test('duplicate folder display names sharing distinct ids each get their own group, none merged', () => {
    const groups = [1, 2, 3].flatMap(folderId =>
      [1, 2].map(n =>
        transfer({ id: folderId * 10 + n, shared_folder_id: folderId, folder_relative_path: `test/f${n}.txt` }),
      ),
    );
    const items = groupTransfers(groups);
    expect(items).toHaveLength(3);
    expect(items.every(item => item.kind === 'folder' && item.folderName === 'test')).toBe(true);
  });

  test('group position follows the first-encountered child, preserving a newest-first input order', () => {
    const newestSingle = transfer({ id: 10, shared_file_id: 1, file_name: 'newest.txt' });
    const folderChild1 = transfer({ id: 9, shared_folder_id: 1, folder_relative_path: 'F/a' });
    const folderChild2 = transfer({ id: 8, shared_folder_id: 1, folder_relative_path: 'F/b' });
    const oldestSingle = transfer({ id: 7, shared_file_id: 2, file_name: 'oldest.txt' });

    const items = groupTransfers([newestSingle, folderChild1, folderChild2, oldestSingle]);
    expect(items.map(item => item.kind)).toEqual(['single', 'folder', 'single']);
  });
});
