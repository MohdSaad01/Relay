import { useEffect, useState } from 'react';
import { getFolderFiles } from '../api/endpoints/folders';
import { AvailableFolderFileResponse, AvailableFolderResponse } from '../api/types';

type FolderFilesMap = Record<number, AvailableFolderFileResponse[]>;

/**
 * Lazily fetches each shared folder's child-file manifest once per folder id
 * (P13) — needed both to compute a folder row's aggregate download status
 * (folderDownloadStatus.ts) and to drive the actual per-file downloads when
 * the user taps a folder's Download button. Only fetches for folder ids not
 * already in the map, so FilesScreen's existing poll tick (which returns a
 * fresh `folders` array every time, same identity or not) doesn't re-fetch
 * every folder's manifest on every tick — the same "don't re-fetch what
 * hasn't changed" spirit as useSharedFiles' own refreshSilently.
 *
 * Does not track live changes to an already-fetched folder's contents (e.g.
 * the desktop refreshing it mid-session) — an accepted, narrow limitation;
 * tapping Download always re-fetches that one folder's manifest fresh
 * regardless of what's cached here (see FilesScreen.handleFolderDownload).
 */
export function useFolderFilesMap(folders: AvailableFolderResponse[]) {
  const [map, setMap] = useState<FolderFilesMap>({});

  useEffect(() => {
    const missing = folders.filter(folder => !(folder.id in map));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(missing.map(folder => getFolderFiles(folder.id).then(files => [folder.id, files] as const)))
      .then(entries => {
        if (cancelled) return;
        setMap(prev => {
          const next = { ...prev };
          for (const [id, files] of entries) {
            next[id] = files;
          }
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [folders, map]);

  return map;
}
