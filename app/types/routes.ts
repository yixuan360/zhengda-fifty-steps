/**
 * V3 校园文脉导演 — 路线类型
 * 字段与 Django /api/v2/narrative/routes/、Agent /narrative/route 保持一致。
 */
import type {
  DeepContentFactNote,
  DeepContentSource,
} from './narrative';

export interface RouteStop {
  order: number;
  spot_id: number;
  category: string;
  duration_seconds: number;
  optional: boolean;
  indoor: boolean;
  note: string;
}

export type RouteNarrativeKind = 'intro' | 'transition' | 'outro';

export interface RouteNarrative {
  key: string;
  kind: RouteNarrativeKind;
  from_order: number | null;
  to_order: number | null;
  text: string;
  audio_url: string | null;
  sources: DeepContentSource[];
  fact_notes: DeepContentFactNote[];
  version: number;
  updated_at: string;
}

export interface RouteDetail {
  code: string;
  name: string;
  subtitle: string;
  theme: string;
  total_minutes: number;
  walking_km: number;
  stops: RouteStop[];
  narratives: RouteNarrative[];
}

export interface RouteSummary {
  code: string;
  name: string;
  subtitle: string;
  theme: string;
  total_minutes: number;
  walking_km: number;
  stops_count: number;
  optional_count: number;
}

export interface ExcludedStop {
  order: number;
  reason: string;
}

/** Agent 规划结果 */
export interface RoutePlan {
  route_code: string;
  route_name: string;
  stops: number[];
  excluded: ExcludedStop[];
  total_minutes: number;
  walking_km: number;
  explanation: string;
  fallback: boolean;
  start_order: number;
}

/** Agent 现场调整结果 */
export interface RouteAdaptation {
  route_code: string;
  stops: number[];
  total_minutes: number;
  end_reason: string;
  message: string;
  fallback: boolean;
  shelter_spot_id: number | null;
  shelter_name: string | null;
  deep_dive: { spot_id: number; category: string } | null;
}

export type RouteEvent =
  | 'plan'
  | 'view'
  | 'start'
  | 'stop'
  | 'complete'
  | 'adapt'
  | 'fallback';

export type RouteAdaptAction = 'time_short' | 'rain' | 'more';
