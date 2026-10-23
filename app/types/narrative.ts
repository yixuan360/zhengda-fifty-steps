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

// ── V2 比赛版：按“景点 × 分类”的深度稿 ─────────────────

export type NarrativeCategory =
  | 'architecture'
  | 'history'
  | 'academy'
  | 'nature'
  | 'activity';

/** GET /api/v2/narrative/categories/ 的单项 */
export interface NarrativeCategoryCount {
  category: NarrativeCategory;
  label: string;
  approved_count: number;
}

export interface DeepContentSource {
  title: string;
  url: string;
  /** verified / secondary / unverified / ... */
  status: string;
}

export interface DeepContentFactNote {
  claim: string;
  status: string;
  note: string;
}

/** GET /api/v2/narrative/deep/ 的 data */
export interface DeepContent {
  id: number;
  spot_id: number;
  category: NarrativeCategory;
  title: string;
  body: string;
  sources: DeepContentSource[];
  fact_notes: DeepContentFactNote[];
  audio_url: string | null;
  version: number;
  updated_at: string;
}

export type DeepContentEvent = 'view' | 'play' | 'complete' | 'fallback';
