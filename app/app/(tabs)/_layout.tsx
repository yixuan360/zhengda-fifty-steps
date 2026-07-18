/**
 * Tab 导航 — 地图 / 列表（V5.4 玻璃拟态风格）
 */
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Color } from '../../constants/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Color.primary,
        tabBarInactiveTintColor: Color.caption,
        tabBarStyle: {
          backgroundColor: Color.cardBg,
          borderTopColor: Color.divider,
          borderTopWidth: 0.5,
          elevation: 0,
          shadowOpacity: 0,
          paddingBottom: 4,
          height: 54,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="map"
        options={{
          title: '地图',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="map-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="list"
        options={{
          title: '景点',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
