import { useCallback, useEffect, useState } from 'react';
import { cancelTransfer, getTransfer } from '../api/endpoints/transfers';
import { ApiError } from '../api/client';
import { TransferResponse } from '../api/types';

interface State {
  transfer: TransferResponse | null;
  loading: boolean;
  error: string | null;
}

/** Loads a single persisted transfer, for TransferDetailScreen. */
export function useTransfer(transferId: number) {
  const [state, setState] = useState<State>({ transfer: null, loading: true, error: null });

  const refresh = useCallback(async () => {
    try {
      const transfer = await getTransfer(transferId);
      setState({ transfer, loading: false, error: null });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not load this transfer.';
      setState(prev => ({ ...prev, loading: false, error: message }));
    }
  }, [transferId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** POST /transfers/{id}/cancel returns the updated Transfer directly, so this applies it without a second round trip. */
  const cancel = useCallback(async () => {
    const updated = await cancelTransfer(transferId);
    setState({ transfer: updated, loading: false, error: null });
  }, [transferId]);

  return { ...state, refresh, cancel };
}
