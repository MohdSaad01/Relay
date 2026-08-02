/**
 * Transfer endpoints Android may call (backend/README.md "Transfer API").
 *
 * Not included here, deliberately:
 * - POST /transfers/requests/{id}/accept|reject — desktop-only decision.
 * - GET /transfers/{id}/download, POST /transfers/{id}/upload — the actual
 *   byte streams. Those need react-native-blob-util, not JSON fetch, and
 *   belong to the transfer-streaming milestone.
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

export function getTransferRequest(requestId: string): Promise<TransferRequestResponse> {
  return apiClient.get(`/transfers/requests/${requestId}`);
}

export function withdrawTransferRequest(requestId: string): Promise<void> {
  return apiClient.del(`/transfers/requests/${requestId}`);
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
