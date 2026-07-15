/**
 * 景点详情页 — 图片 + 描述 + 手动播放
 */
import { useEffect, useState } from 'react';
import { View, Text, Image, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { getSpotById } from '../../services/database';
import { haversineDistance } from '../../utils/distance';
import { useTourStore } from '../../stores/tourStore';
import type { Spot } from '../../types';

const PLACEHOLDER_IMG = require('../../assets/icon.png');

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
      if (Number.isNaN(spotId)) {
        setLoading(false);
        return;
      }
      const s = await getSpotById(spotId);
      setSpot(s);
      setLoading(false);
    })();
  }, [id]);

  if (!id || Number.isNaN(Number(id))) {
    return (
      <View style={styles.centered}>
        <Text style={styles.hint}>参数无效</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1677FF" />
      </View>
    );
  }

  if (!spot) {
    return (
      <View style={styles.centered}>
        <Text style={styles.hint}>景点不存在</Text>
      </View>
    );
  }

  const distance = userLocation
    ? haversineDistance(userLocation, { lat: spot.lat, lng: spot.lng })
    : null;

  return (
    <ScrollView style={styles.container}>
      <Stack.Screen options={{ title: spot.name }} />

      <Image
        source={spot.imageUrl && !imageError ? { uri: spot.imageUrl } : PLACEHOLDER_IMG}
        style={styles.image}
        resizeMode="cover"
        onError={() => setImageError(true)}
      />

      <View style={styles.body}>
        <Text style={styles.name}>{spot.name}</Text>

        {distance != null && (
          <Text style={styles.distance}>
            距您{' '}
            {distance < 1000
              ? `${Math.round(distance)}m`
              : `${(distance / 1000).toFixed(1)}km`}
          </Text>
        )}

        {spot.summary ? (
          <View style={styles.section}>
            <Text style={styles.label}>简介</Text>
            <Text style={styles.text}>{spot.summary}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.label}>详细介绍</Text>
          <Text style={styles.text}>{spot.description}</Text>
        </View>

        {spot.audioUrl && (
          <View style={styles.section}>
            <Text style={styles.label}>语音导览</Text>
            <Text style={styles.hint}>走近景点时将自动播放，或下拉播放条手动播放</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  image: {
    width: '100%',
    height: 240,
    backgroundColor: '#f0f0f0',
  },
  body: { padding: 20 },
  name: { fontSize: 22, fontWeight: '700', color: '#111' },
  distance: {
    fontSize: 14,
    color: '#1677FF',
    fontWeight: '500',
    marginTop: 8,
  },
  section: { marginTop: 20 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  text: { fontSize: 15, color: '#333', lineHeight: 24 },
  hint: { fontSize: 14, color: '#999', marginTop: 8 },
});
