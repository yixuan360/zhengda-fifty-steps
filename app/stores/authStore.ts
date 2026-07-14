/**
 * 认证状态 — Zustand Store
 * v4.0 §9：微信登录 + Token 管理
 */
import { create } from 'zustand';
import type { UserInfo } from '../types';

interface AuthState {
  /** JWT Access Token */
  accessToken: string | null;
  /** JWT Refresh Token */
  refreshToken: string | null;
  /** 当前用户信息 */
  user: UserInfo | null;
  /** 是否已登录 */
  isLoggedIn: boolean;

  // Actions
  setTokens: (access: string, refresh: string) => void;
  setUser: (user: UserInfo) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: null,
  user: null,
  isLoggedIn: false,

  setTokens: (access, refresh) =>
    set({ accessToken: access, refreshToken: refresh, isLoggedIn: true }),

  setUser: (user) => set({ user }),

  logout: () =>
    set({
      accessToken: null,
      refreshToken: null,
      user: null,
      isLoggedIn: false,
    }),
}));
