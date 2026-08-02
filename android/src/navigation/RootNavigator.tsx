import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import { PairingStack } from './PairingStack';
import { MainTabs } from './MainTabs';
import { useSession } from '../session/useSession';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Root switch between the unpaired (PairingStack) and paired (MainTabs)
 * flows, following React Navigation's conditional-screen pattern for auth
 * flows so switching branches resets navigation state correctly.
 *
 * `session` comes from SessionManager (restored at app startup — see
 * App.tsx) rather than local state, so a device that was already paired
 * boots straight into MainTabs instead of always landing on pairing.
 */
export function RootNavigator() {
  const { session, isRestored } = useSession();

  if (!isRestored) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {session ? (
          <Stack.Screen name="Main" component={MainTabs} />
        ) : (
          <Stack.Screen name="Pairing" component={PairingStack} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
