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
import { getAllSpots, seedFresh } from '../services/database';
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
        // 1. 每次启动用最新内置种子覆盖 SQLite（保证离线数据最新）
        await seedFresh(SEED_SPOTS);
        useTourStore.getState().setSpots(await getAllSpots());
        // 2. 尝试全量同步（成功则服务器数据整体覆盖种子）
        await syncAll();
        useTourStore.getState().setSpots(await getAllSpots());
      } catch (err) { console.warn('[Layout] sync fail:', err); }
    })();
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="spot/[id]"
          options={{
            headerShown: true, title: '景点详情', headerBackTitle: '返回',
            headerStyle: { backgroundColor: '#F2F4F6' }, headerTintColor: '#1A7A5A',
          }}
        />
      </Stack>
      <AudioBar />
    </View>
  );
}
const styles = StyleSheet.create({ root: { flex: 1 } });
