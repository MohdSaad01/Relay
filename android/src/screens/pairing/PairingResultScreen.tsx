import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CommonActions, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { PairingStackParamList } from '../../navigation/types';
import { SessionManager } from '../../session/SessionManager';

type Navigation = NativeStackNavigationProp<PairingStackParamList, 'PairingResult'>;
type Route = RouteProp<PairingStackParamList, 'PairingResult'>;

/**
 * Renders the terminal outcome of a pairing attempt. On success, commits the
 * session through SessionManager — the only thing allowed to write session
 * data — which flips RootNavigator's root switch to MainTabs and unmounts
 * this whole stack; there is nothing further to navigate to here. On
 * failure, offers to reset back to Discovery and try again.
 */
export function PairingResultScreen() {
  const navigation = useNavigation<Navigation>();
  const { params } = useRoute<Route>();

  useEffect(() => {
    if (params.outcome === 'success') {
      SessionManager.setSession(params.session);
    }
  }, [params]);

  if (params.outcome === 'success') {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Paired successfully.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.message}>{params.message}</Text>
      <Pressable
        style={styles.button}
        onPress={() =>
          navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Discovery' }] }))
        }
      >
        <Text style={styles.buttonText}>Try Again</Text>
      </Pressable>
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
    textAlign: 'center',
    color: '#333',
    marginBottom: 24,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
