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

/** 触发语义原因（解释层，不改播放行为） */
export type TriggerReason =
  | 'inside_radius'   // circle 命中
  | 'inside_polygon'  // polygon 命中
  | 'matched_path'    // corridor 命中（轨迹确认通过）
  | 'fallback_circle'; // 脏数据退化圆命中

/** 方向置信度状态 */
export type DirectionState = 'aligned' | 'conflict' | 'unknown';

/** 触发区域几何配置（GCJ-02 全链路统一坐标系） */
export interface Trigger {
  /** 缺省为 circle：圆心 + triggerRadius（存量行为不变） */
  type: 'circle' | 'corridor' | 'polygon';
  /** corridor 半宽（米），缺省 15，逐对象配置 */
  halfWidth?: number;
  /** corridor 折线 / polygon 顶点（按顺序连接；polygon 自动闭合） */
  points?: LatLng[];
  /** 行为感知（仅 corridor）：开启后按三级判定计算置信度 */
  directionCheck?: boolean;
  /** 方向一致判定夹角容差（度），缺省 60 */
  directionToleranceDeg?: number;
  /** 计算方向所需最小移动距离（米），缺省 8；低于此 → 方向 unknown */
  minMovementDistance?: number;
  /** 关联 Walking Graph 边 ID（可选，供路线故事/调试） */
  pathId?: string;
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
  confidence?: number;       // 0~1（仅行为感知景点）
  reason?: TriggerReason;    // 触发语义
  directionState?: DirectionState;
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
