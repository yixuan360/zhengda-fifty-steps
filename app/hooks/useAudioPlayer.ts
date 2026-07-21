/**
 * 音频播放 Hook — react-native-track-player 封装
 * v4.0 §6.1 / ADR #9：后台播放 + 锁屏控制
 *
 * 环境兼容：Expo Go 中 RNTP 原生模块不存在 → require 失败 → 降级，不崩。
 *           EAS APK 中完整可用（PlaybackService 在 index.js 注册）。
 *
 * 注意：RNTP v4 的 State 是字符串枚举（'playing'/'paused'/...），
 *       不是 v3 的数字枚举。
 */
import { useEffect, useRef } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { useAudioStore } from '../stores/audioStore';
import { ensureCacheSpace, ensureAudioDir } from '../services/cache';
import type { PlaybackState } from '../types';

// ─── RNTP 惰性加载 ──────────────────────────────────────
let TrackPlayer: any = null;
let Capability: any = {};
let Event: any = {};
let RepeatMode: any = {};
let AppKilledPlaybackBehavior: any = {};
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
    AppKilledPlaybackBehavior = m.AppKilledPlaybackBehavior;
    rntpOk = true;
    return true;
  } catch {
    TrackPlayer = false;
    return false;
  }
}

/**
 * RNTP v4 State（字符串）→ 应用内 PlaybackState 映射。
 * 'none'/'ready'/'stopped' 是 reset()/装载过程的中间态，
 * 映射为 undefined 表示忽略，避免切歌时误触发 useTour 的"播放完成"。
 */
const STATE_MAP: Record<string, PlaybackState | undefined> = {
  playing: 'playing',
  paused: 'paused',
  loading: 'loading',
  buffering: 'loading',
  ended: 'idle', // 自然播完 → useTour 据 playing→idle 转变执行冷却/出队
  error: 'error',
};

// ─── 初始化 ─────────────────────────────────────────────
let readyPromise: Promise<void> | null = null;

async function ensurePlayerReady(): Promise<void> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    if (!loadRNTP()) return;
    try {
      await TrackPlayer.setupPlayer();
      await TrackPlayer.updateOptions({
        android: {
          // 用户从最近任务划掉 App 时停止播放并移除通知（校园导览合理默认）
          appKilledPlaybackBehavior:
            AppKilledPlaybackBehavior?.StopPlaybackAndRemoveNotification,
        },
        capabilities: [Capability.Play, Capability.Pause, Capability.Stop, Capability.SeekTo],
        compactCapabilities: [Capability.Play, Capability.Pause],
        notificationCapabilities: [Capability.Play, Capability.Pause, Capability.Stop],
        // 必须设置，否则 PlaybackProgressUpdated 事件不触发（进度条恒为 0）
        progressUpdateEventInterval: 1,
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
  if (result.status != 200) throw new Error(`下载失败: HTTP ${result.status}`);
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
      } catch (err: any) { useAudioStore.getState().setError(err?.message ?? '播放失败，请重试'); }
    },
    pause:  () => { if (loadRNTP()) TrackPlayer.pause(); },
    resume: () => { if (loadRNTP()) TrackPlayer.play(); },
    stop:   () => { if (loadRNTP()) TrackPlayer.reset(); useAudioStore.getState().reset(); },
    seekTo: (s: number) => { if (loadRNTP()) TrackPlayer.seekTo(s); },
  };
}

// ─── React Hook（根布局挂载一次，注册事件监听） ─────────
export function useAudioPlayer() {
  const initialized = useRef(false);
  const store = useAudioStore();

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    ensurePlayerReady();

    if (!loadRNTP()) return;

    // 统一走 getState()，避免闭包持有过期 store 引用
    const subs = [
      TrackPlayer.addEventListener(Event.PlaybackState, (e: any) => {
        const s = STATE_MAP[e.state];
        if (s === undefined) return; // 忽略 none/ready/stopped 中间态
        const st = useAudioStore.getState();
        if (s === st.state) return;
        st.setState(s);
        // 自然播完：清空曲目信息（reset 保留 manuallyStopped 语义）
        if (s === 'idle' && st.currentUrl) st.reset();
      }),
      TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, (e: any) => {
        const st = useAudioStore.getState();
        st.setPosition(e.position);
        st.setDuration(e.duration);
      }),
      TrackPlayer.addEventListener(Event.PlaybackError, (e: any) => {
        useAudioStore.getState().setError(e?.message ?? '播放失败，请重试');
      }),
    ];

    return () => { subs.forEach((sub) => sub?.remove?.()); };
  }, []);

  return {
    state: store.state, spotName: store.spotName, position: store.position, duration: store.duration, error: store.error,
    play:   (url: string, name: string, id?: number) => getPlayer().play(url, name, id),
    pause:  () => getPlayer().pause(), resume: () => getPlayer().resume(),
    stop:   () => getPlayer().stop(),  seekTo: (s: number) => getPlayer().seekTo(s),
  };
}
