/**
 * The two pairing endpoints Android is documented to call
 * (backend/README.md "Pairing API" — request, result).
 *
 * Both take `desktopBaseUrl` explicitly rather than relying on the
 * configured api/config.ts base URL: pairing happens *before* any session
 * exists, against whichever desktop the QR code just identified.
 */

import { apiClient } from '../client';
import {
  PairingRequestSubmitRequest,
  PairingResultResponse,
  StatusResponse,
} from '../types';

export function submitPairingRequest(
  desktopBaseUrl: string,
  body: PairingRequestSubmitRequest,
): Promise<StatusResponse> {
  return apiClient.post('/pairing/request', body, desktopBaseUrl);
}

export function getPairingResult(
  desktopBaseUrl: string,
  pairingToken: string,
): Promise<PairingResultResponse> {
  return apiClient.get(`/pairing/result/${pairingToken}`, desktopBaseUrl);
}
