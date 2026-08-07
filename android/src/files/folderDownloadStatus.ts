import { AvailableFolderFileResponse, TransferRequestResponse, TransferResponse } from '../api/types';
import { deriveDownloadStatus } from './downloadStatus';

/**
 * A shared folder's aggregate download status (P13), derived from the
 * existing per-file deriveDownloadStatus applied to each child — a folder's
 * children are ordinary SharedFile rows under the hood (see
 * backend/app/services/shared_folder_service.py), so nothing new is needed
 * to know any one child's own status.
 *
 * Unlike FileDownloadStatus, this does not fold in useDownloadExistence's
 * on-device verification — that hook is keyed by a flat file_name and does
 * not extend to a folder child's nested relative_path. A folder therefore
 * shows 'completed' once every child's Transfer says so, even if one was
 * since deleted from disk; documented as an accepted V1 limitation.
 *
 * P13.2 (Issue 2): 'completed' additionally requires isFolderContentReconciled
 * below — every child's Transfer being individually 'completed' is no longer
 * sufficient once the shared folder can change shape after being downloaded
 * (a file added, removed, renamed, or resized on the desktop). A folder
 * whose children are all individually 'completed' but whose content has
 * since drifted from what was last confirmed on disk (folderIdentity.ts's
 * reconciledChildren record) reports 'idle' instead, matching how a deleted
 * single file already downgrades back to 'idle' (useDownloadExistence).
 *
 * P13.3: the on-device gap called out above is now closed — see the
 * `folderExists` parameter below, FilesScreen's own live re-verification of
 * a folder's root directory (via useDownloadExistence, reused for folder
 * roots, keyed by folderIdentity.ts's resolved localRoot), and
 * downloadActions.ts's openDownloadedFolder. A deleted folder therefore now
 * downgrades back to 'idle' exactly like a deleted single file.
 */
export interface FolderDownloadStatus {
  kind: 'idle' | 'in_progress' | 'completed' | 'failed';
  completedCount: number;
  totalCount: number;
}

/**
 * Whether one current child's on-device copy matches what this folder's
 * reconciliation record (folderIdentity.ts's markFolderReconciled — the
 * (relative_path -> file_size) shape confirmed at the end of the last
 * successful download, *not* Transfer history) says was actually
 * downloaded. Used both to gate a folder's aggregate 'completed' status
 * below and by FilesScreen.handleFolderDownload to decide which children a
 * re-download of a since-changed folder must actually re-fetch (a child
 * whose Transfer already says 'completed' but whose size has since changed
 * on the desktop must still be treated as needing a fresh download, not
 * skipped as already-done).
 *
 * `reconciledChildren` is undefined for a folder that has never finished a
 * download (or predates this reconciliation record) — every child is
 * correctly "not reconciled" in that case, same as an empty record.
 */
export function isFolderChildReconciled(
  child: AvailableFolderFileResponse,
  reconciledChildren: Record<string, number> | undefined,
): boolean {
  return reconciledChildren?.[child.relative_path] === child.file_size;
}

/**
 * Whether the whole folder's on-device copy matches what's currently
 * shared. Requires every current child to be individually reconciled
 * (catches an added or resized file) *and* the reconciled record to hold no
 * extra entries beyond the current children (catches a removed file, and —
 * combined with the per-child check above — a renamed one: the old path
 * lingers as an "extra" reconciled entry while the new path has no entry of
 * its own, so both directions of a rename are caught even when the file's
 * size never changed).
 */
function isFolderContentReconciled(
  children: AvailableFolderFileResponse[],
  reconciledChildren: Record<string, number> | undefined,
): boolean {
  const entries = reconciledChildren ?? {};
  if (Object.keys(entries).length !== children.length) {
    return false;
  }
  return children.every(child => isFolderChildReconciled(child, entries));
}

/**
 * Whether every current child's own Transfer has individually finished —
 * deliberately *not* gated on isFolderContentReconciled above (unlike
 * deriveFolderDownloadStatus's 'completed' kind): TransferStreamManager
 * calls this to decide the exact moment a download run itself has finished
 * and it's time to write the reconciliation record in the first place.
 * Gating that decision on the record it's about to write would never fire.
 */
export function areAllFolderChildrenDownloaded(
  children: AvailableFolderFileResponse[],
  requests: TransferRequestResponse[],
  transfers: TransferResponse[],
): boolean {
  return (
    children.length > 0 &&
    children.every(child => deriveDownloadStatus(child.id, requests, transfers).kind === 'completed')
  );
}

/**
 * `folderExists` (P13.3) mirrors deriveDownloadStatus's own `fileExists`
 * parameter exactly: optional and three-valued on purpose.  `undefined`
 * means "not checked yet" and is treated the same as `true` (optimistic —
 * don't flash "Download" while FilesScreen's on-device check is still in
 * flight), while an explicit `false` downgrades an otherwise-'completed'
 * folder back to 'idle' so it can be downloaded again. See
 * FilesScreen.tsx's folder-existence effect for how this gets populated —
 * a live re-check of the folder's resolved root directory
 * (folderIdentity.ts's localRoot) against the actual filesystem, the same
 * way useDownloadExistence already does for a single file.
 */
export function deriveFolderDownloadStatus(
  children: AvailableFolderFileResponse[],
  requests: TransferRequestResponse[],
  transfers: TransferResponse[],
  reconciledChildren: Record<string, number> | undefined,
  folderExists?: boolean,
): FolderDownloadStatus {
  if (children.length === 0) {
    return { kind: 'idle', completedCount: 0, totalCount: 0 };
  }
  const statuses = children.map(child => deriveDownloadStatus(child.id, requests, transfers));
  const completedCount = statuses.filter(status => status.kind === 'completed').length;

  let kind: FolderDownloadStatus['kind'];
  if (statuses.some(status => status.kind === 'failed')) {
    kind = 'failed';
  } else if (statuses.some(status => status.kind === 'in_progress' || status.kind === 'pending')) {
    kind = 'in_progress';
  } else if (
    completedCount === children.length &&
    isFolderContentReconciled(children, reconciledChildren) &&
    folderExists !== false
  ) {
    kind = 'completed';
  } else {
    kind = 'idle';
  }

  return { kind, completedCount, totalCount: children.length };
}
