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
 * Started from two places: FilesScreen calls it the moment a download is
 * proposed (the backend auto-accepts it in that same call, so the file's
 * bytes should start moving immediately — no waiting for the user to visit
 * the Transfers tab), and TransferProgressDetail calls it opportunistically
 * whenever it observes an in_progress transfer that isn't already streaming
 * — the fallback that resumes a live view if the user navigates to a
 * transfer's detail screen without having started it from FilesScreen (e.g.
 * an accepted upload, or a download started from another app instance).
 * Both call sites are safe to call redundantly — see start()'s own guards.
 */

import { PermissionsAndroid } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { getApiConfig } from '../api/config';
import { cancelTransfer } from '../api/endpoints/transfers';
import { ApiError } from '../api/client';
import { TransferResponse } from '../api/types';
import { SessionManager } from '../session/SessionManager';
import { downloadFile, isStreamCancelError, publishDownload, StreamTask, uploadFile } from './blobUtil';
import { clearUploadSource, getUploadSource } from './uploadSourceRegistry';
import { startTransferNotification, stopTransferNotification, updateTransferNotification } from './foregroundService';
import { notifyDownloadComplete } from './downloadNotification';
import { StreamState } from './types';

type Listener = () => void;

let state: StreamState | null = null;
let activeTask: StreamTask | null = null;
// True from the moment a start() call has passed its guard checks until it
// has committed `state` — closes the race where a second start() call is
// invoked before the first one's own first `await` (the notification
// permission request, below) yields back to the event loop. Without this,
// two calls fired back-to-back both pass the state-based guards and both
// begin streaming, breaking the one-active-stream-at-a-time invariant this
// module documents above.
let starting = false;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach(listener => listener());
}

function setState(next: StreamState): void {
  state = next;
  notify();
}

// Private app-internal storage — never the final resting place a user
// browses to. It's just where bytes land while the stream is in flight;
// start() moves the finished file into public storage via publishDownload
// once the download completes. See blobUtil.ts's publishDownload for why.
function downloadStagingPath(fileName: string): string {
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
    if (state?.status === 'streaming' || starting) {
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

    starting = true;

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
    // From here on, state.status === 'streaming' is itself a sufficient
    // guard against a concurrent start() call — see the top of this method.
    starting = false;

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
          downloadStagingPath(transfer.file_name),
          transfer.file_size,
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
      if (transfer.direction === 'send') {
        const contentUri = await publishDownload(downloadStagingPath(transfer.file_name), transfer.file_name);
        await notifyDownloadComplete(transfer.file_name, contentUri);
      }
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
