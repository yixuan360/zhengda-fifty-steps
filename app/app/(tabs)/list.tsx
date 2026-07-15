/**
 * 景点列表页 — FlatList + pull-to-refresh
 * 排序：按距离（有定位时）/ 按名称（无定位时）
 */
import { useEffect, useState, useCallback } from 'react';
import { View, FlatList, Text, StyleSheet, RefreshControl } from 'react-native';
import SpotCard from '../../components/SpotCard';
import { getAllSpots } from '../../services/database';
import { syncAll } from '../../services/sync';
import { haversineDistance } from '../../utils/distance';
import { useTourStore } from '../../stores/tourStore';
import type { Spot } from '../../types';

export default function ListScreen() {
  const { spots, setSpots, userLocation } = useTourStore();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const localSpots = await getAllSpots();
      setSpots(localSpots);
    } finally {
      setLoading(false);
    }
  }, [setSpots]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await syncAll();
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const sortedSpots = [...spots].sort((a, b) => {
    if (userLocation) {
      const da = haversineDistance(userLocation, { lat: a.lat, lng: a.lng });
      const db = haversineDistance(userLocation, { lat: b.lat, lng: b.lng });
      return da - db;
    }
    return a.name.localeCompare(b.name, 'zh');
  });

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text style={styles.hint}>加载中...</Text>
      </View>
    );
  }

  if (sortedSpots.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.hint}>暂无景点数据</Text>
        <Text style={styles.subHint}>
          {typeof navigator !== 'undefined' && !navigator.onLine
            ? '当前无网络，请连接网络后下拉刷新'
            : '下拉刷新从服务器同步'}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={sortedSpots}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => {
        const dist = userLocation
          ? haversineDistance(userLocation, { lat: item.lat, lng: item.lng })
          : null;
        return <SpotCard spot={item} distance={dist} />;
      }}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: 8 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  hint: { fontSize: 16, color: '#666' },
  subHint: { fontSize: 13, color: '#999', marginTop: 8 },
});
