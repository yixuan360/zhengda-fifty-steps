/**
 * 根布局 — Expo Router 入口
 * v4.0 §5：文件系统路由，底部 Tab 导航（地图 / 列表）
 *
 * 启动流程：
 *   1. useAuth() 注入 Mock Token（游客模式）
 *   2. useAudioPlayer() 初始化 RNTP
 *   3. useEffect 异步 syncAll() → SQLite → tourStore.spots
 *   4. AudioBar 悬浮于 Tab 上方，不遮挡导航
 */
import { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useAuth } from '../hooks/useAuth';
import { syncAll } from '../services/sync';
import { getAllSpots } from '../services/database';
import { useTourStore } from '../stores/tourStore';
import AudioBar from '../components/AudioBar';

export default function RootLayout() {
  const syncedRef = useRef(false);

  // ─── 全局服务初始化 ──────────────────────────────
  useAuth();            // Mock Token 注入（游客模式）
  useAudioPlayer();     // expo-av 音频服务

  // ─── 启动数据同步（仅执行一次） ───────────────────
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;

    (async () => {
      try {
        await syncAll();
        const spots = await getAllSpots();
        useTourStore.getState().setSpots(spots);
      } catch (err) {
        console.warn('[Layout] 启动同步失败，沿用本地缓存:', err);
      }
    })();
  }, []);

  return (
    <View style={styles.root}>
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

      {/* 全局悬浮播放条 — float above Tab, zIndex 9000 */}
      <AudioBar />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
