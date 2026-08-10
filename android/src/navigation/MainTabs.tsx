import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MainTabParamList } from './types';
import { FilesStack } from './FilesStack';
import { TransfersStack } from './TransfersStack';
import { SettingsStack } from './SettingsStack';
import { FolderIcon, SlidersIcon, TransferIcon } from '../components/icons';

const Tab = createBottomTabNavigator<MainTabParamList>();

// Matches Desktop's --color-primary / --color-text-muted design tokens
// (desktop/styles/app.css) — the two apps share one brand palette (P23).
const ACTIVE_TINT = '#2d6cdf';
const INACTIVE_TINT = '#8a8f98';

// Defined once at module scope, not inline in JSX below, so each is a
// stable component reference across renders (react/no-unstable-nested-components).
function renderFilesIcon({ color, size }: { color: string; size: number }) {
  return <FolderIcon color={color} size={size} />;
}
function renderTransfersIcon({ color, size }: { color: string; size: number }) {
  return <TransferIcon color={color} size={size} />;
}
function renderSettingsIcon({ color, size }: { color: string; size: number }) {
  return <SlidersIcon color={color} size={size} />;
}

/**
 * Steady-state UI for an already-paired device. Each tab owns its own
 * native-stack (see FilesStack/TransfersStack/SettingsStack) so drill-downs
 * like the transfer detail screen get correct back-button behavior without
 * leaving the tab.
 *
 * Tab icons (P23) are hand-drawn (components/icons.tsx) rather than left
 * unset — react-navigation's own MissingIcon placeholder (a bare outlined
 * rectangle) was the only thing rendering there before, which read as
 * broken/unfinished rather than simply iconless.
 */
export function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false, tabBarActiveTintColor: ACTIVE_TINT, tabBarInactiveTintColor: INACTIVE_TINT }}
    >
      <Tab.Screen name="FilesTab" component={FilesStack} options={{ title: 'Files', tabBarIcon: renderFilesIcon }} />
      <Tab.Screen
        name="TransfersTab"
        component={TransfersStack}
        options={{ title: 'Transfers', tabBarIcon: renderTransfersIcon }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsStack}
        options={{ title: 'Settings', tabBarIcon: renderSettingsIcon }}
      />
    </Tab.Navigator>
  );
}
