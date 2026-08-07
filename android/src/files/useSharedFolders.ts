import { useCallback, useEffect, useState } from 'react';
import { getSharedFolders } from '../api/endpoints/folders';
import { ApiError } from '../api/client';
import { AvailableFolderResponse } from '../api/types';

interface SharedFoldersState {
  folders: AvailableFolderResponse[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
}

type LoadMode = 'initial' | 'refresh' | 'silent';

/**
 * Mirrors useSharedFiles.ts exactly (P13) — a shared folder is a separate
 * resource from a shared file (GET /folders vs GET /files), but the loading/
 * refresh/silent-poll semantics FilesScreen needs are identical, so this
 * hook is a straight parallel rather than folding folders into
 * useSharedFiles and inventing a discriminated-union state shape there.
 */
export function useSharedFolders() {
  const [state, setState] = useState<SharedFoldersState>({
    folders: [],
    loading: true,
    refreshing: false,
    error: null,
  });

  const load = useCallback(async (mode: LoadMode) => {
    if (mode !== 'silent') {
      setState(prev => ({ ...prev, loading: mode === 'initial', refreshing: mode === 'refresh', error: null }));
    }
    try {
      const folders = await getSharedFolders();
      setState({ folders, loading: false, refreshing: false, error: null });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not load shared folders.';
      setState(prev => ({ ...prev, loading: false, refreshing: false, error: message }));
    }
  }, []);

  useEffect(() => {
    load('initial');
  }, [load]);

  const refresh = useCallback(() => load('refresh'), [load]);
  const refreshSilently = useCallback(() => load('silent'), [load]);

  return { ...state, refresh, refreshSilently };
}
