/**
 * 导览状态 — Zustand Store
 */
import { create } from 'zustand';
import type { Spot, HitSpot, CategoryInfo } from '../types';

interface TourState {
  currentHit: HitSpot | null;
  queue: HitSpot[];
  cooldowns: Record<number, number>;
  spots: Spot[];
  isSyncing: boolean;
  syncStatus: 'idle' | 'syncing' | 'done' | 'error';
  syncError: string | null;
  userLocation: { lat: number; lng: number } | null;
  isAccuracyGood: boolean;
  mockLocation: { lat: number; lng: number } | null;
  newSpotHint: string | null;
  categories: CategoryInfo[];

  setCurrentHit: (hit: HitSpot | null) => void;
  enqueue: (hit: HitSpot) => void;
  dequeue: () => HitSpot | undefined;
  setCooldown: (spotId: number) => void;
  isInCooldown: (spotId: number) => boolean;
  setSpots: (spots: Spot[]) => void;
  setIsSyncing: (v: boolean) => void;
  setSyncStatus: (status: TourState['syncStatus']) => void;
  setSyncError: (err: string | null) => void;
  setUserLocation: (loc: { lat: number; lng: number } | null) => void;
  setIsAccuracyGood: (v: boolean) => void;
  setMockLocation: (loc: { lat: number; lng: number } | null) => void;
  setNewSpotHint: (hint: string | null) => void;
  switchToNext: () => HitSpot | undefined;
  setCategories: (cats: CategoryInfo[]) => void;
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
  isAccuracyGood: false,
  mockLocation: null,
  newSpotHint: null,
  categories: [],

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
  setIsAccuracyGood: (v) => set({ isAccuracyGood: v }),
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
}));
