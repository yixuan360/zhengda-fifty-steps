/**
 * 景点列表页 — FlatList + pull-to-refresh + 玻璃拟态卡片（V5.4）
 *
 * 空状态通过 ListEmptyComponent 渲染在 FlatList 内部，
 * RefreshControl 始终在位，确保任何状态都能下拉触发同步。
 */
import { useEffect, useState, useCallback } from 'react';
import { View, FlatList, Text, StyleSheet, RefreshControl } from 'react-native';
import SpotCard from '../../components/SpotCard';
import { getAllSpots } from '../../services/database';
import { syncAll } from '../../services/sync';
import { haversineDistance } from '../../utils/distance';
import { useTourStore } from '../../stores/tourStore';
import { Color, Spacing } from '../../constants/theme';

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

  useEffect(() => { loadData(); }, [loadData]);

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
      contentContainerStyle={sortedSpots.length === 0 ? styles.emptyContainer : styles.list}
      style={{ backgroundColor: Color.pageBg }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[Color.primary]}
          tintColor={Color.primary}
          progressBackgroundColor="#FFFFFF"
        />
      }
      ListEmptyComponent={
        <View style={styles.centered}>
          <Text style={styles.emptyIcon}>🗺️</Text>
          <Text style={styles.hint}>{loading ? '加载中...' : '暂无景点数据'}</Text>
          {!loading && (
            <View style={styles.refreshHint}>
              <Text style={styles.subHint}>↓ 下拉刷新从服务器同步</Text>
            </View>
          )}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: Spacing.sm, paddingBottom: 100 },
  emptyContainer: { flexGrow: 1, backgroundColor: Color.pageBg },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.pageH,
  },
  emptyIcon: { fontSize: 40, marginBottom: Spacing.md },
  hint: { fontSize: 16, fontWeight: '600', color: Color.heading },
  refreshHint: {
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: 999,
    backgroundColor: Color.primarySoft,
  },
  subHint: { fontSize: 13, color: Color.primary },
});
