/**
 * V3 路线 — Django 路线目录 + Agent 规划/调整调用
 * 任何非 2xx、超时、配置缺失都 throw，由页面决定降级。
 */
import type {
  RouteAdaptAction,
  RouteAdaptation,
  RouteDetail,
  RouteEvent,
  RoutePlan,
  RouteSummary,
} from '../types/routes';
import {
  buildRouteAdaptUrl,
  buildRouteAudioUrl,
  buildRouteCatalogUrl,
  buildRouteDetailUrl,
  buildRouteLogUrl,
  buildRoutePlanUrl,
} from '../utils/routes';

const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'
).replace(/\/+$/, '');
const AGENT_BASE_URL = (
  process.env.EXPO_PUBLIC_AGENT_BASE_URL ?? ''
).replace(/\/+$/, '');
const DEFAULT_TIMEOUT_MS = 12_000;

export interface RoutePlanResult extends RoutePlan {
  latency_ms: number;
}

export interface RouteAdaptResult extends RouteAdaptation {
  latency_ms: number;
}

function parseLatency(response: Response, header: string): number {
  const value = Number(response.headers.get(header) ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ data: T; response: Response }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as T;
    return { data, response };
  } finally {
    clearTimeout(timer);
  }
}

/** GET /api/v2/narrative/routes/ */
export async function fetchRouteCatalog(): Promise<RouteSummary[]> {
  const { data } = await fetchJson<{
    ok: boolean;
    data?: RouteSummary[];
    message?: string;
  }>(buildRouteCatalogUrl(API_BASE_URL), { method: 'GET' }, 10_000);
  if (!data.ok) throw new Error(data.message ?? '路线目录查询失败');
  return data.data ?? [];
}

/** GET /api/v2/narrative/routes/<code>/ */
export async function fetchRouteDetail(code: string): Promise<RouteDetail> {
  const { data } = await fetchJson<{
    ok: boolean;
    data?: RouteDetail;
    message?: string;
  }>(buildRouteDetailUrl(API_BASE_URL, code), { method: 'GET' }, 10_000);
  if (!data.ok || !data.data) {
    throw new Error(data.message ?? '路线暂未上线');
  }
  return data.data;
}

/** POST /narrative/route */
export async function planRoute(
  minutes: number,
  interests: string[],
  startSpotId: number | null = null,
  context: Record<string, unknown> = {},
): Promise<RoutePlanResult> {
  if (!AGENT_BASE_URL) throw new Error('EXPO_PUBLIC_AGENT_BASE_URL 未配置');

  const { data, response } = await fetchJson<RoutePlan>(
    buildRoutePlanUrl(AGENT_BASE_URL),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        minutes,
        interests,
        start_spot_id: startSpotId,
        context,
      }),
    },
    20_000,
  );
  return {
    ...data,
    latency_ms: parseLatency(response, 'X-Route-Latency-Ms'),
  };
}

/** POST /narrative/route/adapt */
export async function adaptRoute(
  routeCode: string,
  currentOrder: number,
  action: RouteAdaptAction,
  currentStops: number[],
  context: Record<string, unknown> = {},
): Promise<RouteAdaptResult> {
  if (!AGENT_BASE_URL) throw new Error('EXPO_PUBLIC_AGENT_BASE_URL 未配置');

  const { data, response } = await fetchJson<RouteAdaptation>(
    buildRouteAdaptUrl(AGENT_BASE_URL),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        route_code: routeCode,
        current_order: currentOrder,
        action,
        current_stops: currentStops,
        context,
      }),
    },
    12_000,
  );
  return {
    ...data,
    latency_ms: parseLatency(response, 'X-Route-Latency-Ms'),
  };
}

/** 路线文案 audio_url（/media/...）→ 可播放绝对 URL */
export function resolveRouteAudioUrl(audioUrl: string): string {
  return buildRouteAudioUrl(API_BASE_URL, audioUrl);
}

/** POST /api/v2/narrative/routes/log/ — 失败静默。 */
export async function reportRouteEvent(
  routeCode: string,
  event: RouteEvent,
  spotId: number | null = null,
  payload: Record<string, unknown> = {},
  latencyMs = 0,
): Promise<void> {
  try {
    await fetchJson<unknown>(
      buildRouteLogUrl(API_BASE_URL),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          route_code: routeCode,
          event,
          spot_id: spotId,
          payload,
          latency_ms: latencyMs,
        }),
      },
      8_000,
    );
  } catch {
    // 度量失败不影响体验
  }
}
