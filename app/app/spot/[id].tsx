/**
 * 景点详情页 — 玻璃拟态卡片 + 图片 + 手动播放（V5.4）
 */
import { useEffect, useState } from 'react';
import {
  View, Text, Image, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity,
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

function fmtDist(m: number): string {
  return m < 1000 ? `约 ${Math.round(m)}m` : `约 ${(m / 1000).toFixed(1)}km`;
}

export default function SpotDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userLocation = useTourStore((s) => s.userLocation);

  const [spot, setSpot] = useState<Spot | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  // ── 手动播放状态（依赖 audioStore，与 AudioBar 共享同一播放器） ──
  const audioState = useAudioStore((s) => s.state);
  const audioUrl = useAudioStore((s) => s.currentUrl);

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

  // 判断当前页面展示的景点是否正在播放
  const isThisSpotPlaying =
    spot?.audioUrl != null &&
    audioUrl != null &&
    audioUrl.includes(cacheKey(spot.audioUrl));

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

  const handlePlay = () => {
    if (!spot.audioUrl) return;
    if (isThisSpotPlaying) {
      if (audioState === 'playing') getPlayer().pause();
      else if (audioState === 'paused') getPlayer().resume();
    } else {
      getPlayer().play(spot.audioUrl, spot.name, spot.id);
    }
  };

  const isPlayingThis = isThisSpotPlaying && audioState === 'playing';
  const isLoadingThis = isThisSpotPlaying && audioState === 'loading';

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

        {/* 手动播放 / 自动触发提示区域 */}
        {spot.audioUrl ? (
          <TouchableOpacity
            style={[styles.playBtn, isPlayingThis && styles.playBtnActive]}
            onPress={handlePlay}
            activeOpacity={0.8}
          >
            <Ionicons
              name={isLoadingThis ? 'hourglass-outline' : isPlayingThis ? 'pause' : 'play'}
              size={20}
              color={isPlayingThis ? '#fff' : Color.primary}
            />
            <Text style={[styles.playBtnText, isPlayingThis && { color: '#fff' }]}>
              {isLoadingThis ? '加载中...' : isPlayingThis ? '暂停' : '播放语音讲解'}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.audioHint}>
            <Text style={styles.audioHintText}>📝 该景点暂无语音导览</Text>
            <Text style={styles.audioHintSub}>
              请连接服务器后下拉刷新同步最新数据
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

/** 从 URL 末尾取文件名，用于判断是否同一音频 */
function cacheKey(url: string): string {
  return url.split('/').pop() || '';
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  image: { width: '100%', height: 260, backgroundColor: Color.divider },
  body: { padding: Spacing.pageH, paddingBottom: 32 },
  name: { fontSize: 24, fontWeight: '700', color: Color.heading, marginBottom: Spacing.md, letterSpacing: -0.4 },

  // 距离卡片（玻璃拟态）
  distanceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Color.cardBg,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.cardBorder,
    ...Shadow.card,
  },
  distanceDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Color.primary, marginRight: Spacing.sm },
  distanceText: { fontSize: 14, fontWeight: '500', color: Color.primary },

  section: { marginTop: Spacing.xl },
  label: { fontSize: 12, fontWeight: '600', color: Color.primary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing.sm },
  summary: { fontSize: 16, color: Color.body, lineHeight: 26, fontWeight: '500' },
  text: { fontSize: 15, color: Color.body, lineHeight: 25, marginTop: Spacing.xs },

  // 播放按钮（青绿边框 + 按压时填充青绿底）
  playBtn: {
    marginTop: Spacing.xxl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Color.primary,
    backgroundColor: Color.primarySoft,
    gap: 8,
  },
  playBtnActive: { backgroundColor: Color.primary },
  playBtnText: { fontSize: 15, fontWeight: '600', color: Color.primary },
  playBtnIcon: { marginRight: 4 },

  audioHint: {
    marginTop: Spacing.xxl,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: Color.primarySoft,
    alignItems: 'center',
  },
  audioHintText: { fontSize: 13, color: Color.primary, fontWeight: '500' },
  audioHintSub: { fontSize: 12, color: Color.caption, marginTop: Spacing.sm },
});
