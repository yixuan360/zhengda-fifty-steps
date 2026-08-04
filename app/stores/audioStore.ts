/**
 * 音频播放状态 — Zustand Store
 * v4.0 §6.1：useAudioPlayer 状态管理
 */
import { create } from 'zustand';
import type { PlaybackState } from '../types';

interface AudioState {
  state: PlaybackState;
  currentUrl: string | null;
  spotName: string | null;
  /** 当前播放的景点 id（useTour 用它识别"手动播放了非引擎景点"） */
  currentSpotId: number | null;
  position: number;
  duration: number;
  error: string | null;
  /** 用户主动停止（停止按钮），区分于自然播完 */
  manuallyStopped: boolean;

  // Actions
  setState: (s: PlaybackState) => void;
  setTrack: (url: string, name: string, spotId?: number) => void;
  setPosition: (pos: number) => void;
  setDuration: (dur: number) => void;
  setError: (err: string | null) => void;
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
  manuallyStopped: false,

  setState: (s) => set({ state: s }),
  setTrack: (url, name, spotId) => set({
    currentUrl: url, spotName: name, currentSpotId: spotId ?? null,
    position: 0, duration: 0,
  }),
  setPosition: (pos) => set({ position: pos }),
  setDuration: (dur) => set({ duration: dur }),
  setError: (err) => set({ error: err, state: err ? 'error' : 'idle' }),
  setManuallyStopped: (v) => set({ manuallyStopped: v }),
  // 注意：reset 不清 manuallyStopped —— 手动停止（详情页/TriggerCard）的链路是
  // setManuallyStopped(true) → stop() → reset()，useTour 需要在 state
  // 变为 idle 的同一时刻读到 true 才能跳过冷却/写历史。
  // 该标志由下一次 play() 的 setManuallyStopped(false) 归位。
  reset: () => set({
    state: 'idle', currentUrl: null, spotName: null, currentSpotId: null,
    position: 0, duration: 0, error: null,
  }),
}));
