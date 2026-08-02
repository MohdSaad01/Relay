import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TransfersStackParamList } from './types';
import { TransferListScreen } from '../screens/transfers/TransferListScreen';
import { TransferDetailScreen } from '../screens/transfers/TransferDetailScreen';

const Stack = createNativeStackNavigator<TransfersStackParamList>();

/** Owns its own drill-down (list -> detail) independent of the other tabs. */
export function TransfersStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="TransferList"
        component={TransferListScreen}
        options={{ title: 'Transfers' }}
      />
      <Stack.Screen
        name="TransferDetail"
        component={TransferDetailScreen}
        options={{ title: 'Transfer' }}
      />
    </Stack.Navigator>
  );
}
