/**
 * 景点卡片 — 玻璃拟态 + 左侧青色竖条 + 胶囊距离标签（V5.4）
 */
import { useState } from 'react';
import { View, Text, Image, StyleSheet, Pressable } from 'react-native';
import { Link } from 'expo-router';
import { Color, Spacing, Radius, Shadow } from '../constants/theme';
import type { Spot } from '../types';

interface Props {
  spot: Spot;
  distance?: number | null;
  onPress?: () => void;
}

const PLACEHOLDER = require('../assets/icon.png');

/** 距离格式化 */
function fmtDist(m: number): string {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

export default function SpotCard({ spot, distance, onPress }: Props) {
  const [imageError, setImageError] = useState(false);

  const imageSource =
    spot.imageUrl && !imageError ? { uri: spot.imageUrl } : PLACEHOLDER;

  const content = (
    <View style={[styles.card, !spot.isActive && styles.inactive]}>
      {/* 缩略图 */}
      <Image
        source={imageSource}
        style={styles.image}
        resizeMode="cover"
        onError={() => setImageError(true)}
      />

      {/* 左侧青色竖条（玻璃拟态的视觉焦点） */}
      <View style={styles.accentStripe} />

      {/* 正文 */}
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {spot.name}
          {!spot.isActive && <Text style={styles.badge}> · 停用</Text>}
        </Text>
        {spot.summary ? (
          <Text style={styles.summary} numberOfLines={2}>{spot.summary}</Text>
        ) : null}

        {/* 距离胶囊 */}
        {distance != null && (
          <View style={styles.distanceTag}>
            <Text style={styles.distanceText}>{fmtDist(distance)}</Text>
          </View>
        )}
      </View>
    </View>
  );

  if (onPress) {
    return <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>{content}</Pressable>;
  }

  return (
    <Link href={`/spot/${spot.id}`} asChild>
      <Pressable style={({ pressed }) => pressed && styles.pressed}>{content}</Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: Color.cardBg,
    borderRadius: Radius.lg,
    marginHorizontal: Spacing.pageH,
    marginVertical: Spacing.sm,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.cardBorder,
    ...Shadow.card,
  },
  inactive: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  image: {
    width: 100,
    height: 100,
    backgroundColor: Color.divider,
    borderTopLeftRadius: Radius.lg,
    borderBottomLeftRadius: Radius.lg,
  },
  accentStripe: {
    width: 4,
    backgroundColor: Color.primary,
    marginRight: Spacing.md,
  },
  body: {
    flex: 1,
    paddingVertical: Spacing.lg,
    paddingRight: Spacing.lg,
    justifyContent: 'center',
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
    color: Color.heading,
    letterSpacing: -0.2,
  },
  badge: {
    fontSize: 13,
    color: Color.caption,
    fontWeight: '400',
  },
  summary: {
    fontSize: 13,
    color: Color.body,
    marginTop: Spacing.xs,
    lineHeight: 19,
  },
  distanceTag: {
    alignSelf: 'flex-start',
    marginTop: Spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    backgroundColor: Color.distanceBg,
  },
  distanceText: {
    fontSize: 12,
    fontWeight: '600',
    color: Color.primary,
  },
});
