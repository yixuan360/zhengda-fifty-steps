/**
 * 根布局 — Expo Router 入口
 */
import { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useAuth } from '../hooks/useAuth';
import { syncAll } from '../services/sync';
import { getAllSpots, seedIfEmpty } from '../services/database';
import { SEED_SPOTS } from '../constants/seedSpots';
import { useTourStore } from '../stores/tourStore';
import AudioBar from '../components/AudioBar';

export default function RootLayout() {
  const syncedRef = useRef(false);
  useAuth();
  useAudioPlayer();

  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;
    (async () => {
      try {
        // 1. 离线兜底：首启（库为空）先灌内置种子，保证开箱有数据
        const seeded = await seedIfEmpty(SEED_SPOTS);
        if (seeded) {
          useTourStore.getState().setSpots(await getAllSpots());
        }
        // 2. 尝试全量同步（成功则服务器数据整体覆盖种子）
        await syncAll();
        useTourStore.getState().setSpots(await getAllSpots());
      } catch (err) { console.warn('[Layout] sync fail:', err); }
    })();
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="spot/[id]" options={{ headerShown: true, title: '景点详情', headerBackTitle: '返回' }} />
      </Stack>
      <AudioBar />
    </View>
  );
}
const styles = StyleSheet.create({ root: { flex: 1 } });
