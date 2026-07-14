/**
 * 音频播放状态 — Zustand Store
 * v4.0 §6.1：useAudioPlayer 状态管理
 */
import { create } from 'zustand';
import type { PlaybackState } from '../types';

interface AudioState {
  /** 播放状态 */
  state: PlaybackState;
  /** 当前播放的音频 URL */
  currentUrl: string | null;
  /** 当前播放的景点名称（用于 UI 展示） */
  spotName: string | null;
  /** 播放进度（秒） */
  position: number;
  /** 音频总时长（秒） */
  duration: number;
  /** 错误信息 */
  error: string | null;

  // Actions
  setState: (s: PlaybackState) => void;
  setTrack: (url: string, name: string) => void;
  setPosition: (pos: number) => void;
  setDuration: (dur: number) => void;
  setError: (err: string | null) => void;
  reset: () => void;
}

export const useAudioStore = create<AudioState>((set) => ({
  state: 'idle',
  currentUrl: null,
  spotName: null,
  position: 0,
  duration: 0,
  error: null,

  setState: (s) => set({ state: s }),
  setTrack: (url, name) => set({ currentUrl: url, spotName: name, position: 0, duration: 0 }),
  setPosition: (pos) => set({ position: pos }),
  setDuration: (dur) => set({ duration: dur }),
  setError: (err) => set({ error: err, state: err ? 'error' : 'idle' }),
  reset: () => set({
    state: 'idle',
    currentUrl: null,
    spotName: null,
    position: 0,
    duration: 0,
    error: null,
  }),
}));
