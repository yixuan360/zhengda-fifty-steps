/**
 * 类型定义 — 前后端统一接口契约
 * 对齐 v4.0 §7
 */

/** 坐标点（GCJ-02，全链路统一坐标系） */
export interface LatLng {
  lat: number;
  lng: number;
}

/** API 统一响应格式 */
export interface ApiResponse<T> {
  ok: boolean;
  data: T;
  message: string;
}

/** 景点数据 */
export interface Spot {
  id: number;
  name: string;
  lat: number;
  lng: number;
  triggerRadius: number;
  summary: string;
  description: string;
  imageUrl: string;
  audioUrl: string;
  isActive: boolean;
  updatedAt: number;   // 毫秒 Unix 时间戳
}

/** 景点列表响应 */
export interface SpotListData {
  spots: Spot[];
  totalCount: number;
}

/** 用户信息 */
export interface UserInfo {
  id: number;
  username: string;
  nickname: string;
  avatarUrl: string;
}

/** 登录响应 */
export interface AuthData {
  access: string;
  refresh: string;
  user: UserInfo;
}

/** 播放状态 */
export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

/** 命中景点（导览引擎触发结果） */
export interface HitSpot {
  spot: Spot;
  distance: number;      // 距离（米）
  hitAt: number;         // 命中时间戳
}

/** 全局配置 key-value */
export type GlobalConfig = Record<string, unknown>;
