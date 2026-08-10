import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { PairingStackParamList } from '../../navigation/types';
import { getPairingResult } from '../../api/endpoints/pairing';
import { ApiError } from '../../api/client';

const POLL_INTERVAL_MS = 1500;

// The QR payload carries no expiry (PairingQrPayload has no expires_at), and
// the backend's collect_result returns the same 404 for "still pending" as
// for "expired and abandoned" — so this is a best-effort client-side give-up
// point mirroring the backend's default PAIRING_TOKEN_TTL_SECONDS, not an
// authoritative value this client actually receives.
const MAX_WAIT_MS = 5 * 60 * 1000;

type Navigation = NativeStackNavigationProp<PairingStackParamList, 'PairingWaiting'>;
type Route = RouteProp<PairingStackParamList, 'PairingWaiting'>;

/** Pure poller: submits nothing, just watches for the desktop's decision and hands off the terminal outcome. */
export function PairingWaitingScreen() {
  const navigation = useNavigation<Navigation>();
  const { params } = useRoute<Route>();
  const { desktopBaseUrl, pairingToken, deviceName } = params;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + MAX_WAIT_MS;

    async function poll() {
      try {
        const result = await getPairingResult(desktopBaseUrl, pairingToken);
        if (cancelled) {
          return;
        }
        navigation.replace('PairingResult', {
          outcome: 'success',
          session: {
            device_id: result.device_id,
            device_identifier: result.device_identifier,
            device_secret: result.device_secret,
            session_token: result.session_token,
            session_expires_at: result.session_expires_at,
            desktop_base_url: desktopBaseUrl,
            device_name: deviceName,
          },
        });
      } catch (err) {
        if (cancelled) {
          return;
        }
        if (err instanceof ApiError && err.status === 404) {
          if (Date.now() >= deadline) {
            navigation.replace('PairingResult', {
              outcome: 'failure',
              message: 'This pairing request has expired. Scan the QR code again.',
            });
            return;
          }
          timer = setTimeout(poll, POLL_INTERVAL_MS);
          return;
        }
        const message =
          err instanceof ApiError ? err.message : 'Lost contact with the desktop while waiting.';
        navigation.replace('PairingResult', { outcome: 'failure', message });
      }
    }

    poll();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [desktopBaseUrl, pairingToken, deviceName, navigation]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" />
      <Text style={styles.message}>Waiting for the desktop to approve...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  message: {
    marginTop: 16,
    textAlign: 'center',
    color: '#333',
  },
});
