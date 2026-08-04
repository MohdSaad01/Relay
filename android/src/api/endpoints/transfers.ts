/**
 * Transfer endpoints Android may call (backend/README.md "Transfer API").
 *
 * Not included here, deliberately:
 * - GET /transfers/{id}/download, POST /transfers/{id}/upload — the actual
 *   byte streams. Those need react-native-blob-util, not JSON fetch, and
 *   belong to the transfer-streaming milestone.
 *
 * DELETE /transfers/requests/{id} (withdraw) and the desktop-only
 * accept/reject decision no longer exist on the backend: every proposal is
 * auto-accepted in the same call that creates it, so there is nothing left
 * pending to withdraw or decide on.
 */

import { apiClient } from '../client';
import {
  TransferRequestCreate,
  TransferRequestResponse,
  TransferResponse,
} from '../types';

export function proposeTransfer(body: TransferRequestCreate): Promise<TransferRequestResponse> {
  return apiClient.post('/transfers/requests', body);
}

export function listTransferRequests(): Promise<TransferRequestResponse[]> {
  return apiClient.get('/transfers/requests');
}

export function listTransfers(): Promise<TransferResponse[]> {
  return apiClient.get('/transfers');
}

export function getTransfer(transferId: number): Promise<TransferResponse> {
  return apiClient.get(`/transfers/${transferId}`);
}

export function cancelTransfer(transferId: number): Promise<TransferResponse> {
  return apiClient.post(`/transfers/${transferId}/cancel`);
}
