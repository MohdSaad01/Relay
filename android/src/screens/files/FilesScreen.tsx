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
import { useSharedFiles } from '../../files/useSharedFiles';
import { proposeTransfer } from '../../api/endpoints/transfers';
import { ApiError } from '../../api/client';
import { AvailableFileResponse } from '../../api/types';
import { formatFileSize } from '../../utils/formatFileSize';

type DownloadStatus = 'idle' | 'requesting' | 'requested' | 'error';

/**
 * Browses the desktop's shared file list and lets the user *initiate* a
 * download. "Initiate" is the operative word — tapping Download only
 * proposes the transfer (POST /transfers/requests), which is as far as this
 * milestone goes. Tracking its acceptance, progress, and the actual byte
 * stream belongs to the transfers milestone; this screen doesn't attempt
 * any of that, it just reuses the already-built proposeTransfer endpoint
 * function as the literal "initiation" action.
 */
export function FilesScreen() {
  const { files, loading, refreshing, error, refresh } = useSharedFiles();
  const [downloadStatus, setDownloadStatus] = useState<Record<number, DownloadStatus>>({});
  const [downloadError, setDownloadError] = useState<Record<number, string>>({});

  const handleDownload = useCallback(async (file: AvailableFileResponse) => {
    setDownloadStatus(prev => ({ ...prev, [file.id]: 'requesting' }));
    setDownloadError(prev => {
      const next = { ...prev };
      delete next[file.id];
      return next;
    });
    try {
      await proposeTransfer({ direction: 'send', shared_file_id: file.id });
      setDownloadStatus(prev => ({ ...prev, [file.id]: 'requested' }));
    } catch (err) {
      setDownloadStatus(prev => ({ ...prev, [file.id]: 'error' }));
      setDownloadError(prev => ({
        ...prev,
        [file.id]: err instanceof ApiError ? err.message : 'Could not request this download.',
      }));
    }
  }, []);

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
            status={downloadStatus[item.id] ?? 'idle'}
            errorMessage={downloadError[item.id]}
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

function FileRow({
  file,
  status,
  errorMessage,
  onDownload,
}: {
  file: AvailableFileResponse;
  status: DownloadStatus;
  errorMessage?: string;
  onDownload: () => void;
}) {
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
        {status === 'error' && errorMessage && <Text style={styles.rowError}>{errorMessage}</Text>}
      </View>
      <Pressable
        style={[styles.downloadButton, status === 'requested' && styles.downloadButtonDone]}
        onPress={onDownload}
        disabled={status === 'requesting' || status === 'requested'}
      >
        <Text style={styles.downloadButtonText}>
          {status === 'requesting' ? '...' : status === 'requested' ? 'Requested' : 'Download'}
        </Text>
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
