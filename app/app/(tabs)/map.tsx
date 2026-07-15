/**
 * 地图首页 — 高德地图 + GPS 蓝点 + 景点 Marker + 导览引擎
 * v4.0 §2：打开 App 就是地图
 *
 * 启动时触发全量同步 → 写入 SQLite → 载入 tourStore
 * useUserLocation 持续监听定位，useTour 自动处理触发/播放/冷却
 */
import { useEffect, useRef } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import MapView, { UrlTile, Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTourStore } from '../../stores/tourStore';
import { useUserLocation } from '../../hooks/useUserLocation';
import { useTour } from '../../hooks/useTour';
import {
  AMAP_TILE_URL,
  ZZU_CAMPUS,
  blueDotOuterStyle,
  blueDotStyle,
} from '../../utils/mapConstants';

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const hasFirstFix = useRef(false);

  // ─── Hook 注入 ──────────────────────────────────────────
  const { location: userLocation, isAccuracyGood } = useUserLocation();
  useTour(); // 导览引擎：自动订阅位置 → 触发 → 播放 → 冷却

  // ─── 景点数据（_layout.tsx 启动时已同步到 SQLite → tourStore） ──
  const spots = useTourStore((s) => s.spots);
  const activeSpots = spots.filter((s) => s.isActive);

  // ─── 首次定位：地图跟随 ─────────────────────────────────
  useEffect(() => {
    if (userLocation && !hasFirstFix.current) {
      hasFirstFix.current = true;
      mapRef.current?.animateToRegion(
        {
          latitude: userLocation.lat,
          longitude: userLocation.lng,
          latitudeDelta: 0.004,
          longitudeDelta: 0.004,
        },
        500,
      );
    }
  }, [userLocation]);

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        initialRegion={ZZU_CAMPUS}
        ref={mapRef}
        showsUserLocation={false}
        showsMyLocationButton={false}
        rotateEnabled={false}
      >
        <UrlTile urlTemplate={AMAP_TILE_URL} maximumZ={19} flipY={false} tileSize={256} />

        {/* GPS 蓝点（GCJ-02） */}
        {userLocation && (
          <Marker
            coordinate={{ latitude: userLocation.lat, longitude: userLocation.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={100}
          >
            <View style={blueDotOuterStyle}>
              <View style={blueDotStyle} />
            </View>
          </Marker>
        )}

        {/* 景点 Marker */}
        {activeSpots.map((spot) => (
          <Marker
            key={spot.id}
            coordinate={{ latitude: spot.lat, longitude: spot.lng }}
            title={spot.name}
            description={spot.summary || undefined}
            zIndex={50}
          />
        ))}
      </MapView>

      {/* 景点数据未加载 */}
      {activeSpots.length === 0 && (
        <View style={[styles.syncBar, { top: insets.top + 8 }]} pointerEvents="none">
          <Text style={styles.syncText}>正在同步景点数据...</Text>
        </View>
      )}

      {/* 精度不足提示 */}
      {activeSpots.length > 0 && !isAccuracyGood && (
        <View style={[styles.accuracyBar, { top: insets.top + 8 }]} pointerEvents="none">
          <Text style={styles.accuracyText}>⚠ 定位精度不足，自动触发已暂停</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },

  syncBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
    zIndex: 9999,
  },
  syncText: { color: '#fff', fontSize: 12 },

  accuracyBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: 'rgba(255, 107, 107, 0.85)',
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
    zIndex: 9999,
  },
  accuracyText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
