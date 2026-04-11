import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme() ?? 'dark';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors[colorScheme].tabIconSelected,
        tabBarInactiveTintColor: Colors[colorScheme].tabIconDefault,
        tabBarButton: HapticTab,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginBottom: 2,
        },
        tabBarStyle: {
          backgroundColor: colorScheme === 'dark' ? '#0f1115' : Colors[colorScheme].surface,
          borderTopColor: colorScheme === 'dark' ? '#20242c' : Colors[colorScheme].border,
          borderTopWidth: 1,
          height: 64,
          paddingBottom: 8,
          paddingTop: 6,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Workspace',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="terminal"
        options={{
          title: 'Terminal',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="terminal.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explorer"
        options={{
          title: 'Explorer',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={24} name="chevron.left.forwardslash.chevron.right" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
