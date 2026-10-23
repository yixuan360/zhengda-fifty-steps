/**
 * 文脉叙事 — 纯函数（供 services 与 node 回归脚本共用）
 */
import type {
  NarrativeCategory,
  NarrativeDimension,
  NarrativeNext,
} from '../types/narrative';

function trimTrailingSlash(base: string): string {
  return base.replace(/\/+$/, '');
}

/** Agent 服务：POST {base}/narrative/next */
export function buildNarrativeUrl(base: string): string {
  return `${trimTrailingSlash(base)}/narrative/next`;
}

/** Django API：GET {base}/api/v2/narrative/dimensions/?spot_id=N */
export function buildDimensionsUrl(base: string, spotId: number): string {
  return `${trimTrailingSlash(base)}/api/v2/narrative/dimensions/?spot_id=${encodeURIComponent(String(spotId))}`;
}

/**
 * 音频 URL：Agent 返回相对路径 /narrative-media/xxx.mp3。
 * 生产环境 base 可能是 https://host/agent，此时音频在 host 根路径下。
 */
export function buildAudioUrl(base: string, audioUrl: string): string {
  if (/^https?:\/\//i.test(audioUrl)) return audioUrl;
  const origin = trimTrailingSlash(base).replace(/\/agent$/i, '');
  return `${origin}${audioUrl.startsWith('/') ? '' : '/'}${audioUrl}`;
}

/** 降级分支判断 */
export function shouldFallback(response: Pick<NarrativeNext, 'fallback'>): boolean {
  return response.fallback === true;
}

// ── V2 深度稿 URL ─────────────────────────────────────

/** Django API：GET {base}/api/v2/narrative/categories/?spot_id=N */
export function buildCategoriesUrl(base: string, spotId: number): string {
  return `${trimTrailingSlash(base)}/api/v2/narrative/categories/?spot_id=${encodeURIComponent(String(spotId))}`;
}

/** Django API：GET {base}/api/v2/narrative/deep/?spot_id=N&category=... */
export function buildDeepContentUrl(
  base: string,
  spotId: number,
  category: NarrativeCategory,
): string {
  const params = `spot_id=${encodeURIComponent(String(spotId))}&category=${encodeURIComponent(category)}`;
  return `${trimTrailingSlash(base)}/api/v2/narrative/deep/?${params}`;
}

/** Django API：POST {base}/api/v2/narrative/deep/log/ */
export function buildDeepLogUrl(base: string): string {
  return `${trimTrailingSlash(base)}/api/v2/narrative/deep/log/`;
}

/** 深度稿音频是 Django media 相对路径 /media/...，挂在 API 域名下。 */
export function buildDeepAudioUrl(base: string, audioUrl: string): string {
  if (/^https?:\/\//i.test(audioUrl)) return audioUrl;
  return `${trimTrailingSlash(base)}${audioUrl.startsWith('/') ? '' : '/'}${audioUrl}`;
}

/** 默认分类：优先建筑，其次历史，否则第一个可用分类。 */
export function pickDefaultCategory(
  available: NarrativeCategory[],
): NarrativeCategory | null {
  for (const preferred of ['architecture', 'history'] as NarrativeCategory[]) {
    if (available.includes(preferred)) return preferred;
  }
  return available.length > 0 ? available[0] : null;
}

/** 默认维度：优先 nature，否则取第一个可用维度；无可用维度返回 null */
export function pickDefaultDimension(
  available: NarrativeDimension[],
): NarrativeDimension | null {
  if (available.includes('nature')) return 'nature';
  return available.length > 0 ? available[0] : null;
}
