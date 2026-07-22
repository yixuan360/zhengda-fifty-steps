/**
 * 根布局 — Expo Router 入口 + 启动同步 + 版本检查 + 设备心跳
 */
import { useEffect, useRef } from 'react';
import { View, StyleSheet, Alert, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useAuth } from '../hooks/useAuth';
import { syncAll } from '../services/sync';
import { getAllSpots, seedFresh } from '../services/database';
import { fetchVersion, sendPing } from '../services/api';
import { SEED_SPOTS } from '../constants/seedSpots';
import { useTourStore } from '../stores/tourStore';
import AudioBar from '../components/AudioBar';

/** App 本地版本号（与 app.config.ts version 同步） */
const APP_VERSION_CODE = 1;

export default function RootLayout() {
  const syncedRef = useRef(false);
  const checkedVersionRef = useRef(false);
  useAuth();
  useAudioPlayer();

  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;

    (async () => {
      try {
        // 1. 每次启动用最新内置种子覆盖 SQLite
        await seedFresh(SEED_SPOTS);
        useTourStore.getState().setSpots(await getAllSpots());
        // 2. 全量同步
        await syncAll();
        useTourStore.getState().setSpots(await getAllSpots());
      } catch (err) { console.warn('[Layout] sync fail:', err); }

      // 3. 版本检查（异步，不阻塞）
      if (!checkedVersionRef.current) {
        checkedVersionRef.current = true;
        try {
          const verRes = await fetchVersion();
          if (verRes.ok && verRes.data.versionCode > APP_VERSION_CODE) {
            if (verRes.data.downloadUrl) {
              Alert.alert(
                '发现新版本',
                '有新版本可用，是否前往下载？',
                [
                  { text: '稍后再说', style: 'cancel' },
                  { text: '立即更新', style: 'default' },
                ],
              );
            }
          }
        } catch { /* 版本检查静默失败 */ }
      }

      // 4. 匿名设备心跳（异步，不阻塞）
      try {
        const deviceId = Constants.expoConfig?.slug ?? Platform.OS ?? 'unknown';
        await sendPing(String(deviceId), String(APP_VERSION_CODE));
      } catch { /* 心跳静默失败 */ }
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
