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

/** Agent 响应 + 延迟头（额外字段，不改变 NarrativeNext 契约） */
export interface NarrativeNextResult extends NarrativeNext {
  latency_ms: number;
}

function buildLogUrl(): string {
  return `${API_BASE_URL}/api/v2/narrative/log/`;
}

function parseLatency(response: Response): number {
  const value = Number(response.headers.get('X-Narrative-Latency-Ms') ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

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
): Promise<NarrativeNextResult> {
  if (!AGENT_BASE_URL) throw new Error('EXPO_PUBLIC_AGENT_BASE_URL 未配置');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(buildNarrativeUrl(AGENT_BASE_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spot_id: spotId,
        dimension,
        current_depth: currentDepth,
        listened_fact_ids: listenedIds,
        max_seconds: 60,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as NarrativeNext;
    return { ...data, latency_ms: parseLatency(response) };
  } finally {
    clearTimeout(timer);
  }
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

/**
 * 播放结束 / 组件卸载时上报生成结果。
 * 使用现有 Django API 域名（不是 Agent 服务）；失败静默。
 */
export async function reportNarrative(
  result: NarrativeNextResult,
  spotId: number,
  dimension: NarrativeDimension,
  depth: number,
  listenedIds: number[],
): Promise<void> {
  if (!API_BASE_URL) return;

  try {
    await fetchJson<unknown>(
      buildLogUrl(),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spot_id: spotId,
          dimension,
          depth,
          request_params: {
            listened_fact_ids: listenedIds,
            max_seconds: 60,
          },
          fact_ids: result.citations.map((citation) => citation.fact_id),
          output_text: result.text,
          validation_passed: !result.fallback,
          fallback: result.fallback,
          latency_ms: result.latency_ms,
        }),
      },
      10_000,
    );
  } catch {
    // 度量上报失败不影响用户播放
  }
}
