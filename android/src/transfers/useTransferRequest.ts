import { useCallback, useEffect, useState } from 'react';
import { getTransferRequest, withdrawTransferRequest } from '../api/endpoints/transfers';
import { ApiError } from '../api/client';
import { TransferRequestResponse } from '../api/types';

interface State {
  request: TransferRequestResponse | null;
  loading: boolean;
  error: string | null;
}

/** Loads a single pending (or just-decided) transfer request, for TransferDetailScreen. */
export function useTransferRequest(requestId: string) {
  const [state, setState] = useState<State>({ request: null, loading: true, error: null });

  const refresh = useCallback(async () => {
    try {
      const request = await getTransferRequest(requestId);
      setState({ request, loading: false, error: null });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not load this request.';
      setState(prev => ({ ...prev, loading: false, error: message }));
    }
  }, [requestId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Withdraws this still-pending request. Unlike cancel() on useTransfer,
   * there is nothing to refresh into afterward — DELETE removes the request
   * from TransferManager entirely, so a subsequent GET would just 404. The
   * caller (TransferRequestDetail) navigates back instead.
   */
  const withdraw = useCallback(() => withdrawTransferRequest(requestId), [requestId]);

  return { ...state, refresh, withdraw };
}
