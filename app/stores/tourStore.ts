/**
 * 导览状态 — Zustand Store
 */
import { create } from 'zustand';
import type { Spot, HitSpot, CategoryInfo, AccuracyLevel } from '../types';

/** 触发日志条目（调试面板用，最多保留 RECENT_LIMIT 条） */
export interface TriggerLogEntry {
  spotName: string;
  at: number;
}

const RECENT_LIMIT = 10;

interface TourState {
  currentHit: HitSpot | null;
  queue: HitSpot[];
  cooldowns: Record<number, number>;
  spots: Spot[];
  isSyncing: boolean;
  syncStatus: 'idle' | 'syncing' | 'done' | 'error';
  syncError: string | null;
  userLocation: { lat: number; lng: number } | null;
  /** 实测精度（米）；无定位时为 null */
  accuracy: number | null;
  /** 精度档位（good ≤30 / fair 30~50 / poor >50）；无定位时为 null */
  accuracyLevel: AccuracyLevel | null;
  isAccuracyGood: boolean;
  mockLocation: { lat: number; lng: number } | null;
  newSpotHint: string | null;
  categories: CategoryInfo[];
  triggerLog: TriggerLogEntry[];

  setCurrentHit: (hit: HitSpot | null) => void;
  enqueue: (hit: HitSpot) => void;
  dequeue: () => HitSpot | undefined;
  clearQueue: () => void;
  setCooldown: (spotId: number) => void;
  isInCooldown: (spotId: number) => boolean;
  setSpots: (spots: Spot[]) => void;
  setIsSyncing: (v: boolean) => void;
  setSyncStatus: (status: TourState['syncStatus']) => void;
  setSyncError: (err: string | null) => void;
  setUserLocation: (loc: { lat: number; lng: number } | null) => void;
  /** 更新定位精度：accuracy + 档位 + 是否可触发（滞回由调用方算好后传入） */
  setAccuracy: (accuracy: number | null, level: AccuracyLevel | null, isGood: boolean) => void;
  setMockLocation: (loc: { lat: number; lng: number } | null) => void;
  setNewSpotHint: (hint: string | null) => void;
  switchToNext: () => HitSpot | undefined;
  setCategories: (cats: CategoryInfo[]) => void;
  logTrigger: (spotName: string) => void;
}

export const useTourStore = create<TourState>((set, get) => ({
  currentHit: null,
  queue: [],
  cooldowns: {},
  spots: [],
  isSyncing: false,
  syncStatus: 'idle',
  syncError: null,
  userLocation: null,
  accuracy: null,
  accuracyLevel: null,
  isAccuracyGood: false,
  mockLocation: null,
  newSpotHint: null,
  categories: [],
  triggerLog: [],

  setCurrentHit: (hit) => set({ currentHit: hit }),
  enqueue: (hit) => set((s) => ({ queue: [...s.queue, hit] })),
  dequeue: () => {
    const { queue } = get();
    if (queue.length === 0) return undefined;
    const [next, ...rest] = queue;
    set({ queue: rest });
    return next;
  },
  clearQueue: () => set({ queue: [] }),
  setCooldown: (spotId) =>
    set((s) => ({ cooldowns: { ...s.cooldowns, [spotId]: Date.now() + 60_000 } })),
  isInCooldown: (spotId) => {
    const until = get().cooldowns[spotId];
    return until != null && Date.now() < until;
  },
  setSpots: (spots) => set({ spots }),
  setIsSyncing: (v) => set({ isSyncing: v }),
  setSyncStatus: (status) => set({ syncStatus: status }),
  setSyncError: (err) => set({ syncError: err }),
  setUserLocation: (loc) => set({ userLocation: loc }),
  setAccuracy: (accuracy, accuracyLevel, isGood) =>
    set({ accuracy, accuracyLevel, isAccuracyGood: isGood }),
  setMockLocation: (loc) => set({ mockLocation: loc }),
  setNewSpotHint: (hint) => set({ newSpotHint: hint }),
  switchToNext: () => {
    const { queue } = get();
    if (queue.length === 0) return undefined;
    const [next, ...rest] = queue;
    set({ queue: rest });
    return next;
  },
  setCategories: (cats) => set({ categories: cats }),
  logTrigger: (spotName) =>
    set((s) => ({
      triggerLog: [...s.triggerLog, { spotName, at: Date.now() }].slice(-RECENT_LIMIT),
    })),
}));
