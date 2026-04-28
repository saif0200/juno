import { Tabs } from 'expo-router';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Fonts } from '@/constants/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#d6d6dd',
        tabBarInactiveTintColor: '#7a797a',
        tabBarButton: HapticTab,
        tabBarLabelStyle: {
          fontFamily: Fonts.sans,
          fontSize: 10,
          fontWeight: '400',
          marginBottom: 2,
        },
        tabBarStyle: {
          backgroundColor: '#181818',
          borderTopColor: '#292929',
          borderTopWidth: 1,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'workspace',
          tabBarIcon: ({ color }) => <IconSymbol size={20} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="terminal"
        options={{
          title: 'terminal',
          tabBarIcon: ({ color }) => <IconSymbol size={20} name="terminal.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explorer"
        options={{
          title: 'explorer',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={20} name="chevron.left.forwardslash.chevron.right" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
