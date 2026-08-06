import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTransfer } from '../../transfers/useTransfer';
import { directionLabel, formatStatus } from '../../transfers/labels';
import { formatFileSize } from '../../utils/formatFileSize';
import { ApiError } from '../../api/client';
import { TransferStreamManager } from '../../streaming/TransferStreamManager';
import { useTransferStream } from '../../streaming/useTransferStream';
import { mergeLiveTransferState } from '../../transfers/mergeLiveTransferState';
import { detailStyles as styles } from './detailStyles';

const POLL_INTERVAL_MS = 2000;

/**
 * A persisted transfer's status and progress. Two sources of truth are
 * merged here: the server-polled TransferResponse (useTransfer — always
 * correct, but only as fresh as the last 2s poll) and, while this app
 * instance happens to be the one actively moving this transfer's bytes,
 * TransferStreamManager's live state (updates on every progress event).
 * Viewing a transfer this app isn't actively streaming — a different one is
 * active, or this device already streamed it in the past, or it was
 * accepted/streamed from elsewhere — falls back to the polled view alone.
 */
export function TransferProgressDetail({ transferId }: { transferId: number }) {
  const { transfer, loading, error, refresh, cancel } = useTransfer(transferId);
  const stream = useTransferStream();
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isStreamingThis = stream?.transferId === transferId && stream.status === 'streaming';

  // Trigger the stream once, the first time this screen sees the transfer
  // as in_progress and nothing (for this transfer or any other) is already
  // running. TransferStreamManager itself is the source of truth on
  // whether it's safe to start — this just calls it opportunistically.
  useEffect(() => {
    if (transfer?.status === 'in_progress') {
      TransferStreamManager.start(transfer);
    }
  }, [transfer]);

  // The moment this app's own stream reaches a terminal outcome while the
  // server still shows in_progress (the exact gap mergeLiveTransferState
  // bridges locally, below), refresh once immediately instead of waiting for
  // the next poll tick — this just catches the server-side Transfer row
  // (bytes_transferred, completed_at, failure_reason) up to match sooner.
  useEffect(() => {
    if (transfer?.status === 'in_progress' && stream?.transferId === transferId && stream.status !== 'streaming') {
      refresh();
    }
  }, [transfer?.status, stream?.transferId, stream?.status, transferId, refresh]);

  // Keep polling the server while genuinely in_progress, so: (a) a stream
  // running in this same app instance still gets its final "completed"
  // confirmed against the server, and (b) a transfer accepted/streamed
  // outside this screen's involvement (or by a stream that failed to even
  // start) still shows up-to-date status.
  useFocusEffect(
    useCallback(() => {
      if (transfer?.status !== 'in_progress') {
        return;
      }
      const timer = setInterval(refresh, POLL_INTERVAL_MS);
      return () => clearInterval(timer);
    }, [refresh, transfer?.status]),
  );

  const handleCancel = useCallback(async () => {
    setCancelling(true);
    setActionError(null);
    try {
      if (isStreamingThis) {
        await TransferStreamManager.cancelActive();
      } else {
        await cancel();
      }
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not cancel this transfer.');
    } finally {
      setCancelling(false);
    }
  }, [cancel, isStreamingThis]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error || !transfer) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? 'Transfer not found.'}</Text>
      </View>
    );
  }

  // See mergeLiveTransferState for the freshness rules: the server wins
  // outright once terminal (Milestone P3), but while it still reports
  // in_progress, the local stream's own terminal outcome — once it has one —
  // wins over a stale server 'in_progress' too (Milestone P5).
  const merged = mergeLiveTransferState(transfer, stream);
  const progress = merged.totalBytes > 0 ? merged.bytesTransferred / merged.totalBytes : 0;

  return (
    <View style={styles.container}>
      <Text style={styles.name} numberOfLines={2}>
        {transfer.file_name}
      </Text>
      <Text style={styles.meta}>
        {directionLabel(transfer.direction)} · {formatFileSize(transfer.file_size)}
      </Text>
      <Text style={styles.status}>{formatStatus(merged.status)}</Text>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.min(100, Math.round(progress * 100))}%` }]} />
      </View>
      <Text style={styles.meta}>
        {formatFileSize(merged.bytesTransferred)} / {formatFileSize(merged.totalBytes)}
      </Text>

      {merged.showCancel && (
        <Pressable style={styles.dangerButton} onPress={handleCancel} disabled={cancelling}>
          <Text style={styles.dangerButtonText}>{cancelling ? 'Cancelling...' : 'Cancel'}</Text>
        </Pressable>
      )}

      {transfer.status === 'failed' && transfer.failure_reason && (
        <Text style={styles.error}>{transfer.failure_reason}</Text>
      )}

      {merged.status === 'failed' && stream?.transferId === transferId && stream.error && (
        <Text style={styles.error}>{stream.error}</Text>
      )}

      {actionError && <Text style={styles.error}>{actionError}</Text>}
    </View>
  );
}
