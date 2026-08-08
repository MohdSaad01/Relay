import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { hasPermission, openDocumentTree } from 'react-native-saf-x';
import { DownloadLocationManager } from '../../settings/DownloadLocationManager';
import { useDownloadLocation } from '../../settings/useDownloadLocation';

/**
 * P14.3: shows and lets the user change where Relay publishes a completed
 * download. This setting is the real source of truth for the download
 * pipeline (files/downloadExistence.ts, streaming/blobUtil.ts) — not a
 * cosmetic display here; see settings/DownloadLocationManager.ts.
 *
 * Changing the location never touches existing downloads (see this
 * screen's own hint text) — the pipeline re-derives on-device existence
 * live against whatever the current location resolves to, the same way it
 * already recovers from an externally-deleted file, so nothing needs to be
 * moved or reconciled here.
 */
export function SettingsScreen() {
  const { location, isRestored } = useDownloadLocation();
  const [permissionRevoked, setPermissionRevoked] = useState(false);
  const [changing, setChanging] = useState(false);

  // Re-checked every time this tab regains focus (not just on mount) —
  // permission can be revoked from outside the app (e.g. the folder itself
  // deleted, or access removed via the OS's own document-permission UI)
  // while this screen isn't visible.
  useFocusEffect(
    useCallback(() => {
      if (location.mode !== 'custom') {
        setPermissionRevoked(false);
        return;
      }
      let cancelled = false;
      hasPermission(location.treeUri)
        .then(granted => {
          if (!cancelled) {
            setPermissionRevoked(!granted);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setPermissionRevoked(true);
          }
        });
      return () => {
        cancelled = true;
      };
    }, [location]),
  );

  const handleChangeLocation = useCallback(async () => {
    setChanging(true);
    try {
      const picked = await openDocumentTree(true);
      if (!picked) {
        return;
      }
      await DownloadLocationManager.setLocation({
        mode: 'custom',
        treeUri: picked.uri,
        displayName: picked.name,
      });
      setPermissionRevoked(false);
    } catch (err) {
      Alert.alert(
        'Could not set download location',
        err instanceof Error ? err.message : 'Please try again.',
      );
    } finally {
      setChanging(false);
    }
  }, []);

  const handleResetToDefault = useCallback(async () => {
    await DownloadLocationManager.resetToDefault();
    setPermissionRevoked(false);
  }, []);

  if (!isRestored) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  const currentLabel = location.mode === 'default' ? 'Default (Downloads/Relay)' : location.displayName;

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Download Location</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Downloads are saved to</Text>
        <Text style={styles.value}>{currentLabel}</Text>
        {permissionRevoked && (
          <Text style={styles.warning}>
            Relay no longer has access to this folder. Choose a new location, or reset to the default.
          </Text>
        )}
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={handleChangeLocation}
          disabled={changing}
          accessibilityRole="button"
          accessibilityLabel="Change download location"
        >
          <Text style={styles.buttonText}>{changing ? 'Choosing…' : 'Change Location'}</Text>
        </Pressable>
        {location.mode === 'custom' && (
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
            onPress={handleResetToDefault}
            accessibilityRole="button"
            accessibilityLabel="Reset download location to default"
          >
            <Text style={styles.secondaryButtonText}>Reset to Default</Text>
          </Pressable>
        )}
        <Text style={styles.hint}>
          Existing downloads stay where they are when you change this — only new downloads use the new
          location.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 16,
  },
  label: {
    color: '#666',
    fontSize: 13,
  },
  value: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 4,
  },
  warning: {
    marginTop: 12,
    color: '#b91c1c',
    fontSize: 13,
  },
  button: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#2563eb',
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButton: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#999',
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#333',
    fontSize: 15,
    fontWeight: '600',
  },
  hint: {
    marginTop: 12,
    color: '#999',
    fontSize: 12,
  },
});
