/**
 * 景点卡片 — 列表页 / 触发弹窗共用
 * 显示缩略图 + 名称 + 摘要 + 距离
 */
import { useState } from 'react';
import { View, Text, Image, StyleSheet, Pressable } from 'react-native';
import { Link } from 'expo-router';
import type { Spot } from '../types';

interface Props {
  spot: Spot;
  distance?: number | null;
  onPress?: () => void;
}

const PLACEHOLDER = require('../assets/icon.png');

export default function SpotCard({ spot, distance, onPress }: Props) {
  const [imageError, setImageError] = useState(false);

  const imageSource =
    spot.imageUrl && !imageError ? { uri: spot.imageUrl } : PLACEHOLDER;

  const content = (
    <View style={[styles.card, !spot.isActive && styles.inactive]}>
      <Image
        source={imageSource}
        style={styles.image}
        resizeMode="cover"
        onError={() => setImageError(true)}
      />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {spot.name}
          {!spot.isActive && <Text style={styles.badge}> 停用</Text>}
        </Text>
        {spot.summary ? (
          <Text style={styles.summary} numberOfLines={2}>{spot.summary}</Text>
        ) : null}
        {distance != null && (
          <Text style={styles.distance}>
            {distance < 1000
              ? `${Math.round(distance)}m`
              : `${(distance / 1000).toFixed(1)}km`}
          </Text>
        )}
      </View>
    </View>
  );

  if (onPress) {
    return <Pressable onPress={onPress}>{content}</Pressable>;
  }

  return (
    <Link href={`/spot/${spot.id}`} asChild>
      <Pressable>{content}</Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 6,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },
  inactive: { opacity: 0.5 },
  image: {
    width: 88,
    height: 88,
    backgroundColor: '#f0f0f0',
  },
  body: {
    flex: 1,
    padding: 12,
    justifyContent: 'center',
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: '#222',
  },
  badge: {
    fontSize: 12,
    color: '#999',
    fontWeight: '400',
  },
  summary: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
    lineHeight: 18,
  },
  distance: {
    fontSize: 12,
    color: '#1677FF',
    fontWeight: '500',
    marginTop: 6,
  },
});
