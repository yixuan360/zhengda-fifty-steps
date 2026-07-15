/**
 * 导览状态 — Zustand Store
 * v4.0 §6.1：useTour 导览引擎状态管理
 */
import { create } from 'zustand';
import type { Spot, HitSpot } from '../types';

interface TourState {
  /** 当前已命中（待播放/播放中）的景点 */
  currentHit: HitSpot | null;
  /** 播放队列（多个景点同时命中时排队） */
  queue: HitSpot[];
  /** 冷却中的景点 ID 集合（key: spotId, value: 冷却到期时间戳） */
  cooldowns: Record<number, number>;
  /** 所有景点数据（内存缓存，启动同步时写入） */
  spots: Spot[];
  /** 同步状态 */
  isSyncing: boolean;
  /** 用户位置（GCJ-02） */
  userLocation: { lat: number; lng: number } | null;
  /** 定位精度是否足够 */
  isAccuracyGood: boolean;
  /** 播放中命中新景点的弱提示文本，AudioBar 消费后清空 */
  newSpotHint: string | null;

  // Actions
  setCurrentHit: (hit: HitSpot | null) => void;
  enqueue: (hit: HitSpot) => void;
  dequeue: () => HitSpot | undefined;
  setCooldown: (spotId: number) => void;
  isInCooldown: (spotId: number) => boolean;
  setSpots: (spots: Spot[]) => void;
  setIsSyncing: (v: boolean) => void;
  setUserLocation: (loc: { lat: number; lng: number } | null) => void;
  setIsAccuracyGood: (v: boolean) => void;
  setNewSpotHint: (hint: string | null) => void;
}

export const useTourStore = create<TourState>((set, get) => ({
  currentHit: null,
  queue: [],
  cooldowns: {},
  spots: [],
  isSyncing: false,
  userLocation: null,
  isAccuracyGood: false,
  newSpotHint: null,

  setCurrentHit: (hit) => set({ currentHit: hit }),

  enqueue: (hit) => set((s) => ({ queue: [...s.queue, hit] })),

  dequeue: () => {
    const { queue } = get();
    if (queue.length === 0) return undefined;
    const [next, ...rest] = queue;
    set({ queue: rest });
    return next;
  },

  setCooldown: (spotId) =>
    set((s) => ({
      cooldowns: { ...s.cooldowns, [spotId]: Date.now() + 60_000 },
    })),

  isInCooldown: (spotId) => {
    const until = get().cooldowns[spotId];
    return until != null && Date.now() < until;
  },

  setSpots: (spots) => set({ spots }),
  setIsSyncing: (v) => set({ isSyncing: v }),
  setUserLocation: (loc) => set({ userLocation: loc }),
  setIsAccuracyGood: (v) => set({ isAccuracyGood: v }),
  setNewSpotHint: (hint) => set({ newSpotHint: hint }),
}));
