import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSharedFiles } from '../../files/useSharedFiles';
import { deriveDownloadStatus, FileDownloadStatus } from '../../files/downloadStatus';
import { useDownloadExistence } from '../../files/useDownloadExistence';
import { downloadedFileLocationLabel } from '../../files/downloadExistence';
import { openDownloadedFile } from '../../files/downloadActions';
import { useTransferRequests } from '../../transfers/useTransferRequests';
import { useTransfers } from '../../transfers/useTransfers';
import { getTransfer, proposeTransfer } from '../../api/endpoints/transfers';
import { ApiError } from '../../api/client';
import { AvailableFileResponse } from '../../api/types';
import { formatFileSize } from '../../utils/formatFileSize';
import { TransferStreamManager } from '../../streaming/TransferStreamManager';

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
 */
export function FilesScreen() {
  const { files, loading, refreshing, error, refresh, refreshSilently } = useSharedFiles();
  const { requests, refresh: refreshRequests } = useTransferRequests();
  const { transfers, refresh: refreshTransfers } = useTransfers();
  const { existence, verify } = useDownloadExistence();
  const [requestingIds, setRequestingIds] = useState<Record<number, boolean>>({});
  const [requestErrors, setRequestErrors] = useState<Record<number, string>>({});
  const [openErrors, setOpenErrors] = useState<Record<number, string>>({});
  // useTransferRequests/useTransfers/useSharedFiles each already fetch once
  // on mount, and a screen's first focus coincides with that same mount —
  // so the immediate refresh below is only needed from the *second* focus
  // onward (e.g. returning to this screen after backgrounding the app).
  // Without this guard, every mount fired one redundant extra request per
  // list right alongside the hook's own initial fetch.
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
      }
      const timer = setInterval(refreshSilently, FILES_POLL_INTERVAL_MS);
      return () => clearInterval(timer);
    }, [refreshSilently]),
  );

  // Re-verifies on-device existence for every file the polled data currently
  // reports as a completed download — covers both a stale 'completed' from
  // before this screen mounted and a file deleted while it stayed open.
  useEffect(() => {
    files.forEach(file => {
      if (deriveDownloadStatus(file.id, requests, transfers).kind === 'completed') {
        verify(file.file_name);
      }
    });
  }, [files, requests, transfers, verify]);

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
        await openDownloadedFile(file.file_name, file.mime_type);
      } catch {
        // Open is offered optimistically (see canOpen below), so a failure
        // here can mean either "no app handles this file type" or "the file
        // was deleted in the brief window before the last existence check."
        // Re-verify so a genuinely-missing file downgrades back to a
        // re-downloadable 'idle' row instead of staying stuck offering an
        // "Open" that will keep failing.
        verify(file.file_name);
        setOpenErrors(prev => ({
          ...prev,
          [file.id]: 'Could not open this file. It may have been moved, deleted, or need another app.',
        }));
      }
    },
    [verify],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      <FlatList
        data={files}
        keyExtractor={item => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        renderItem={({ item }) => (
          <FileRow
            file={item}
            requesting={requestingIds[item.id] ?? false}
            requestError={requestErrors[item.id]}
            openError={openErrors[item.id]}
            status={deriveDownloadStatus(item.id, requests, transfers, existence[item.file_name])}
            onDownload={() => handleDownload(item)}
            onOpen={() => handleOpen(item)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.empty}>No files are currently shared.</Text>
          </View>
        }
        contentContainerStyle={files.length === 0 ? styles.emptyList : undefined}
      />
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
function downloadButtonLabel(requesting: boolean, status: FileDownloadStatus): string {
  if (requesting) return 'Downloading...';
  switch (status.kind) {
    case 'pending':
      return 'Requested';
    case 'in_progress':
      return 'Downloading...';
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
  onDownload,
  onOpen,
}: {
  file: AvailableFileResponse;
  requesting: boolean;
  requestError?: string;
  openError?: string;
  status: FileDownloadStatus;
  onDownload: () => void;
  onOpen: () => void;
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
    <View style={styles.row}>
      <View style={styles.rowInfo}>
        <Text style={styles.name} numberOfLines={1}>
          {file.file_name}
        </Text>
        <Text style={styles.meta}>
          {formatFileSize(file.file_size)}
          {file.mime_type ? ` · ${file.mime_type}` : ''}
        </Text>
        {canOpen && <Text style={styles.savedLocation}>Saved to {downloadedFileLocationLabel()}</Text>}
        {errorMessage && <Text style={styles.rowError}>{errorMessage}</Text>}
      </View>
      {canOpen ? (
        <Pressable style={[styles.downloadButton, styles.downloadButtonDone]} onPress={onOpen}>
          <Text style={styles.downloadButtonText}>Open</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.downloadButton} onPress={onDownload} disabled={disabled}>
          <Text style={styles.downloadButtonText}>{downloadButtonLabel(requesting, status)}</Text>
        </Pressable>
      )}
    </View>
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
  savedLocation: {
    marginTop: 2,
    color: '#16a34a',
    fontSize: 12,
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
