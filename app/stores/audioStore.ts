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
  position: number;
  duration: number;
  error: string | null;
  /** 用户主动停止（X 按钮），区分于自然播完 */
  manuallyStopped: boolean;

  // Actions
  setState: (s: PlaybackState) => void;
  setTrack: (url: string, name: string) => void;
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
  position: 0,
  duration: 0,
  error: null,
  manuallyStopped: false,

  setState: (s) => set({ state: s }),
  setTrack: (url, name) => set({ currentUrl: url, spotName: name, position: 0, duration: 0 }),
  setPosition: (pos) => set({ position: pos }),
  setDuration: (dur) => set({ duration: dur }),
  setError: (err) => set({ error: err, state: err ? 'error' : 'idle' }),
  setManuallyStopped: (v) => set({ manuallyStopped: v }),
  // 注意：reset 不清 manuallyStopped —— 手动停止（AudioBar X）的链路是
  // setManuallyStopped(true) → stop() → reset()，useTour 需要在 state
  // 变为 idle 的同一时刻读到 true 才能跳过冷却/写历史。
  // 该标志由下一次 play() 的 setManuallyStopped(false) 归位。
  reset: () => set({
    state: 'idle', currentUrl: null, spotName: null,
    position: 0, duration: 0, error: null,
  }),
}));
