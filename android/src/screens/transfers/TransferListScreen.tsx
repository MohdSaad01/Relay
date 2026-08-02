import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { errorCodes, isErrorWithCode, pick } from '@react-native-documents/picker';
import { TransfersStackParamList } from '../../navigation/types';
import { useTransferRequests } from '../../transfers/useTransferRequests';
import { useTransfers } from '../../transfers/useTransfers';
import { directionLabel, formatStatus } from '../../transfers/labels';
import { formatFileSize } from '../../utils/formatFileSize';
import { TransferRequestResponse, TransferResponse } from '../../api/types';
import { proposeTransfer } from '../../api/endpoints/transfers';
import { ApiError } from '../../api/client';
import { promoteUploadSource, registerUploadSource } from '../../streaming/uploadSourceRegistry';

const POLL_INTERVAL_MS = 2000;

type Navigation = NativeStackNavigationProp<TransfersStackParamList, 'TransferList'>;

type SectionItem =
  | { type: 'request'; data: TransferRequestResponse }
  | { type: 'transfer'; data: TransferResponse };

/**
 * Two sections over the same two lists TransferManager/TransferRepository
 * already scope to this device: pending requests (awaiting the desktop's
 * decision) and persisted transfers (accepted, in progress or terminal).
 * Polls both while focused so accept/reject decisions and progress show up
 * without a manual pull-to-refresh.
 *
 * Also the one entry point for proposing an upload — picking a local file
 * to send to the desktop isn't tied to browsing FilesScreen's shared list
 * the way a download is, so it lives here, keeping transfer-lifecycle
 * actions (propose, withdraw, cancel) together in the Transfers feature.
 */
export function TransferListScreen() {
  const navigation = useNavigation<Navigation>();
  const {
    requests,
    loading: requestsLoading,
    error: requestsError,
    refresh: refreshRequests,
  } = useTransferRequests();
  const {
    transfers,
    loading: transfersLoading,
    error: transfersError,
    refresh: refreshTransfers,
  } = useTransfers();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => {
        refreshRequests();
        refreshTransfers();
      }, POLL_INTERVAL_MS);
      return () => clearInterval(timer);
    }, [refreshRequests, refreshTransfers]),
  );

  // Safety net alongside TransferRequestDetail's own promotion effect: an
  // upload request can be accepted while the user is looking at this list
  // rather than that detail screen, and TransferStreamManager needs the
  // promotion to have happened by the time the user opens the transfer.
  useEffect(() => {
    requests.forEach(request => {
      if (request.status === 'accepted' && request.transfer_id != null) {
        promoteUploadSource(request.request_id, request.transfer_id);
      }
    });
  }, [requests]);

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
      const response = await proposeTransfer({
        direction: 'receive',
        file_name: picked.name,
        file_size: picked.size,
      });
      registerUploadSource(response.request_id, { uri: picked.uri, name: picked.name, size: picked.size });
      navigation.navigate('TransferDetail', { kind: 'request', requestId: response.request_id });
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Could not propose this upload.');
    } finally {
      setUploading(false);
    }
  }, [navigation]);

  const loading = requestsLoading || transfersLoading;
  const error = requestsError ?? transfersError ?? uploadError;

  const sections = [
    { title: 'Requests', data: requests.map((r): SectionItem => ({ type: 'request', data: r })) },
    { title: 'Transfers', data: transfers.map((t): SectionItem => ({ type: 'transfer', data: t })) },
  ].filter(section => section.data.length > 0);

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
        <SectionList<SectionItem>
          sections={sections}
          keyExtractor={item =>
            item.type === 'request' ? `request-${item.data.request_id}` : `transfer-${item.data.id}`
          }
          renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
          renderItem={({ item }) =>
            item.type === 'request' ? (
              <RequestRow
                request={item.data}
                onPress={() =>
                  navigation.navigate('TransferDetail', { kind: 'request', requestId: item.data.request_id })
                }
              />
            ) : (
              <TransferRow
                transfer={item.data}
                onPress={() =>
                  navigation.navigate('TransferDetail', { kind: 'transfer', transferId: item.data.id })
                }
              />
            )
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.empty}>No transfers yet.</Text>
            </View>
          }
          contentContainerStyle={sections.length === 0 ? styles.emptyList : undefined}
        />
      )}
    </View>
  );
}

function RequestRow({ request, onPress }: { request: TransferRequestResponse; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.rowInfo}>
        <Text style={styles.name} numberOfLines={1}>
          {request.file_name}
        </Text>
        <Text style={styles.meta}>
          {directionLabel(request.direction)} · {formatFileSize(request.file_size)}
        </Text>
      </View>
      <Text style={styles.statusBadge}>{formatStatus(request.status)}</Text>
    </Pressable>
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
  sectionHeader: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    backgroundColor: '#f3f4f6',
    fontWeight: '600',
    color: '#374151',
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
