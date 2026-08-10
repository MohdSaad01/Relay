import { TransferDirection, TransferResponse, TransferStatus } from '../api/types';

/**
 * P21.1 (Issue 2): the Transfers tab lists persisted `Transfer` rows
 * one-to-one today, so downloading/uploading a folder of N files shows N
 * separate rows instead of the one folder-level operation the user actually
 * performed — the child transfers themselves are unaffected (still ordinary
 * rows, still fed one at a time through TransferStreamManager's FIFO, see
 * that module's own doc comment); this is purely a presentation grouping on
 * top of the existing `GET /transfers` data, mirroring
 * `desktop/src/renderer/transferGrouping.js`'s own batch grouping for the
 * same underlying data (Android's download side just has no
 * `upload_batch_id` equivalent to key off — see `folderGroupKey` below).
 */
export interface SingleTransferItem {
  kind: 'single';
  transfer: TransferResponse;
}

export interface FolderTransferGroup {
  kind: 'folder';
  /** Stable per-render React key — not a durable cross-session identity, see this module's own doc comment on shared_folder_id reuse. */
  key: string;
  folderName: string;
  direction: TransferDirection;
  deviceName: string;
  transfers: TransferResponse[];
  status: TransferStatus;
}

export type TransferListItem = SingleTransferItem | FolderTransferGroup;

/**
 * The key every child of one folder operation shares:
 * - An Android folder *upload* (`direction: 'receive'`) carries a
 *   client-generated `upload_batch_id` (TransferListScreen.handleUploadFolder)
 *   — a UUID, never reused, so grouping on it has no P17-style identity risk.
 * - An Android folder *download* (`direction: 'send'`) carries the shared
 *   folder's `shared_folder_id` instead (no `upload_batch_id` — that field is
 *   receive-only, see `api/types.ts`).
 *
 * `shared_folder_id` is a plain SQLite integer primary key, not durable
 * identity (P17, `files/folderIdentity.ts`) — once every row in
 * `shared_folders` is deleted, SQLite can hand the same id to a later,
 * unrelated folder. Grouping Transfer *history* by this id alone can
 * therefore, in the narrow case where a folder is downloaded, fully
 * unshared, and a different folder is later shared and reuses the same id,
 * merge two logically unrelated download batches under one folder row here.
 * Unlike `folderIdentity.ts`'s own P17 fix, there is no general fix
 * available at this layer: that fix cross-checks a live `SharedFolder`'s
 * `shared_at`, but this screen renders permanent transfer *history*
 * (`docs/13_Database_Design.md` §7/§10), including transfers whose folder
 * was unshared long ago and so no longer has a live `shared_at` to check
 * against at all. Accepted as a known V1 limitation (see
 * `docs/15_QA_NOTEBOOK.md`'s P21.1 entry) rather than solved here — the
 * common case (one folder, downloaded once or retried) groups correctly,
 * and a false merge requires the specific id-reuse sequence above.
 */
function folderGroupKey(transfer: TransferResponse): string | null {
  if (transfer.direction === 'receive' && transfer.upload_batch_id) {
    return `upload:${transfer.upload_batch_id}`;
  }
  if (transfer.direction === 'send' && transfer.shared_folder_id != null) {
    return `download:${transfer.shared_folder_id}`;
  }
  return null;
}

/**
 * The backend always builds a folder child's `folder_relative_path` as
 * "<folder-name>/<rest>" for both directions — a download's leading segment
 * is the shared folder's raw `folder_name`
 * (`backend/app/services/transfer_service.py::_resolve_download_naming`),
 * and a folder upload's is the on-desktop, conflict-resolved root name
 * (`_validate_folder_upload_payload`, "root-inclusive" per its own doc
 * comment) — so the first path segment is always the right display name for
 * either direction, with no separate desktop round trip needed.
 */
function folderNameFor(transfer: TransferResponse): string {
  return transfer.folder_relative_path?.split('/')[0] ?? transfer.file_name;
}

/**
 * One folder-level status representing every child, in the same
 * failed > in_progress > completed priority desktop's own
 * `renderBatchRow` already uses — a folder operation is only "Completed" once
 * every child is, and any single failure marks the whole operation failed
 * (matching FilesScreen's `deriveFolderDownloadStatus` for a download's own
 * aggregate status). A folder whose children are a mix of 'completed' and
 * 'cancelled' (no failures, nothing still running) reports 'cancelled' —
 * the operation as the user experienced it did not fully succeed.
 */
function aggregateStatus(transfers: TransferResponse[]): TransferStatus {
  if (transfers.some(t => t.status === 'failed')) {
    return 'failed';
  }
  if (transfers.some(t => t.status === 'in_progress')) {
    return 'in_progress';
  }
  if (transfers.every(t => t.status === 'completed')) {
    return 'completed';
  }
  if (transfers.some(t => t.status === 'cancelled')) {
    return 'cancelled';
  }
  return 'completed';
}

/**
 * Groups `transfers` (already in whatever order the caller wants rendered,
 * typically `GET /transfers`'s own newest-first order) into one row per
 * folder operation plus one row per ordinary standalone transfer — a
 * standalone file (`folderGroupKey` returns null) is untouched, always its
 * own `single` item, exactly the flat row it already is today. Group
 * position is the position of its first-encountered child, so a newest-first
 * input list stays newest-first at the group level too.
 */
export function groupTransfers(transfers: TransferResponse[]): TransferListItem[] {
  const groups = new Map<string, FolderTransferGroup>();
  const items: TransferListItem[] = [];

  for (const transfer of transfers) {
    const key = folderGroupKey(transfer);
    if (key == null) {
      items.push({ kind: 'single', transfer });
      continue;
    }
    let group = groups.get(key);
    if (!group) {
      group = {
        kind: 'folder',
        key,
        folderName: folderNameFor(transfer),
        direction: transfer.direction,
        deviceName: transfer.device_name,
        transfers: [],
        status: 'completed',
      };
      groups.set(key, group);
      items.push(group);
    }
    group.transfers.push(transfer);
  }

  for (const item of items) {
    if (item.kind === 'folder') {
      item.status = aggregateStatus(item.transfers);
    }
  }

  return items;
}
