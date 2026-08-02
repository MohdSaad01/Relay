import React, { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { DiscoveryService } from '../../discovery/DiscoveryService';
import { useDiscovery } from '../../discovery/useDiscovery';
import { DiscoveredDesktop } from '../../discovery/types';
import { PairingStackParamList } from '../../navigation/types';

type Navigation = NativeStackNavigationProp<PairingStackParamList, 'Discovery'>;

/**
 * Purely informational: lists desktops currently broadcasting on the LAN.
 * Pairing itself never depends on this list — "Scan QR to Pair" is always
 * available regardless of what (if anything) has been discovered, since the
 * QR payload carries everything needed on its own.
 */
export function DiscoveryScreen() {
  const navigation = useNavigation<Navigation>();
  const { desktops } = useDiscovery();

  // Only listen while this screen is actually visible — once the user moves
  // on to scan a QR code (or later, into the paired app), there's no reason
  // to keep a socket open and a battery-costing eviction timer running.
  useFocusEffect(
    useCallback(() => {
      DiscoveryService.start();
      return () => DiscoveryService.stop();
    }, []),
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={desktops}
        keyExtractor={item => item.instanceId}
        renderItem={({ item }: { item: DiscoveredDesktop }) => (
          <View style={styles.row}>
            <Text style={styles.name}>{item.displayName}</Text>
            <Text style={styles.address}>{item.desktopIp}</Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>Looking for Relay on your network...</Text>
        }
        contentContainerStyle={desktops.length === 0 ? styles.emptyContainer : undefined}
      />
      <Pressable style={styles.scanButton} onPress={() => navigation.navigate('QrScan')}>
        <Text style={styles.scanButtonText}>Scan QR to Pair</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
  },
  address: {
    marginTop: 2,
    color: '#666',
  },
  emptyContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    color: '#666',
  },
  scanButton: {
    margin: 16,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#2563eb',
    alignItems: 'center',
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
