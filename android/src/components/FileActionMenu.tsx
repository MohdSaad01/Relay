import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * P14.1: the Files screen's long-press context menu for a single row (file
 * or folder). Deliberately generic over "a title, an optional subtitle, and
 * a list of actions" rather than files/folders specifically — FilesScreen
 * owns all the file/folder-specific logic (which actions apply, what they
 * do) and only hands this component the already-resolved list to render, so
 * this stays a pure presentation primitive per CLAUDE.md's layering rules.
 *
 * Built on React Native's own Modal (transparent + fade), not a third-party
 * action-sheet library — P14.0 confirmed no such dependency exists yet in
 * this codebase, and one row of read-only actions doesn't justify adding
 * one (CLAUDE.md Rule 2).
 */
export interface FileActionMenuAction {
  key: string;
  label: string;
  onPress: () => void;
  /**
   * P22: renders this action's label in the same danger color
   * TransferProgressDetail's own Cancel button already uses
   * (detailStyles.dangerButtonText's `#dc2626`) — a destructive action
   * (Delete) should read as visually distinct from a neutral one (Open,
   * Share, Details), matching New_Issues.txt §16's "clear action buttons"/
   * "clear action hierarchy" goal. "Remove" is deliberately not marked
   * destructive: it either dismisses a not-yet-downloaded row (nothing is
   * destroyed — the item is still shared and can be re-shown) or cancels an
   * in-flight download, neither of which discards content the way Delete
   * does.
   */
  destructive?: boolean;
}

interface FileActionMenuProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  actions: FileActionMenuAction[];
  onClose: () => void;
}

export function FileActionMenu({ visible, title, subtitle, actions, onClose }: FileActionMenuProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* Tapping the backdrop dismisses; the sheet itself is wrapped in its
          own no-op Pressable so a tap inside it doesn't fall through to the
          backdrop underneath (RN's touch responder system gives the
          innermost hit-tested view the touch, so this reliably isolates the
          two without any extra event-propagation bookkeeping). */}
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss menu">
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
          <View style={styles.divider} />
          {actions.map(action => (
            <Pressable
              key={action.key}
              style={styles.actionRow}
              onPress={action.onPress}
              accessibilityRole="button"
              accessibilityLabel={action.label}
            >
              <Text style={[styles.actionLabel, action.destructive && styles.actionLabelDestructive]}>{action.label}</Text>
            </Pressable>
          ))}
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
    paddingTop: 16,
    paddingBottom: 24,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  subtitle: {
    marginTop: 2,
    color: '#666',
  },
  divider: {
    marginTop: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  actionRow: {
    paddingVertical: 14,
  },
  actionLabel: {
    fontSize: 16,
    color: '#2563eb',
  },
  // Matches TransferProgressDetail's own dangerButtonText color — see
  // FileActionMenuAction.destructive's own doc comment.
  actionLabelDestructive: {
    color: '#dc2626',
  },
});
