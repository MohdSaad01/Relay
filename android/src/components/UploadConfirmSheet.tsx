import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatFileSize } from '../utils/formatFileSize';

/**
 * P26 (New_Issues.txt §7): the native document/directory picker's own
 * confirm action ("tap a file" for a single pick, "USE THIS FOLDER" for a
 * directory) either has no relabelable button at all or already says exactly
 * what it does — neither can be made to say "Upload this file"/"Upload these
 * files". Rather than fighting the native picker (out of scope per this
 * milestone's own guidance), this is the intermediate confirmation step
 * TransferListScreen shows *after* the picker returns and *before* any
 * transfer is proposed: nothing is sent to the backend until the user taps
 * this sheet's own explicit upload action. Cancelling here discards the
 * picked selection entirely — no partial/implicit upload ever starts.
 *
 * Built on the same Modal (transparent + fade, backdrop-dismiss) shape as
 * FileActionMenu.tsx (P14.1) rather than a new dialog primitive.
 */
export type UploadConfirmDetails =
  | { kind: 'files'; items: Array<{ name: string; size: number }> }
  | { kind: 'folder'; folderName: string; fileCount: number; totalSize: number };

interface UploadConfirmSheetProps {
  visible: boolean;
  details: UploadConfirmDetails | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function UploadConfirmSheet({ visible, details, onCancel, onConfirm }: UploadConfirmSheetProps) {
  if (!details) {
    return null;
  }

  const title = details.kind === 'folder' ? 'Upload Folder' : details.items.length === 1 ? 'Upload File' : 'Upload Files';
  const confirmLabel =
    details.kind === 'folder' ? 'Upload folder' : details.items.length === 1 ? 'Upload this file' : 'Upload these files';
  const subtitle =
    details.kind === 'folder'
      ? `${details.folderName} · ${details.fileCount} item${details.fileCount === 1 ? '' : 's'} · ${formatFileSize(details.totalSize)}`
      : `${details.items.length} file${details.items.length === 1 ? '' : 's'} selected · ${formatFileSize(
          details.items.reduce((sum, item) => sum + item.size, 0)
        )} total`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="Dismiss upload confirmation">
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          {details.kind === 'files' && (
            <ScrollView style={styles.itemList} contentContainerStyle={styles.itemListContent}>
              {details.items.map((item, index) => (
                <Text key={`${item.name}-${index}`} style={styles.itemRow} numberOfLines={1}>
                  {item.name}
                </Text>
              ))}
            </ScrollView>
          )}

          <View style={styles.buttonRow}>
            <Pressable
              style={styles.cancelButton}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel upload"
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={styles.confirmButton}
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
            >
              <Text style={styles.confirmButtonText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 20,
    paddingBottom: 24,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 4,
    color: '#666',
  },
  itemList: {
    maxHeight: 160,
    marginTop: 14,
  },
  itemListContent: {
    gap: 8,
  },
  itemRow: {
    fontSize: 14,
    color: '#111',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 20,
    gap: 8,
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 15,
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
