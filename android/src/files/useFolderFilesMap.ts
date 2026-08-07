import { useEffect, useState } from 'react';
import { getFolderFiles } from '../api/endpoints/folders';
import { AvailableFolderFileResponse, AvailableFolderResponse } from '../api/types';

type FolderFilesMap = Record<number, AvailableFolderFileResponse[]>;

/**
 * Fetches each shared folder's child-file manifest (P13) — needed both to
 * compute a folder row's aggregate download status (folderDownloadStatus.ts)
 * and to drive the actual per-file downloads when the user taps a folder's
 * Download button.
 *
 * P13.2 (Issue 2): re-fetches every shared folder's manifest on every run of
 * this effect, rather than only for ids not already in the map. The
 * original "fetch once per id, forever" version was the root cause of a
 * downloaded folder never being detected as stale: FilesScreen's row status
 * is derived from this map, so a folder whose contents changed on the
 * desktop kept being scored against the manifest from the moment it was
 * first downloaded, no matter how many times GET /folders itself (already
 * polled separately, and already correctly reflecting the new file_count/
 * total_size) refreshed afterward.
 *
 * This effect already re-runs on every one of FilesScreen's existing poll
 * ticks (FILES_POLL_INTERVAL_MS) — refreshSilently/refreshFoldersSilently
 * hand it a new `folders` array identity every time regardless of whether
 * anything actually changed, which is exactly what re-triggers this effect.
 * So doing more work per run is not a new polling loop, just this hook no
 * longer opting out of the one that already exists. The added cost (N
 * parallel GET requests per tick, N = shared folder count) is bounded by how
 * many folders are actually shared, matching how the sibling `files`/
 * `folders` lists themselves are already refetched wholesale on every tick.
 */
export function useFolderFilesMap(folders: AvailableFolderResponse[]) {
  const [map, setMap] = useState<FolderFilesMap>({});

  useEffect(() => {
    if (folders.length === 0) return;
    let cancelled = false;
    Promise.all(folders.map(folder => getFolderFiles(folder.id).then(files => [folder.id, files] as const)))
      .then(entries => {
        if (cancelled) return;
        const next: FolderFilesMap = {};
        for (const [id, files] of entries) {
          next[id] = files;
        }
        setMap(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [folders]);

  return map;
}
