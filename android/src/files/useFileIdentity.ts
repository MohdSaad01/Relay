import { useCallback, useEffect, useState } from 'react';
import { readAllLocalFileNames } from './fileIdentity';

type LocalNameMap = Record<number, string>;

/**
 * Loads every standalone shared file's resolved on-device name
 * (fileIdentity.ts's registry, P16) into React state — the file-level
 * mirror of useFolderReconciliation.ts's localRootByFolderId, for the same
 * reason: FilesScreen needs this to check/verify/open the actual physical
 * file a completed download landed on, not every row's own possibly-
 * colliding raw file_name.
 *
 * Re-reads on the same poll tick useSharedFiles already re-runs on (`files`
 * gets a new array identity every FILES_POLL_INTERVAL_MS tick) — not a new
 * polling loop, just this hook's effect piggybacking on that existing one.
 * `refresh` is exposed on top for the moment a local action (a download's
 * stream completing — see FilesScreen's TransferStreamManager subscription)
 * just wrote a fresh mapping and wants it reflected immediately, rather than
 * waiting out the rest of that poll interval.
 */
export function useFileIdentity(pollKey: unknown) {
  const [localNameByFileId, setLocalNameByFileId] = useState<LocalNameMap>({});

  const refresh = useCallback(() => {
    let cancelled = false;
    readAllLocalFileNames()
      .then(map => {
        if (!cancelled) {
          setLocalNameByFileId(map);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refresh(), [pollKey, refresh]);

  return { localNameByFileId, refresh };
}
