import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { errorCodes, isErrorWithCode, pick } from '@react-native-documents/picker';
import { TransfersStackParamList } from '../../navigation/types';
import { useTransfers } from '../../transfers/useTransfers';
import { directionLabel, formatStatus } from '../../transfers/labels';
import { formatFileSize } from '../../utils/formatFileSize';
import { TransferResponse } from '../../api/types';
import { getTransfer, proposeTransfer } from '../../api/endpoints/transfers';
import { ApiError } from '../../api/client';
import { registerUploadSource } from '../../streaming/uploadSourceRegistry';
import { TransferStreamManager } from '../../streaming/TransferStreamManager';
import { materializeToLocalCache, pickAndEnumerateFolder } from '../../streaming/folderPicker';
import { generateUuidV4 } from '../../utils/uuid';

const POLL_INTERVAL_MS = 2000;

type Navigation = NativeStackNavigationProp<TransfersStackParamList, 'TransferList'>;

/**
 * This device's transfer history, persisted transfers only — a proposal is
 * auto-accepted the moment it's made (backend/app/services/transfer_service.py),
 * so there is no separate pending-requests view to show here anymore.
 *
 * Also the one entry point for proposing an upload — picking a local file
 * to send to the desktop isn't tied to browsing FilesScreen's shared list
 * the way a download is, so it lives here. Tapping "Upload a File" proposes
 * the transfer and, mirroring FilesScreen's download flow, immediately hands
 * it to TransferStreamManager to start moving bytes without waiting for a
 * separate desktop decision.
 */
export function TransferListScreen() {
  const navigation = useNavigation<Navigation>();
  const {
    transfers,
    loading,
    error: transfersError,
    refresh: refreshTransfers,
  } = useTransfers();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadingFolder, setUploadingFolder] = useState(false);
  const [folderUploadError, setFolderUploadError] = useState<string | null>(null);
  // useTransfers() already fetches once on mount, and this screen's first
  // focus coincides with that same mount, so the immediate refresh below is
  // only needed from the second focus onward — otherwise every mount fired
  // a redundant extra GET /transfers right alongside the hook's own fetch.
  const isFirstFocus = useRef(true);

  useFocusEffect(
    useCallback(() => {
      // Refresh immediately on regaining focus, not just on the next
      // interval tick — otherwise a transfer started from FilesScreen (which
      // already has its own fresh copy) doesn't appear here until up to
      // POLL_INTERVAL_MS later, since a screen kept mounted by the tab
      // navigator doesn't re-fetch on its own. See docs/15_QA_NOTEBOOK.md's
      // Milestone P3 entry.
      if (isFirstFocus.current) {
        isFirstFocus.current = false;
      } else {
        refreshTransfers();
      }
      const timer = setInterval(refreshTransfers, POLL_INTERVAL_MS);
      return () => clearInterval(timer);
    }, [refreshTransfers]),
  );

  const handleUpload = useCallback(async () => {
    setUploadError(null);
    let picked;
    try {
      [picked] = await pick();
    } catch (err) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) {
        return;
      }
      setUploadError('Could not open the file picker.');
      return;
    }

    if (picked.size == null || picked.name == null) {
      setUploadError('Could not read that file — its name or size is unavailable.');
      return;
    }

    setUploading(true);
    try {
      const request = await proposeTransfer({
        direction: 'receive',
        file_name: picked.name,
        file_size: picked.size,
      });
      // Refresh the list and start the actual stream in parallel — the same
      // reasoning as FilesScreen.handleDownload: getTransfer()/start() don't
      // need the refreshed list, so waiting for it first only delayed when
      // the upload's bytes actually started moving.
      const refreshPromise = refreshTransfers();
      if (request.status === 'accepted' && request.transfer_id != null) {
        registerUploadSource(request.transfer_id, {
          uri: picked.uri,
          name: picked.name,
          size: picked.size,
        });
        const transfer = await getTransfer(request.transfer_id);
        TransferStreamManager.start(transfer);
      }
      await refreshPromise;
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Could not propose this upload.');
    } finally {
      setUploading(false);
    }
  }, [refreshTransfers]);

  /**
   * P13: picks a local folder (SAF directory tree, see folderPicker.ts),
   * then proposes one upload per enumerated file, all sharing a single
   * client-generated upload_batch_id/upload_folder_name so the backend
   * (TransferService._validate_folder_upload_payload / UploadBatchRegistry)
   * recreates the exact same hierarchy under one conflict-resolved folder
   * name on the desktop. Each accepted transfer is registered and handed to
   * TransferStreamManager exactly like a single-file upload — its existing
   * queue is what actually serializes N files behind one active stream.
   */
  const handleUploadFolder = useCallback(async () => {
    setFolderUploadError(null);
    let picked;
    try {
      picked = await pickAndEnumerateFolder();
    } catch {
      setFolderUploadError('Could not open the folder picker.');
      return;
    }
    if (!picked) {
      return; // user cancelled
    }
    if (picked.files.length === 0) {
      setFolderUploadError('That folder is empty — nothing to upload.');
      return;
    }

    setUploadingFolder(true);
    const batchId = generateUuidV4();
    try {
      for (const file of picked.files) {
        const request = await proposeTransfer({
          direction: 'receive',
          file_size: file.size,
          folder_relative_path: file.relativePath,
          upload_batch_id: batchId,
          upload_folder_name: picked.folderName,
        });
        if (request.status === 'accepted' && request.transfer_id != null) {
          const baseName = file.relativePath.split('/').pop() ?? file.relativePath;
          // Materialize to a local cache path first — react-native-blob-util's
          // wrap() cannot read bytes directly from a react-native-saf-x
          // tree-child URI (see materializeToLocalCache's own doc comment).
          const localPath = await materializeToLocalCache(file.uri, baseName);
          registerUploadSource(request.transfer_id, {
            uri: localPath,
            name: baseName,
            size: file.size,
            relativePath: file.relativePath,
          });
          const transfer = await getTransfer(request.transfer_id);
          TransferStreamManager.start(transfer);
        }
      }
      await refreshTransfers();
    } catch (err) {
      setFolderUploadError(err instanceof ApiError ? err.message : 'Could not propose this folder upload.');
    } finally {
      setUploadingFolder(false);
    }
  }, [refreshTransfers]);

  const error = transfersError ?? uploadError ?? folderUploadError;

  return (
    <View style={styles.container}>
      <View style={styles.uploadRow}>
        <Pressable style={styles.uploadButton} onPress={handleUpload} disabled={uploading}>
          <Text style={styles.uploadButtonText}>{uploading ? 'Requesting...' : 'Upload a File'}</Text>
        </Pressable>
        <Pressable style={styles.uploadButton} onPress={handleUploadFolder} disabled={uploadingFolder}>
          <Text style={styles.uploadButtonText}>{uploadingFolder ? 'Uploading...' : 'Upload a Folder'}</Text>
        </Pressable>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <FlatList<TransferResponse>
          data={transfers}
          keyExtractor={item => String(item.id)}
          renderItem={({ item }) => (
            <TransferRow
              transfer={item}
              onPress={() => navigation.navigate('TransferDetail', { transferId: item.id })}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.empty}>No transfers yet.</Text>
            </View>
          }
          contentContainerStyle={transfers.length === 0 ? styles.emptyList : undefined}
        />
      )}
    </View>
  );
}

function TransferRow({ transfer, onPress }: { transfer: TransferResponse; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.rowInfo}>
        <Text style={styles.name} numberOfLines={1}>
          {transfer.file_name}
        </Text>
        <Text style={styles.meta}>
          {directionLabel(transfer.direction)} · {formatFileSize(transfer.bytes_transferred)} /{' '}
          {formatFileSize(transfer.file_size)}
        </Text>
      </View>
      <Text style={styles.statusBadge}>{formatStatus(transfer.status)}</Text>
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
  uploadRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    gap: 8,
  },
  uploadButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#2563eb',
    alignItems: 'center',
  },
  uploadButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
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
  statusBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
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
