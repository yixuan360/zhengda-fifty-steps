/**
 * 音频播放 Hook — react-native-track-player 封装
 * v4.0 §6.1 / ADR #9：后台播放 + 锁屏控制是刚需
 *
 * 设计：模块级单例 + React Hook。useTour 通过 getPlayer() 直接调播放，
 * 组件通过 useAudioPlayer() 订阅状态变化。
 *
 * 兼容性：Expo Go 缺少 RNTP 原生模块，初始化静默失败不崩溃。
 * EAS Build APK 中完整可用。
 */
import { useEffect, useRef } from 'react';
import TrackPlayer, {
  Capability,
  Event,
  RepeatMode,
} from 'react-native-track-player';
import * as FileSystem from 'expo-file-system';
import { useAudioStore } from '../stores/audioStore';
import { ensureCacheSpace } from '../services/cache';
import type { PlaybackState } from '../types';

const AUDIO_CACHE_DIR =
  ((FileSystem as any).cacheDirectory ?? (FileSystem as any).documentDirectory ?? '') + 'audio/';

function cacheKey(url: string): string {
  const parts = url.split('/');
  return parts[parts.length - 1] || 'audio';
}

// ─── 模块级状态 ────────────────────────────────────────
let playerReady = false;
let playerAvailable = true; // Expo Go 中设为 false，降级为无音频模式
let readyPromise: Promise<void> | null = null;
let readyResolve: (() => void) | null = null;

async function ensureAudioDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(AUDIO_CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(AUDIO_CACHE_DIR, { intermediates: true });
  }
}

async function downloadToCache(url: string): Promise<string> {
  await ensureCacheSpace();
  await ensureAudioDir();

  const localPath = `${AUDIO_CACHE_DIR}${cacheKey(url)}`;
  const info = await FileSystem.getInfoAsync(localPath);
  if (info.exists) return localPath;

  const result = await FileSystem.downloadAsync(url, localPath);
  if (result.status !== 200) {
    throw new Error(`下载失败: HTTP ${result.status}`);
  }
  return localPath;
}

/** 全局播放器（供 useTour 等非组件代码调用） */
export function getPlayer() {
  return {
    async play(url: string, spotName: string, spotId?: number): Promise<void> {
      if (!playerAvailable) {
        console.warn('[AudioPlayer] RNTP 不可用（Expo Go），跳过播放');
        return;
      }

      const store = useAudioStore.getState();

      if (!playerReady && readyPromise) {
        await readyPromise;
      }

      store.setTrack(url, spotName);
      store.setManuallyStopped(false);

      try {
        store.setState('loading');
        const localUri = await downloadToCache(url);

        await TrackPlayer.reset();

        const trackId = spotId != null ? String(spotId) : spotName;
        await TrackPlayer.add({
          id: trackId,
          url: localUri,
          title: spotName,
        });

        await TrackPlayer.play();
      } catch (err: any) {
        console.error('[AudioPlayer] 播放失败:', err?.message ?? err);
        store.setError(err?.message ?? '播放失败，请重试');
      }
    },

    async pause(): Promise<void> {
      if (!playerAvailable) return;
      try { await TrackPlayer.pause(); } catch {}
    },

    async resume(): Promise<void> {
      if (!playerAvailable) return;
      try { await TrackPlayer.play(); } catch {}
    },

    async stop(): Promise<void> {
      if (!playerAvailable) return;
      try { await TrackPlayer.reset(); } catch {}
      useAudioStore.getState().reset();
    },

    async seekTo(seconds: number): Promise<void> {
      if (!playerAvailable) return;
      try { await TrackPlayer.seekTo(seconds); } catch {}
    },
  };
}

// ─── React Hook ────────────────────────────────────────

export function useAudioPlayer() {
  const initialized = useRef(false);
  const store = useAudioStore();

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    readyPromise = new Promise<void>((resolve) => {
      readyResolve = resolve;
    });

    // RNTP 原生模块在 Expo Go 中不可用，同步调用也会抛异常
    try {
      const subs: Array<{ remove: () => void }> = [];

      (async () => {
        try {
          await TrackPlayer.setupPlayer();
          await TrackPlayer.updateOptions({
            capabilities: [
              Capability.Play, Capability.Pause, Capability.Stop, Capability.SeekTo,
            ],
            compactCapabilities: [Capability.Play, Capability.Pause],
            notificationCapabilities: [Capability.Play, Capability.Pause, Capability.Stop],
          });
          await TrackPlayer.setRepeatMode(RepeatMode.Off);
          playerReady = true;
          readyResolve?.();
        } catch (err: any) {
          playerAvailable = false;
          readyResolve?.();
          console.warn('[AudioPlayer] RNTP 初始化失败（可能运行在 Expo Go 中，APK 环境正常）:', err?.message ?? err);
        }
      })();

      // 事件订阅（同步调用，Expo Go 中可能抛异常）
      let lastPbState: PlaybackState = 'idle';

      try {
        subs.push(
          TrackPlayer.addEventListener(Event.PlaybackState, (e: any) => {
            const stateMap: Record<number, PlaybackState> = {
              0: 'idle', 1: 'idle', 2: 'paused', 3: 'playing', 6: 'loading',
            };
            const pbState: PlaybackState = stateMap[e.state] ?? 'idle';
            if (pbState === lastPbState) return;
            lastPbState = pbState;
            store.setState(pbState);
            if (pbState === 'idle' && store.currentUrl) {
              store.reset();
            }
          }) as any,
        );
      } catch { playerAvailable = false; }

      try {
        subs.push(
          TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, (e: any) => {
            store.setPosition(e.position);
            store.setDuration(e.duration);
          }) as any,
        );
      } catch {}

      try {
        subs.push(
          TrackPlayer.addEventListener(Event.PlaybackError, (e: any) => {
            console.error('[AudioPlayer] 播放异常:', e);
            store.setError(e?.message ?? '播放失败，请重试');
          }) as any,
        );
      } catch {}

      return () => {
        subs.forEach((s) => { try { s.remove?.(); } catch {} });
        playerReady = false;
        readyPromise = null;
        readyResolve = null;
      };
    } catch (syncErr: any) {
      // Expo Go：RNTP 的 addEventListener 或 setupPlayer 可能同步抛异常
      playerAvailable = false;
      readyResolve?.();
      console.warn('[AudioPlayer] RNTP 同步初始化失败（Expo Go 环境正常）:', syncErr?.message ?? syncErr);
    }
  }, []);

  return {
    state: store.state,
    spotName: store.spotName,
    position: store.position,
    duration: store.duration,
    error: store.error,
    play: async (url: string, name: string, spotId?: number) => {
      store.setTrack(url, name);
      await getPlayer().play(url, name, spotId);
    },
    pause: () => getPlayer().pause(),
    resume: () => getPlayer().resume(),
    stop: () => getPlayer().stop(),
    seekTo: (sec: number) => getPlayer().seekTo(sec),
  };
}
