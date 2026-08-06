/**
 * 触发区域几何判定 — 统一有符号距离（v4.1）
 *
 * 三种形状归一为一个标量 d：
 *   d < 0  用户在区域内（越小越深入）
 *   d >= 0 用户在区域外（越大越远）
 *
 * 这样 useTour 的门控、滞回、最近排序、冷却、队列逻辑只需这一个标量，
 * 不需要感知几何类型。圆形与旧逻辑逐字节等价：
 *   d = haversine(用户, 圆心) - triggerRadius
 *   → 旧"进入 dist<=radius" ⇔ d<=0；旧"离开 dist>radius+20" ⇔ d>20
 *
 * 几何库用 turf 颗粒包（纯 JS，RN 可用）：
 *   booleanPointInPolygon    点在多边形内（默认边界算内，进围栏即触发）
 *   pointToLineDistance      点到折线最短距离（geodesic 球面，多段原生支持）
 * turf 使用 [lng, lat]，项目统一 {lat, lng}，入口处转换。
 */
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { pointToLineDistance } from '@turf/point-to-line-distance';
import { haversineDistance } from './distance';
import type { LatLng, Spot } from '../types';

/** corridor 默认半宽（米）。贴楼走 GPS 漂移 10~20m 常见，宁可边界少触发。 */
const DEFAULT_HALF_WIDTH = 15;

/** 兜底：数据异常的 corridor/polygon 退化为圆形，保证不崩且行为可预期 */
function fallbackCircle(userLoc: LatLng, spot: Spot): number {
  return haversineDistance(userLoc, { lat: spot.lat, lng: spot.lng }) - spot.triggerRadius;
}

function toTurfPos(p: LatLng): [number, number] {
  return [p.lng, p.lat];
}

/** 点到闭合多边形边界的最短距离（米），内部外部都返回正值 */
function distanceToPolygonEdges(pt: LatLng, points: LatLng[]): number {
  let min = Infinity;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n]; // 闭合环：末点连回首点
    const d = pointToLineDistance(toTurfPos(pt), {
      type: 'LineString',
      coordinates: [toTurfPos(a), toTurfPos(b)],
    }, { units: 'meters' });
    if (d < min) min = d;
  }
  return min;
}

/**
 * 用户到景点触发区域的有符号距离（米）。
 * - circle：   d = 圆心距 - 半径
 * - corridor： d = 到折线最短距离 - halfWidth
 * - polygon：  d = 内部为 -(到最近边距离)，外部为 +(到最近边距离)
 */
export function getTriggerSignedDistance(userLoc: LatLng, spot: Spot): number {
  const trigger = spot.trigger;
  if (!trigger || trigger.type === 'circle') {
    return haversineDistance(userLoc, { lat: spot.lat, lng: spot.lng }) - spot.triggerRadius;
  }

  // 双保险：parseTrigger 已校验结构，但引擎也可能收到未经该校验的 spots（如 API 直传），
  // 脏数据（points 非数组）在 length/map 上会抛错，这里显式兜底为"无点"→ 退化圆。
  const points = Array.isArray(trigger.points) ? trigger.points : [];

  if (trigger.type === 'corridor') {
    if (points.length < 2) return fallbackCircle(userLoc, spot);
    const halfWidth = trigger.halfWidth ?? DEFAULT_HALF_WIDTH;
    const d = pointToLineDistance(toTurfPos(userLoc), {
      type: 'LineString',
      coordinates: points.map(toTurfPos),
    }, { units: 'meters' });
    return d - halfWidth;
  }

  // polygon
  if (points.length < 3) return fallbackCircle(userLoc, spot);
  // turf 的 booleanPointInPolygon 要求 ring 首尾坐标相同，否则内部 point-in-polygon-hao
  // 对开环直接抛异常（且其自身校验有 bug，只差一维时会静默漏掉闭合边）。
  // 数据按"自然多边形"存储（不重复首点），这里统一自动闭合。
  const ring = points.map(toTurfPos);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  const inside = booleanPointInPolygon(toTurfPos(userLoc), {
    type: 'Polygon',
    coordinates: [ring],
  });
  const edgeDist = distanceToPolygonEdges(userLoc, points);
  return inside ? -edgeDist : edgeDist;
}
