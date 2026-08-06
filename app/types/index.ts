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

/** 触发区域几何配置（GCJ-02 全链路统一坐标系） */
export interface Trigger {
  /** 缺省为 circle：圆心 + triggerRadius（存量行为不变） */
  type: 'circle' | 'corridor' | 'polygon';
  /** corridor 半宽（米），缺省 15 */
  halfWidth?: number;
  /** corridor 折线 / polygon 顶点（按顺序连接；polygon 自动闭合） */
  points?: LatLng[];
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
  category?: string;  // 'college'|'nature'|'architecture'|'teaching'|'service'|'humanity'
  /** 触发区域形状；缺省 = circle（lat/lng + triggerRadius） */
  trigger?: Trigger;
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

/**
 * 定位精度档位（三档分级）
 * good ≤ 30m：正常触发，无提示
 * fair 30~50m：可触发，横幅提示
 * poor > 50m：暂停触发，横幅提示
 */
export type AccuracyLevel = 'good' | 'fair' | 'poor';

/** 命中景点（导览引擎触发结果） */
export interface HitSpot {
  spot: Spot;
  distance: number;      // 距离（米）
  hitAt: number;         // 命中时间戳
}

/** 全局配置 key-value */
export type GlobalConfig = Record<string, unknown>;

/** 版本检查 */
export interface VersionData {
  versionCode: number;
  downloadUrl: string;
}

/** 景点分类 */
export interface CategoryInfo {
  key: string;
  label: string;
  color: string;
  sortOrder: number;
}

export interface CategoryListData {
  categories: CategoryInfo[];
}

export interface PingData {
  todayDevices: number;
  weekDevices: number;
}
