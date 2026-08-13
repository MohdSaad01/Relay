import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { errorCodes, isErrorWithCode, pick } from '@react-native-documents/picker';
import { TransfersStackParamList } from '../../navigation/types';
import { useTransfers } from '../../transfers/useTransfers';
import { directionLabel, formatStatus } from '../../transfers/labels';
import { FolderTransferGroup, groupTransfers, TransferListItem } from '../../transfers/transferGrouping';
import { formatFileSize } from '../../utils/formatFileSize';
import { TransferResponse } from '../../api/types';
import { getTransfer, proposeTransfer } from '../../api/endpoints/transfers';
import { ApiError } from '../../api/client';
import { registerUploadSource } from '../../streaming/uploadSourceRegistry';
import { TransferStreamManager } from '../../streaming/TransferStreamManager';
import { materializeToLocalCache, PickedFolder, pickAndEnumerateFolder } from '../../streaming/folderPicker';
import { generateUuidV4 } from '../../utils/uuid';
import {
  applyHistoryReset,
  clearTransferHistory,
  getHistoryClearedAt,
  isHistoricalTransfer,
} from '../../transfers/historyReset';
import { UploadConfirmDetails, UploadConfirmSheet } from '../../components/UploadConfirmSheet';
import { AppDialog, useAppDialog } from '../../components/AppDialog';
import { FolderIcon } from '../../components/icons';

/** A file picked via the native document picker, once its size/name are known to be readable. */
interface PickedUploadFile {
  uri: string;
  name: string;
  size: number;
}

/** What the user picked, held here until they confirm the upload via UploadConfirmSheet — see that component's own doc comment for why this step exists. */
type PendingUpload = { kind: 'files'; files: PickedUploadFile[] } | { kind: 'folder'; folder: PickedFolder };

const POLL_INTERVAL_MS = 2000;

type Navigation = NativeStackNavigationProp<TransfersStackParamList, 'TransferList'>;

/**
 * This device's transfer history, persisted transfers only — a proposal is
 * auto-accepted the moment it's made (backend/app/services/transfer_service.py),
 * so there is no separate pending-requests view to show here anymore.
 *
 * Also the one entry point for proposing an upload — picking a local file
 * to send to the desktop isn't tied to browsing FilesScreen's shared list
 * the way a download is, so it lives here. Tapping "Upload a File"/"Upload a
 * Folder" only opens the native picker; the actual proposal (and, mirroring
 * FilesScreen's download flow, handing it straight to TransferStreamManager
 * without waiting for a separate desktop decision) happens only once the
 * user confirms the picked selection via UploadConfirmSheet (P26,
 * New_Issues.txt §7) — see that component's own doc comment for why this
 * extra step exists.
 *
 * Clear History (P14.4 functionality, P23 placement) renders in the native
 * header via navigation.setOptions({ headerRight }), next to the "Transfers"
 * title set by TransfersStack — not in the content area below the upload
 * buttons, where it lived before P23.
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
  // P14.4: null until the marker file has been read at least once — kept
  // distinct from "never cleared" (also null, post-read) only in that this
  // gates the Clear History button's enabled state so it can't fire against
  // a not-yet-loaded cutoff; applyHistoryReset itself treats both the same.
  const [clearedAt, setClearedAt] = useState<string | null>(null);
  const [clearedAtLoaded, setClearedAtLoaded] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  // P26: set once the native picker returns a selection, cleared on cancel
  // or once the user confirms via UploadConfirmSheet — nothing is proposed
  // to the backend while this is non-null.
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const dialog = useAppDialog();

  useEffect(() => {
    let cancelled = false;
    getHistoryClearedAt().then(value => {
      if (!cancelled) {
        setClearedAt(value);
        setClearedAtLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
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

  /**
   * P26: picks one or more files and hands them to UploadConfirmSheet rather
   * than proposing the upload immediately — see that component's own doc
   * comment. `allowMultiSelection` (New_Issues.txt §7's "one or more files")
   * was previously unset (single-file only); a picked item missing a
   * readable name/size is dropped rather than aborting the whole selection,
   * since one unreadable item shouldn't block uploading the rest.
   */
  const handleUpload = useCallback(async () => {
    setUploadError(null);
    let picked;
    try {
      picked = await pick({ allowMultiSelection: true });
    } catch (err) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) {
        return;
      }
      setUploadError('Could not open the file picker.');
      return;
    }

    const files: PickedUploadFile[] = [];
    for (const item of picked) {
      if (item.size != null && item.name != null) {
        files.push({ uri: item.uri, name: item.name, size: item.size });
      }
    }
    if (files.length === 0) {
      setUploadError('Could not read the selected file — its name or size is unavailable.');
      return;
    }
    setPendingUpload({ kind: 'files', files });
  }, []);

  /** Proposes and starts one transfer per file, in sequence — run only after UploadConfirmSheet confirms. */
  const runFileUploads = useCallback(
    async (files: PickedUploadFile[]) => {
      setUploading(true);
      try {
        for (const file of files) {
          const request = await proposeTransfer({
            direction: 'receive',
            file_name: file.name,
            file_size: file.size,
          });
          if (request.status === 'accepted' && request.transfer_id != null) {
            registerUploadSource(request.transfer_id, {
              uri: file.uri,
              name: file.name,
              size: file.size,
            });
            const transfer = await getTransfer(request.transfer_id);
            TransferStreamManager.start(transfer);
          }
        }
        await refreshTransfers();
      } catch (err) {
        setUploadError(err instanceof ApiError ? err.message : 'Could not propose this upload.');
      } finally {
        setUploading(false);
      }
    },
    [refreshTransfers]
  );

  /**
   * P13: picks a local folder (SAF directory tree, see folderPicker.ts) and
   * enumerates it. P26: enumeration already tells us the item count/total
   * size, so — like handleUpload — this only picks and hands the result to
   * UploadConfirmSheet; the actual per-file proposal loop moved to
   * runFolderUpload below, run only once the user confirms.
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
    setPendingUpload({ kind: 'folder', folder: picked });
  }, []);

  /**
   * Proposes one upload per enumerated file, all sharing a single
   * client-generated upload_batch_id/upload_folder_name so the backend
   * (TransferService._validate_folder_upload_payload / UploadBatchRegistry)
   * recreates the exact same hierarchy under one conflict-resolved folder
   * name on the desktop. Each accepted transfer is registered and handed to
   * TransferStreamManager exactly like a single-file upload — its existing
   * queue is what actually serializes N files behind one active stream.
   */
  const runFolderUpload = useCallback(
    async (picked: PickedFolder) => {
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
    },
    [refreshTransfers]
  );

  /** UploadConfirmSheet's own confirm/cancel — dispatches to whichever pick produced pendingUpload. */
  const handleConfirmUpload = useCallback(() => {
    const pending = pendingUpload;
    setPendingUpload(null);
    if (!pending) return;
    if (pending.kind === 'files') {
      runFileUploads(pending.files);
    } else {
      runFolderUpload(pending.folder);
    }
  }, [pendingUpload, runFileUploads, runFolderUpload]);

  const handleCancelUpload = useCallback(() => {
    setPendingUpload(null);
  }, []);

  const uploadConfirmDetails: UploadConfirmDetails | null =
    pendingUpload == null
      ? null
      : pendingUpload.kind === 'files'
      ? { kind: 'files', items: pendingUpload.files.map(f => ({ name: f.name, size: f.size })) }
      : {
          kind: 'folder',
          folderName: pendingUpload.folder.folderName,
          fileCount: pendingUpload.folder.files.length,
          totalSize: pendingUpload.folder.files.reduce((sum, f) => sum + f.size, 0),
        };

  // P14.4: 'in_progress' transfers (streaming or locally queued — see
  // historyReset.ts's own doc comment) are always kept regardless of
  // clearedAt; only a terminal transfer that finished at or before the
  // clear point is hidden.
  const visibleTransfers = applyHistoryReset(transfers, clearedAt);
  const hasHistoryToClear = visibleTransfers.some(isHistoricalTransfer);
  // P21.1 (Issue 2): grouped after history reset, same order desktop's own
  // batch grouping applies it in — a folder whose children are all hidden by
  // a clear stays hidden, one still 'in_progress' stays visible, exactly
  // like today's per-row behavior. See transferGrouping.ts's own doc comment.
  const listItems = groupTransfers(visibleTransfers);

  const handleClearHistory = useCallback(() => {
    dialog.show({
      title: 'Clear transfer history?',
      message:
        'Completed, failed, and cancelled transfers will be removed from this list. Downloaded files are not deleted, and active or queued transfers are not affected.',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear History',
          style: 'destructive',
          onPress: async () => {
            setClearingHistory(true);
            try {
              const newClearedAt = await clearTransferHistory();
              setClearedAt(newClearedAt);
            } finally {
              setClearingHistory(false);
            }
          },
        },
      ],
    });
  }, [dialog]);

  // P23: Clear History lives in the header (next to the "Transfers" title),
  // not the content area — see this component's own doc comment. Re-set
  // whenever its enabled/label state changes, since headerRight is a
  // render function captured once per navigation.setOptions call.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          style={styles.headerClearHistoryButton}
          onPress={handleClearHistory}
          disabled={!clearedAtLoaded || clearingHistory || !hasHistoryToClear}
          accessibilityRole="button"
          accessibilityLabel="Clear transfer history"
        >
          <Text
            style={[
              styles.clearHistoryText,
              (!clearedAtLoaded || clearingHistory || !hasHistoryToClear) && styles.clearHistoryTextDisabled,
            ]}
          >
            {clearingHistory ? 'Clearing...' : 'Clear History'}
          </Text>
        </Pressable>
      ),
    });
  }, [navigation, handleClearHistory, clearedAtLoaded, clearingHistory, hasHistoryToClear]);

  const error = transfersError ?? uploadError ?? folderUploadError;

  return (
    <View style={styles.container}>
      <View style={styles.uploadRow}>
        <Pressable style={styles.uploadButton} onPress={handleUpload} disabled={uploading}>
          <Text style={styles.uploadButtonText}>{uploading ? 'Uploading...' : 'Upload a File'}</Text>
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
        <FlatList<TransferListItem>
          data={listItems}
          keyExtractor={item => (item.kind === 'single' ? `single-${item.transfer.id}` : item.key)}
          renderItem={({ item }) =>
            item.kind === 'folder' ? (
              <FolderTransferRow group={item} />
            ) : (
              <TransferRow
                transfer={item.transfer}
                onPress={() => navigation.navigate('TransferDetail', { transferId: item.transfer.id })}
              />
            )
          }
          ListEmptyComponent={
            // P28: one ordinary empty state regardless of *why* the list is
            // empty (never had transfers vs. history cleared) — matching
            // desktop's own transfers.js. The previous text distinguishing
            // "cleared" from "never had any" exposed that internal
            // distinction to the user, which the milestone ruled out.
            <View style={styles.emptyContainer}>
              <Text style={styles.empty}>No transfers yet.</Text>
            </View>
          }
          contentContainerStyle={listItems.length === 0 ? styles.emptyList : undefined}
        />
      )}

      <UploadConfirmSheet
        visible={pendingUpload != null}
        details={uploadConfirmDetails}
        onCancel={handleCancelUpload}
        onConfirm={handleConfirmUpload}
      />
      <AppDialog {...dialog.props} />
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

/**
 * P21.1 (Issue 2): one row for an entire folder upload/download — see
 * transferGrouping.ts's own doc comment. Not `Pressable`: there is no
 * folder-level detail screen (each child transfer still has its own, but
 * drilling into one from here is out of this milestone's scope), matching
 * desktop's own non-interactive batch row
 * (desktop/src/renderer/views/transfers.js's renderBatchRow). Deliberately
 * no per-child progress count in the subtitle — FilesScreen's
 * folderDownloadButtonLabel already established (P13.1) that a folder's
 * primary label should read exactly like a single item's, not "(3/8)".
 */
function FolderTransferRow({ group }: { group: FolderTransferGroup }) {
  const itemLabel = `${group.transfers.length} item${group.transfers.length === 1 ? '' : 's'}`;
  return (
    <View style={styles.row}>
      <View style={styles.rowInfo}>
        <View style={styles.nameRow}>
          <FolderIcon color="#666" size={16} />
          <Text style={styles.name} numberOfLines={1}>
            {group.folderName}
          </Text>
        </View>
        <Text style={styles.meta}>
          {directionLabel(group.direction)} · Folder ({itemLabel})
        </Text>
      </View>
      <Text style={styles.statusBadge}>{formatStatus(group.status)}</Text>
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
  headerClearHistoryButton: {
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  clearHistoryText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '600',
  },
  clearHistoryTextDisabled: {
    color: '#999',
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
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    flexShrink: 1,
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
