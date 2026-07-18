/**
 * 地图首页 — 高德原生地图 + 玻璃拟态状态条（V5.4）
 * v4.0 §2：打开 App 就是地图
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
import { Color, Spacing, Radius, Shadow } from '../../constants/theme';

/** 郑州大学主校区兜底初始视角（GCJ-02） */
const ZZU_CAMPUS = { latitude: 34.8172, longitude: 113.5348 };

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const hasFirstFix = useRef(false);
  const [amapReady, setAmapReady] = useState<boolean | null>(null);
  const { location: userLocation, isAccuracyGood } = useUserLocation();
  useTour();
  const spots = useTourStore((s) => s.spots);
  const activeSpots = spots.filter((s) => s.isActive);

  useEffect(() => { initAMap().then(setAmapReady); }, []);

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
      <View style={[styles.fallback, { backgroundColor: Color.pageBg }]}>
        <Text style={[styles.fallbackTitle, { color: Color.heading }]}>地图暂不可用</Text>
        <Text style={[styles.fallbackText, { color: Color.caption }]}>
          请检查高德 API Key 配置。{'\n'}景点列表与自动讲解不受影响。
        </Text>
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
          myLocationEnabled
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

      {/* 玻璃拟态状态提示条 */}
      {activeSpots.length === 0 && (
        <View style={[styles.bar, styles.barInfo, { top: insets.top + Spacing.md }]} pointerEvents="none">
          <Text style={styles.barInfoText}>正在同步景点数据...</Text>
        </View>
      )}
      {activeSpots.length > 0 && !isAccuracyGood && (
        <View style={[styles.bar, styles.barWarn, { top: insets.top + Spacing.md }]} pointerEvents="none">
          <Text style={styles.barWarnText}>⚠ 定位精度不足，自动触发已暂停</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  bar: {
    position: 'absolute',
    left: Spacing.pageH,
    right: Spacing.pageH,
    borderRadius: Radius.pill,
    paddingVertical: 10,
    alignItems: 'center',
    zIndex: 9999,
    borderWidth: StyleSheet.hairlineWidth,
    ...Shadow.card,
  },
  barInfo: {
    backgroundColor: Color.cardBg,
    borderColor: Color.cardBorder,
  },
  barInfoText: { fontSize: 13, fontWeight: '600', color: Color.heading },
  barWarn: {
    backgroundColor: Color.warningBg,
    borderColor: 'rgba(217,74,74,0.3)',
  },
  barWarnText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  fallback: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  fallbackTitle: { fontSize: 17, fontWeight: '600', marginBottom: 8 },
  fallbackText: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
