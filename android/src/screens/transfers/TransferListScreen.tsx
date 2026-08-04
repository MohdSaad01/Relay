import React, { useCallback, useState } from 'react';
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

  useFocusEffect(
    useCallback(() => {
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
      await refreshTransfers();
      if (request.status === 'accepted' && request.transfer_id != null) {
        registerUploadSource(request.transfer_id, {
          uri: picked.uri,
          name: picked.name,
          size: picked.size,
        });
        const transfer = await getTransfer(request.transfer_id);
        TransferStreamManager.start(transfer);
      }
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Could not propose this upload.');
    } finally {
      setUploading(false);
    }
  }, [refreshTransfers]);

  const error = transfersError ?? uploadError;

  return (
    <View style={styles.container}>
      <Pressable style={styles.uploadButton} onPress={handleUpload} disabled={uploading}>
        <Text style={styles.uploadButtonText}>{uploading ? 'Requesting...' : 'Upload a File'}</Text>
      </Pressable>

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
  uploadButton: {
    margin: 16,
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
