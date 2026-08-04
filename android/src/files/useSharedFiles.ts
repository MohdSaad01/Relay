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

type LoadMode = 'initial' | 'refresh' | 'silent';

/**
 * Loads the desktop's shared-file list on mount and supports pull-to-refresh.
 * No caching beyond the current screen instance — the desktop's shared set
 * can change at any time and there's no push channel to invalidate a cache.
 *
 * `refresh()` drives the visible pull-to-refresh spinner (isRefresh
 * semantics, unchanged from before). `refreshSilently()` is for
 * FilesScreen's focus/poll-driven sync (there is no push channel from the
 * desktop, so it's the smallest way to pick up newly shared files without a
 * manual pull) — it re-fetches the same way but never toggles
 * `loading`/`refreshing`, so a background tick doesn't flash the spinner.
 */
export function useSharedFiles() {
  const [state, setState] = useState<SharedFilesState>({
    files: [],
    loading: true,
    refreshing: false,
    error: null,
  });

  const load = useCallback(async (mode: LoadMode) => {
    if (mode !== 'silent') {
      setState(prev => ({ ...prev, loading: mode === 'initial', refreshing: mode === 'refresh', error: null }));
    }
    try {
      const files = await getAvailableFiles();
      setState({ files, loading: false, refreshing: false, error: null });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not load shared files.';
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
