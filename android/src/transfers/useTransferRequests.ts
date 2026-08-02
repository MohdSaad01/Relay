import { useCallback, useEffect, useState } from 'react';
import { listTransferRequests } from '../api/endpoints/transfers';
import { ApiError } from '../api/client';
import { TransferRequestResponse } from '../api/types';

interface State {
  requests: TransferRequestResponse[];
  loading: boolean;
  error: string | null;
}

/**
 * Loads this device's own pending transfer requests (GET /transfers/requests
 * — dual-audience, so the backend already scopes the response to just this
 * caller). Fetches once on mount; `refresh()` is exposed for the screen to
 * drive on whatever cadence it decides (see TransferListScreen's
 * useFocusEffect poll loop) — this hook doesn't poll on its own.
 */
export function useTransferRequests() {
  const [state, setState] = useState<State>({ requests: [], loading: true, error: null });

  const refresh = useCallback(async () => {
    try {
      const requests = await listTransferRequests();
      setState({ requests, loading: false, error: null });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not load transfer requests.';
      setState(prev => ({ ...prev, loading: false, error: message }));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh };
}
