/**
 * 根布局 — Expo Router 入口 + 启动同步 + 版本检查 + 设备心跳
 */
import { useEffect, useRef } from 'react';
import { View, StyleSheet, Alert, Platform, Linking } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useAuth } from '../hooks/useAuth';
import { syncAll } from '../services/sync';
import { getAllSpots, seedFresh } from '../services/database';
import { fetchVersion, sendPing } from '../services/api';
import { SEED_SPOTS } from '../constants/seedSpots';
import { useTourStore } from '../stores/tourStore';
import AudioBar from '../components/AudioBar';

const APP_VERSION_CODE = 1;
const DEVICE_ID_KEY = '@zhengda_device_id';

let deviceIdPromise: Promise<string> | null = null;

async function getDeviceId(): Promise<string> {
  if (deviceIdPromise) return deviceIdPromise;
  deviceIdPromise = (async () => {
    let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = `${Platform.OS}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      await AsyncStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  })();
  return deviceIdPromise;
}

function openUrlSafely(url: string) {
  Linking.openURL(url).catch(() => {
    Alert.alert('打开失败', '无法打开下载链接，请稍后重试或联系管理员');
  });
}

export default function RootLayout() {
  const syncedRef = useRef(false);
  useAuth();
  useAudioPlayer();

  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;

    (async () => {
      // 1. 离线种子先灌入 SQLite（失败不阻断同步）
      try {
        await seedFresh(SEED_SPOTS);
        useTourStore.getState().setSpots(await getAllSpots());
      } catch (err) { console.warn('[Layout] seedFresh fail:', err); }

      // 2. 全量同步（种子失败也要尝试，可能网络数据覆盖损坏的本地数据）
      try {
        await syncAll();
        useTourStore.getState().setSpots(await getAllSpots());
      } catch (err) { console.warn('[Layout] syncAll fail:', err); }

      // 3. 版本检查
      try {
        const verRes = await fetchVersion();
        if (verRes.ok && verRes.data.versionCode > APP_VERSION_CODE) {
          const hasUrl = typeof verRes.data.downloadUrl === 'string'
            && /^https?:\/\//.test(verRes.data.downloadUrl);
          Alert.alert(
            '发现新版本',
            hasUrl ? '有新版本可用，是否前往下载？' : '有新版本可用，请联系管理员获取安装包',
            hasUrl
              ? [
                  { text: '稍后再说', style: 'cancel' },
                  { text: '立即更新', style: 'default', onPress: () => { openUrlSafely(verRes.data.downloadUrl); } },
                ]
              : [{ text: '知道了', style: 'default' }],
          );
        }
      } catch { /* 版本检查静默失败 */ }

      // 4. 匿名设备心跳
      try {
        const deviceId = await getDeviceId();
        await sendPing(deviceId, String(APP_VERSION_CODE));
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
