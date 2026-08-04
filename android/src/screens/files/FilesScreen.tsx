import React, { useCallback, useState } from 'react';
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
import { useTransferRequests } from '../../transfers/useTransferRequests';
import { useTransfers } from '../../transfers/useTransfers';
import { proposeTransfer } from '../../api/endpoints/transfers';
import { ApiError } from '../../api/client';
import { AvailableFileResponse } from '../../api/types';
import { formatFileSize } from '../../utils/formatFileSize';

const POLL_INTERVAL_MS = 2000;

/**
 * Browses the desktop's shared file list and lets the user *initiate* a
 * download. Tapping Download only proposes the transfer (POST
 * /transfers/requests) — from there, this screen's per-file status is
 * derived from the same pending-requests/transfers lists TransferListScreen
 * polls (see downloadStatus.ts), rather than a local flag that only ever
 * reflected the propose call's own success/failure.
 */
export function FilesScreen() {
  const { files, loading, refreshing, error, refresh } = useSharedFiles();
  const { requests, refresh: refreshRequests } = useTransferRequests();
  const { transfers, refresh: refreshTransfers } = useTransfers();
  const [requestingIds, setRequestingIds] = useState<Record<number, boolean>>({});
  const [requestErrors, setRequestErrors] = useState<Record<number, string>>({});

  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => {
        refreshRequests();
        refreshTransfers();
      }, POLL_INTERVAL_MS);
      return () => clearInterval(timer);
    }, [refreshRequests, refreshTransfers]),
  );

  const handleDownload = useCallback(
    async (file: AvailableFileResponse) => {
      setRequestingIds(prev => ({ ...prev, [file.id]: true }));
      setRequestErrors(prev => {
        const next = { ...prev };
        delete next[file.id];
        return next;
      });
      try {
        await proposeTransfer({ direction: 'send', shared_file_id: file.id });
        await refreshRequests();
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
    [refreshRequests],
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
            status={deriveDownloadStatus(item.id, requests, transfers)}
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

function downloadButtonLabel(requesting: boolean, status: FileDownloadStatus): string {
  if (requesting) return '...';
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
