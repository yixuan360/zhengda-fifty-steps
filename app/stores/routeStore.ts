/**
 * V3 路线 — 规划结果跨页面共享（规划页 → 走线页）
 */
import { create } from 'zustand';
import type { RouteDetail, RoutePlan } from '../types/routes';

interface RouteState {
  plan: RoutePlan | null;
  detail: RouteDetail | null;
  /** 降级/调整等一次性提示，进入走线页后展示 */
  notice: string | null;
  setRoute: (
    plan: RoutePlan,
    detail: RouteDetail,
    notice?: string | null,
  ) => void;
  updatePlan: (plan: RoutePlan) => void;
  setNotice: (notice: string | null) => void;
  clear: () => void;
}

export const useRouteStore = create<RouteState>((set) => ({
  plan: null,
  detail: null,
  notice: null,
  setRoute: (plan, detail, notice = null) => set({ plan, detail, notice }),
  updatePlan: (plan) => set({ plan }),
  setNotice: (notice) => set({ notice }),
  clear: () => set({ plan: null, detail: null, notice: null }),
}));
