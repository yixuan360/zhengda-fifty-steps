/**
 * V2 比赛版 — 深度稿 API（Django /api/v2/narrative/...）
 * 与 V1 的 Agent /narrative/next 完全独立；失败由 UI 降级到固定播报。
 */
import type {
  DeepContent,
  DeepContentEvent,
  NarrativeCategory,
  NarrativeCategoryCount,
} from '../types/narrative';
import {
  buildCategoriesUrl,
  buildDeepAudioUrl,
  buildDeepContentUrl,
  buildDeepLogUrl,
} from '../utils/narrative';

const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'
).replace(/\/+$/, '');
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

/** GET /api/v2/narrative/categories/?spot_id=N */
export async function fetchCategories(
  spotId: number,
): Promise<NarrativeCategoryCount[]> {
  const payload = await fetchJson<{
    ok: boolean;
    data?: NarrativeCategoryCount[];
  }>(buildCategoriesUrl(API_BASE_URL, spotId), { method: 'GET' }, 10_000);

  if (!payload.ok) throw new Error('分类查询失败');
  return payload.data ?? [];
}

/** GET /api/v2/narrative/deep/?spot_id=N&category=... */
export async function fetchDeepContent(
  spotId: number,
  category: NarrativeCategory,
): Promise<DeepContent> {
  const payload = await fetchJson<{
    ok: boolean;
    data?: DeepContent;
    message?: string;
  }>(buildDeepContentUrl(API_BASE_URL, spotId, category), { method: 'GET' });

  if (!payload.ok || !payload.data) {
    throw new Error(payload.message ?? '深度稿暂未上线');
  }
  return payload.data;
}

/** Agent 音频是 /narrative-media/...；V2 音频是 Django /media/... */
export function resolveDeepAudioUrl(audioUrl: string): string {
  return buildDeepAudioUrl(API_BASE_URL, audioUrl);
}

/** POST /api/v2/narrative/deep/log/ — 失败静默，不影响播放。 */
export async function reportDeepEvent(
  spotId: number,
  contentId: number | null,
  category: NarrativeCategory | null,
  event: DeepContentEvent,
  latencyMs = 0,
): Promise<void> {
  try {
    await fetchJson<unknown>(
      buildDeepLogUrl(API_BASE_URL),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spot_id: spotId,
          content_id: contentId,
          category: category ?? '',
          event,
          latency_ms: latencyMs,
        }),
      },
      8_000,
    );
  } catch {
    // 日志失败不影响用户体验
  }
}
