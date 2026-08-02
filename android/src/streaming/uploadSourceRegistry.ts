/**
 * Remembers which local file an upload (direction "receive") proposal was
 * for, since the backend has no concept of the Android device's local
 * filesystem — TransferResponse carries only file_name/file_size, not a URI.
 *
 * Keyed by request_id at proposal time (the only id that exists then), then
 * "promoted" to transfer_id once the desktop accepts and a Transfer row
 * exists. In-memory only — lost on app restart, which is acceptable: V1 has
 * no resume support (docs/11_File_Transfer.md §16), so an upload whose
 * local file reference is gone can't continue regardless.
 */

import { PickedUploadFile } from './types';

const sourcesByRequestId = new Map<string, PickedUploadFile>();
const sourcesByTransferId = new Map<number, PickedUploadFile>();

export function registerUploadSource(requestId: string, file: PickedUploadFile): void {
  sourcesByRequestId.set(requestId, file);
}

export function promoteUploadSource(requestId: string, transferId: number): void {
  const file = sourcesByRequestId.get(requestId);
  if (file) {
    sourcesByTransferId.set(transferId, file);
    sourcesByRequestId.delete(requestId);
  }
}

export function getUploadSource(transferId: number): PickedUploadFile | undefined {
  return sourcesByTransferId.get(transferId);
}

export function clearUploadSource(transferId: number): void {
  sourcesByTransferId.delete(transferId);
}
