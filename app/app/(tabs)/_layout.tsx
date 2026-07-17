/**
 * Tab 导航 — 地图 / 列表
 */
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#1677FF', tabBarInactiveTintColor: '#999', headerShown: false }}>
      <Tabs.Screen name="map" options={{ title: '地图', tabBarIcon: ({ color, size }) => <Ionicons name="map-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="list" options={{ title: '景点', tabBarIcon: ({ color, size }) => <Ionicons name="list-outline" size={size} color={color} /> }} />
    </Tabs>
  );
}
