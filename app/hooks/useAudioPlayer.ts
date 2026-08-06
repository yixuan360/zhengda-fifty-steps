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
import { useAudioStore, type AudioError } from '../stores/audioStore';
import { ensureAudioCached } from '../services/cache';
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
// v7：下载逻辑移至 services/cache 的 ensureAudioCached ——
// URL 校验 + 哈希命名 + 并发去重 + 失败重试 + 半成品清理。
// 失败时抛带 kind='download' 的错误，由 play() 转成结构化 store.error。

// ─── 播放器 ─────────────────────────────────────────────
/**
 * play 代次 token：stop() 会递增它。play() 在异步下载完成后校验代次，
 * 若期间被 stop（或又被新的 play 取代），则放弃 TrackPlayer.play()，
 * 避免"加载中停止后音频仍响起"的幽灵播放（审查 MEDIUM-1）。
 */
let playGeneration = 0;

export function getPlayer() {
  return {
    async play(url: string, spotName: string, spotId?: number, opts?: { engine?: boolean }): Promise<void> {
      if (!loadRNTP()) return;
      await ensurePlayerReady();
      const store = useAudioStore.getState();
      store.setError(null);            // 清除上一次错误（若仍在 error 态则复位 idle，避免旧 toast 残留）
      store.setEngineArmed(!!opts?.engine); // 引擎 playSpot/失败重试=true；详情页手动=false（审查 MEDIUM-3）
      store.setTrack(url, spotName, spotId);
      store.setManuallyStopped(false);
      store.setLastFailed(null);       // 新播放开始，清除旧的"点击重试"记录
      try {
        store.setState('loading');
        const gen = ++playGeneration;
        const localUri = await ensureAudioCached(url);
        if (gen !== playGeneration) {
          // 下载期间被 stop() 或新的 play() 取代 → 直接丢弃本次播放。
          // 不在此 reset()：接管者（新 play / stop）已经或将会自行 reset+add+play，
          // 这里再 reset 会清掉已接管的播放（审查 HIGH-2）。
          return;
        }
        await TrackPlayer.reset();
        await TrackPlayer.add({ id: spotId != null ? String(spotId) : spotName, url: localUri, title: spotName });
        await TrackPlayer.play();
      } catch (err: any) {
        // 下载失败（kind='download'，可重试）与播放失败（kind='playback'）分开标记。
        // message 一律转用户友好文案，不把原生桥接异常（ExponentFileSystem...）透传给 UI。
        const st = useAudioStore.getState();
        const kind: AudioError['kind'] = err?.kind === 'download' ? 'download' : 'playback';
        const message =
          kind === 'download'
            ? (typeof err?.message === 'string' && err.message ? err.message : '语音加载失败，请检查网络')
            : '播放失败，请重试';
        st.setError({ kind, message });
        st.setLastFailed({ url, name: spotName, spotId: spotId ?? null });
        st.clearTrack();
      }
    },
    pause:  () => { if (loadRNTP()) TrackPlayer.pause(); },
    resume: () => { if (loadRNTP()) TrackPlayer.play(); },
    stop:   () => { playGeneration += 1; if (loadRNTP()) TrackPlayer.reset(); useAudioStore.getState().reset(); },
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
        // 原生播放错误：同样转用户友好文案并记录失败曲目，供"点击重试"
        const st = useAudioStore.getState();
        const currentUrl = st.currentUrl;
        st.setError({ kind: 'playback', message: '播放失败，请重试' });
        if (currentUrl) {
          st.setLastFailed({ url: currentUrl, name: st.spotName ?? '语音', spotId: st.currentSpotId });
          st.clearTrack();
        }
      }),
    ];

    return () => { subs.forEach((sub) => sub?.remove?.()); };
  }, []);

  return {
    state: store.state, spotName: store.spotName, position: store.position, duration: store.duration, error: store.error,
    play:   (url: string, name: string, id?: number, opts?: { engine?: boolean }) => getPlayer().play(url, name, id, opts),
    pause:  () => getPlayer().pause(), resume: () => getPlayer().resume(),
    stop:   () => getPlayer().stop(),  seekTo: (s: number) => getPlayer().seekTo(s),
  };
}
