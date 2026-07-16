/**
 * 地图首页 — 高德地图 + GPS 蓝点 + 景点 Marker + 导览引擎
 * v4.0 §2：打开 App 就是地图
 */
import { useEffect, useRef } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import MapView, { UrlTile, Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTourStore } from '../../stores/tourStore';
import { useUserLocation } from '../../hooks/useUserLocation';
import { useTour } from '../../hooks/useTour';
import {
  AMAP_TILE_URL, ZZU_CAMPUS, blueDotOuterStyle, blueDotStyle,
} from '../../utils/mapConstants';

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const hasFirstFix = useRef(false);
  const { location: userLocation, isAccuracyGood } = useUserLocation();
  useTour();
  const spots = useTourStore((s) => s.spots);
  const activeSpots = spots.filter((s) => s.isActive);

  useEffect(() => {
    if (userLocation && !hasFirstFix.current) {
      hasFirstFix.current = true;
      mapRef.current?.animateToRegion(
        { latitude: userLocation.lat, longitude: userLocation.lng, latitudeDelta: 0.004, longitudeDelta: 0.004 },
        500,
      );
    }
  }, [userLocation]);

  return (
    <View style={styles.container}>
      <MapView style={styles.map} initialRegion={ZZU_CAMPUS} ref={mapRef} showsUserLocation={false} showsMyLocationButton={false} rotateEnabled={false}>
        <UrlTile urlTemplate={AMAP_TILE_URL} maximumZ={19} flipY={false} tileSize={256} />
        {userLocation && (
          <Marker coordinate={{ latitude: userLocation.lat, longitude: userLocation.lng }} anchor={{ x: 0.5, y: 0.5 }} zIndex={100}>
            <View style={blueDotOuterStyle}><View style={blueDotStyle} /></View>
          </Marker>
        )}
        {activeSpots.map((spot) => (
          <Marker key={spot.id} coordinate={{ latitude: spot.lat, longitude: spot.lng }} title={spot.name} description={spot.summary || undefined} zIndex={50} />
        ))}
      </MapView>
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
});
