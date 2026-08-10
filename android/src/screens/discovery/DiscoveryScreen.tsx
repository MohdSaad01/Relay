import React, { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { DiscoveryService } from '../../discovery/DiscoveryService';
import { useDiscovery } from '../../discovery/useDiscovery';
import { DiscoveredDesktop } from '../../discovery/types';
import { PairingStackParamList } from '../../navigation/types';
import { DesktopIcon } from '../../components/icons';

// Matches Desktop's --color-primary / MainTabs' ACTIVE_TINT (P23) — kept
// local rather than imported since MainTabs' constants aren't exported.
const PRIMARY_TINT = '#2d6cdf';
const MUTED_TINT = '#8a8f98';

type Navigation = NativeStackNavigationProp<PairingStackParamList, 'Discovery'>;

/**
 * Lists desktops currently broadcasting on the LAN and lets the user tap one
 * to start pairing with it. This list is still purely a UX convenience, not
 * a source of truth for pairing — "Scan QR to Pair" stays available
 * regardless of what (if anything) has been discovered, since the QR
 * payload carries everything the pairing flow itself needs on its own.
 * Tapping a specific row instead of the generic button just carries that
 * device's (IP, port) along so QrScanScreen can flag a scanned QR that
 * belongs to a different desktop (see qrPayload.ts's matchesSelectedDesktop).
 *
 * There is no "already paired" state to distinguish here: this whole screen
 * only ever renders while unpaired (RootNavigator swaps to MainTabs the
 * instant pairing succeeds — see secureStorage.ts, "only ever one paired
 * desktop per device in V1"), so every row shown is, by construction, not
 * yet paired with this phone.
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
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => navigation.navigate('QrScan', { device: item })}
            accessibilityRole="button"
            accessibilityLabel={`${item.displayName}. Discovered. Tap to pair.`}
          >
            <View style={styles.iconBadge}>
              <DesktopIcon color={PRIMARY_TINT} size={20} />
            </View>
            <View style={styles.rowInfo}>
              <Text style={styles.name}>{item.displayName}</Text>
              <Text style={styles.address}>Discovered • Tap to pair</Text>
            </View>
            <Text style={styles.chevron}>{'›'}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <View>
            <Text style={styles.empty}>No Relay devices found yet</Text>
            <Text style={styles.emptyHint}>
              Make sure this phone and the desktop are on the same Wi-Fi network or mobile hotspot.
              Relay will list a desktop here as soon as it's found — or scan its QR code directly below.
            </Text>
          </View>
        }
        contentContainerStyle={desktops.length === 0 ? styles.emptyContainer : styles.listContainer}
      />
      <Pressable style={styles.scanButton} onPress={() => navigation.navigate('QrScan', {})}>
        <Text style={styles.scanButtonText}>Scan QR to Pair</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContainer: {
    paddingTop: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
  },
  rowPressed: {
    backgroundColor: '#ebebeb',
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(45, 108, 223, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowInfo: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
  },
  address: {
    marginTop: 2,
    color: MUTED_TINT,
  },
  chevron: {
    marginLeft: 12,
    fontSize: 20,
    color: '#999',
  },
  emptyContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  empty: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  emptyHint: {
    marginTop: 8,
    color: MUTED_TINT,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  scanButton: {
    margin: 16,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: PRIMARY_TINT,
    alignItems: 'center',
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
