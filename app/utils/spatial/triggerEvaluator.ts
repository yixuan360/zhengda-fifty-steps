/**
 * 空间语义触发评估 — 三级判定（spec §5.4）
 * 一级 空间命中（d ≤ 0，必要条件）→ 二级 轨迹确认（连续样本，调用方用 nextConfirmCount）→ 三级 方向置信度
 * 方向是权重不是门槛：conflict 只把 confidence 降到 0.4，不丢命中。
 */
import { getTriggerSignedDistance } from '../trigger';
import { matchToPath } from './mapMatcher';
import type { LatLng, Spot, Trigger, TriggerReason, DirectionState } from '../../types';

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;   // 业务播放阈值（spec：useTour 阈值层）
export const DEFAULT_DIRECTION_TOLERANCE_DEG = 60; // 方向一致夹角容差（缺省 60°）
export const DEFAULT_MIN_MOVEMENT_DISTANCE = 8;    // 计算方向所需最小移动距离（米）
export const DEFAULT_PATH_CONFIRM_SAMPLES = 2;     // 连续空间命中样本数（轨迹确认）

export interface MovementInfo {
  bearingDeg: number | null;      // 移动方向（方位角），无有效航向为 null
  segmentMeters: number | null;   // 计算该方向的移动段长度
}

export interface SpatialHit {
  spot: Spot;
  distance: number;        // 复用现有标量 d
  reason: TriggerReason;
  confidence: number;      // 0~1（三级判定输出）
  matchedPathId?: string;  // 命中 corridor 时的 pathId
  directionDeg?: number;   // 实测移动方向与折线切向夹角
  directionState?: DirectionState;
}

/** 连续命中计数：本次空间命中则 +1，否则清零（spec §5.4 二级） */
export function nextConfirmCount(prev: number, spaceMatched: boolean): number {
  return spaceMatched ? prev + 1 : 0;
}

/**
 * trigger 结构校验 + 兜底清洗：非法返回 undefined（调用方按圆形退化）。
 * 与旧 parseTrigger 逻辑对齐，并扩展新字段校验。
 */
export function sanitizeTrigger(raw: unknown): Spot['trigger'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const t = raw as Record<string, unknown>;
  if (
    typeof t.type !== 'string' ||
    !['circle', 'corridor', 'polygon'].includes(t.type)
  ) {
    return undefined;
  }
  if (t.type !== 'circle') {
    if (
      !Array.isArray(t.points) ||
      t.points.length === 0 ||
      !(t.points as unknown[]).every(
        (p) => !!p && typeof (p as LatLng).lat === 'number' && typeof (p as LatLng).lng === 'number',
      )
    ) {
      return undefined;
    }
  }
  if (
    t.directionToleranceDeg !== undefined &&
    (typeof t.directionToleranceDeg !== 'number' ||
      t.directionToleranceDeg < 0 ||
      t.directionToleranceDeg > 180)
  ) {
    return undefined;
  }
  if (
    t.minMovementDistance !== undefined &&
    (typeof t.minMovementDistance !== 'number' || t.minMovementDistance <= 0)
  ) {
    return undefined;
  }
  return raw as Spot['trigger'];
}

/**
 * 评估单个景点的空间语义触发。
 * @returns 空间命中返回 SpatialHit（含置信度）；d > 0（空间未命中）返回 null。
 */
export function evaluateSpatialTrigger(
  userLoc: LatLng,
  movement: MovementInfo | null,
  spot: Spot,
): SpatialHit | null {
  const trigger: Trigger | undefined = spot.trigger;
  const d = getTriggerSignedDistance(userLoc, spot);
  if (d > 0) return null;

  if (!trigger || trigger.type === 'circle') {
    return { spot, distance: d, reason: 'inside_radius', confidence: 1 };
  }
  if (trigger.type === 'polygon') {
    return { spot, distance: d, reason: 'inside_polygon', confidence: 1 };
  }

  // corridor
  const points = Array.isArray(trigger.points) ? trigger.points : [];
  if (points.length < 2) {
    return { spot, distance: d, reason: 'fallback_circle', confidence: 1 }; // 脏数据退化圆
  }
  const matchedPathId = trigger.pathId;
  if (!trigger.directionCheck) {
    return { spot, distance: d, reason: 'matched_path', confidence: 1, matchedPathId };
  }

  const result = matchToPath(userLoc, movement?.bearingDeg ?? null, points, matchedPathId ?? '');
  const tolerance = trigger.directionToleranceDeg ?? DEFAULT_DIRECTION_TOLERANCE_DEG;
  const minMove = trigger.minMovementDistance ?? DEFAULT_MIN_MOVEMENT_DISTANCE;
  const headingOk =
    movement != null &&
    movement.bearingDeg != null &&
    movement.segmentMeters != null &&
    movement.segmentMeters >= minMove;

  let directionState: DirectionState;
  let confidence: number;
  if (headingOk) {
    directionState = result.angleDeg <= tolerance ? 'aligned' : 'conflict';
    confidence = directionState === 'aligned' ? 0.9 : 0.4;
  } else {
    // 方向未分辨（静止/抖动/样本不足）→ pending 语义：
    // 置信度 0 低于阈值，不直接可播。调用方（useTour）在连续空间命中计数
    // 窗口内等待轨迹分辨——后续样本变 aligned(0.9) 即播，一直 unknown 则不播。
    // （修正前 unknown=0.7 恰等于阈值，导致停留用户每 60s 冷却后循环播）
    directionState = 'unknown';
    confidence = 0;
  }

  return {
    spot,
    distance: d,
    reason: 'matched_path',
    confidence,
    matchedPathId,
    directionDeg: result.angleDeg,
    directionState,
  };
}
