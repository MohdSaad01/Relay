import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PairingStackParamList } from './types';
import { DiscoveryScreen } from '../screens/discovery/DiscoveryScreen';
import { QrScanScreen } from '../screens/pairing/QrScanScreen';
import { PairingWaitingScreen } from '../screens/pairing/PairingWaitingScreen';
import { PairingResultScreen } from '../screens/pairing/PairingResultScreen';

const Stack = createNativeStackNavigator<PairingStackParamList>();

/**
 * Linear, one-way flow for an unpaired device: discover (optional) -> scan ->
 * wait for the desktop's decision -> result. There is no tab bar here — you
 * can't jump around this flow, only move forward or back out of it.
 */
export function PairingStack() {
  return (
    <Stack.Navigator initialRouteName="Discovery">
      <Stack.Screen
        name="Discovery"
        component={DiscoveryScreen}
        options={{ title: 'Relay' }}
      />
      <Stack.Screen
        name="QrScan"
        component={QrScanScreen}
        options={{ title: 'Scan QR Code' }}
      />
      <Stack.Screen
        name="PairingWaiting"
        component={PairingWaitingScreen}
        options={{ title: 'Pairing', headerBackVisible: false }}
      />
      <Stack.Screen
        name="PairingResult"
        component={PairingResultScreen}
        options={{ title: 'Pairing', headerBackVisible: false }}
      />
    </Stack.Navigator>
  );
}
