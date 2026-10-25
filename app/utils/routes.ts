/**
 * V3 路线 — URL 构造纯函数（便于 node 脚本/测试复用）
 */
import { buildDeepAudioUrl } from './narrative';
import type {
  RouteAdaptation,
  RouteDetail,
  RoutePlan,
} from '../types/routes';

function trimTrailingSlash(base: string): string {
  return base.replace(/\/+$/, '');
}

/** Django：GET {base}/api/v2/narrative/routes/ */
export function buildRouteCatalogUrl(base: string): string {
  return `${trimTrailingSlash(base)}/api/v2/narrative/routes/`;
}

/** Django：GET {base}/api/v2/narrative/routes/<code>/ */
export function buildRouteDetailUrl(base: string, code: string): string {
  return `${trimTrailingSlash(base)}/api/v2/narrative/routes/${encodeURIComponent(code)}/`;
}

/** Django：POST {base}/api/v2/narrative/routes/log/ */
export function buildRouteLogUrl(base: string): string {
  return `${trimTrailingSlash(base)}/api/v2/narrative/routes/log/`;
}

/** Agent：POST {base}/narrative/route */
export function buildRoutePlanUrl(base: string): string {
  return `${trimTrailingSlash(base)}/narrative/route`;
}

/** Agent：POST {base}/narrative/route/adapt */
export function buildRouteAdaptUrl(base: string): string {
  return `${trimTrailingSlash(base)}/narrative/route/adapt`;
}

/** 路线/深度稿音频是 Django media 相对路径，挂在 API 域名下。 */
export function buildRouteAudioUrl(base: string, audioUrl: string): string {
  return buildDeepAudioUrl(base, audioUrl);
}

/** 从音频 URL 取文件名，用于判断当前播放的是不是这一段。 */
export function audioKey(audioUrl: string | null): string | null {
  if (!audioUrl) return null;
  const name = audioUrl.split('/').pop();
  return name || null;
}

/**
 * 调整后重建 RoutePlan：Agent 只返回 stops/total_minutes，
 * excluded 与 walking_km 必须由 App 按路线详情重新推导，否则路线卡会自相矛盾。
 */
export function derivePlanAfterAdapt(
  detail: RouteDetail,
  plan: RoutePlan,
  adaptation: RouteAdaptation,
): RoutePlan {
  const chosen = new Set(adaptation.stops);
  const firstOrder = adaptation.stops[0] ?? plan.start_order;
  const excluded = detail.stops
    .filter((stop) => !chosen.has(stop.order))
    .map((stop) => ({
      order: stop.order,
      reason: stop.order < firstOrder
        ? '从当前景点开始'
        : stop.optional
          ? '时间不足，留到下次'
          : '时间不足',
    }));

  const totalStops = detail.stops.length;
  const walkFraction = totalStops > 1
    ? Math.max(0, adaptation.stops.length - 1) / (totalStops - 1)
    : 0;

  return {
    ...plan,
    stops: adaptation.stops,
    excluded,
    total_minutes: adaptation.total_minutes,
    walking_km: Math.round(detail.walking_km * walkFraction * 100) / 100,
    explanation: adaptation.message || adaptation.end_reason || plan.explanation,
    start_order: firstOrder,
  };
}
