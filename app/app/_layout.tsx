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
import { getAllSpots } from '../services/database';
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
        await syncAll();
        const spots = await getAllSpots();
        useTourStore.getState().setSpots(spots);
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
