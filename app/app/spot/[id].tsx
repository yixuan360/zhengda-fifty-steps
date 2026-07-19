/**
 * 景点详情页 — 玻璃拟态卡片 + 图片 + 迷你播放器（V5.5）
 * 播放器含：播放/暂停 + 时间显示 + 可拖动进度条（拖动时显示预览时间）
 */
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, Image, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, PanResponder, Dimensions,
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
/** 播放器左右内边距 */
const PLAYER_H_PAD = Spacing.pageH;
const TRACK_WIDTH = SCREEN_WIDTH - PLAYER_H_PAD * 2;

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
  const { id } = useLocalSearchParams<{ id: string }>();
  const userLocation = useTourStore((s) => s.userLocation);

  const [spot, setSpot] = useState<Spot | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  // ── 播放器状态（与 AudioBar 共享同一播放器实例） ──
  const audioState = useAudioStore((s) => s.state);
  const audioUrl = useAudioStore((s) => s.currentUrl);
  const position = useAudioStore((s) => s.position);
  const duration = useAudioStore((s) => s.duration);

  // ── 进度条拖动状态 ──
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekPreview, setSeekPreview] = useState(0);
  const seekRef = useRef(0);
  const trackLayout = useRef({ x: 0, width: TRACK_WIDTH });
  const isActiveRef = useRef(false);

  // isThisSpotActive 需在 useEffect 引用之前计算
  const isThisSpotActive: boolean = useMemo(() =>
    !!(spot?.audioUrl && audioUrl && audioUrl.includes(cacheKey(spot.audioUrl))),
    [spot?.audioUrl, audioUrl],
  );

  useEffect(() => { seekRef.current = seekPreview; }, [seekPreview]);
  useEffect(() => { isActiveRef.current = isThisSpotActive; }, [isThisSpotActive]);

  useEffect(() => {
    (async () => {
      if (!id) return;
      const spotId = Number(id);
      if (Number.isNaN(spotId)) { setLoading(false); return; }
      const s = await getSpotById(spotId);
      setSpot(s);
      setLoading(false);
    })();
  }, [id]);

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

  const distance = userLocation
    ? haversineDistance(userLocation, { lat: spot.lat, lng: spot.lng })
    : null;

  const isPlaying = isThisSpotActive && audioState === 'playing';
  const isPaused = isThisSpotActive && audioState === 'paused';
  const isLoading = isThisSpotActive && audioState === 'loading';

  // ── 播放/暂停切换 ──
  const handleToggle = useCallback(() => {
    if (!spot.audioUrl) return;
    if (isPlaying) { getPlayer().pause(); }
    else if (isPaused) { getPlayer().resume(); }
    else { getPlayer().play(spot.audioUrl, spot.name, spot.id); }
  }, [spot.audioUrl, spot.name, spot.id, isPlaying, isPaused]);

  // ── 进度条拖动：PanResponder（通过 Ref 读最新值，避免闭包过期） ──
  const seekPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => isActiveRef.current,
      onMoveShouldSetPanResponder: () => isActiveRef.current,
      onPanResponderGrant: () => {
        setIsSeeking(true);
      },
      onPanResponderMove: (_e, gs) => {
        const rawX = gs.moveX - trackLayout.current.x;
        const pct = Math.max(0, Math.min(1, rawX / trackLayout.current.width));
        const sec = pct * duration;
        setSeekPreview(sec);
        seekRef.current = sec;
      },
      onPanResponderRelease: () => {
        setIsSeeking(false);
        getPlayer().seekTo(seekRef.current);
      },
    }),
  ).current;

  // seekPan 依赖会变，每次渲染刷新
  const displayPosition = isSeeking ? seekPreview : position;
  const progressPct = duration > 0 ? (displayPosition / duration) * 100 : 0;

  // ── 按钮图标 ──
  let btnIcon: keyof typeof Ionicons.glyphMap = 'play';
  let btnLabel = '播放语音讲解';
  if (isLoading) { btnIcon = 'hourglass-outline'; btnLabel = '加载中...'; }
  else if (isPlaying) { btnIcon = 'pause'; btnLabel = '暂停'; }
  else if (isPaused) { btnIcon = 'play'; btnLabel = '继续播放'; }

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
        {/* 玻璃拟态距离卡片 */}
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

        {/* ── 迷你播放器（替换文字提示） ── */}
        <View style={styles.playerSection}>
          {spot.audioUrl ? (
            <View style={styles.playerCard}>
              {/* 控制行：播放/暂停 + 时间 */}
              <View style={styles.playerRow}>
                <TouchableOpacity
                  style={[styles.playPauseBtn, isPlaying && styles.playPauseBtnActive]}
                  onPress={handleToggle}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={btnIcon}
                    size={22}
                    color={isPlaying || isPaused ? '#fff' : Color.primary}
                  />
                </TouchableOpacity>

                <View style={styles.timeGroup}>
                  <Text style={styles.timeText}>{fmtTime(displayPosition)}</Text>
                  <Text style={styles.timeSep}> / </Text>
                  <Text style={styles.timeTextDim}>{fmtTime(duration)}</Text>
                  {isSeeking && (
                    <Text style={styles.seekHint}> 松开定位</Text>
                  )}
                </View>
              </View>

              {/* 可拖动进度条 */}
              <View
                style={styles.progressTrack}
                onLayout={(e) => {
                  trackLayout.current = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width };
                }}
                {...seekPan.panHandlers}
              >
                {/* 缓冲/背景 */}
                <View style={styles.progressBg} />
                {/* 已播放部分 */}
                <View style={[styles.progressFill, { width: `${Math.min(100, progressPct)}%` }]} />
                {/* 拖动手柄（正在拖动时显示） */}
                {isSeeking && (
                  <View style={[styles.progressThumb, { left: `${Math.min(100, progressPct)}%` }]} />
                )}
              </View>
            </View>
          ) : (
            <View style={styles.audioHint}>
              <Text style={styles.audioHintText}>📝 该景点暂无语音导览</Text>
              <Text style={styles.audioHintSub}>
                请连接服务器后下拉刷新同步最新数据
              </Text>
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

  // ── 播放器区域 ──
  playerSection: { marginTop: Spacing.xxl },
  playerCard: {
    borderRadius: Radius.lg,
    backgroundColor: Color.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.cardBorder,
    padding: Spacing.lg,
    ...Shadow.card,
  },

  // 控制行
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  playPauseBtn: {
    width: 48, height: 48, borderRadius: 24,
    borderWidth: 2, borderColor: Color.primary,
    backgroundColor: Color.primarySoft,
    justifyContent: 'center', alignItems: 'center',
    marginRight: Spacing.md,
  },
  playPauseBtnActive: {
    backgroundColor: Color.primary,
    borderColor: Color.primary,
  },

  timeGroup: { flexDirection: 'row', alignItems: 'baseline' },
  timeText: { fontSize: 15, fontWeight: '600', color: Color.heading, fontVariant: ['tabular-nums'] },
  timeSep: { fontSize: 13, color: Color.caption },
  timeTextDim: { fontSize: 14, color: Color.caption, fontVariant: ['tabular-nums'] },
  seekHint: { fontSize: 12, fontWeight: '500', color: Color.primary },

  // 可拖动进度条
  progressTrack: {
    height: 32, // 增大触摸区域
    justifyContent: 'center',
    paddingVertical: 4,
  },
  progressBg: {
    height: 5, borderRadius: 2.5,
    backgroundColor: Color.divider,
    position: 'absolute', left: 0, right: 0, top: 14,
  },
  progressFill: {
    height: 5, borderRadius: 2.5,
    backgroundColor: Color.primary,
    position: 'absolute', left: 0, top: 14,
  },
  progressThumb: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: Color.primary,
    borderWidth: 3, borderColor: '#fff',
    position: 'absolute', top: 8,
    marginLeft: -8,
    ...Shadow.card,
  },

  // 无音频提示
  audioHint: {
    padding: Spacing.lg, borderRadius: Radius.md,
    backgroundColor: Color.primarySoft, alignItems: 'center',
  },
  audioHintText: { fontSize: 13, color: Color.primary, fontWeight: '500' },
  audioHintSub: { fontSize: 12, color: Color.caption, marginTop: Spacing.sm },
});
