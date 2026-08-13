import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { hasPermission, openDocumentTree } from 'react-native-saf-x';
import { DownloadLocationManager } from '../../settings/DownloadLocationManager';
import { useDownloadLocation } from '../../settings/useDownloadLocation';
import { useSession } from '../../session/useSession';
import { SessionManager } from '../../session/SessionManager';
import { renameDevice } from '../../api/endpoints/devices';
import { ApiError } from '../../api/client';
import { getDefaultDeviceName } from '../../pairing/deviceName';
import { AppDialog, useAppDialog } from '../../components/AppDialog';

/**
 * A small, user-facing settings screen — deliberately not an administrative
 * configuration panel (P23). Exposes exactly two things: this device's
 * display name (DEVICE) and where downloads are saved (STORAGE). No session
 * token lifetime, backend URL, or other internal configuration belongs here.
 *
 * DOWNLOAD LOCATION (P14.3): shows and lets the user change where Relay
 * publishes a completed download. This setting is the real source of truth
 * for the download pipeline (files/downloadExistence.ts, streaming/blobUtil.ts)
 * — not a cosmetic display here; see settings/DownloadLocationManager.ts.
 * Changing the location never touches existing downloads (see this screen's
 * own hint text) — the pipeline re-derives on-device existence live against
 * whatever the current location resolves to, the same way it already
 * recovers from an externally-deleted file, so nothing needs to be moved or
 * reconciled here.
 */
export function SettingsScreen() {
  const { location, isRestored } = useDownloadLocation();
  const [permissionRevoked, setPermissionRevoked] = useState(false);
  const [changing, setChanging] = useState(false);
  const dialog = useAppDialog();

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
      dialog.show({
        title: 'Could not set download location',
        message: err instanceof Error ? err.message : 'Please try again.',
        buttons: [{ text: 'OK' }],
      });
    } finally {
      setChanging(false);
    }
  }, [dialog]);

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
      <Text style={styles.sectionTitle}>Device</Text>
      <DeviceNameCard />

      <Text style={[styles.sectionTitle, styles.sectionSpacing]}>Storage</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Download folder</Text>
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
          accessibilityLabel="Change download folder"
        >
          <Text style={styles.buttonText}>{changing ? 'Choosing…' : 'Change Folder'}</Text>
        </Pressable>
        {location.mode === 'custom' && (
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
            onPress={handleResetToDefault}
            accessibilityRole="button"
            accessibilityLabel="Reset download folder to default"
          >
            <Text style={styles.secondaryButtonText}>Reset to Default</Text>
          </Pressable>
        )}
        <Text style={styles.hint}>
          Existing downloads stay where they are when you change this — only new downloads use the new
          location.
        </Text>
      </View>
      <AppDialog {...dialog.props} />
    </View>
  );
}

/**
 * The device display name shown on the desktop's Devices list — distinct
 * from device_identifier, which is generated once at pairing and never
 * changes (pairing/deviceIdentifier.ts). Renaming calls
 * `PATCH /devices/{id}` and, only once that succeeds, updates the local
 * Session so the new name survives navigating away and an app restart
 * (SessionManager persists via secure storage on every write).
 */
function DeviceNameCard() {
  const { session } = useSession();
  // A session persisted before P23 has no device_name (the field didn't
  // exist yet) — falls back to the same default a fresh pairing would have
  // used, rather than rendering blank. Saving (even unchanged) self-heals
  // the stored session, since the fallback never equals session.device_name.
  const currentName = session?.device_name || getDefaultDeviceName();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keeps the draft in sync if the session's name changes out from under an
  // idle (non-editing) card — e.g. right after a save commits.
  useEffect(() => {
    if (!editing) {
      setDraftName(currentName);
    }
  }, [editing, currentName]);

  const handleStartEdit = useCallback(() => {
    setError(null);
    setDraftName(currentName);
    setEditing(true);
  }, [currentName]);

  const handleCancelEdit = useCallback(() => {
    setError(null);
    setEditing(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!session) {
      return;
    }
    const trimmed = draftName.trim();
    if (!trimmed) {
      setError('Device name cannot be empty.');
      return;
    }
    if (trimmed === session.device_name) {
      // Nothing changed — no need to round-trip to the backend.
      setEditing(false);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await renameDevice(session.device_id, trimmed);
      await SessionManager.updateDeviceName(trimmed);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this name. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [draftName, session]);

  if (!session) {
    return null;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Device display name</Text>
      {editing ? (
        <>
          <TextInput
            style={styles.input}
            value={draftName}
            onChangeText={setDraftName}
            autoFocus
            editable={!saving}
            accessibilityLabel="Device display name"
          />
          {error && <Text style={styles.warning}>{error}</Text>}
          <View style={styles.editRow}>
            <Pressable
              style={({ pressed }) => [styles.secondaryButtonSmall, pressed && styles.buttonPressed]}
              onPress={handleCancelEdit}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Cancel editing device name"
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.buttonSmall, pressed && styles.buttonPressed]}
              onPress={handleSave}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Save device name"
            >
              <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.value}>{currentName}</Text>
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
            onPress={handleStartEdit}
            accessibilityRole="button"
            accessibilityLabel="Edit device name"
          >
            <Text style={styles.secondaryButtonText}>Edit Name</Text>
          </Pressable>
          <Text style={styles.hint}>This is the name paired desktops see for this device.</Text>
        </>
      )}
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
  sectionSpacing: {
    marginTop: 24,
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
  input: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
    borderBottomWidth: 2,
    borderBottomColor: '#2563eb',
    paddingVertical: 4,
  },
  warning: {
    marginTop: 12,
    color: '#dc2626',
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
  editRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  secondaryButtonSmall: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#999',
    alignItems: 'center',
  },
  buttonSmall: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#2563eb',
    alignItems: 'center',
  },
  hint: {
    marginTop: 12,
    color: '#999',
    fontSize: 12,
  },
});
