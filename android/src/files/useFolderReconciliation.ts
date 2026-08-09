import { useCallback, useEffect, useState } from 'react';
import { AvailableFolderResponse } from '../api/types';
import { readAllLocalRoots, readAllReconciledChildren } from './folderIdentity';

type ReconciliationMap = Record<number, Record<string, number>>;
type LocalRootMap = Record<number, string>;

/**
 * Loads every shared folder's reconciliation record (folderIdentity.ts's
 * markFolderReconciled — the (relative_path -> file_size) shape last
 * confirmed on disk) AND its resolved on-device root directory name
 * (localRoot, P13.3) into React state, so folderDownloadStatus.ts's
 * deriveFolderDownloadStatus — a pure, synchronous function called during
 * render — can compare against the former without doing its own file I/O,
 * and FilesScreen can re-verify the latter still exists on disk.
 *
 * Two reads of the whole registry file per call (one per field), not one per
 * folder (the registry already stores every folder's record together — see
 * folderIdentity.ts's readAllReconciledChildren/readAllLocalRoots), so this
 * stays cheap regardless of how many folders are shared.
 *
 * Re-reads on the same poll tick useFolderFilesMap already re-runs on
 * (`folders` gets a new array identity every FILES_POLL_INTERVAL_MS tick
 * regardless of whether anything changed) — not a new polling loop, just
 * this hook's effect piggybacking on that existing one. `refresh` is
 * exposed on top for the moment a local action (FilesScreen finishing a
 * folder download, whether or not it actually streamed anything new, or
 * TransferStreamManager finishing a stream — see FilesScreen's own
 * TransferStreamManager subscription) just wrote a fresh record and wants
 * the row to reflect it immediately, rather than waiting out the rest of
 * that poll interval.
 *
 * `folders` (P17) is also handed to folderIdentity.ts's read functions as
 * the live `{id, shared_at}` set they filter stale entries against — a
 * shared_folder_id reused by a different logical folder (see
 * folderIdentity.ts's RegistryEntry doc comment) must never read back as
 * that new folder's own reconciled/localRoot state just because an
 * unrelated, already-deleted folder previously held the same id.
 */
export function useFolderReconciliation(folders: AvailableFolderResponse[]) {
  const [map, setMap] = useState<ReconciliationMap>({});
  const [localRootMap, setLocalRootMap] = useState<LocalRootMap>({});

  const refresh = useCallback(() => {
    let cancelled = false;
    const liveFolders = folders.map(folder => ({ id: folder.id, shared_at: folder.shared_at }));
    Promise.all([readAllReconciledChildren(liveFolders), readAllLocalRoots(liveFolders)])
      .then(([reconciled, localRoots]) => {
        if (!cancelled) {
          setMap(reconciled);
          setLocalRootMap(localRoots);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [folders]);

  useEffect(() => refresh(), [folders, refresh]);

  return { reconciledByFolderId: map, localRootByFolderId: localRootMap, refresh };
}
