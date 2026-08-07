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
 *
 * A start() call that arrives while another transfer is already streaming
 * does not run its bytes immediately, but it is never simply dropped either
 * (Milestone P11): it joins `queue` and is started automatically the moment
 * the active stream finishes, preserving the one-at-a-time invariant above
 * without ever leaving a proposed transfer stuck at 0 bytes until something
 * happens to call start() again for that exact transfer (previously only
 * TransferProgressDetail's own opportunistic effect could do that, so a
 * transfer proposed anywhere else — e.g. a second/third rapid tap on
 * FilesScreen — froze until its detail screen was visited).
 */

import { PermissionsAndroid, Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { getApiConfig } from '../api/config';
import { cancelTransfer, listTransferRequests, listTransfers } from '../api/endpoints/transfers';
import { getFolderFiles } from '../api/endpoints/folders';
import { ApiError } from '../api/client';
import { TransferResponse } from '../api/types';
import { SessionManager } from '../session/SessionManager';
import { deriveFolderDownloadStatus } from '../files/folderDownloadStatus';
import { downloadedFolderContentUri, MEDIASTORE_MIN_SDK } from '../files/downloadExistence';
import { downloadFile, isStreamCancelError, publishDownload, StreamTask, uploadFile } from './blobUtil';
import { clearUploadSource, getUploadSource } from './uploadSourceRegistry';
import { startTransferNotification, stopTransferNotification, updateTransferNotification } from './foregroundService';
import { notifyDownloadComplete, notifyFolderDownloadComplete } from './downloadNotification';
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
// Transfers whose start() call arrived while another was already active —
// drained in FIFO order as each active stream finishes. See this module's
// own doc comment above (Milestone P11).
const queue: TransferResponse[] = [];
const listeners = new Set<Listener>();

function enqueue(transfer: TransferResponse): void {
  if (transfer.id === state?.transferId || queue.some(queued => queued.id === transfer.id)) {
    return;
  }
  queue.push(transfer);
}

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
//
// downloadRelativePath (P13) is transfer.folder_relative_path when set (a
// folder child, e.g. "University Notes/Semester 1/DBMS.pdf") or otherwise
// just transfer.file_name (the pre-P13, single-file shape) — either way,
// react-native-blob-util's `.config({ path })` is expected to create any
// missing intermediate directories itself when writing the response.
function downloadRelativePath(transfer: TransferResponse): string {
  return transfer.folder_relative_path ?? transfer.file_name;
}

function downloadStagingPath(relativePath: string): string {
  return `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/Downloads/${relativePath}`;
}

/**
 * Fires exactly one "folder downloaded" notification (P13.1, Issue 3) once
 * every child of `transfer`'s shared folder has completed, instead of the
 * per-child notifyDownloadComplete a folder download used to produce one of
 * for every single file it contained. Reuses deriveFolderDownloadStatus
 * (files/folderDownloadStatus.ts) — the same aggregate-status logic
 * FilesScreen's folder row already relies on — against freshly-fetched
 * state rather than anything cached here, since this module has no local
 * view of the folder's other children.
 *
 * Only ever observes "all completed" on the *last* child to finish: every
 * child's Transfer row already exists as 'in_progress' the moment
 * FilesScreen.handleFolderDownload proposes it (auto-accepted, per M11), so
 * an earlier child's completion always still finds at least one sibling not
 * yet 'completed' here. No separate "already notified this folder" guard is
 * needed on top of that — the one-active-stream-at-a-time invariant this
 * module documents above means these checks never run concurrently for two
 * children of the same folder.
 *
 * A failed sibling permanently withholds this notification for the whole
 * folder (deriveFolderDownloadStatus never reports 'completed' once any
 * child has 'failed') — deliberate: a partially-failed folder download
 * should not be announced as a success.
 */
async function notifyIfFolderComplete(transfer: TransferResponse): Promise<void> {
  const folderId = transfer.shared_folder_id;
  if (folderId == null) {
    return;
  }
  try {
    const [children, requests, transfers] = await Promise.all([
      getFolderFiles(folderId),
      listTransferRequests(),
      listTransfers(),
    ]);
    const status = deriveFolderDownloadStatus(children, requests, transfers);
    if (status.kind !== 'completed') {
      return;
    }
    // The backend always builds a folder child's folder_relative_path as
    // "<shared_folder.folder_name>/<relative_path>" (see
    // backend/app/services/transfer_service.py's _resolve_download_naming),
    // so its own first path segment already is the folder's display name —
    // no need for a separate GET /folders round trip just to look it up.
    const folderName = transfer.folder_relative_path?.split('/')[0] ?? transfer.file_name;
    const folderUri = Number(Platform.Version) >= MEDIASTORE_MIN_SDK ? downloadedFolderContentUri(folderName) : null;
    await notifyFolderDownloadComplete(folderName, folderUri);
  } catch (err) {
    console.warn('Could not determine whether the folder download finished.', err);
  }
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
   * Starts streaming `transfer`'s bytes. If this app is already streaming
   * something else, `transfer` is queued and started automatically once the
   * active stream finishes (see `queue` above) rather than dropped. A no-op
   * if this exact transfer is already streaming, already queued, or already
   * ran to a terminal local result (completed/failed/cancelled): V1 has no
   * retry — a failed transfer must be explicitly cancelled and re-proposed,
   * not silently restarted the next time its detail screen regains focus.
   */
  async start(transfer: TransferResponse): Promise<void> {
    if (state?.status === 'streaming' || starting) {
      enqueue(transfer);
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
      // No try/finally ran for this transfer (the session check short-
      // circuits before it), so the queue must be drained here too — a lost
      // session must not strand every transfer still waiting behind it.
      const next = queue.shift();
      if (next) {
        void TransferStreamManager.start(next);
      }
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

    const relativePath = downloadRelativePath(transfer);

    try {
      if (transfer.direction === 'send') {
        activeTask = downloadFile(
          `${baseUrl}/transfers/${transfer.id}/download`,
          headers,
          downloadStagingPath(relativePath),
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
        const contentUri = await publishDownload(downloadStagingPath(relativePath), relativePath);
        if (transfer.shared_folder_id != null) {
          await notifyIfFolderComplete(transfer);
        } else {
          await notifyDownloadComplete(transfer.file_name, contentUri);
        }
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
      const next = queue.shift();
      if (next) {
        void TransferStreamManager.start(next);
      }
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
