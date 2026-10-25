/**
 * Tab 导航 — 地图 / 列表（V5.4 玻璃拟态风格）
 */
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Color } from '../../constants/theme';

const ROUTE_ENABLED =
  process.env.EXPO_PUBLIC_NARRATIVE_ROUTE_ENABLED === 'true';

export default function TabLayout() {
  // Edge-to-edge 下底部系统导航条是透明的，必须把 insets.bottom 计入
  // tabBarStyle 的高度与底部内边距，否则 tab 文字/图标会被手势条遮挡。
  const insets = useSafeAreaInsets();
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
          paddingBottom: 4 + insets.bottom,
          height: 54 + insets.bottom,
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
      <Tabs.Screen
        name="routes"
        options={{
          title: '带我走',
          // 关闭功能时不显示 Tab（文件仍保留，便于回滚/分支合并）
          href: ROUTE_ENABLED ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="navigate-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
