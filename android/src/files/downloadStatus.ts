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
 * A proposed download (direction "send") only exists as a pending
 * TransferRequest until the desktop accepts it, at which point it becomes a
 * persisted Transfer and drops out of the requests list (TransferManager
 * only ever lists still-PENDING requests). So the authoritative source is
 * whichever of the two actually references this file right now: a matching
 * Transfer if one exists (it supersedes the request that spawned it),
 * otherwise a matching pending request, otherwise idle.
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
