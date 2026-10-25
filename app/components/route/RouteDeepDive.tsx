/**
 * V3 走线中的“深入一点” — 复用 V2 深度稿 API，不修改 CategoryDeepCard
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
import { Color, Radius, Spacing } from '../../constants/theme';
import { getPlayer } from '../../hooks/useAudioPlayer';
import { useAudioStore } from '../../stores/audioStore';
import {
  fetchDeepContent,
  reportDeepEvent,
  resolveDeepAudioUrl,
} from '../../services/deepContentApi';
import type { DeepContent, NarrativeCategory } from '../../types/narrative';

const CATEGORIES: NarrativeCategory[] = [
  'architecture', 'history', 'academy', 'nature', 'activity',
];

function toCategory(value: string): NarrativeCategory | null {
  return CATEGORIES.includes(value as NarrativeCategory)
    ? (value as NarrativeCategory)
    : null;
}

function safeUrl(url: string): string | undefined {
  return /^https?:\/\//i.test(url) ? url : undefined;
}

interface Props {
  spotId: number;
  category: string;
  spotName: string;
  onContinue: () => void;
}

export default function RouteDeepDive({
  spotId, category, spotName, onContinue,
}: Props) {
  const [content, setContent] = useState<DeepContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const contentRef = useRef<DeepContent | null>(null);
  const audioKeyRef = useRef<string | null>(null);
  const playReportedRef = useRef(false);

  const audioState = useAudioStore((s) => s.state);
  const currentUrl = useAudioStore((s) => s.currentUrl);

  const deepKey = content?.audio_url?.split('/').pop() ?? null;
  const isThisAudio = !!(
    deepKey && currentUrl && currentUrl.includes(deepKey)
  );
  const isPlaying = isThisAudio && audioState === 'playing';

  useEffect(() => {
    let cancelled = false;
    const parsed = toCategory(category);
    if (!parsed) {
      setHint('这个景点暂时没有深度稿');
      setLoading(false);
      return () => { cancelled = true; };
    }

    (async () => {
      try {
        const item = await fetchDeepContent(spotId, parsed);
        if (cancelled) return;
        setContent(item);
        contentRef.current = item;
        void reportDeepEvent(spotId, item.id, item.category, 'view');
      } catch {
        if (!cancelled) setHint('这篇深度讲解暂不可用，先继续路线');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [spotId, category]);

  useEffect(() => {
    return () => {
      const key = audioKeyRef.current;
      audioKeyRef.current = null;
      const url = useAudioStore.getState().currentUrl ?? '';
      if (key && url.includes(key)) getPlayer().stop();
    };
  }, []);

  // 深度稿播放/播完/失败记账（与 CategoryDeepCard 同一套事件）
  useEffect(() => {
    return useAudioStore.subscribe((audio, prev) => {
      const key = audioKeyRef.current;
      if (!key) return;
      const isOur = (audio.currentUrl ?? '').includes(key);

      if (audio.state === 'playing' && isOur && !playReportedRef.current) {
        playReportedRef.current = true;
        const item = contentRef.current;
        if (item) {
          void reportDeepEvent(spotId, item.id, item.category, 'play');
        }
      }

      if (
        prev.state === 'playing'
        && audio.state === 'idle'
        && (prev.currentUrl ?? '').includes(key)
      ) {
        playReportedRef.current = false;
        const item = contentRef.current;
        if (item) {
          void reportDeepEvent(spotId, item.id, item.category, 'complete');
        }
      }

      if (audio.state === 'error' && isOur) {
        playReportedRef.current = false;
        audioKeyRef.current = null;
        const item = contentRef.current;
        if (item) {
          void reportDeepEvent(spotId, item.id, item.category, 'fallback');
        }
      }
    });
  }, [spotId]);

  const handleToggleAudio = () => {
    if (isPlaying) {
      audioKeyRef.current = null;
      playReportedRef.current = false;
      getPlayer().stop();
      return;
    }
    const item = contentRef.current;
    if (!item?.audio_url) return;
    audioKeyRef.current = item.audio_url.split('/').pop() ?? null;
    playReportedRef.current = false;
    getPlayer().play(
      resolveDeepAudioUrl(item.audio_url),
      item.title,
      spotId,
    );
  };

  const handleContinue = () => {
    audioKeyRef.current = null;
    const url = useAudioStore.getState().currentUrl ?? '';
    if (deepKey && url.includes(deepKey)) getPlayer().stop();
    onContinue();
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow}>深入一点 · {spotName}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={handleContinue}
          activeOpacity={0.7}
        >
          <Text style={styles.close}>继续路线</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={Color.primary} />
          <Text style={styles.hint}>正在取深度稿…</Text>
        </View>
      ) : null}

      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      {content ? (
        <View>
          <Text style={styles.title}>{content.title}</Text>
          <Text style={styles.body}>{content.body}</Text>

          {content.audio_url ? (
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.8}
              style={styles.listenBtn}
              onPress={handleToggleAudio}
            >
              <Text style={styles.listenText}>
                {isPlaying ? '停止深度讲解' : '听这段深度讲解'}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.hint}>这篇深度稿暂无音频，可以直接阅读</Text>
          )}

          {content.sources?.length ? (
            <Text style={styles.sourceTitle}>
              来源（{content.sources.length}）
            </Text>
          ) : null}
          {content.sources?.slice(0, 3).map((source, index) => {
            const url = safeUrl(source.url);
            return (
              <TouchableOpacity
                key={`${source.title}-${index}`}
                disabled={!url}
                activeOpacity={0.7}
                onPress={() => { if (url) void Linking.openURL(url); }}
              >
                <Text style={styles.sourceText} numberOfLines={2}>
                  · {source.title}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      <TouchableOpacity
        accessibilityRole="button"
        activeOpacity={0.8}
        style={styles.continueBtn}
        onPress={handleContinue}
      >
        <Text style={styles.continueText}>继续走线</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    backgroundColor: Color.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.primary,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    color: Color.accent,
    letterSpacing: 0.5,
  },
  close: {
    fontSize: 13,
    fontWeight: '600',
    color: Color.primary,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  hint: {
    paddingVertical: Spacing.sm,
    fontSize: 13,
    lineHeight: 20,
    color: Color.caption,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: Color.heading,
    marginBottom: Spacing.sm,
  },
  body: {
    fontSize: 14,
    lineHeight: 24,
    color: Color.body,
  },
  listenBtn: {
    marginTop: Spacing.md,
    minHeight: 44,
    borderRadius: Radius.md,
    backgroundColor: Color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listenText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  sourceTitle: {
    marginTop: Spacing.md,
    fontSize: 12,
    fontWeight: '600',
    color: Color.primary,
  },
  sourceText: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 17,
    color: Color.caption,
  },
  continueBtn: {
    marginTop: Spacing.md,
    minHeight: 44,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueText: {
    fontSize: 14,
    fontWeight: '600',
    color: Color.primary,
  },
});
