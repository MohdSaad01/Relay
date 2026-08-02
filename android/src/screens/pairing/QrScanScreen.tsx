import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, StyleSheet, Text, View } from 'react-native';
import { Camera } from 'react-native-camera-kit';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { PairingStackParamList } from '../../navigation/types';
import { buildDesktopBaseUrl, parsePairingQrPayload } from '../../pairing/qrPayload';
import { generateDeviceIdentifier } from '../../pairing/deviceIdentifier';
import { getDefaultDeviceName } from '../../pairing/deviceName';
import { submitPairingRequest } from '../../api/endpoints/pairing';
import { ApiError } from '../../api/client';

type Navigation = NativeStackNavigationProp<PairingStackParamList, 'QrScan'>;
type PermissionState = 'checking' | 'granted' | 'denied';

/**
 * Decodes a scanned QR code, submits the pairing request, and hands off to
 * PairingWaitingScreen. Requests camera access contextually here, not at
 * app launch — the only screen in the app that needs it.
 */
export function QrScanScreen() {
  const navigation = useNavigation<Navigation>();
  const [permission, setPermission] = useState<PermissionState>('checking');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref, not just the `submitting` state: onReadCode can fire multiple
  // times for the same code before a state update re-renders, and state
  // read inside the callback's closure would still see the stale value.
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA).then(result => {
      if (!cancelled) {
        setPermission(result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleReadCode = useCallback(
    async (event: { nativeEvent: { codeStringValue: string } }) => {
      if (isSubmittingRef.current) {
        return;
      }
      setError(null);

      let desktopBaseUrl: string;
      let pairingToken: string;
      try {
        const qr = parsePairingQrPayload(event.nativeEvent.codeStringValue);
        desktopBaseUrl = buildDesktopBaseUrl(qr);
        pairingToken = qr.pairing_token;
      } catch (err) {
        setError((err as Error).message);
        return;
      }

      isSubmittingRef.current = true;
      setSubmitting(true);
      try {
        await submitPairingRequest(desktopBaseUrl, {
          pairing_token: pairingToken,
          device_identifier: generateDeviceIdentifier(),
          device_name: getDefaultDeviceName(),
          platform: 'android',
        });
        navigation.navigate('PairingWaiting', { desktopBaseUrl, pairingToken });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not reach that desktop.');
        isSubmittingRef.current = false;
        setSubmitting(false);
      }
    },
    [navigation],
  );

  if (permission === 'checking') {
    return (
      <View style={styles.center}>
        <Text>Requesting camera access...</Text>
      </View>
    );
  }

  if (permission === 'denied') {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>
          Camera access is required to scan a pairing QR code. Enable it in system settings and try
          again.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        scanBarcode
        allowedBarcodeTypes={['qr']}
        scanThrottleDelay={1000}
        onReadCode={handleReadCode}
      />
      {submitting && (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>Requesting to pair...</Text>
        </View>
      )}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  message: {
    textAlign: 'center',
    color: '#333',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
  },
  overlayText: {
    color: '#fff',
  },
  errorBanner: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
    padding: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(220,38,38,0.9)',
  },
  errorText: {
    color: '#fff',
    textAlign: 'center',
  },
});
