/**
 * 地图首页 — 高德原生地图 + 定位蓝点 + 景点 Marker + 导览引擎
 * v4.0 §2：打开 App 就是地图
 *
 * 方案：react-native-amap3d（高德官方 3D SDK 封装）
 * - Android 侧基于 TextureMapView 渲染，走正常 View 合成管线，
 *   天然规避 react-native-maps SurfaceView 的 z-order 遮挡问题（v4.0 §11 P0-1）。
 * - 国产无 GMS 设备原生支持，底图/坐标系均为 GCJ-02，无需瓦片叠加。
 * - MapView 仅在 initAMap() 成功后渲染，Key 异常时降级为占位页，不闪退。
 */
import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { MapView, Marker } from 'react-native-amap3d';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTourStore } from '../../stores/tourStore';
import { useUserLocation } from '../../hooks/useUserLocation';
import { useTour } from '../../hooks/useTour';
import { initAMap } from '../../services/amap';

/** 郑州大学主校区兜底初始视角（GCJ-02） */
const ZZU_CAMPUS = { latitude: 34.8172, longitude: 113.5348 };

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const hasFirstFix = useRef(false);
  /** null = 初始化中，true = 可用，false = SDK 不可用（降级占位） */
  const [amapReady, setAmapReady] = useState<boolean | null>(null);
  const { location: userLocation, isAccuracyGood } = useUserLocation();
  useTour();
  const spots = useTourStore((s) => s.spots);
  const activeSpots = spots.filter((s) => s.isActive);

  useEffect(() => {
    initAMap().then(setAmapReady);
  }, []);

  // 首次定位成功 → 移动视角到用户位置
  useEffect(() => {
    if (userLocation && !hasFirstFix.current) {
      hasFirstFix.current = true;
      mapRef.current?.moveCamera(
        { target: { latitude: userLocation.lat, longitude: userLocation.lng }, zoom: 17 },
        500,
      );
    }
  }, [userLocation]);

  if (amapReady === false) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>地图暂不可用</Text>
        <Text style={styles.fallbackText}>请检查高德 API Key 配置。{'\n'}景点列表与自动讲解不受影响。</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {amapReady && (
        <MapView
          ref={mapRef}
          style={styles.map}
          initialCameraPosition={{ target: ZZU_CAMPUS, zoom: 16 }}
          myLocationEnabled          // 原生定位蓝点（SDK 自带，含方向/精度圈）
          myLocationButtonEnabled={false}
          rotateGesturesEnabled={false}
          tiltGesturesEnabled={false}
          zoomControlsEnabled={false}
          labelsEnabled
        >
          {activeSpots.map((spot) => (
            <Marker
              key={spot.id}
              position={{ latitude: spot.lat, longitude: spot.lng }}
              onPress={() => router.push(`/spot/${spot.id}`)}
            />
          ))}
        </MapView>
      )}
      {activeSpots.length === 0 && (
        <View style={[styles.bar, { top: insets.top + 8 }]} pointerEvents="none"><Text style={styles.barText}>正在同步景点数据...</Text></View>
      )}
      {activeSpots.length > 0 && !isAccuracyGood && (
        <View style={[styles.bar, styles.barWarn, { top: insets.top + 8 }]} pointerEvents="none"><Text style={styles.barText}>⚠ 定位精度不足，自动触发已暂停</Text></View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 }, map: { flex: 1 },
  bar: { position: 'absolute', left: 16, right: 16, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, paddingVertical: 6, alignItems: 'center', zIndex: 9999 },
  barWarn: { backgroundColor: 'rgba(255,107,107,0.85)' },
  barText: { color: '#fff', fontSize: 12 },
  fallback: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5', padding: 32 },
  fallbackTitle: { fontSize: 17, fontWeight: '600', color: '#333' },
  fallbackText: { fontSize: 13, color: '#888', marginTop: 8, textAlign: 'center', lineHeight: 20 },
});
