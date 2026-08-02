import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MainTabParamList } from './types';
import { FilesStack } from './FilesStack';
import { TransfersStack } from './TransfersStack';
import { SettingsStack } from './SettingsStack';

const Tab = createBottomTabNavigator<MainTabParamList>();

/**
 * Steady-state UI for an already-paired device. Each tab owns its own
 * native-stack (see FilesStack/TransfersStack/SettingsStack) so drill-downs
 * like the transfer detail screen get correct back-button behavior without
 * leaving the tab.
 */
export function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen
        name="FilesTab"
        component={FilesStack}
        options={{ title: 'Files' }}
      />
      <Tab.Screen
        name="TransfersTab"
        component={TransfersStack}
        options={{ title: 'Transfers' }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsStack}
        options={{ title: 'Settings' }}
      />
    </Tab.Navigator>
  );
}
