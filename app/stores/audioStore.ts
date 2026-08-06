/**
 * 音频播放状态 — Zustand Store
 * v4.0 §6.1：useAudioPlayer 状态管理
 */
import { create } from 'zustand';
import type { PlaybackState } from '../types';

/** 播放错误：kind 区分"下载失败"（可重试）与"播放失败" */
export interface AudioError {
  kind: 'download' | 'playback';
  message: string;
}

/** 最近一次失败的曲目（AppToast"点击重试"用），下次 play() 时清空 */
export interface FailedTrack {
  url: string;
  name: string;
  spotId: number | null;
}

interface AudioState {
  state: PlaybackState;
  currentUrl: string | null;
  spotName: string | null;
  /** 当前播放的景点 id（useTour 用它识别"手动播放了非引擎景点"） */
  currentSpotId: number | null;
  position: number;
  duration: number;
  error: AudioError | null;
  lastFailed: FailedTrack | null;
  /**
   * 本次播放是否由导览引擎发起（playSpot 传 { engine: true }）。
   * useTour 据它区分"引擎播放/失败重试"（应写历史+冷却+出队）与
   * "详情页手动播放"（不应写历史）——避免失败后保留 ref 时，
   * 手动播放同一景点被误判为引擎播放（审查 MEDIUM-3）。
   */
  engineArmed: boolean;
  /** 用户主动停止（停止按钮），区分于自然播完 */
  manuallyStopped: boolean;

  // Actions
  setState: (s: PlaybackState) => void;
  setTrack: (url: string, name: string, spotId?: number) => void;
  setPosition: (pos: number) => void;
  setDuration: (dur: number) => void;
  setError: (err: AudioError | null) => void;
  setLastFailed: (t: FailedTrack | null) => void;
  /** 播放失败后清空曲目信息（不碰 state/error），避免详情页残留"播放中" */
  clearTrack: () => void;
  setEngineArmed: (v: boolean) => void;
  setManuallyStopped: (v: boolean) => void;
  reset: () => void;
}

export const useAudioStore = create<AudioState>((set) => ({
  state: 'idle',
  currentUrl: null,
  spotName: null,
  currentSpotId: null,
  position: 0,
  duration: 0,
  error: null,
  lastFailed: null,
  engineArmed: false,
  manuallyStopped: false,

  setState: (s) => set({ state: s }),
  setTrack: (url, name, spotId) => set({
    currentUrl: url, spotName: name, currentSpotId: spotId ?? null,
    position: 0, duration: 0,
  }),
  setPosition: (pos) => set({ position: pos }),
  setDuration: (dur) => set({ duration: dur }),
  // 清错误时只在"当前确实是 error 态"才复位 idle —— 否则在播放中调用
  // setError(null)（play() 开头）会把 playing 误置成 idle，触发 useTour
  // 的"播放完成"（给未播完的曲目写历史/出队）。
  setError: (err) =>
    set((s) => ({
      error: err,
      state: err ? 'error' : s.state === 'error' ? 'idle' : s.state,
    })),
  setLastFailed: (t) => set({ lastFailed: t }),
  clearTrack: () => set({
    currentUrl: null, spotName: null, currentSpotId: null, position: 0, duration: 0,
  }),
  setEngineArmed: (v) => set({ engineArmed: v }),
  setManuallyStopped: (v) => set({ manuallyStopped: v }),
  // 注意：reset 不清 manuallyStopped —— 手动停止（详情页/TriggerCard）的链路是
  // setManuallyStopped(true) → stop() → reset()，useTour 需要在 state
  // 变为 idle 的同一时刻读到 true 才能跳过冷却/写历史。
  // 该标志由下一次 play() 的 setManuallyStopped(false) 归位。
  reset: () => set({
    state: 'idle', currentUrl: null, spotName: null, currentSpotId: null,
    position: 0, duration: 0, error: null, engineArmed: false,
  }),
}));
