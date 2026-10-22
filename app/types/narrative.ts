/**
 * 文脉叙事引擎 — App 端类型（与 Agent 服务 HTTP 契约一致）
 */

export type NarrativeDimension = 'nature' | 'architecture' | 'academy' | 'history';

export interface NarrativeCitation {
  fact_id: number;
  fact_text: string;
}

export interface NarrativeNext {
  text: string;
  citations: NarrativeCitation[];
  depth: number;
  audio_url: string | null;
  fallback: boolean;
}

/** GET /api/v2/narrative/dimensions/ 的单项 */
export interface NarrativeDimensionCount {
  dimension: NarrativeDimension;
  approved_count: number;
}
