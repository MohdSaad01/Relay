import { useCallback, useEffect, useState } from 'react';
import { getAvailableFiles } from '../api/endpoints/files';
import { ApiError } from '../api/client';
import { AvailableFileResponse } from '../api/types';

interface SharedFilesState {
  files: AvailableFileResponse[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
}

/** Loads the desktop's shared-file list on mount and supports pull-to-refresh. No caching beyond the current screen instance — the desktop's shared set can change at any time and there's no push channel to invalidate a cache. */
export function useSharedFiles() {
  const [state, setState] = useState<SharedFilesState>({
    files: [],
    loading: true,
    refreshing: false,
    error: null,
  });

  const load = useCallback(async (isRefresh: boolean) => {
    setState(prev => ({ ...prev, loading: !isRefresh, refreshing: isRefresh, error: null }));
    try {
      const files = await getAvailableFiles();
      setState({ files, loading: false, refreshing: false, error: null });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not load shared files.';
      setState(prev => ({ ...prev, loading: false, refreshing: false, error: message }));
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return { ...state, refresh };
}
