/**
 * 文脉叙事 — Agent 服务 / Django 维度接口调用
 * 任何非 2xx、超时、配置缺失都直接 throw，由 UI 降级。
 */
import type {
  NarrativeDimension,
  NarrativeDimensionCount,
  NarrativeNext,
} from '../types/narrative';
import {
  buildAudioUrl,
  buildDimensionsUrl,
  buildNarrativeUrl,
} from '../utils/narrative';

const AGENT_BASE_URL = (process.env.EXPO_PUBLIC_AGENT_BASE_URL ?? '').replace(/\/+$/, '');
const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000').replace(/\/+$/, '');
const TIMEOUT_MS = 15_000;

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** POST /narrative/next */
export async function fetchNext(
  spotId: number,
  dimension: NarrativeDimension,
  currentDepth: number,
  listenedIds: number[],
): Promise<NarrativeNext> {
  if (!AGENT_BASE_URL) throw new Error('EXPO_PUBLIC_AGENT_BASE_URL 未配置');

  return fetchJson<NarrativeNext>(buildNarrativeUrl(AGENT_BASE_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      spot_id: spotId,
      dimension,
      current_depth: currentDepth,
      listened_fact_ids: listenedIds,
      max_seconds: 60,
    }),
  });
}

/** GET /api/v2/narrative/dimensions/?spot_id=N */
export async function fetchDimensions(
  spotId: number,
): Promise<NarrativeDimensionCount[]> {
  if (!API_BASE_URL) throw new Error('EXPO_PUBLIC_API_BASE_URL 未配置');

  const payload = await fetchJson<{
    ok: boolean;
    data?: NarrativeDimensionCount[];
  }>(
    buildDimensionsUrl(API_BASE_URL, spotId),
    { method: 'GET' },
    10_000,
  );

  if (!payload.ok) throw new Error('维度查询失败');
  return payload.data ?? [];
}

/** Agent 返回的 /narrative-media/xxx.mp3 → 可播放的绝对 URL */
export function resolveNarrativeAudioUrl(audioUrl: string): string {
  return buildAudioUrl(AGENT_BASE_URL, audioUrl);
}
