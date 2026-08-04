import React, { useCallback, useEffect, useState } from 'react';
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
 */
export function FilesScreen() {
  const { files, loading, refreshing, error, refresh, refreshSilently } = useSharedFiles();
  const { requests, refresh: refreshRequests } = useTransferRequests();
  const { transfers, refresh: refreshTransfers } = useTransfers();
  const { existence, verify } = useDownloadExistence();
  const [requestingIds, setRequestingIds] = useState<Record<number, boolean>>({});
  const [requestErrors, setRequestErrors] = useState<Record<number, string>>({});

  useFocusEffect(
    useCallback(() => {
      // Refresh immediately on regaining focus, not just on the next
      // interval tick — a download just proposed from this same screen is
      // already reflected locally (see handleDownload's own refresh below),
      // but returning to this screen later (e.g. after backgrounding the
      // app) otherwise waits up to POLL_INTERVAL_MS to show its outcome.
      refreshRequests();
      refreshTransfers();
      const timer = setInterval(() => {
        refreshRequests();
        refreshTransfers();
      }, POLL_INTERVAL_MS);
      return () => clearInterval(timer);
    }, [refreshRequests, refreshTransfers]),
  );

  useFocusEffect(
    useCallback(() => {
      refreshSilently();
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
      try {
        const request = await proposeTransfer({ direction: 'send', shared_file_id: file.id });
        await Promise.all([refreshRequests(), refreshTransfers()]);
        if (request.status === 'accepted' && request.transfer_id != null) {
          const transfer = await getTransfer(request.transfer_id);
          TransferStreamManager.start(transfer);
        }
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
            status={deriveDownloadStatus(item.id, requests, transfers, existence[item.file_name])}
            onDownload={() => handleDownload(item)}
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
    case 'completed':
      return 'Downloaded';
    default:
      return 'Download';
  }
}

function FileRow({
  file,
  requesting,
  requestError,
  status,
  onDownload,
}: {
  file: AvailableFileResponse;
  requesting: boolean;
  requestError?: string;
  status: FileDownloadStatus;
  onDownload: () => void;
}) {
  const disabled = requesting || status.kind === 'pending' || status.kind === 'in_progress' || status.kind === 'completed';
  const errorMessage = requestError ?? (status.kind === 'failed' ? status.message ?? 'This download failed.' : undefined);

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
        {errorMessage && <Text style={styles.rowError}>{errorMessage}</Text>}
      </View>
      <Pressable
        style={[styles.downloadButton, status.kind === 'completed' && styles.downloadButtonDone]}
        onPress={onDownload}
        disabled={disabled}
      >
        <Text style={styles.downloadButtonText}>{downloadButtonLabel(requesting, status)}</Text>
      </Pressable>
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
