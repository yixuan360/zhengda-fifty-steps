/**
 * V2 比赛版 — “想多了解哪一面？”分类深度讲解卡片。
 *
 * - 分类来自 GET /api/v2/narrative/categories/，只展示有已发布深度稿的分类
 * - 点一次分类 → 取深度稿 → 播放预生成音频（一次到位，无深度层级）
 * - 失败降级：提示 + 保留页面固定播报按钮
 */
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Color, Radius, Shadow, Spacing } from '../../constants/theme';
import { getPlayer } from '../../hooks/useAudioPlayer';
import {
  fetchCategories,
  fetchDeepContent,
  reportDeepEvent,
  resolveDeepAudioUrl,
} from '../../services/deepContentApi';
import { useAudioStore } from '../../stores/audioStore';
import type {
  DeepContent,
  NarrativeCategory,
  NarrativeCategoryCount,
} from '../../types/narrative';
import { pickDefaultCategory } from '../../utils/narrative';

interface Props {
  spotId: number;
  /** 景点固定讲解音频（降级时保留页面原按钮） */
  audioUrl?: string;
  spotName?: string;
}

const STATUS_LABELS: Record<string, string> = {
  verified: '已核验',
  secondary: '二手资料',
  unverified: '待核验',
  conflict: '口径差异',
  corrected: '已校正',
  rejected: '未采用',
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** 来源链接只允许 http/https，避免内容层被写入危险 scheme。 */
function safeUrl(url: string): string | undefined {
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

export default function CategoryDeepCard({ spotId, audioUrl, spotName }: Props) {
  const [categories, setCategories] = useState<NarrativeCategoryCount[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [category, setCategory] = useState<NarrativeCategory | null>(null);
  const [content, setContent] = useState<DeepContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const contentRef = useRef<DeepContent | null>(null);
  const audioKeyRef = useRef<string | null>(null);
  const playReportedRef = useRef(false);
  const requestSeq = useRef(0);
  const mountedRef = useRef(true);

  const audioState = useAudioStore((state) => state.state);
  const currentUrl = useAudioStore((state) => state.currentUrl);

  const deepKey = content?.audio_url?.split('/').pop() ?? null;
  const isDeepActive = !!(deepKey && currentUrl && currentUrl.includes(deepKey));
  const isDeepPlaying = isDeepActive && audioState === 'playing';

  // 分类列表：只取有 approved 深度稿的分类
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    // 同一路由实例切换到另一个景点时，清掉上一个景点的内容与音频。
    requestSeq.current += 1;
    setCategories([]);
    setCategory(null);
    setContent(null);
    contentRef.current = null;
    setHint(null);
    setSourcesOpen(false);
    setNotesOpen(false);
    setContentLoading(false);
    setCategoriesLoading(true);
    playReportedRef.current = false;
    const playerState = useAudioStore.getState();
    if (
      audioKeyRef.current
      && (playerState.currentUrl ?? '').includes(audioKeyRef.current)
    ) {
      audioKeyRef.current = null;
      getPlayer().stop();
    } else {
      audioKeyRef.current = null;
    }

    (async () => {
      try {
        const list = await fetchCategories(spotId);
        if (cancelled || !mountedRef.current) return;
        setCategories(list);
        setCategory(pickDefaultCategory(list.map((item) => item.category)));
      } catch {
        if (!cancelled && mountedRef.current) setCategories([]);
      } finally {
        if (!cancelled && mountedRef.current) setCategoriesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [spotId]);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  // 播放/播完上报：只有真正进入 playing 才记 play，避免 404 也计入播放。
  useEffect(() => {
    const unsubscribe = useAudioStore.subscribe((state, prevState) => {
      const key = audioKeyRef.current;
      if (!key) return;
      const isOurTrack = (state.currentUrl ?? '').includes(key);

      if (state.state === 'playing' && isOurTrack && !playReportedRef.current) {
        playReportedRef.current = true;
        const current = contentRef.current;
        if (current) {
          void reportDeepEvent(spotId, current.id, current.category, 'play', 0);
        }
      }

      if (
        prevState.state !== 'playing'
        || state.state !== 'idle'
        || !isOurTrack
      ) return;

      const current = contentRef.current;
      audioKeyRef.current = null;
      playReportedRef.current = false;
      if (current) {
        void reportDeepEvent(
          spotId, current.id, current.category, 'complete', 0,
        );
      }
    });
    return unsubscribe;
  }, [spotId]);

  const stopDeepAudio = () => {
    audioKeyRef.current = null;
    playReportedRef.current = false;
    getPlayer().stop();
  };

  const playContentAudio = () => {
    const current = contentRef.current;
    if (!current?.audio_url) return;
    const key = current.audio_url.split('/').pop() ?? null;
    audioKeyRef.current = key;
    playReportedRef.current = false;
    getPlayer().play(
      resolveDeepAudioUrl(current.audio_url),
      current.title,
      spotId,
    );
  };

  const playFixedAudio = () => {
    if (!audioUrl) return;
    audioKeyRef.current = null;
    playReportedRef.current = false;
    getPlayer().play(audioUrl, spotName ?? '标准讲解', spotId);
  };

  const loadCategory = async (next: NarrativeCategory, autoPlay: boolean) => {
    const seq = ++requestSeq.current;
    const started = Date.now();

    // 只停掉本卡片正在播的深度音频；如果用户已切到页面固定播报，不要误停。
    const player = useAudioStore.getState();
    if (
      audioKeyRef.current
      && (player.currentUrl ?? '').includes(audioKeyRef.current)
    ) {
      stopDeepAudio();
    } else {
      audioKeyRef.current = null;
      playReportedRef.current = false;
    }
    setCategory(next);
    setContent(null);
    contentRef.current = null;
    setHint(null);
    setSourcesOpen(false);
    setNotesOpen(false);
    setContentLoading(true);

    try {
      const item = await fetchDeepContent(spotId, next);
      if (!mountedRef.current || seq !== requestSeq.current) return;
      setContent(item);
      contentRef.current = item;
      void reportDeepEvent(
        spotId, item.id, item.category, 'view', Date.now() - started,
      );
      if (autoPlay && item.audio_url) {
        const key = item.audio_url.split('/').pop() ?? null;
        audioKeyRef.current = key;
        playReportedRef.current = false;
        getPlayer().play(
          resolveDeepAudioUrl(item.audio_url),
          item.title,
          spotId,
        );
      }
    } catch {
      if (!mountedRef.current || seq !== requestSeq.current) return;
      setHint('这个分类的深度讲解暂不可用，可以先听页面上的标准讲解');
      void reportDeepEvent(
        spotId, null, next, 'fallback', Date.now() - started,
      );
    } finally {
      if (mountedRef.current && seq === requestSeq.current) {
        setContentLoading(false);
      }
    }
  };

  const handleSelect = (next: NarrativeCategory) => {
    if (next === category && content) {
      if (content.audio_url) toggleContentAudio();
      return;
    }
    void loadCategory(next, true);
  };

  const toggleContentAudio = () => {
    if (isDeepPlaying) {
      stopDeepAudio();
    } else {
      playContentAudio();
    }
  };

  if (categoriesLoading) {
    return (
      <View style={[styles.card, styles.loading]}>
        <ActivityIndicator color={Color.primary} />
      </View>
    );
  }
  if (categories.length === 0) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>AI 深度讲解</Text>
      <Text style={styles.title}>想多了解哪一面？</Text>

      <View style={styles.categoryRow}>
        {categories.map((item) => {
          const active = item.category === category;
          return (
            <TouchableOpacity
              key={item.category}
              accessibilityRole="button"
              activeOpacity={0.8}
              style={[styles.categoryBtn, active && styles.categoryBtnActive]}
              onPress={() => handleSelect(item.category)}
            >
              <Text
                style={[
                  styles.categoryText,
                  active && styles.categoryTextActive,
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {!content && !contentLoading && !hint ? (
        <Text style={styles.prompt}>点一个分类，听 2–3 分钟专业解读</Text>
      ) : null}

      {contentLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={Color.primary} size="small" />
          <Text style={styles.prompt}>正在准备深度讲解…</Text>
        </View>
      ) : null}

      {hint ? (
        <View>
          <Text style={styles.hint}>{hint}</Text>
          {audioUrl ? (
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.7}
              onPress={playFixedAudio}
            >
              <Text style={styles.toggle}>播放页面标准讲解</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {content ? (
        <View style={styles.result}>
          <Text style={styles.contentTitle}>{content.title}</Text>
          <Text style={styles.resultText}>{content.body}</Text>

          {content.audio_url ? (
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.8}
              style={styles.listenBtn}
              onPress={toggleContentAudio}
            >
              <Text style={styles.listenText}>
                {isDeepPlaying ? '停止播放' : '重听这段讲解'}
              </Text>
            </TouchableOpacity>
          ) : null}

          {content.sources?.length ? (
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.7}
              onPress={() => setSourcesOpen((open) => !open)}
            >
              <Text style={styles.toggle}>
                来源（{content.sources.length}）{sourcesOpen ? '收起' : '展开'}
              </Text>
            </TouchableOpacity>
          ) : null}

          {sourcesOpen
            ? content.sources.map((source, index) => {
                const url = safeUrl(source.url);
                return (
                  <TouchableOpacity
                    key={`${source.url}-${index}`}
                    activeOpacity={0.7}
                    disabled={!url}
                    onPress={() => {
                      if (url) void Linking.openURL(url);
                    }}
                  >
                    <Text style={styles.sourceText}>
                      · {source.title}
                      {'  '}
                      <Text style={styles.sourceStatus}>
                        {statusLabel(source.status)}
                      </Text>
                    </Text>
                  </TouchableOpacity>
                );
              })
            : null}

          {content.fact_notes?.length ? (
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.7}
              onPress={() => setNotesOpen((open) => !open)}
            >
              <Text style={styles.toggle}>
                数据口径（{content.fact_notes.length}）{notesOpen ? '收起' : '展开'}
              </Text>
            </TouchableOpacity>
          ) : null}

          {notesOpen
            ? content.fact_notes.map((note, index) => (
                <View key={`${note.claim}-${index}`} style={styles.noteBox}>
                  <Text style={styles.noteClaim}>
                    {note.claim} ·{' '}
                    <Text style={styles.sourceStatus}>
                      {statusLabel(note.status)}
                    </Text>
                  </Text>
                  <Text style={styles.noteText}>{note.note}</Text>
                </View>
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
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  categoryBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Color.primary,
    backgroundColor: Color.primarySoft,
  },
  categoryBtnActive: {
    backgroundColor: Color.primary,
  },
  categoryText: {
    fontSize: 13,
    fontWeight: '600',
    color: Color.primary,
  },
  categoryTextActive: {
    color: '#fff',
  },
  prompt: {
    fontSize: 12,
    color: Color.caption,
    lineHeight: 18,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
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
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Color.divider,
  },
  contentTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Color.heading,
    marginBottom: Spacing.sm,
  },
  resultText: {
    fontSize: 15,
    color: Color.body,
    lineHeight: 25,
  },
  listenBtn: {
    marginTop: Spacing.md,
    minHeight: 44,
    paddingVertical: 12,
    borderRadius: Radius.md,
    backgroundColor: Color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listenText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  toggle: {
    marginTop: Spacing.md,
    fontSize: 13,
    fontWeight: '600',
    color: Color.primary,
  },
  sourceText: {
    marginTop: Spacing.sm,
    fontSize: 12,
    color: Color.caption,
    lineHeight: 19,
  },
  sourceStatus: {
    fontSize: 11,
    color: Color.accent,
  },
  noteBox: {
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Color.primarySoft,
  },
  noteClaim: {
    fontSize: 12,
    fontWeight: '600',
    color: Color.primary,
    lineHeight: 18,
  },
  noteText: {
    marginTop: 4,
    fontSize: 12,
    color: Color.body,
    lineHeight: 18,
  },
});
