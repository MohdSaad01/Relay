/**
 * Remembers which local file an upload (direction "receive") transfer is
 * for, since the backend has no concept of the Android device's local
 * filesystem — TransferResponse carries only file_name/file_size, not a URI.
 *
 * Keyed by transfer_id directly: a transfer proposal is auto-accepted in the
 * same call that creates it (backend/app/services/transfer_service.py), so
 * the transfer_id is already known by the time the file needs registering
 * — see TransferListScreen's "Upload a file" flow. In-memory only — lost on
 * app restart, which is acceptable: V1 has no resume support
 * (docs/11_File_Transfer.md §16), so an upload whose local file reference is
 * gone can't continue regardless.
 */

import { PickedUploadFile } from './types';

const sourcesByTransferId = new Map<number, PickedUploadFile>();

export function registerUploadSource(transferId: number, file: PickedUploadFile): void {
  sourcesByTransferId.set(transferId, file);
}

export function getUploadSource(transferId: number): PickedUploadFile | undefined {
  return sourcesByTransferId.get(transferId);
}

export function clearUploadSource(transferId: number): void {
  sourcesByTransferId.delete(transferId);
}
