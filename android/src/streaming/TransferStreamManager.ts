/**
 * Owns the one transfer (at most) whose bytes this app instance is actively
 * moving. Deliberately a plain module-level singleton, same shape as
 * SessionManager/DiscoveryService — not tied to any screen's mount/focus,
 * so a stream keeps running (backed by the foreground service) if the user
 * navigates away or backgrounds the app mid-transfer.
 *
 * Only one active stream at a time, matching docs/11_File_Transfer.md §10's
 * sequential-processing model and the backend's own ActiveStreamRegistry
 * (one active stream per transfer_id — this goes further and limits the
 * whole app to one at a time, keeping the V1 UI simple).
 *
 * Triggered by TransferProgressDetail when it observes an in_progress
 * transfer that isn't already streaming — see that screen for why nothing
 * auto-starts a stream the user hasn't looked at (V1 has no push/background
 * fetch trigger, by design, matching the "no push notifications" scope).
 */

import { PermissionsAndroid } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { getApiConfig } from '../api/config';
import { cancelTransfer } from '../api/endpoints/transfers';
import { ApiError } from '../api/client';
import { TransferResponse } from '../api/types';
import { SessionManager } from '../session/SessionManager';
import { downloadFile, isStreamCancelError, StreamTask, uploadFile } from './blobUtil';
import { clearUploadSource, getUploadSource } from './uploadSourceRegistry';
import { startTransferNotification, stopTransferNotification, updateTransferNotification } from './foregroundService';
import { StreamState } from './types';

type Listener = () => void;

let state: StreamState | null = null;
let activeTask: StreamTask | null = null;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach(listener => listener());
}

function setState(next: StreamState): void {
  state = next;
  notify();
}

function downloadDestinationPath(fileName: string): string {
  return `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/Downloads/${fileName}`;
}

export const TransferStreamManager = {
  getState(): StreamState | null {
    return state;
  },

  /** True only while this exact transfer's bytes are actively moving right now. */
  isActive(transferId: number): boolean {
    return state?.transferId === transferId && state.status === 'streaming';
  },

  /**
   * Starts streaming `transfer`'s bytes. A no-op if this app is already
   * streaming something (including this same transfer) — the caller
   * (TransferProgressDetail) falls back to server-polled state in that
   * case. Also a no-op if this transfer already ran to a terminal local
   * result (completed/failed/cancelled): V1 has no retry — a failed
   * transfer must be explicitly cancelled and re-proposed, not silently
   * restarted the next time its detail screen regains focus.
   */
  async start(transfer: TransferResponse): Promise<void> {
    if (state?.status === 'streaming') {
      return;
    }
    if (state?.transferId === transfer.id) {
      return;
    }

    const { baseUrl, sessionToken } = getApiConfig();
    if (!baseUrl || !sessionToken) {
      setState({
        transferId: transfer.id,
        direction: transfer.direction,
        fileName: transfer.file_name,
        bytesTransferred: 0,
        totalBytes: transfer.file_size,
        status: 'failed',
        error: 'No active session.',
      });
      return;
    }

    // Requested here, not at app launch — the one moment this app actually
    // needs it, per the approved design's Permissions section. Best-effort:
    // a denial doesn't block starting the service, it just means Android
    // suppresses the notification while the service (and the OS-level
    // protection from background throttling it provides) still runs.
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => undefined);

    setState({
      transferId: transfer.id,
      direction: transfer.direction,
      fileName: transfer.file_name,
      bytesTransferred: 0,
      totalBytes: transfer.file_size,
      status: 'streaming',
      error: null,
    });

    await startTransferNotification(transfer.file_name, 0);

    const onProgress = (transferred: number, total: number): void => {
      if (!state || state.transferId !== transfer.id) {
        return;
      }
      const totalBytes = total > 0 ? total : state.totalBytes;
      setState({ ...state, bytesTransferred: transferred, totalBytes });
      updateTransferNotification(transfer.file_name, totalBytes > 0 ? transferred / totalBytes : 0);
    };

    const headers = { Authorization: `Bearer ${sessionToken}` };

    try {
      if (transfer.direction === 'send') {
        activeTask = downloadFile(
          `${baseUrl}/transfers/${transfer.id}/download`,
          headers,
          downloadDestinationPath(transfer.file_name),
          onProgress,
        );
      } else {
        const source = getUploadSource(transfer.id);
        if (!source) {
          throw new Error(
            'The file originally selected for this upload is no longer available. Cancel and start a new upload.',
          );
        }
        activeTask = uploadFile(
          `${baseUrl}/transfers/${transfer.id}/upload`,
          headers,
          source.uri,
          onProgress,
        );
      }

      await activeTask.promise;
      if (state?.transferId === transfer.id) {
        setState({ ...state, status: 'completed', bytesTransferred: state.totalBytes });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await SessionManager.clearSession();
      }
      if (state?.transferId === transfer.id) {
        const cancelled = isStreamCancelError(err);
        setState({
          ...state,
          status: cancelled ? 'cancelled' : 'failed',
          error: cancelled ? null : (err as Error).message,
        });
      }
    } finally {
      activeTask = null;
      clearUploadSource(transfer.id);
      await stopTransferNotification();
    }
  },

  /** Aborts the active stream locally and tells the backend, best-effort. */
  async cancelActive(): Promise<void> {
    if (!state || state.status !== 'streaming') {
      return;
    }
    const { transferId } = state;
    activeTask?.cancel();
    try {
      await cancelTransfer(transferId);
    } catch {
      // The local abort already stops the stream regardless of whether the
      // backend's own cancel call succeeds — best-effort only.
    }
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
