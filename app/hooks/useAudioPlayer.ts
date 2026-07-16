/**
 * 音频播放 Hook — react-native-track-player 封装
 * v4.0 §6.1 / ADR #9：后台播放 + 锁屏控制
 *
 * 环境兼容：Expo Go 中 RNTP 原生模块不存在 → require 失败 → 降级，不崩。
 *           EAS APK 中完整可用。
 */
import { useEffect, useRef } from 'react';
import * as FileSystem from 'expo-file-system';
import { useAudioStore } from '../stores/audioStore';
import { ensureCacheSpace, ensureAudioDir } from '../services/cache';
import type { PlaybackState } from '../types';

// ─── RNTP 惰性加载 ──────────────────────────────────────
let TrackPlayer: any = null;
let Capability: any = {};
let Event: any = {};
let RepeatMode: any = {};
let rntpOk = false;

function loadRNTP(): boolean {
  if (rntpOk) return true;
  if (TrackPlayer === false) return false;
  try {
    const m = require('react-native-track-player');
    TrackPlayer = m.default ?? m;
    Capability = m.Capability;
    Event = m.Event;
    RepeatMode = m.RepeatMode;
    rntpOk = true;
    return true;
  } catch {
    TrackPlayer = false;
    return false;
  }
}

// ─── 初始化 ─────────────────────────────────────────────
let readyPromise: Promise<void> | null = null;

async function ensurePlayerReady(): Promise<void> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    if (!loadRNTP()) return;
    try {
      await TrackPlayer.setupPlayer();
      await TrackPlayer.updateOptions({
        capabilities: [Capability.Play, Capability.Pause, Capability.Stop, Capability.SeekTo],
        compactCapabilities: [Capability.Play, Capability.Pause],
        notificationCapabilities: [Capability.Play, Capability.Pause, Capability.Stop],
      });
      await TrackPlayer.setRepeatMode(RepeatMode.Off);
    } catch (err: any) {
      console.error('[AudioPlayer] init fail:', err?.message ?? err);
    }
  })();
  return readyPromise;
}

// ─── 下载 ───────────────────────────────────────────────
function cacheKey(url: string): string { return url.split('/').pop() || 'audio'; }

async function downloadToCache(url: string): Promise<string> {
  await ensureCacheSpace();
  const audioDir = await ensureAudioDir();
  const localPath = `${audioDir}${cacheKey(url)}`;
  const info = await FileSystem.getInfoAsync(localPath);
  if (info.exists) return localPath;
  const result = await FileSystem.downloadAsync(url, localPath);
  if (result.status !== 200) throw new Error(`下载失败: HTTP ${result.status}`);
  return localPath;
}

// ─── 播放器 ─────────────────────────────────────────────
export function getPlayer() {
  return {
    async play(url: string, spotName: string, spotId?: number): Promise<void> {
      if (!loadRNTP()) return;
      await ensurePlayerReady();
      const store = useAudioStore.getState();
      store.setTrack(url, spotName);
      store.setManuallyStopped(false);
      try {
        store.setState('loading');
        const localUri = await downloadToCache(url);
        await TrackPlayer.reset();
        await TrackPlayer.add({ id: spotId != null ? String(spotId) : spotName, url: localUri, title: spotName });
        await TrackPlayer.play();
      } catch (err: any) { store.setError(err?.message ?? '播放失败，请重试'); }
    },
    pause:  () => { if (loadRNTP()) TrackPlayer.pause(); },
    resume: () => { if (loadRNTP()) TrackPlayer.play(); },
    stop:   () => { if (loadRNTP()) TrackPlayer.reset(); useAudioStore.getState().reset(); },
    seekTo: (s: number) => { if (loadRNTP()) TrackPlayer.seekTo(s); },
  };
}

// ─── React Hook ────────────────────────────────────────
export function useAudioPlayer() {
  const initialized = useRef(false);
  const store = useAudioStore();

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    ensurePlayerReady();

    if (!loadRNTP()) return;

    let lastPbState: PlaybackState = 'idle';
    TrackPlayer.addEventListener(Event.PlaybackState, (e: any) => {
      const m: Record<number, PlaybackState> = { 0: 'idle', 1: 'idle', 2: 'paused', 3: 'playing', 6: 'loading' };
      const s = m[e.state] ?? 'idle';
      if (s === lastPbState) return; lastPbState = s;
      store.setState(s);
      if (s === 'idle' && store.currentUrl) store.reset();
    });
    TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, (e: any) => { store.setPosition(e.position); store.setDuration(e.duration); });
    TrackPlayer.addEventListener(Event.PlaybackError, (e: any) => { store.setError(e?.message ?? '播放失败，请重试'); });

    return () => { readyPromise = null; };
  }, []);

  return {
    state: store.state, spotName: store.spotName, position: store.position, duration: store.duration, error: store.error,
    play:   (url: string, name: string, id?: number) => { store.setTrack(url, name); return getPlayer().play(url, name, id); },
    pause:  () => getPlayer().pause(), resume: () => getPlayer().resume(),
    stop:   () => getPlayer().stop(),  seekTo: (s: number) => getPlayer().seekTo(s),
  };
}
