import { useCallback, useEffect, useState } from 'react';
import { AvailableFileResponse, AvailableFolderResponse } from '../api/types';
import { markItemRemoved, readRemovedIds } from './removedItems';

/**
 * Loads which currently-shared files/folders the user has locally "Removed"
 * (removedItems.ts) into React state, mirroring useFolderReconciliation.ts's
 * shape exactly. Re-reads whenever `files`/`folders` change — the same
 * FILES_POLL_INTERVAL_MS-driven refresh FilesScreen already re-runs
 * useFolderReconciliation on — plus exposes `refresh` for the moment
 * removeFile/removeFolder below just wrote a fresh dismissal and the row
 * needs to disappear immediately rather than waiting out the rest of that
 * poll interval.
 */
export function useRemovedItems(files: AvailableFileResponse[], folders: AvailableFolderResponse[]) {
  const [removedFileIds, setRemovedFileIds] = useState<Set<number>>(new Set());
  const [removedFolderIds, setRemovedFolderIds] = useState<Set<number>>(new Set());

  const refresh = useCallback(() => {
    let cancelled = false;
    const liveFiles = files.map(file => ({ id: file.id, shared_at: file.shared_at }));
    const liveFolders = folders.map(folder => ({ id: folder.id, shared_at: folder.shared_at }));
    Promise.all([readRemovedIds('file', liveFiles), readRemovedIds('folder', liveFolders)])
      .then(([removedFiles, removedFolders]) => {
        if (!cancelled) {
          setRemovedFileIds(removedFiles);
          setRemovedFolderIds(removedFolders);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [files, folders]);

  useEffect(() => refresh(), [files, folders, refresh]);

  const removeFile = useCallback(
    async (file: AvailableFileResponse) => {
      await markItemRemoved('file', file.id, file.shared_at);
      refresh();
    },
    [refresh],
  );

  const removeFolder = useCallback(
    async (folder: AvailableFolderResponse) => {
      await markItemRemoved('folder', folder.id, folder.shared_at);
      refresh();
    },
    [refresh],
  );

  return { removedFileIds, removedFolderIds, removeFile, removeFolder, refresh };
}
