/**
 * Axios 实例 + 拦截器 + Token 注入
 * v4.0 §7.1 — 统一请求/响应处理
 */
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/authStore';
import type { ApiResponse, SpotListData, GlobalConfig, AuthData, VersionData, PingData, CategoryListData } from '../types';

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// ─── 请求拦截器：注入 Token ──────────────────────────
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ─── 响应拦截器：401 自动刷新 ────────────────────────
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach((p) => {
    if (token) p.resolve(token);
    else p.reject(error);
  });
  failedQueue = [];
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (!originalRequest || originalRequest._retry) return Promise.reject(error);

    // 不是 401 或是在 refresh 接口自身失败 → 直接抛
    if (error.response?.status !== 401 || originalRequest.url?.includes('auth/refresh')) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      // 等待正在进行的刷新
      return new Promise((resolve, reject) => {
        failedQueue.push({
          resolve: (token: string) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(api(originalRequest));
          },
          reject,
        });
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const refreshToken = useAuthStore.getState().refreshToken;
      if (!refreshToken) throw new Error('no refresh token');

      const res = await axios.post(`${BASE_URL}/api/v1/auth/refresh/`, { refresh: refreshToken });
      const newAccess: string = res.data.data.access;
      useAuthStore.getState().setTokens(newAccess, refreshToken);
      processQueue(null, newAccess);

      originalRequest.headers.Authorization = `Bearer ${newAccess}`;
      return api(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError, null);
      useAuthStore.getState().logout();
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);

// ─── 业务 API ────────────────────────────────────────

/** 全量拉取景点 */
export async function fetchSpots(): Promise<ApiResponse<SpotListData>> {
  const { data } = await api.get<ApiResponse<SpotListData>>('/api/v1/spots/');
  return data;
}

/** 拉取全局配置 */
export async function fetchConfig(): Promise<ApiResponse<GlobalConfig>> {
  const { data } = await api.get<ApiResponse<GlobalConfig>>('/api/v1/config/');
  return data;
}

/** 微信登录 */
export async function wechatLogin(code: string): Promise<ApiResponse<AuthData>> {
  const { data } = await api.post<ApiResponse<AuthData>>('/api/v1/auth/wechat-login/', { code });
  return data;
}

/** 检查 App 版本 */
export async function fetchVersion(): Promise<ApiResponse<VersionData>> {
  const { data } = await api.get<ApiResponse<VersionData>>('/api/v1/config/version/');
  return data;
}

/** 匿名设备心跳 */
export async function sendPing(deviceId: string, version: string): Promise<ApiResponse<PingData>> {
  const { data } = await api.post<ApiResponse<PingData>>('/api/v1/config/ping/', { deviceId, version });
  return data;
}

/** 拉取景点分类 */
export async function fetchCategories(): Promise<ApiResponse<CategoryListData>> {
  const { data } = await api.get<ApiResponse<CategoryListData>>('/api/v1/config/categories/');
  return data;
}

export default api;
