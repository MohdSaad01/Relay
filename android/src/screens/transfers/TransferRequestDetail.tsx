import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { TransfersStackParamList } from '../../navigation/types';
import { useTransferRequest } from '../../transfers/useTransferRequest';
import { directionLabel, formatStatus } from '../../transfers/labels';
import { formatFileSize } from '../../utils/formatFileSize';
import { ApiError } from '../../api/client';
import { promoteUploadSource } from '../../streaming/uploadSourceRegistry';
import { detailStyles as styles } from './detailStyles';

const POLL_INTERVAL_MS = 2000;

type Navigation = NativeStackNavigationProp<TransfersStackParamList, 'TransferDetail'>;

/**
 * A still-pending (or just-decided) transfer request — the "accept/reject
 * visibility" half of this milestone. There is no accept/reject button
 * here: that decision is desktop-only (backend/README.md's Transfer API),
 * so this screen only ever displays whatever the desktop has decided, and
 * lets the user withdraw their own still-pending request.
 */
export function TransferRequestDetail({
  requestId,
  navigation,
}: {
  requestId: string;
  navigation: Navigation;
}) {
  const { request, loading, error, refresh, withdraw } = useTransferRequest(requestId);
  const [withdrawing, setWithdrawing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // If this was an upload proposal, its picked-file source is registered
  // under request_id (see TransferListScreen's "Upload a file" flow) and
  // needs promoting to transfer_id the moment acceptance is observed, or
  // TransferStreamManager won't be able to find it later. Idempotent — a
  // no-op once already promoted, or for a download request (nothing was
  // ever registered for those).
  useEffect(() => {
    if (request?.status === 'accepted' && request.transfer_id != null) {
      promoteUploadSource(requestId, request.transfer_id);
    }
  }, [request, requestId]);

  // Only worth polling while the desktop hasn't decided yet — once
  // accepted/rejected the request is terminal (rejected) or superseded by
  // a Transfer row (accepted), and TransferManager evicts it shortly after.
  useFocusEffect(
    useCallback(() => {
      if (request?.status !== 'pending') {
        return;
      }
      const timer = setInterval(refresh, POLL_INTERVAL_MS);
      return () => clearInterval(timer);
    }, [refresh, request?.status]),
  );

  const handleWithdraw = useCallback(async () => {
    setWithdrawing(true);
    setActionError(null);
    try {
      await withdraw();
      navigation.goBack();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not withdraw this request.');
      setWithdrawing(false);
    }
  }, [withdraw, navigation]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error || !request) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? 'Request not found.'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.name} numberOfLines={2}>
        {request.file_name}
      </Text>
      <Text style={styles.meta}>
        {directionLabel(request.direction)} · {formatFileSize(request.file_size)}
      </Text>
      <Text style={styles.status}>{formatStatus(request.status)}</Text>

      {request.status === 'pending' && (
        <Pressable style={styles.dangerButton} onPress={handleWithdraw} disabled={withdrawing}>
          <Text style={styles.dangerButtonText}>{withdrawing ? 'Withdrawing...' : 'Withdraw'}</Text>
        </Pressable>
      )}

      {request.status === 'accepted' && request.transfer_id != null && (
        <Pressable
          style={styles.button}
          onPress={() =>
            navigation.replace('TransferDetail', { kind: 'transfer', transferId: request.transfer_id as number })
          }
        >
          <Text style={styles.buttonText}>View Transfer</Text>
        </Pressable>
      )}

      {actionError && <Text style={styles.error}>{actionError}</Text>}
    </View>
  );
}
