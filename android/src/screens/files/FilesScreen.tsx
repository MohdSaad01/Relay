import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSharedFiles } from '../../files/useSharedFiles';
import { useSharedFolders } from '../../files/useSharedFolders';
import { useFolderFilesMap } from '../../files/useFolderFilesMap';
import { useFolderReconciliation } from '../../files/useFolderReconciliation';
import { useFileIdentity } from '../../files/useFileIdentity';
import { deriveDownloadStatus, FileDownloadStatus, latestSendTransferId } from '../../files/downloadStatus';
import { deriveFolderDownloadStatus, FolderDownloadStatus, isFolderChildReconciled } from '../../files/folderDownloadStatus';
import { useDownloadExistence } from '../../files/useDownloadExistence';
import { deleteDownloadedPath, downloadedFileExists } from '../../files/downloadExistence';
import { markFolderReconciled, resolveLocalFolderRoot } from '../../files/folderIdentity';
import { openDownloadedFile, openDownloadedFolder } from '../../files/downloadActions';
import { useTransferRequests } from '../../transfers/useTransferRequests';
import { useTransfers } from '../../transfers/useTransfers';
import { getFolderFiles } from '../../api/endpoints/folders';
import { getTransfer, proposeTransfer } from '../../api/endpoints/transfers';
import { ApiError } from '../../api/client';
import {
  AvailableFileResponse,
  AvailableFolderFileResponse,
  AvailableFolderResponse,
  TransferRequestResponse,
  TransferResponse,
} from '../../api/types';
import { formatFileSize } from '../../utils/formatFileSize';
import { TransferStreamManager } from '../../streaming/TransferStreamManager';
import { ensureEmptyFolderStaged } from '../../streaming/blobUtil';
import { FileActionMenu, FileActionMenuAction } from '../../components/FileActionMenu';

const POLL_INTERVAL_MS = 2000;
// Deliberately longer than the transfer-progress poll above: the shared-file
// list only changes when the desktop user shares/unshares a file (rare
// compared to an active transfer's byte-level progress), so polling it that
// aggressively would just be wasted traffic. This, plus a refresh the moment
// the screen regains focus below, is enough to pick up a newly shared file
// without the user having to pull-to-refresh — see docs/15_QA_NOTEBOOK.md's
// Milestone P2 entry for the alternatives considered (a push channel would be
// the "correct" fix but is out of scope for a UX-polish milestone).
const FILES_POLL_INTERVAL_MS = 5000;

type SharedItem =
  | { kind: 'file'; data: AvailableFileResponse }
  | { kind: 'folder'; data: AvailableFolderResponse };

/**
 * `localNameByFileId` (P16 — files/fileIdentity.ts) resolves a file's
 * *actual* on-device name — two different shared files that happen to share
 * a display name (file_name) resolve to distinct on-device names (e.g.
 * "report.txt" / "report (1).txt"), so consulting existence/Open by the raw,
 * undisambiguated file_name would answer for whichever of the two happened
 * to occupy that exact name, silently mixing up both rows' Download/Open
 * state. A file with no registry entry yet (never successfully downloaded)
 * falls back to its raw file_name — nothing to disambiguate yet.
 */
function localFileName(file: AvailableFileResponse, localNameByFileId: Record<number, string>): string {
  return localNameByFileId[file.id] ?? file.file_name;
}

/**
 * A row's derived download status/queued flag, computed once and shared by
 * both its FileRow rendering (renderItem below) and the P14.1 long-press
 * menu (FilesScreen's menuTarget rendering) — the menu deliberately reads
 * off the same derivation the row itself uses instead of snapshotting it at
 * long-press time, so a state change (e.g. queued -> active) while the menu
 * is open is reflected the next time FilesScreen re-renders, exactly like
 * the row already does. See downloadButtonLabel's own doc comment above for
 * what `queued` distinguishes from `status.kind === 'in_progress'`.
 */
function computeFileRowState(
  file: AvailableFileResponse,
  requests: TransferRequestResponse[],
  transfers: TransferResponse[],
  existence: Record<string, boolean>,
  localNameByFileId: Record<number, string>,
): { status: FileDownloadStatus; queued: boolean } {
  const status = deriveDownloadStatus(file.id, requests, transfers, existence[localFileName(file, localNameByFileId)]);
  const transferId = latestSendTransferId(file.id, transfers);
  const queued = transferId != null && TransferStreamManager.isQueued(transferId);
  return { status, queued };
}

/**
 * P21.1: `deriveFolderDownloadStatus` is a pure function of polled
 * data — it has no way to tell "every child's Transfer just reached
 * 'completed', but TransferStreamManager's own reconciliation write
 * (markFolderReconciled, TransferStreamManager.notifyIfFolderComplete)
 * hasn't landed yet" apart from "this folder was simply never downloaded
 * and its content changed since" (P13.2, Issue 2) — both look identical to
 * it: every current child individually 'completed', but
 * isFolderContentReconciled says no. It therefore falls to 'idle', and the
 * Files row briefly regresses from "Downloading..." to "Download" before
 * FilesScreen's own TransferStreamManager subscription (P13.3, fix #3)
 * refreshes reconciliation a moment later and the row jumps to "Open" —
 * confirmed live on RMX3997 (frame-by-frame screen capture, folder of 8
 * files) as a single-frame flicker landing consistently around the last
 * child's completion, not one flicker per child (every child's Transfer
 * already reads 'in_progress' the instant it's proposed — see
 * downloadStatus.ts — so an *earlier* child finishing can never make the
 * folder's aggregate kind fall out of 'in_progress').
 *
 * Fix: break the tie using a signal deriveFolderDownloadStatus doesn't
 * have — TransferStreamManager's own live state, which this screen is
 * already subscribed to. If every child is backend-'completed' but the
 * derived kind is still 'idle', and the last transfer this app instance's
 * stream engine actually touched (state.transferId) belongs to *this*
 * folder, then this is the reconciliation-catch-up window, not a genuinely
 * stale/never-downloaded folder — keep showing "Downloading..." rather
 * than regressing to "Download". A folder the stream engine hasn't just
 * touched (state is null, or references a different transfer entirely —
 * including the ordinary case of a folder whose *content changed on the
 * desktop* since its last download, P13.2's Issue 2) is untouched by this
 * override and still correctly reports 'idle' so the user can re-download
 * it. `folderExists === false` (P13.3) also bypasses the override — a
 * folder just confirmed deleted from disk must still fall back to
 * "Download", not get stuck showing "Downloading..." forever.
 *
 * P21.2: the fix above closed the *kind* ('idle' vs 'in_progress'/
 * 'completed') flicker, but a large folder still visibly toggled its
 * button text between "Downloading..." and "Queued" once per child —
 * confirmed live on RMX3997 with a 100-file folder via direct
 * instrumentation of this function's own return value: 194 label changes
 * (Downloading...⇄Queued, roughly one full cycle per child) across a single
 * download, `kind` itself rock solid throughout. Root cause: every child
 * transfer, including the 2nd through 100th, goes through
 * TransferStreamManager.start()'s own brief `await
 * PermissionsAndroid.request(...)` gate before `state.status` flips to
 * 'streaming' (the same gap the P13.3 correction above already had to
 * design around for a single lone transfer). Between one child's stream
 * ending and the next one's clearing that gate, `TransferStreamManager`
 * has *no* transfer with `status === 'streaming'` for a few milliseconds —
 * `anyActive` below reads false — while the other 98 not-yet-started
 * children are already genuinely sitting in the FIFO `queue`, so `queued`
 * below read true, for every single child boundary in a large folder.
 *
 * Fix: `queued` must mean "this *folder's* download hasn't started yet",
 * not "no child happens to be mid-permission-check this exact millisecond".
 * Once any child has completed, or one is genuinely active right now, the
 * folder's operation is unambiguously underway — the transient gap between
 * children is internal progress, not the whole folder going back to
 * waiting in line, and must never read as "Queued" again. A folder that
 * genuinely hasn't started at all (nothing completed, nothing of its own
 * active) still correctly reports "Queued" while it waits behind an
 * unrelated transfer already streaming (P21.1's own Test E).
 */
export function computeFolderRowState(
  children: AvailableFolderFileResponse[],
  requests: TransferRequestResponse[],
  transfers: TransferResponse[],
  reconciledChildren: Record<string, number> | undefined,
  folderExists: boolean | undefined,
): { status: FolderDownloadStatus; queued: boolean } {
  let status = deriveFolderDownloadStatus(children, requests, transfers, reconciledChildren, folderExists);
  const childTransferIds = children
    .map(child => latestSendTransferId(child.id, transfers))
    .filter((id): id is number => id != null);

  if (
    status.kind === 'idle' &&
    status.totalCount > 0 &&
    status.completedCount === status.totalCount &&
    folderExists !== false
  ) {
    const streamState = TransferStreamManager.getState();
    if (streamState != null && childTransferIds.includes(streamState.transferId)) {
      status = { ...status, kind: 'in_progress' };
    }
  }

  const anyActive = childTransferIds.some(id => TransferStreamManager.isActive(id));
  // P21.2: once this folder's own download is underway — at least one child
  // has finished, or one is streaming right now — it must never read as
  // "Queued" again, even for the brief async gap between one child's stream
  // ending and the next one's starting (see this function's own doc comment
  // below for why that gap exists). `queued` otherwise still correctly
  // reports true for the folder's genuine pre-start wait behind an unrelated
  // active transfer (P21.1's own Test E: a lone file + a folder started
  // together, the later one waits its turn) — that scenario has
  // completedCount === 0 and no child of *this* folder active yet.
  const folderDownloadUnderway = anyActive || status.completedCount > 0;
  const queued = !folderDownloadUnderway && childTransferIds.some(id => TransferStreamManager.isQueued(id));
  return { status, queued };
}

/**
 * Human-readable state for the Details action — distinct from
 * downloadButtonLabel/folderDownloadButtonLabel, which phrase the same
 * states as a button's call to action ("Download", "Retry") rather than a
 * description. Exported for its own pin test, matching downloadButtonLabel's
 * own precedent (__tests__/screens/files/downloadButtonLabel.test.ts).
 */
export function describeStatus(kind: FileDownloadStatus['kind'] | FolderDownloadStatus['kind'], queued: boolean): string {
  switch (kind) {
    case 'completed':
      return 'Downloaded';
    case 'in_progress':
      return queued ? 'Queued' : 'Downloading';
    case 'pending':
      return 'Requested';
    case 'failed':
      return 'Failed';
    default:
      return 'Not downloaded';
  }
}

/**
 * Browses the desktop's shared file list and lets the user *initiate* a
 * download. Tapping Download proposes the transfer (POST /transfers/requests)
 * — the backend auto-accepts it in that same call, so the response already
 * carries a transfer_id — and immediately hands it to TransferStreamManager
 * to start moving bytes, without waiting for the user to visit the Transfers
 * tab. This screen's per-file status is still derived from the same
 * pending-requests/transfers lists TransferListScreen polls (see
 * downloadStatus.ts), rather than a local flag that only ever reflected the
 * propose call's own success/failure — further gated by useDownloadExistence
 * so a 'completed' transfer whose saved file was since deleted doesn't keep
 * claiming "Downloaded" forever.
 *
 * A completed download's row never shows a dead-end disabled state: once
 * deriveDownloadStatus reports 'completed' (which by construction already
 * excludes a file useDownloadExistence has confirmed missing — see that
 * function's own fileExists handling), the row's primary action is always
 * the live "Open" button, matching how modern cloud-storage apps treat a
 * downloaded file as still the thing you tap, not a disabled receipt.
 *
 * P13: shared folders render alongside shared files as one merged,
 * newest-first list — a folder is always exactly one row here regardless of
 * how many files it contains. Downloading a folder proposes every one of its
 * child files (each an ordinary SharedFile under the hood) and hands each to
 * the same TransferStreamManager queue that already serializes concurrent
 * single-file downloads — see handleFolderDownload below.
 */
export function FilesScreen() {
  const { files, loading, refreshing, error, refresh, refreshSilently } = useSharedFiles();
  const {
    folders,
    loading: foldersLoading,
    refreshing: foldersRefreshing,
    error: foldersError,
    refresh: refreshFolders,
    refreshSilently: refreshFoldersSilently,
  } = useSharedFolders();
  const folderFilesMap = useFolderFilesMap(folders);
  const { reconciledByFolderId, localRootByFolderId, refresh: refreshReconciliation } = useFolderReconciliation(folders);
  const { localNameByFileId, refresh: refreshFileIdentity } = useFileIdentity(files);
  const { requests, refresh: refreshRequests } = useTransferRequests();
  const { transfers, refresh: refreshTransfers } = useTransfers();
  const { existence, verify } = useDownloadExistence();
  // Separate existence cache from `existence` above (files) — both are keyed
  // by a bare on-device name, and a file and a folder root could otherwise
  // coincidentally share one (e.g. a file "test" and a folder whose resolved
  // localRoot is also "test"), corrupting each other's cached result.
  const { existence: folderExistence, verify: verifyFolderExists } = useDownloadExistence();
  const [requestingIds, setRequestingIds] = useState<Record<number, boolean>>({});
  const [requestErrors, setRequestErrors] = useState<Record<number, string>>({});
  const [openErrors, setOpenErrors] = useState<Record<number, string>>({});
  const [requestingFolderIds, setRequestingFolderIds] = useState<Record<number, boolean>>({});
  const [folderRequestErrors, setFolderRequestErrors] = useState<Record<number, string>>({});
  // Keyed separately from openErrors (files) and folderRequestErrors (the
  // folder's own download-request failures) — a folder id and a file id are
  // independent numeric spaces, so sharing either of those dicts could
  // surface the wrong row's error under a coincidental id collision.
  const [folderOpenErrors, setFolderOpenErrors] = useState<Record<number, string>>({});
  // P14.1: identifies the row the long-press context menu is open for, not a
  // snapshot of its state — rendering below always looks the identified
  // file/folder back up in the current `files`/`folders` lists and recomputes
  // its status via computeFileRowState/computeFolderRowState, so the menu
  // can never go stale while it's open (see those functions' own doc
  // comment). `null` means the menu is closed.
  const [menuTarget, setMenuTarget] = useState<{ kind: 'file'; id: number } | { kind: 'folder'; id: number } | null>(
    null,
  );
  const closeMenu = useCallback(() => setMenuTarget(null), []);
  // useTransferRequests/useTransfers/useSharedFiles/useSharedFolders each
  // already fetch once on mount, and a screen's first focus coincides with
  // that same mount — so the immediate refresh below is only needed from the
  // *second* focus onward (e.g. returning to this screen after backgrounding
  // the app). Without this guard, every mount fired one redundant extra
  // request per list right alongside the hook's own initial fetch.
  const isFirstTransfersFocus = useRef(true);
  const isFirstFilesFocus = useRef(true);

  useFocusEffect(
    useCallback(() => {
      // Refresh immediately on regaining focus, not just on the next
      // interval tick — a download just proposed from this same screen is
      // already reflected locally (see handleDownload's own refresh below),
      // but returning to this screen later (e.g. after backgrounding the
      // app) otherwise waits up to POLL_INTERVAL_MS to show its outcome.
      if (isFirstTransfersFocus.current) {
        isFirstTransfersFocus.current = false;
      } else {
        refreshRequests();
        refreshTransfers();
      }
      const timer = setInterval(() => {
        refreshRequests();
        refreshTransfers();
      }, POLL_INTERVAL_MS);
      return () => clearInterval(timer);
    }, [refreshRequests, refreshTransfers]),
  );

  useFocusEffect(
    useCallback(() => {
      if (isFirstFilesFocus.current) {
        isFirstFilesFocus.current = false;
      } else {
        refreshSilently();
        refreshFoldersSilently();
      }
      const timer = setInterval(() => {
        refreshSilently();
        refreshFoldersSilently();
      }, FILES_POLL_INTERVAL_MS);
      return () => clearInterval(timer);
    }, [refreshSilently, refreshFoldersSilently]),
  );

  // Re-verifies on-device existence for every file the polled data currently
  // reports as a completed download — covers both a stale 'completed' from
  // before this screen mounted and a file deleted while it stayed open.
  // Checked against each file's *resolved* on-device name (localFileName,
  // P16 — files/fileIdentity.ts), not its raw, possibly-colliding file_name
  // — see localFileName's own doc comment. Folder children are not
  // individually covered here — useDownloadExistence is keyed by a flat name
  // and does not extend to a nested relative_path — but the folder as a
  // whole is, via a live check of its root directory in the next effect
  // below (P13.3, Problem 1).
  useEffect(() => {
    files.forEach(file => {
      if (deriveDownloadStatus(file.id, requests, transfers).kind === 'completed') {
        verify(localFileName(file, localNameByFileId));
      }
    });
  }, [files, requests, transfers, verify, localNameByFileId]);

  // P13.3 (Problem 1): the folder-level equivalent of the file check above —
  // closes the gap folderDownloadStatus.ts used to document as an accepted
  // V1 limitation. Re-verifies on-device existence of a folder's resolved
  // root directory (folderIdentity.ts's localRoot) for every folder the
  // polled data currently reports as fully downloaded, so a folder deleted
  // outside the app (or since a prior check) is caught the same way a
  // deleted single file already is. Only runs once localRootByFolderId has
  // resolved this folder's root at least once (a folder never downloaded on
  // this install has no root to check yet, and can't be 'completed' anyway).
  useEffect(() => {
    folders.forEach(folder => {
      const children = folderFilesMap[folder.id] ?? [];
      const status = deriveFolderDownloadStatus(children, requests, transfers, reconciledByFolderId[folder.id]);
      const localRoot = localRootByFolderId[folder.id];
      if (status.kind === 'completed' && localRoot) {
        verifyFolderExists(localRoot);
      }
    });
  }, [folders, folderFilesMap, requests, transfers, reconciledByFolderId, localRootByFolderId, verifyFolderExists]);

  // P13.3 (Problem 3): TransferStreamManager writes a folder's reconciliation
  // record (folderIdentity.ts's markFolderReconciled) synchronously before it
  // transitions that stream's own state to 'completed' (see
  // notifyIfFolderComplete's call order in TransferStreamManager.start) — but
  // it has no reference to this screen's state and so never told
  // refreshReconciliation to re-read it. Without this, the fast 2000ms
  // requests/transfers poll could observe "every child completed" well
  // before the slower 5000ms folder poll happened to re-read the registry,
  // producing a visible Download -> Downloading -> Download -> Open flicker
  // (deriveFolderDownloadStatus falling through to 'idle' in between).
  // Subscribing here re-reads the registry the instant it's actually ready,
  // closing that window instead of just waiting it out.
  //
  // Also drives the Queued/Downloading distinction below (P13.3, and its
  // correction): `streamKey` only changes on a genuine transferId/status
  // transition (stream start, completion, failure, cancellation), not on
  // every in-flight progress tick, so this doesn't force a re-render for
  // every byte-count update — just the moments TransferStreamManager.isQueued
  // could actually give a different answer.
  const streamKeyRef = useRef<string | null>(null);
  const [, forceStreamRerender] = useReducer((n: number) => n + 1, 0);
  useEffect(
    () =>
      TransferStreamManager.subscribe(() => {
        const streamState = TransferStreamManager.getState();
        const key = streamState ? `${streamState.transferId}:${streamState.status}` : null;
        if (key !== streamKeyRef.current) {
          streamKeyRef.current = key;
          forceStreamRerender();
        }
        if (streamState?.status === 'completed') {
          refreshReconciliation();
          refreshFileIdentity();
        }
      }),
    [refreshReconciliation, refreshFileIdentity],
  );

  const handleDownload = useCallback(
    async (file: AvailableFileResponse) => {
      setRequestingIds(prev => ({ ...prev, [file.id]: true }));
      setRequestErrors(prev => {
        const next = { ...prev };
        delete next[file.id];
        return next;
      });
      // Clear any stale "couldn't open" message from a prior completed
      // download of this file — a fresh download attempt makes it
      // irrelevant, and leaving it would otherwise linger next to a button
      // that no longer offers Open.
      setOpenErrors(prev => {
        const next = { ...prev };
        delete next[file.id];
        return next;
      });
      try {
        const request = await proposeTransfer({ direction: 'send', shared_file_id: file.id });
        // Kick off the list refresh (drives this row's polled status/label)
        // and the actual stream start in parallel rather than sequentially —
        // getTransfer()/start() don't depend on the refreshed lists, so
        // waiting for them first only delayed when bytes actually started
        // moving. requestingIds still isn't cleared until refreshPromise
        // settles below, so the button's "Downloading..." label hands off to
        // the polled status without a gap.
        const refreshPromise = Promise.all([refreshRequests(), refreshTransfers()]);
        if (request.status === 'accepted' && request.transfer_id != null) {
          const transfer = await getTransfer(request.transfer_id);
          TransferStreamManager.start(transfer);
        }
        await refreshPromise;
      } catch (err) {
        setRequestErrors(prev => ({
          ...prev,
          [file.id]: err instanceof ApiError ? err.message : 'Could not request this download.',
        }));
      } finally {
        setRequestingIds(prev => {
          const next = { ...prev };
          delete next[file.id];
          return next;
        });
      }
    },
    [refreshRequests, refreshTransfers],
  );

  const handleOpen = useCallback(
    async (file: AvailableFileResponse) => {
      setOpenErrors(prev => {
        const next = { ...prev };
        delete next[file.id];
        return next;
      });
      try {
        await openDownloadedFile(localFileName(file, localNameByFileId), file.mime_type);
      } catch {
        // Open is offered optimistically (see canOpen below), so a failure
        // here can mean either "no app handles this file type" or "the file
        // was deleted in the brief window before the last existence check."
        // Re-verify so a genuinely-missing file downgrades back to a
        // re-downloadable 'idle' row instead of staying stuck offering an
        // "Open" that will keep failing.
        verify(localFileName(file, localNameByFileId));
        setOpenErrors(prev => ({
          ...prev,
          [file.id]: 'Could not open this file. It may have been moved, deleted, or need another app.',
        }));
      }
    },
    [verify, localNameByFileId],
  );

  // P14.1: the long-press menu's Details action for a file — surfaces only
  // metadata Relay already has (no new backend/API call), matching the
  // milestone's "use-existing-system" scope.
  const handleFileDetails = useCallback((file: AvailableFileResponse, state: { status: FileDownloadStatus; queued: boolean }) => {
    Alert.alert(
      file.file_name,
      [
        `Size: ${formatFileSize(file.file_size)}`,
        `Type: ${file.mime_type ?? 'Unknown'}`,
        `Shared: ${new Date(file.shared_at).toLocaleString()}`,
        `Status: ${describeStatus(state.status.kind, state.queued)}`,
      ].join('\n'),
    );
  }, []);

  /**
   * Enumerates a shared folder's children (GET /folders/{id}/files, always
   * fetched fresh here — not read from folderFilesMap — so a retry after an
   * interrupted transfer sees the folder's current contents) and proposes a
   * download for every one not already 'completed' *and current*
   * (isFolderChildCurrent, P13.2 Issue 2 — a child whose Transfer already
   * says 'completed' but whose size has since changed on the desktop still
   * needs a fresh download, not a skip), so retrying a partially-downloaded
   * or since-updated folder only fetches what's actually missing or stale
   * instead of re-downloading everything. Each accepted transfer is handed
   * to TransferStreamManager exactly like a single-file download — its
   * existing FIFO queue is what actually serializes N files behind one
   * active stream.
   *
   * P13.2 (Issue 1): resolves this folder's on-device root once up front
   * (resolveLocalFolderRoot — a cheap read-through after the first ever
   * download of this shared_folder_id) so every child this call proposes
   * lands under that same, correctly-disambiguated directory rather than
   * two different shared folders that happen to share a display name
   * merging into one.
   *
   * P13.2 (Issue 2): a child being re-proposed because it's stale (already
   * 'completed', but isFolderChildReconciled says otherwise) has its
   * previous on-device copy deleted first. Without this, the fresh download
   * would land at the exact same relative path as the old one still sitting
   * there, and blobUtil.ts's own (unchanged, out of this milestone's scope)
   * resolveAvailableMediaStoreName would treat that as an ordinary same-name
   * collision — the same handling that deliberately keeps two *unrelated*
   * same-named files side by side — and rename the update to "name
   * (1).ext" instead of replacing the outdated content it's meant to
   * supersede.
   *
   * When nothing at all ends up pending — every current child already
   * matches the reconciliation record — the record is still rewritten from
   * `children` before returning. This is what makes a removal-only update
   * (nothing to actually download, just something to stop counting) able to
   * self-heal back to "Open": without this, a file dropped from the share
   * would leave the old, now-too-large record in place forever, since
   * nothing in this run would otherwise ever touch it. See
   * folderIdentity.ts's own doc comment for the physical-device failure
   * this fixed (a folder that had a file removed never came back from
   * "Download" even after a successful re-download).
   */
  const handleFolderDownload = useCallback(
    async (folder: AvailableFolderResponse) => {
      setRequestingFolderIds(prev => ({ ...prev, [folder.id]: true }));
      setFolderRequestErrors(prev => {
        const next = { ...prev };
        delete next[folder.id];
        return next;
      });
      // Clear any stale "couldn't open" message from a prior completed
      // download of this folder, matching handleDownload's own openErrors
      // reset for a single file — a fresh download attempt makes it
      // irrelevant.
      setFolderOpenErrors(prev => {
        const next = { ...prev };
        delete next[folder.id];
        return next;
      });
      try {
        const children = await getFolderFiles(folder.id);
        const localRoot = await resolveLocalFolderRoot(folder.id, folder.folder_name, folder.shared_at);
        if (children.length === 0) {
          // Empty folder: nothing to stream, so nothing would otherwise ever
          // run for it — see ensureEmptyFolderStaged's own doc comment for
          // why this only ever lands in private staging, never MediaStore.
          await ensureEmptyFolderStaged(localRoot);
          return;
        }
        const reconciledChildren = reconciledByFolderId[folder.id];
        // P13.3 (Problem 1): a per-child reconciliation match (below) only
        // means "this child's backend metadata hasn't changed since we last
        // confirmed it" — it says nothing about whether the bytes are still
        // actually on disk right now. Without this check, re-tapping
        // Download on a folder whose root directory was deleted outside the
        // app (see the live existence check above that got this row back to
        // "Download" in the first place) would find every child still
        // "reconciled" and skip all of them, silently doing nothing: the
        // button would keep offering "Download" forever without ever
        // actually re-fetching anything. Checking the root once, up front,
        // and treating every child as needing a fresh fetch when it's
        // missing (bypassing the normal per-child skip) mirrors how a
        // never-before-seen folder already has nothing to skip.
        const folderRootMissing = !(await downloadedFileExists(localRoot));
        const pending: AvailableFolderFileResponse[] = [];
        for (const child of children) {
          const status = deriveDownloadStatus(child.id, requests, transfers);
          if (status.kind === 'pending' || status.kind === 'in_progress') {
            continue;
          }
          if (status.kind === 'completed' && !folderRootMissing) {
            if (isFolderChildReconciled(child, reconciledChildren)) {
              continue;
            }
            await deleteDownloadedPath(`${localRoot}/${child.relative_path}`);
          }
          pending.push(child);
        }
        if (pending.length === 0) {
          await markFolderReconciled(folder.id, children);
          refreshReconciliation();
        } else {
          for (const child of pending) {
            const request = await proposeTransfer({ direction: 'send', shared_file_id: child.id });
            if (request.status === 'accepted' && request.transfer_id != null) {
              const transfer = await getTransfer(request.transfer_id);
              TransferStreamManager.start(transfer);
            }
          }
        }
        await Promise.all([refreshRequests(), refreshTransfers()]);
      } catch (err) {
        setFolderRequestErrors(prev => ({
          ...prev,
          [folder.id]: err instanceof ApiError ? err.message : 'Could not request this download.',
        }));
      } finally {
        setRequestingFolderIds(prev => {
          const next = { ...prev };
          delete next[folder.id];
          return next;
        });
      }
    },
    [requests, transfers, reconciledByFolderId, refreshReconciliation, refreshRequests, refreshTransfers],
  );

  /**
   * "Open" action for a folder row whose download has completed (P13.1,
   * Issue 2) — mirrors handleOpen's file counterpart exactly, just against
   * openDownloadedFolder/folderOpenErrors instead of
   * openDownloadedFile/openErrors.
   */
  const handleOpenFolder = useCallback(async (folder: AvailableFolderResponse) => {
    setFolderOpenErrors(prev => {
      const next = { ...prev };
      delete next[folder.id];
      return next;
    });
    try {
      // P13.2 (Issue 1): open whatever this folder's download actually
      // resolved to on-device, not its raw shared display name — the two
      // only ever differ once a same-named folder conflict has actually
      // been resolved (see folderIdentity.ts), so this is a cheap
      // read-through the rest of the time. P17: passing folder.shared_at
      // lets this call detect (and recover from) folder.id having been
      // reused for a different logical folder since the mapping was last
      // resolved.
      const localRoot = await resolveLocalFolderRoot(folder.id, folder.folder_name, folder.shared_at);
      await openDownloadedFolder(localRoot);
    } catch {
      // Open is offered optimistically (see canOpen below), so a failure
      // here can mean either "no app handles directories" or "the folder
      // was deleted in the brief window before the last existence check" —
      // mirrors handleOpen's own re-verify for a single file (P13.3,
      // Problem 1). Re-verifying lets the row recover to a re-downloadable
      // 'idle' state instead of staying stuck offering an "Open" that will
      // keep failing.
      const localRoot = await resolveLocalFolderRoot(folder.id, folder.folder_name, folder.shared_at).catch(() => null);
      if (localRoot) {
        verifyFolderExists(localRoot);
      }
      setFolderOpenErrors(prev => ({
        ...prev,
        [folder.id]: 'Could not open this folder. It may have been moved, deleted, or need a different app.',
      }));
    }
  }, [verifyFolderExists]);

  // P14.1: the long-press menu's Details action for a folder — mirrors
  // handleFileDetails exactly, against folder metadata instead of file
  // metadata.
  const handleFolderDetails = useCallback(
    (folder: AvailableFolderResponse, state: { status: FolderDownloadStatus; queued: boolean }) => {
      Alert.alert(
        folder.folder_name,
        [
          `Items: ${folder.file_count}`,
          `Total size: ${formatFileSize(folder.total_size)}`,
          `Shared: ${new Date(folder.shared_at).toLocaleString()}`,
          `Status: ${describeStatus(state.status.kind, state.queued)}`,
        ].join('\n'),
      );
    },
    [],
  );

  if (loading || foldersLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const items: SharedItem[] = [
    ...files.map(file => ({ kind: 'file' as const, data: file })),
    ...folders.map(folder => ({ kind: 'folder' as const, data: folder })),
  ].sort((a, b) => new Date(b.data.shared_at).getTime() - new Date(a.data.shared_at).getTime());

  // P14.1: resolves the long-press menu's content from the *current* files/
  // folders lists by menuTarget's id, not a snapshot taken at long-press
  // time — see menuTarget's own doc comment. If the targeted item is no
  // longer in either list (e.g. unshared from the desktop while the menu
  // was open — out of this milestone's scope to trigger from Android, but
  // not out of scope to not crash on), menuFile/menuFolder end up
  // undefined and menuVisible below resolves to false, closing the menu
  // instead of showing stale or empty content.
  const menuFile = menuTarget?.kind === 'file' ? files.find(f => f.id === menuTarget.id) : undefined;
  const menuFolder = menuTarget?.kind === 'folder' ? folders.find(f => f.id === menuTarget.id) : undefined;
  const menuVisible = menuFile != null || menuFolder != null;

  let menuTitle = '';
  let menuSubtitle: string | undefined;
  let menuActions: FileActionMenuAction[] = [];

  if (menuFile) {
    const fileState = computeFileRowState(menuFile, requests, transfers, existence, localNameByFileId);
    const canOpen = fileState.status.kind === 'completed';
    menuTitle = menuFile.file_name;
    menuSubtitle = `${formatFileSize(menuFile.file_size)}${menuFile.mime_type ? ` · ${menuFile.mime_type}` : ''}`;
    menuActions = [
      ...(canOpen ? [{ key: 'open', label: 'Open', onPress: () => { closeMenu(); handleOpen(menuFile); } }] : []),
      { key: 'details', label: 'Details', onPress: () => { closeMenu(); handleFileDetails(menuFile, fileState); } },
    ];
  } else if (menuFolder) {
    const children = folderFilesMap[menuFolder.id] ?? [];
    const folderState = computeFolderRowState(
      children,
      requests,
      transfers,
      reconciledByFolderId[menuFolder.id],
      localRootByFolderId[menuFolder.id] ? folderExistence[localRootByFolderId[menuFolder.id]] : undefined,
    );
    const canOpen = folderState.status.kind === 'completed';
    menuTitle = `\u{1F4C1} ${menuFolder.folder_name}`;
    const itemLabel = `${menuFolder.file_count} item${menuFolder.file_count === 1 ? '' : 's'}`;
    menuSubtitle = `${itemLabel} · ${formatFileSize(menuFolder.total_size)}`;
    menuActions = [
      ...(canOpen ? [{ key: 'open', label: 'Open', onPress: () => { closeMenu(); handleOpenFolder(menuFolder); } }] : []),
      {
        key: 'details',
        label: 'Details',
        onPress: () => {
          closeMenu();
          handleFolderDetails(menuFolder, folderState);
        },
      },
    ];
  }

  return (
    <View style={styles.container}>
      {(error || foldersError) && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error || foldersError}</Text>
        </View>
      )}
      <FlatList
        data={items}
        keyExtractor={item => (item.kind === 'file' ? `file-${item.data.id}` : `folder-${item.data.id}`)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing || foldersRefreshing}
            onRefresh={() => {
              refresh();
              refreshFolders();
            }}
          />
        }
        renderItem={({ item }) =>
          item.kind === 'folder' ? (
            <FolderRow
              folder={item.data}
              requesting={requestingFolderIds[item.data.id] ?? false}
              requestError={folderRequestErrors[item.data.id]}
              openError={folderOpenErrors[item.data.id]}
              {...computeFolderRowState(
                folderFilesMap[item.data.id] ?? [],
                requests,
                transfers,
                reconciledByFolderId[item.data.id],
                localRootByFolderId[item.data.id] ? folderExistence[localRootByFolderId[item.data.id]] : undefined,
              )}
              onDownload={() => handleFolderDownload(item.data)}
              onOpen={() => handleOpenFolder(item.data)}
              onLongPress={() => setMenuTarget({ kind: 'folder', id: item.data.id })}
            />
          ) : (
            <FileRow
              file={item.data}
              requesting={requestingIds[item.data.id] ?? false}
              requestError={requestErrors[item.data.id]}
              openError={openErrors[item.data.id]}
              {...computeFileRowState(item.data, requests, transfers, existence, localNameByFileId)}
              onDownload={() => handleDownload(item.data)}
              onOpen={() => handleOpen(item.data)}
              onLongPress={() => setMenuTarget({ kind: 'file', id: item.data.id })}
            />
          )
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.empty}>No files are currently shared.</Text>
          </View>
        }
        contentContainerStyle={items.length === 0 ? styles.emptyList : undefined}
      />
      <FileActionMenu visible={menuVisible} title={menuTitle} subtitle={menuSubtitle} actions={menuActions} onClose={closeMenu} />
    </View>
  );
}

// A download's request is always auto-accepted, and the resulting Transfer
// row is already 'in_progress' the instant propose() resolves (see
// TransferService._create_transfer) — well before this app's own stream
// actually starts moving bytes. So the brief `requesting` window (the
// propose/getTransfer round trip) is never really an unknown state; it's
// already known to be a download starting. This used to show a bare "..."
// for that window (Milestone P2's Issue 2 — see docs/15_QA_NOTEBOOK.md),
// which added a meaningless extra step; showing the real label immediately
// lets the user transition straight into it once the polled data confirms
// the same thing.
// `queued` (P13.3 correction) distinguishes "this row is genuinely sitting
// in TransferStreamManager's FIFO queue behind another active stream"
// (TransferStreamManager.isQueued) from "the backend already considers this
// an in-progress transfer" (status.kind === 'in_progress', true from the
// moment it's proposed — see TransferService._create_transfer). A first
// attempt at this distinction (original P13.3) used the inverse of
// isActive() instead — "Queued" whenever this row wasn't the one observed
// streaming — which misfired on a single, unqueued download: isActive()
// only starts reporting true once TransferStreamManager.start() has gotten
// past its own internal `await`s (the POST_NOTIFICATIONS permission
// request), so a lone transfer briefly looked exactly like one waiting in
// line the instant FilesScreen's poll caught status.kind === 'in_progress'
// ahead of that. isQueued() has no equivalent gap — it only ever reflects
// actual membership in `queue`, itself only ever populated synchronously —
// so "Queued" now only appears for a transfer genuinely waiting behind
// another one in TransferStreamManager's FIFO queue (Milestone P11);
// anything else in_progress (including that same startup window) defaults
// to "Downloading...", matching what's actually about to happen.
export function downloadButtonLabel(requesting: boolean, status: FileDownloadStatus, queued: boolean): string {
  if (requesting) return 'Downloading...';
  switch (status.kind) {
    case 'pending':
      return 'Requested';
    case 'in_progress':
      return queued ? 'Queued' : 'Downloading...';
    case 'failed':
      return 'Retry';
    default:
      return 'Download';
  }
}

// P13.1 (Issue 1): deliberately reports no progress counts — a folder's
// button reads exactly like an ordinary file's ("Download" / "Downloading..."
// / "Retry"), never "(1)", "(0/1)", or "(1/1)". FolderDownloadStatus still
// carries completedCount/totalCount (folderDownloadStatus.ts) for internal
// use — e.g. deciding when a folder is fully 'completed' — just not for
// display here.
// See downloadButtonLabel's own doc comment for what `queued` distinguishes.
// A folder's `queued` is true only when none of its currently-fetched
// children is the one actually streaming *and* at least one of them is
// genuinely sitting in TransferStreamManager's queue — so a folder whose
// first child is still in that same pre-`isActive` startup window (no
// sibling queued behind it yet either) still reads "Downloading...", not
// "Queued".
export function folderDownloadButtonLabel(requesting: boolean, status: FolderDownloadStatus, queued: boolean): string {
  if (requesting) return 'Downloading...';
  switch (status.kind) {
    case 'in_progress':
      return queued ? 'Queued' : 'Downloading...';
    case 'failed':
      return 'Retry';
    default:
      return 'Download';
  }
}

function FileRow({
  file,
  requesting,
  requestError,
  openError,
  status,
  queued,
  onDownload,
  onOpen,
  onLongPress,
}: {
  file: AvailableFileResponse;
  requesting: boolean;
  requestError?: string;
  openError?: string;
  status: FileDownloadStatus;
  queued: boolean;
  onDownload: () => void;
  onOpen: () => void;
  onLongPress: () => void;
}) {
  const disabled = requesting || status.kind === 'pending' || status.kind === 'in_progress';
  // deriveDownloadStatus only ever reports 'completed' when the file isn't
  // confirmed missing (see its own fileExists handling) — so "completed"
  // alone is enough to offer Open. This is deliberately the same optimistic
  // "not checked yet counts as present" tolerance deriveDownloadStatus
  // already applies, rather than a second, stricter check re-litigating the
  // same question — that mismatch used to leave the row on a disabled,
  // dead-end "Downloaded" pill for the brief window before the on-device
  // check resolved.
  const canOpen = status.kind === 'completed';
  // openError only applies while Open is still the row's action — once a
  // failed-open re-verify (see handleOpen) or a later poll downgrades the
  // row past 'completed', that message would otherwise linger next to a
  // button that no longer says Open.
  const errorMessage =
    requestError ??
    (canOpen ? openError : undefined) ??
    (status.kind === 'failed' ? status.message ?? 'This download failed.' : undefined);

  return (
    <Pressable
      style={styles.row}
      onLongPress={onLongPress}
      accessibilityLabel={`${file.file_name}. Double tap and hold for more options.`}
    >
      <View style={styles.rowInfo}>
        <Text style={styles.name} numberOfLines={1}>
          {file.file_name}
        </Text>
        <Text style={styles.meta}>
          {formatFileSize(file.file_size)}
          {file.mime_type ? ` · ${file.mime_type}` : ''}
        </Text>
        {errorMessage && <Text style={styles.rowError}>{errorMessage}</Text>}
      </View>
      {canOpen ? (
        <Pressable style={[styles.downloadButton, styles.downloadButtonDone]} onPress={onOpen}>
          <Text style={styles.downloadButtonText}>Open</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.downloadButton} onPress={onDownload} disabled={disabled}>
          <Text style={styles.downloadButtonText}>{downloadButtonLabel(requesting, status, queued)}</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

function FolderRow({
  folder,
  requesting,
  requestError,
  openError,
  status,
  queued,
  onDownload,
  onOpen,
  onLongPress,
}: {
  folder: AvailableFolderResponse;
  requesting: boolean;
  requestError?: string;
  openError?: string;
  status: FolderDownloadStatus;
  queued: boolean;
  onDownload: () => void;
  onOpen: () => void;
  onLongPress: () => void;
}) {
  const disabled = requesting || status.kind === 'in_progress';
  const itemLabel = `${folder.file_count} item${folder.file_count === 1 ? '' : 's'}`;
  // P13.1 (Issue 2): a fully-downloaded folder offers "Open" exactly like a
  // completed file's canOpen/onOpen (FileRow above) — status.kind only ever
  // reports 'completed' once every child has (deriveFolderDownloadStatus).
  // P13.3: that now includes the folder's own on-device existence check
  // (deriveFolderDownloadStatus's folderExists parameter, fed by the
  // folder-existence effect above), so this is no longer a weaker guarantee
  // than FileRow's canOpen — a deleted folder's status.kind downgrades to
  // 'idle' the same way a deleted file's does.
  const canOpen = status.kind === 'completed';
  const errorMessage = requestError ?? (canOpen ? openError : undefined);

  return (
    <Pressable
      style={styles.row}
      onLongPress={onLongPress}
      accessibilityLabel={`${folder.folder_name} folder. Double tap and hold for more options.`}
    >
      <View style={styles.rowInfo}>
        <Text style={styles.name} numberOfLines={1}>
          {'\u{1F4C1}'} {folder.folder_name}
        </Text>
        <Text style={styles.meta}>
          {itemLabel} · {formatFileSize(folder.total_size)}
        </Text>
        {errorMessage && <Text style={styles.rowError}>{errorMessage}</Text>}
      </View>
      {canOpen ? (
        <Pressable style={[styles.downloadButton, styles.downloadButtonDone]} onPress={onOpen}>
          <Text style={styles.downloadButtonText}>Open</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.downloadButton} onPress={onDownload} disabled={disabled}>
          <Text style={styles.downloadButtonText}>{folderDownloadButtonLabel(requesting, status, queued)}</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: {
    padding: 12,
    backgroundColor: 'rgba(220,38,38,0.1)',
  },
  errorText: {
    color: '#dc2626',
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  rowInfo: {
    flex: 1,
    marginRight: 12,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
  },
  meta: {
    marginTop: 2,
    color: '#666',
  },
  rowError: {
    marginTop: 4,
    color: '#dc2626',
    fontSize: 12,
  },
  downloadButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    backgroundColor: '#2563eb',
  },
  downloadButtonDone: {
    backgroundColor: '#16a34a',
  },
  downloadButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  emptyContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyList: {
    flexGrow: 1,
  },
  empty: {
    color: '#666',
  },
});
