import { useCallback, useEffect, useState } from 'react';
import { readAllReconciledChildren } from './folderIdentity';

type ReconciliationMap = Record<number, Record<string, number>>;

/**
 * Loads every shared folder's reconciliation record (folderIdentity.ts's
 * markFolderReconciled — the (relative_path -> file_size) shape last
 * confirmed on disk) into React state, so folderDownloadStatus.ts's
 * deriveFolderDownloadStatus — a pure, synchronous function called during
 * render — can compare against it without doing its own file I/O.
 *
 * One read of the whole registry file per call, not one per folder (the
 * registry already stores every folder's record together — see
 * folderIdentity.ts's readAllReconciledChildren), so this stays cheap
 * regardless of how many folders are shared.
 *
 * Re-reads on the same poll tick useFolderFilesMap already re-runs on
 * (`folders` gets a new array identity every FILES_POLL_INTERVAL_MS tick
 * regardless of whether anything changed) — not a new polling loop, just
 * this hook's effect piggybacking on that existing one. `refresh` is
 * exposed on top for the moment a local action (FilesScreen finishing a
 * folder download, whether or not it actually streamed anything new) just
 * wrote a fresh record and wants the row to reflect it immediately, rather
 * than waiting out the rest of that poll interval.
 */
export function useFolderReconciliation(pollKey: unknown) {
  const [map, setMap] = useState<ReconciliationMap>({});

  const refresh = useCallback(() => {
    let cancelled = false;
    readAllReconciledChildren()
      .then(result => {
        if (!cancelled) {
          setMap(result);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refresh(), [pollKey, refresh]);

  return { reconciledByFolderId: map, refresh };
}
