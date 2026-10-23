/**
 * 景点详情页 — “再深一点”文脉叙事卡片（T6）
 *
 * - 维度来自 GET /api/v2/narrative/dimensions/，只展示有 approved 卡片的叙事线
 * - 点击后调用 Agent POST /narrative/next；成功走现有 RNTP 播放链路
 * - fallback / 网络错误：提示并播放景点固定音频，保证“点了有反应”
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Color, Radius, Shadow, Spacing } from '../../constants/theme';
import { getPlayer } from '../../hooks/useAudioPlayer';
import {
  fetchDimensions,
  fetchNext,
  reportNarrative,
  resolveNarrativeAudioUrl,
} from '../../services/narrativeApi';
import type { NarrativeNextResult } from '../../services/narrativeApi';
import { useAudioStore } from '../../stores/audioStore';
import type { NarrativeDimension } from '../../types/narrative';
import { pickDefaultDimension } from '../../utils/narrative';

const NARRATIVE_ENABLED =
  process.env.EXPO_PUBLIC_NARRATIVE_ENABLED === 'true';

const DIMENSION_LABELS: Record<NarrativeDimension, string> = {
  nature: '自然',
  architecture: '建筑',
  academy: '学科',
  history: '校史',
};

const ALL_DIMENSIONS: NarrativeDimension[] = [
  'nature', 'architecture', 'academy', 'history',
];

interface Props {
  spotId: number;
  /** 景点固定讲解音频（fallback 时播放；由详情页传入） */
  audioUrl?: string;
  spotName?: string;
}

export default function DepthNarrativeCard({ spotId, audioUrl, spotName }: Props) {
  const [dimensions, setDimensions] = useState<NarrativeDimension[]>([]);
  const [dimensionsLoading, setDimensionsLoading] = useState(true);
  const [dimension, setDimension] = useState<NarrativeDimension>('nature');
  const [currentDepth, setCurrentDepth] = useState(0);
  const [listenedIds, setListenedIds] = useState<number[]>([]);
  const [result, setResult] = useState<NarrativeNextResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [citationsOpen, setCitationsOpen] = useState(false);

  // 度量上报（T7）：播放结束或组件卸载时上报，每条结果只报一次
  const resultRef = useRef<NarrativeNextResult | null>(null);
  const reportedRef = useRef(true);
  const audioKeyRef = useRef<string | null>(null);
  const reportContextRef = useRef<{
    dimension: NarrativeDimension;
    depth: number;
    listenedIds: number[];
  } | null>(null);

  const reportOnce = useCallback(() => {
    const current = resultRef.current;
    const context = reportContextRef.current;
    if (!current || !context || reportedRef.current) return;
    reportedRef.current = true;
    void reportNarrative(
      current, spotId, context.dimension, context.depth, context.listenedIds,
    );
  }, [spotId]);

  // 监听现有播放 store：playing → idle 视为本段叙事播放结束
  useEffect(() => {
    const unsubscribe = useAudioStore.subscribe((state, prevState) => {
      if (prevState.state !== 'playing' || state.state !== 'idle') return;
      const key = audioKeyRef.current;
      if (key && (state.currentUrl ?? '').includes(key)) reportOnce();
    });
    return () => {
      unsubscribe();
      reportOnce();
    };
  }, [reportOnce]);

  useEffect(() => {
    if (!NARRATIVE_ENABLED) return;
    let cancelled = false;

    (async () => {
      try {
        const counts = await fetchDimensions(spotId);
        if (cancelled) return;
        const available = counts
          .filter((item) => item.approved_count > 0)
          .map((item) => item.dimension);
        if (available.length === 0) {
          setDimensions([]);
          return;
        }
        setDimensions(available);
        setDimension(pickDefaultDimension(available) ?? available[0]);
      } catch {
        // 维度接口不可用时退回四维，由 Agent 侧继续兜底
        if (!cancelled) {
          setDimensions(ALL_DIMENSIONS);
          setDimension('nature');
        }
      } finally {
        if (!cancelled) setDimensionsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [spotId]);

  const playFixedAudio = useCallback(() => {
    if (!audioUrl) return;
    getPlayer().play(audioUrl, spotName ?? '景点讲解', spotId);
  }, [audioUrl, spotName, spotId]);

  const selectDimension = (next: NarrativeDimension) => {
    if (next === dimension) return;
    reportOnce();
    setDimension(next);
    setCurrentDepth(0);
    setListenedIds([]);
    setResult(null);
    setHint(null);
    setCitationsOpen(false);
    resultRef.current = null;
    reportContextRef.current = null;
    reportedRef.current = true;
    audioKeyRef.current = null;
  };

  const goDeeper = async () => {
    if (loading) return;
    reportOnce();
    setLoading(true);
    setHint(null);

    try {
      const next = await fetchNext(
        spotId, dimension, currentDepth, listenedIds,
      );

      if (next.fallback) {
        setHint('该层讲解暂未上线，先听听标准讲解');
        playFixedAudio();
        // 降级也要计入 fallback 率
        resultRef.current = next;
        reportContextRef.current = {
          dimension, depth: next.depth, listenedIds,
        };
        audioKeyRef.current = null;
        reportedRef.current = false;
        reportOnce();
        return;
      }

      const citedIds = next.citations.map((citation) => citation.fact_id);
      const mergedIds = [...new Set([...listenedIds, ...citedIds])];

      setResult(next);
      setCurrentDepth(next.depth);
      setListenedIds(mergedIds);

      resultRef.current = next;
      reportContextRef.current = {
        dimension, depth: next.depth, listenedIds: mergedIds,
      };
      reportedRef.current = false;

      if (next.audio_url) {
        audioKeyRef.current = next.audio_url.split('/').pop() ?? null;
        getPlayer().play(
          resolveNarrativeAudioUrl(next.audio_url),
          spotName ?? 'AI 讲解',
          spotId,
        );
      } else {
        audioKeyRef.current = null;
        setHint('音频暂不可用，可阅读上方讲解');
        reportOnce();
      }
    } catch {
      setHint('叙事服务暂时不可用，先听听标准讲解');
      playFixedAudio();
    } finally {
      setLoading(false);
    }
  };

  if (!NARRATIVE_ENABLED) return null;
  if (dimensionsLoading) {
    return (
      <View style={[styles.card, styles.loading]}>
        <ActivityIndicator color={Color.primary} />
      </View>
    );
  }
  if (dimensions.length === 0) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>AI 叙事</Text>
      <Text style={styles.title}>换一个角度，再深入一层</Text>

      <View style={styles.dimensionRow}>
        {dimensions.map((item) => (
          <TouchableOpacity
            key={item}
            accessibilityRole="button"
            activeOpacity={0.8}
            style={[
              styles.dimensionBtn,
              item === dimension && styles.dimensionBtnActive,
            ]}
            onPress={() => selectDimension(item)}
          >
            <Text
              style={[
                styles.dimensionText,
                item === dimension && styles.dimensionTextActive,
              ]}
            >
              {DIMENSION_LABELS[item]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.depthText}>当前深度：L{currentDepth}</Text>

      <TouchableOpacity
        accessibilityRole="button"
        activeOpacity={0.8}
        disabled={loading}
        style={[styles.deeperBtn, loading && styles.deeperBtnDisabled]}
        onPress={goDeeper}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.deeperText}>再深一点</Text>
        )}
      </TouchableOpacity>

      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      {result ? (
        <View style={styles.result}>
          <Text style={styles.resultText}>{result.text}</Text>

          {result.citations.length > 0 ? (
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.7}
              onPress={() => setCitationsOpen((open) => !open)}
            >
              <Text style={styles.citationToggle}>
                来源（{result.citations.length}）{citationsOpen ? '收起' : '展开'}
              </Text>
            </TouchableOpacity>
          ) : null}

          {citationsOpen
            ? result.citations.map((citation) => (
                <Text key={citation.fact_id} style={styles.citationText}>
                  · {citation.fact_text}
                </Text>
              ))
            : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: Spacing.xxl,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    backgroundColor: Color.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.cardBorder,
    ...Shadow.card,
  },
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xl,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '600',
    color: Color.accent,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: Spacing.xs,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: Color.heading,
    marginBottom: Spacing.md,
  },
  dimensionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  dimensionBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Color.primary,
    backgroundColor: Color.primarySoft,
  },
  dimensionBtnActive: {
    backgroundColor: Color.primary,
  },
  dimensionText: {
    fontSize: 13,
    fontWeight: '600',
    color: Color.primary,
  },
  dimensionTextActive: {
    color: '#fff',
  },
  depthText: {
    fontSize: 12,
    color: Color.caption,
    marginBottom: Spacing.sm,
  },
  deeperBtn: {
    minHeight: 44,
    paddingVertical: 12,
    borderRadius: Radius.md,
    backgroundColor: Color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deeperBtnDisabled: {
    opacity: 0.6,
  },
  deeperText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  hint: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Color.primarySoft,
    fontSize: 13,
    lineHeight: 20,
    color: Color.primary,
  },
  result: {
    marginTop: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Color.divider,
  },
  resultText: {
    fontSize: 15,
    color: Color.body,
    lineHeight: 25,
  },
  citationToggle: {
    marginTop: Spacing.md,
    fontSize: 13,
    fontWeight: '600',
    color: Color.primary,
  },
  citationText: {
    marginTop: Spacing.sm,
    fontSize: 12,
    color: Color.caption,
    lineHeight: 19,
  },
});
