import { useCallback, useEffect, useState } from 'react';
import { listTransfers } from '../api/endpoints/transfers';
import { ApiError } from '../api/client';
import { TransferResponse } from '../api/types';

interface State {
  transfers: TransferResponse[];
  loading: boolean;
  error: string | null;
}

/**
 * Loads this device's own persisted transfers (GET /transfers — dual-audience,
 * already scoped server-side to just this caller). Same shape as
 * useTransferRequests: fetches once on mount, exposes refresh() for the
 * screen to drive its own polling cadence.
 */
export function useTransfers() {
  const [state, setState] = useState<State>({ transfers: [], loading: true, error: null });

  const refresh = useCallback(async () => {
    try {
      const transfers = await listTransfers();
      setState({ transfers, loading: false, error: null });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not load transfers.';
      setState(prev => ({ ...prev, loading: false, error: message }));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh };
}
