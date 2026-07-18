/**
 * 景点详情页 — 玻璃拟态卡片 + 图片 + 描述（V5.4）
 */
import { useEffect, useState } from 'react';
import { View, Text, Image, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { getSpotById } from '../../services/database';
import { haversineDistance } from '../../utils/distance';
import { useTourStore } from '../../stores/tourStore';
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

        {spot.audioUrl ? (
          <View style={styles.audioHint}>
            <Text style={styles.audioHintText}>🎧 走近景点时将自动播放语音讲解</Text>
          </View>
        ) : (
          <View style={styles.audioHint}>
            <Text style={styles.audioHintText}>📝 该景点暂无语音导览</Text>
          </View>
        )}
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
  distanceDot: {
    width: 8, height: 8,
    borderRadius: 4,
    backgroundColor: Color.primary,
    marginRight: Spacing.sm,
  },
  distanceText: { fontSize: 14, fontWeight: '500', color: Color.primary },

  section: { marginTop: Spacing.xl },
  label: { fontSize: 12, fontWeight: '600', color: Color.primary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing.sm },
  summary: { fontSize: 16, color: Color.body, lineHeight: 26, fontWeight: '500' },
  text: { fontSize: 15, color: Color.body, lineHeight: 25, marginTop: Spacing.xs },

  audioHint: {
    marginTop: Spacing.xxl,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: Color.primarySoft,
    alignItems: 'center',
  },
  audioHintText: { fontSize: 13, color: Color.primary, fontWeight: '500' },
});
