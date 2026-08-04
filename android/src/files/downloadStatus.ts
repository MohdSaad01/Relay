import { TransferRequestResponse, TransferResponse } from '../api/types';

/**
 * A shared file's download status, derived from the same pending-requests
 * (GET /transfers/requests) and persisted-transfers (GET /transfers) lists
 * TransferListScreen already polls — not tracked separately by FilesScreen.
 */
export type FileDownloadStatus =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'in_progress' }
  | { kind: 'completed' }
  | { kind: 'failed'; message: string | null };

/**
 * A proposed download (direction "send") is auto-accepted by the backend in
 * the same call that proposes it, so it becomes a persisted Transfer
 * immediately and is never observed sitting in the pending-requests list
 * (TransferManager only ever lists still-PENDING requests, and a download's
 * request is never left PENDING — see TransferService.request_transfer). The
 * authoritative source is whichever of the two actually references this file
 * right now: a matching Transfer if one exists (it supersedes the request
 * that spawned it), otherwise a matching pending request — a purely
 * defensive fallback for the brief window between FilesScreen's propose call
 * and its first refresh — otherwise idle.
 */
export function deriveDownloadStatus(
  fileId: number,
  requests: TransferRequestResponse[],
  transfers: TransferResponse[],
): FileDownloadStatus {
  const transfer = transfers
    .filter(t => t.shared_file_id === fileId && t.direction === 'send')
    .sort((a, b) => b.id - a.id)[0];

  if (transfer) {
    switch (transfer.status) {
      case 'completed':
        return { kind: 'completed' };
      case 'in_progress':
        return { kind: 'in_progress' };
      case 'failed':
        return { kind: 'failed', message: transfer.failure_reason };
      case 'cancelled':
        return { kind: 'idle' };
    }
  }

  const pending = requests.some(r => r.shared_file_id === fileId && r.direction === 'send');
  return pending ? { kind: 'pending' } : { kind: 'idle' };
}
