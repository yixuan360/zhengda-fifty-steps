/**
 * 景点详情页 — 玻璃拟态卡片 + 图片 + 迷你播放器（V5.5）
 * 播放器含：播放/暂停 + 时间显示 + 点击进度条跳转
 *
 * ⚠ 严格 Hook 规则：全部 hooks（useState/useRef/useEffect/useCallback）
 * 必须在所有条件返回之前调用，保证每次渲染 hook 数量一致。
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, Image, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, Stack } from 'expo-router';
import { getSpotById } from '../../services/database';
import { haversineDistance } from '../../utils/distance';
import { useTourStore } from '../../stores/tourStore';
import { useAudioStore } from '../../stores/audioStore';
import { getPlayer } from '../../hooks/useAudioPlayer';
import { Color, Spacing, Radius, Shadow } from '../../constants/theme';
import type { Spot } from '../../types';

const PLACEHOLDER_IMG = require('../../assets/icon.png');
const SCREEN_WIDTH = Dimensions.get('window').width;
const TRACK_WIDTH = SCREEN_WIDTH - Spacing.pageH * 2;

function fmtDist(m: number): string {
  return m < 1000 ? `约 ${Math.round(m)}m` : `约 ${(m / 1000).toFixed(1)}km`;
}

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function cacheKey(url: string): string {
  return url.split('/').pop() || '';
}

export default function SpotDetailScreen() {
  // ═══════════════════════════════════════════════════════════
  // Hook 区域（全部在条件返回之前，数量恒定）
  // ═══════════════════════════════════════════════════════════
  const { id } = useLocalSearchParams<{ id: string }>();
  const userLocation = useTourStore((s) => s.userLocation);

  const [spot, setSpot] = useState<Spot | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  const audioState = useAudioStore((s) => s.state);
  const audioUrl = useAudioStore((s) => s.currentUrl);
  const position = useAudioStore((s) => s.position);
  const duration = useAudioStore((s) => s.duration);

  const trackX = useRef(0);
  const trackW = useRef(TRACK_WIDTH);
  const spotRef = useRef<Spot | null>(null);

  // 数据加载
  useEffect(() => {
    (async () => {
      if (!id) return;
      const spotId = Number(id);
      if (Number.isNaN(spotId)) { setLoading(false); return; }
      const s = await getSpotById(spotId);
      spotRef.current = s;
      setSpot(s);
      setLoading(false);
    })();
  }, [id]);

  // 事件回调（依赖用 ref + getState() 避免闭包过期，空 deps = hook 永远在）
  const handleToggle = useCallback(() => {
    const s = spotRef.current;
    if (!s?.audioUrl) return;
    const st = useAudioStore.getState();
    const active = !!(s.audioUrl && st.currentUrl && st.currentUrl.includes(cacheKey(s.audioUrl)));
    if (!active) {
      getPlayer().play(s.audioUrl, s.name, s.id);
    } else if (st.state === 'playing') {
      getPlayer().pause();
    } else if (st.state === 'paused') {
      getPlayer().resume();
    }
  }, []);

  const handleSeek = useCallback((e: any) => {
    const dur = useAudioStore.getState().duration;
    if (dur <= 0) return;
    const x = e.nativeEvent.locationX ?? (e.nativeEvent.pageX - trackX.current);
    const pct = Math.max(0, Math.min(1, x / trackW.current));
    getPlayer().seekTo(pct * dur);
  }, []);

  // ═══════════════════════════════════════════════════════════
  // 条件返回（在此之下不能再有 hook 调用）
  // ═══════════════════════════════════════════════════════════
  if (!id || Number.isNaN(Number(id))) {
    return (
      <View style={[styles.centered, { backgroundColor: Color.pageBg }]}>
        <Text style={{ color: Color.caption }}>参数无效</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: Color.pageBg }]}>
        <ActivityIndicator size="large" color={Color.primary} />
      </View>
    );
  }

  if (!spot) {
    return (
      <View style={[styles.centered, { backgroundColor: Color.pageBg }]}>
        <Text style={{ color: Color.caption }}>景点不存在</Text>
      </View>
    );
  }

  // 渲染数据计算（不是 hooks，可以在条件返回之后）
  const distance = userLocation
    ? haversineDistance(userLocation, { lat: spot.lat, lng: spot.lng })
    : null;

  const isThisSpotActive =
    !!(spot.audioUrl && audioUrl && audioUrl.includes(cacheKey(spot.audioUrl)));

  const isPlaying = isThisSpotActive && audioState === 'playing';
  const isPaused = isThisSpotActive && audioState === 'paused';
  const isLoading = isThisSpotActive && audioState === 'loading';

  let btnIcon = 'play';
  let btnLabel = '播放语音讲解';
  if (isLoading) { btnIcon = 'hourglass-outline'; btnLabel = '加载中...'; }
  else if (isPlaying) { btnIcon = 'pause'; btnLabel = '暂停'; }
  else if (isPaused) { btnIcon = 'play'; btnLabel = '继续播放'; }

  const progressPct = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <ScrollView style={[styles.container, { backgroundColor: Color.pageBg }]}>
      <Stack.Screen options={{ title: spot.name, headerStyle: { backgroundColor: Color.pageBg } }} />

      <Image
        source={spot.imageUrl && !imageError ? { uri: spot.imageUrl } : PLACEHOLDER_IMG}
        style={styles.image}
        resizeMode="cover"
        onError={() => setImageError(true)}
      />

      <View style={styles.body}>
        {distance != null && (
          <View style={styles.distanceCard}>
            <View style={styles.distanceDot} />
            <Text style={styles.distanceText}>距您 {fmtDist(distance)}</Text>
          </View>
        )}

        <Text style={styles.name}>{spot.name}</Text>

        {spot.summary ? (
          <View style={styles.section}>
            <Text style={styles.label}>简介</Text>
            <Text style={styles.summary}>{spot.summary}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.label}>详细介绍</Text>
          <Text style={styles.text}>{spot.description}</Text>
        </View>

        {/* ── 迷你播放器 ── */}
        <View style={styles.playerSection}>
          {spot.audioUrl ? (
            <View style={styles.playerCard}>
              <View style={styles.playerRow}>
                <TouchableOpacity
                  style={[styles.playPauseBtn, isPlaying && styles.playPauseBtnActive]}
                  onPress={handleToggle}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={btnIcon as any}
                    size={22}
                    color={isPlaying || isPaused ? '#fff' : Color.primary}
                  />
                </TouchableOpacity>

                <View style={styles.timeGroup}>
                  <Text style={styles.timeText}>{fmtTime(position)}</Text>
                  <Text style={styles.timeSep}> / </Text>
                  <Text style={styles.timeTextDim}>{fmtTime(duration)}</Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.progressTouchArea}
                activeOpacity={0.99}
                onLayout={(e) => {
                  trackX.current = e.nativeEvent.layout.x;
                  trackW.current = e.nativeEvent.layout.width;
                }}
                onPress={handleSeek}
              >
                <View style={styles.progressBg} />
                <View style={[styles.progressFill, { width: `${Math.min(100, progressPct)}%` }]} />
                <View style={[styles.progressThumb, { left: `${Math.min(100, progressPct)}%` }]} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.audioHint}>
              <Text style={styles.audioHintText}>📝 该景点暂无语音导览</Text>
              <Text style={styles.audioHintSub}>请连接服务器后下拉刷新同步最新数据</Text>
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  image: { width: '100%', height: 260, backgroundColor: Color.divider },
  body: { padding: Spacing.pageH, paddingBottom: 32 },
  name: { fontSize: 24, fontWeight: '700', color: Color.heading, marginBottom: Spacing.md, letterSpacing: -0.4 },

  distanceCard: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    marginBottom: Spacing.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Color.cardBg, borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Color.cardBorder, ...Shadow.card,
  },
  distanceDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Color.primary, marginRight: Spacing.sm },
  distanceText: { fontSize: 14, fontWeight: '500', color: Color.primary },

  section: { marginTop: Spacing.xl },
  label: { fontSize: 12, fontWeight: '600', color: Color.primary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing.sm },
  summary: { fontSize: 16, color: Color.body, lineHeight: 26, fontWeight: '500' },
  text: { fontSize: 15, color: Color.body, lineHeight: 25, marginTop: Spacing.xs },

  playerSection: { marginTop: Spacing.xxl },
  playerCard: {
    borderRadius: Radius.lg, backgroundColor: Color.cardBg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Color.cardBorder,
    padding: Spacing.lg, ...Shadow.card,
  },
  playerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  playPauseBtn: {
    width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: Color.primary,
    backgroundColor: Color.primarySoft, justifyContent: 'center', alignItems: 'center', marginRight: Spacing.md,
  },
  playPauseBtnActive: { backgroundColor: Color.primary, borderColor: Color.primary },
  timeGroup: { flexDirection: 'row', alignItems: 'baseline' },
  timeText: { fontSize: 15, fontWeight: '600', color: Color.heading, fontVariant: ['tabular-nums'] },
  timeSep: { fontSize: 13, color: Color.caption },
  timeTextDim: { fontSize: 14, color: Color.caption, fontVariant: ['tabular-nums'] },

  progressTouchArea: { height: 36, justifyContent: 'center' },
  progressBg: { height: 5, borderRadius: 2.5, backgroundColor: Color.divider, position: 'absolute', left: 0, right: 0, top: 15.5 },
  progressFill: { height: 5, borderRadius: 2.5, backgroundColor: Color.primary, position: 'absolute', left: 0, top: 15.5 },
  progressThumb: {
    width: 14, height: 14, borderRadius: 7, backgroundColor: Color.primary,
    borderWidth: 2.5, borderColor: '#fff', position: 'absolute', top: 11, marginLeft: -7, ...Shadow.card,
  },

  audioHint: { padding: Spacing.lg, borderRadius: Radius.md, backgroundColor: Color.primarySoft, alignItems: 'center' },
  audioHintText: { fontSize: 13, color: Color.primary, fontWeight: '500' },
  audioHintSub: { fontSize: 12, color: Color.caption, marginTop: Spacing.sm },
});
