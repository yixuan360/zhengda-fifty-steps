/**
 * 点到折线匹配 — 轻量化地图匹配（校园场景，不做导航级 HMM/卡尔曼）
 * GPS点 → 最近 line segment → 投影/走向/沿程进度
 */
import { pointToLineDistance } from '@turf/point-to-line-distance';
import { haversineDistance, bearing, angleDiff } from '../distance';
import type { LatLng } from '../../types';

export interface PathMatchResult {
  corridorId: string;      // 关联 spot.pathId（业务主键）
  distance: number;        // 点到折线最短距离（米）
  progress: number;        // alongDistance / totalLength ∈ [0,1]
  heading: number | null;  // 用户移动方向（方位角），无效时为 null
  tangentBearing: number;  // 最近线段的走向（方位角）
  angleDeg: number;        // heading 与 tangentBearing 夹角，归一到 [0,180]
  projected: LatLng;       // 投影点
  segmentIndex: number;    // 命中的折线段下标
  alongDistance: number;   // 投影点沿折线的累计距离（米，自折线起点）
  totalLength: number;     // 折线总长（米）
}

function toTurfPos(p: LatLng): [number, number] {
  return [p.lng, p.lat];
}

function segLen(a: LatLng, b: LatLng): number {
  return haversineDistance(a, b);
}

/** 点到线段的最近点（平面投影，校园尺度误差可忽略） */
function closestPointOnSegment(p: LatLng, a: LatLng, b: LatLng): LatLng {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const denom = dx * dx + dy * dy || 1;
  let t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / denom;
  t = Math.max(0, Math.min(1, t));
  return { lat: a.lat + t * dy, lng: a.lng + t * dx };
}

/** 匹配用户位置到折线（要求 points.length ≥ 2，调用方需先校验） */
export function matchToPath(
  userLoc: LatLng,
  heading: number | null,
  points: LatLng[],
  corridorId: string,
): PathMatchResult {
  let minD = Infinity;
  let segmentIndex = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const d = pointToLineDistance(
      toTurfPos(userLoc),
      { type: 'LineString', coordinates: [toTurfPos(points[i]), toTurfPos(points[i + 1])] },
      { units: 'meters' },
    );
    if (d < minD) { minD = d; segmentIndex = i; }
  }

  const segA = points[segmentIndex];
  const segB = points[segmentIndex + 1];
  const projected = closestPointOnSegment(userLoc, segA, segB);
  const tangentBearing = bearing(segA, segB);

  let totalLength = 0;
  for (let i = 0; i < points.length - 1; i++) totalLength += segLen(points[i], points[i + 1]);

  let alongDistance = 0;
  for (let i = 0; i < segmentIndex; i++) alongDistance += segLen(points[i], points[i + 1]);
  alongDistance += segLen(segA, projected);

  return {
    corridorId,
    distance: minD,
    progress: totalLength > 0 ? alongDistance / totalLength : 0,
    heading,
    tangentBearing,
    angleDeg: heading == null ? 0 : angleDiff(heading, tangentBearing),
    projected,
    segmentIndex,
    alongDistance,
    totalLength,
  };
}

/**
 * 从位置历史计算移动航向：从最新点向前扫描，取第一个间距 ≥ minSpanMeters 的历史点，
 * 以两点方位角为移动方向。窗口内移动不足 → bearingDeg=null（方向 unknown）。
 */
export function computeMovement(
  history: LatLng[],
  minSpanMeters: number,
): { bearingDeg: number | null; segmentMeters: number | null } {
  if (history.length < 2) return { bearingDeg: null, segmentMeters: null };
  const latest = history[history.length - 1];
  for (let i = history.length - 2; i >= 0; i--) {
    const d = haversineDistance(history[i], latest);
    if (d >= minSpanMeters) {
      return { bearingDeg: bearing(history[i], latest), segmentMeters: d };
    }
  }
  return { bearingDeg: null, segmentMeters: null };
}
