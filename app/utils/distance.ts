/**
 * Haversine 距离计算
 * v4.0 §6.1 — useTour 导览引擎核心工具
 * 输入两对 (lat, lng)，返回米级距离
 */
import type { LatLng } from '../types';

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Haversine 公式：计算两点间球面距离
 * @returns 距离（米）
 */
export function haversineDistance(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const haversine =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;

  const c = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

  return EARTH_RADIUS_M * c;
}

/**
 * 两点初始方位角（度，0=北，顺时针，范围 [0,360)）
 * 用于 mapMatcher 计算折线走向与移动方向
 */
export function bearing(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** 两个方位角的夹角（度），归一到 [0,180] */
export function angleDiff(aDeg: number, bDeg: number): number {
  const d = Math.abs(aDeg - bDeg) % 360;
  return d > 180 ? 360 - d : d;
}
