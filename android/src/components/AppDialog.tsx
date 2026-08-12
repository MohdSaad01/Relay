import React, { useCallback, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * Relay's one Android dialog primitive (P30), replacing `Alert.alert()` —
 * the OS's own unstyled system dialog, entirely outside this app's visual
 * language (`FileActionMenu.tsx`/P14.1, `UploadConfirmSheet.tsx`/P26: white
 * card, rounded corners, `#2563eb` primary / `#dc2626` destructive text).
 * Built on the same `Modal` (transparent + fade, backdrop-dismiss, an inner
 * no-op `Pressable` isolating taps on the card from the backdrop) those two
 * components already established — a *centered* card here rather than their
 * bottom sheet shape, since a confirm/alert dialog isn't an action list tied
 * to a specific row.
 *
 * Mirrors `Alert.alert(title, message, buttons)`'s own shape closely
 * (a `buttons` array, a `style` per button) so migrating a call site is a
 * small, low-risk diff rather than a rewrite of each screen's logic.
 * `onDismiss` fires for a backdrop tap or the Android hardware back button —
 * exactly `Alert.alert`'s own default `cancelable: true` behavior (no call
 * site here relied on `cancelable: false`), and any button press first
 * dismisses the dialog and then runs its own `onPress`, again matching
 * `Alert.alert`'s dismiss-after-any-button behavior.
 */
export interface AppDialogButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface AppDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  buttons: AppDialogButton[];
  onDismiss: () => void;
}

export function AppDialog({ visible, title, message, buttons, onDismiss }: AppDialogProps) {
  const handlePress = useCallback(
    (button: AppDialogButton) => {
      onDismiss();
      button.onPress?.();
    },
    [onDismiss],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityLabel="Dismiss dialog">
        <Pressable style={styles.card} onPress={() => undefined}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.buttonRow}>
            {buttons.map((button, index) => (
              <Pressable
                key={`${button.text}-${index}`}
                style={styles.button}
                onPress={() => handlePress(button)}
                accessibilityRole="button"
                accessibilityLabel={button.text}
              >
                <Text
                  style={[
                    styles.buttonText,
                    button.style === 'cancel' && styles.cancelText,
                    button.style === 'destructive' && styles.destructiveText,
                  ]}
                >
                  {button.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Config for one `AppDialog` invocation - everything but `visible`/`onDismiss`, which `useAppDialog` supplies itself. */
type AppDialogConfig = Omit<AppDialogProps, 'visible' | 'onDismiss'>;

/**
 * Local dialog state for a screen, matching `Alert.alert`'s own call-and-
 * forget ergonomics: `show({ title, message, buttons })` in place of
 * `Alert.alert(title, message, buttons)`. The screen renders one
 * `<AppDialog {...dialog.props} />` (spread onto `visible`/`onDismiss` too)
 * near the bottom of its JSX, exactly where `FileActionMenu`/
 * `UploadConfirmSheet` are already rendered.
 */
export function useAppDialog() {
  const [config, setConfig] = useState<AppDialogConfig | null>(null);

  const show = useCallback((next: AppDialogConfig) => setConfig(next), []);
  const hide = useCallback(() => setConfig(null), []);

  return {
    show,
    props: {
      visible: config != null,
      title: config?.title ?? '',
      message: config?.message,
      buttons: config?.buttons ?? [],
      onDismiss: hide,
    } satisfies AppDialogProps,
  };
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  message: {
    marginTop: 8,
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 20,
    gap: 8,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2563eb',
  },
  cancelText: {
    color: '#666',
  },
  destructiveText: {
    color: '#dc2626',
  },
});
