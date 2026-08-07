import { AvailableFolderFileResponse, TransferRequestResponse, TransferResponse } from '../api/types';
import { deriveDownloadStatus } from './downloadStatus';

/**
 * A shared folder's aggregate download status (P13), derived from the
 * existing per-file deriveDownloadStatus applied to each child — a folder's
 * children are ordinary SharedFile rows under the hood (see
 * backend/app/services/shared_folder_service.py), so nothing new is needed
 * to know any one child's own status.
 *
 * Unlike FileDownloadStatus, this does not fold in useDownloadExistence's
 * on-device verification — that hook is keyed by a flat file_name and does
 * not extend to a folder child's nested relative_path. A folder therefore
 * shows 'completed' once every child's Transfer says so, even if one was
 * since deleted from disk; documented as an accepted V1 limitation.
 */
export interface FolderDownloadStatus {
  kind: 'idle' | 'in_progress' | 'completed' | 'failed';
  completedCount: number;
  totalCount: number;
}

export function deriveFolderDownloadStatus(
  children: AvailableFolderFileResponse[],
  requests: TransferRequestResponse[],
  transfers: TransferResponse[],
): FolderDownloadStatus {
  if (children.length === 0) {
    return { kind: 'idle', completedCount: 0, totalCount: 0 };
  }
  const statuses = children.map(child => deriveDownloadStatus(child.id, requests, transfers));
  const completedCount = statuses.filter(status => status.kind === 'completed').length;

  let kind: FolderDownloadStatus['kind'];
  if (statuses.some(status => status.kind === 'failed')) {
    kind = 'failed';
  } else if (statuses.some(status => status.kind === 'in_progress' || status.kind === 'pending')) {
    kind = 'in_progress';
  } else if (completedCount === children.length) {
    kind = 'completed';
  } else {
    kind = 'idle';
  }

  return { kind, completedCount, totalCount: children.length };
}
