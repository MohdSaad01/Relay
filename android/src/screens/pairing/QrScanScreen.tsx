import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, PermissionsAndroid, Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera } from 'react-native-camera-kit';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { PairingStackParamList } from '../../navigation/types';
import { buildDesktopBaseUrl, matchesSelectedDesktop, parsePairingQrPayload } from '../../pairing/qrPayload';
import { generateDeviceIdentifier } from '../../pairing/deviceIdentifier';
import { getDefaultDeviceName } from '../../pairing/deviceName';
import { submitPairingRequest } from '../../api/endpoints/pairing';
import { ApiError } from '../../api/client';

type Navigation = NativeStackNavigationProp<PairingStackParamList, 'QrScan'>;
type Route = RouteProp<PairingStackParamList, 'QrScan'>;
// 'blocked' is Android's "never ask again" state (PermissionsAndroid.RESULTS
// includes it distinctly from a plain, re-askable denial) — the request
// dialog won't reappear, so that state alone routes the user to the app's
// system settings page instead of just repeating the same denied message.
type PermissionState = 'checking' | 'granted' | 'denied' | 'blocked';

/**
 * Decodes a scanned QR code, submits the pairing request, and hands off to
 * PairingWaitingScreen. Requests camera access contextually here, not at
 * app launch — the only screen in the app that needs it.
 *
 * Reached two ways — tapping a discovered device on DiscoveryScreen (route
 * params carry that device) or its always-available "Scan QR to Pair"
 * button (no params) — both landing on this exact screen/flow, never a
 * second scanner implementation. When a device was selected, a scanned QR
 * for a *different* desktop is rejected client-side (matchesSelectedDesktop)
 * before ever submitting a pairing request.
 */
export function QrScanScreen() {
  const navigation = useNavigation<Navigation>();
  const { params } = useRoute<Route>();
  const selectedDevice = params?.device;
  const [permission, setPermission] = useState<PermissionState>('checking');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref, not just the `submitting` state: onReadCode can fire multiple
  // times for the same code before a state update re-renders, and state
  // read inside the callback's closure would still see the stale value.
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
      title: 'Camera access',
      message: 'Relay needs your camera to scan the pairing QR code shown on the other device.',
      buttonPositive: 'OK',
    }).then(result => {
      if (cancelled) {
        return;
      }
      if (result === PermissionsAndroid.RESULTS.GRANTED) {
        setPermission('granted');
      } else if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        setPermission('blocked');
      } else {
        setPermission('denied');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Closing the scanner before a valid QR is scanned never creates a partial
  // pairing: no pending state exists anywhere (server or client) until
  // submitPairingRequest below actually resolves, so a plain goBack() is
  // always a clean cancel. Handled explicitly (rather than left to
  // react-navigation's default hardware-back handling) only so it can share
  // the same handler as the Close button.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      navigation.goBack();
      return true;
    });
    return () => subscription.remove();
  }, [navigation]);

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
        if (selectedDevice && !matchesSelectedDesktop(qr, selectedDevice)) {
          setError(
            `This QR code belongs to a different device. Scan the QR code for: ${selectedDevice.displayName}`,
          );
          return;
        }
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
    [navigation, selectedDevice],
  );

  if (permission === 'checking') {
    return (
      <View style={styles.center}>
        <Text>Requesting camera access...</Text>
      </View>
    );
  }

  if (permission === 'denied' || permission === 'blocked') {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>
          Camera access is required to scan a pairing QR code.
          {permission === 'blocked'
            ? ' Enable it for Relay in Android Settings and try again.'
            : ' Enable it and try again.'}
        </Text>
        {permission === 'blocked' && (
          <Pressable style={styles.settingsButton} onPress={() => Linking.openSettings()}>
            <Text style={styles.settingsButtonText}>Open Settings</Text>
          </Pressable>
        )}
        <Pressable style={styles.closeButtonSecondary} onPress={() => navigation.goBack()}>
          <Text style={styles.closeButtonSecondaryText}>Close</Text>
        </Pressable>
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
      <View style={styles.instructionBanner} pointerEvents="none">
        <Text style={styles.instructionText}>
          Point your camera at the QR code shown on the device you want to pair with.
        </Text>
      </View>
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
      <Pressable style={styles.closeButton} onPress={() => navigation.goBack()}>
        <Text style={styles.closeButtonText}>Close</Text>
      </Pressable>
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
    bottom: 100,
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
  instructionBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  instructionText: {
    color: '#fff',
    textAlign: 'center',
  },
  closeButton: {
    position: 'absolute',
    bottom: 32,
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  closeButtonText: {
    color: '#111',
    fontWeight: '600',
  },
  settingsButton: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  settingsButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  closeButtonSecondary: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  closeButtonSecondaryText: {
    color: '#2563eb',
    fontWeight: '600',
  },
});
