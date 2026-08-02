import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { FilesStackParamList } from './types';
import { FilesScreen } from '../screens/files/FilesScreen';

const Stack = createNativeStackNavigator<FilesStackParamList>();

export function FilesStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="Files"
        component={FilesScreen}
        options={{ title: 'Shared Files' }}
      />
    </Stack.Navigator>
  );
}
