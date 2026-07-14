/**
 * 根布局 — Expo Router 入口
 * v4.0 §5：文件系统路由，底部 Tab 导航（地图 / 列表）
 */
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="spot/[id]"
          options={{
            headerShown: true,
            title: '景点详情',
            headerBackTitle: '返回',
          }}
        />
      </Stack>
    </>
  );
}
