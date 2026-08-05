import { TransferResponse, TransferStatus } from '../api/types';
import { StreamState } from '../streaming/types';

/** What TransferProgressDetail actually renders, after merging server and local state. */
export interface MergedTransferView {
  status: TransferStatus;
  bytesTransferred: number;
  totalBytes: number;
  showCancel: boolean;
}

/**
 * Merges the server-polled Transfer with TransferStreamManager's live
 * StreamState for the same transfer, for TransferProgressDetail.
 *
 * The server wins outright once it reports a terminal status: it is then at
 * least as fresh as anything local, and second-guessing it was Milestone
 * P3's original bug (docs/15_QA_NOTEBOOK.md). While the server still reports
 * in_progress, the live stream's byte count is preferred for its finer
 * granularity — and, once the local stream itself reaches a terminal
 * outcome (completed/failed/cancelled) ahead of the next server poll, its
 * status is preferred too, so the status badge and Cancel button don't keep
 * showing a stale "in progress" for a few seconds after bytesTransferred is
 * already sitting at the full total (Milestone P5).
 */
export function mergeLiveTransferState(transfer: TransferResponse, stream: StreamState | null): MergedTransferView {
  const liveStream = stream?.transferId === transfer.id && transfer.status === 'in_progress' ? stream : null;

  if (!liveStream) {
    return {
      status: transfer.status,
      bytesTransferred: transfer.bytes_transferred,
      totalBytes: transfer.file_size,
      showCancel: transfer.status === 'in_progress',
    };
  }

  const status: TransferStatus = liveStream.status === 'streaming' ? 'in_progress' : liveStream.status;
  return {
    status,
    bytesTransferred: liveStream.bytesTransferred,
    totalBytes: liveStream.totalBytes,
    showCancel: status === 'in_progress',
  };
}
