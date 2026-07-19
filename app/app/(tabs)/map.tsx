/**
 * 地图首页 — 高德原生地图 + 玻璃拟态状态条 + 模拟定位调试（V5.4）
 * v4.0 §2：打开 App 就是地图
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, StyleSheet, Text, TextInput, TouchableOpacity, ScrollView,
} from 'react-native';
import { MapView, Marker } from 'react-native-amap3d';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTourStore } from '../../stores/tourStore';
import { useUserLocation } from '../../hooks/useUserLocation';
import { useTour } from '../../hooks/useTour';
import { initAMap } from '../../services/amap';
import { Color, Spacing, Radius, Shadow } from '../../constants/theme';

/** 郑州大学主校区中心点（GCJ-02，标定边界西南+东北取中） */
const ZZU_CAMPUS = { latitude: 34.8175, longitude: 113.5354 };

/** 5 次点击激活模拟定位面板 */
const DEBUG_TAP_COUNT = 5;

/** 快捷模拟点（GCJ-02，郑大主校区核心地标） */
const QUICK_POINTS = [
  { label: '钟楼', lat: 34.8179, lng: 113.5373 },
  { label: '南门', lat: 34.8085, lng: 113.5355 },
  { label: '图书馆', lat: 34.8184, lng: 113.5387 },
  { label: '眉湖', lat: 34.8170, lng: 113.5336 },
  { label: '厚山', lat: 34.8221, lng: 113.5354 },
  { label: '樱花林', lat: 34.8160, lng: 113.5343 },
] as const;

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [amapReady, setAmapReady] = useState<boolean | null>(null);
  const { location: userLocation, isAccuracyGood } = useUserLocation();
  useTour();
  const spots = useTourStore((s) => s.spots);
  const mockLocation = useTourStore((s) => s.mockLocation);
  const setMockLocation = useTourStore((s) => s.setMockLocation);
  const activeSpots = spots.filter((s) => s.isActive);

  useEffect(() => { initAMap().then(setAmapReady); }, []);

  // ── 模拟定位面板：5 击触发 ──
  const [mockVisible, setMockVisible] = useState(false);
  const [mockLatInput, setMockLatInput] = useState('');
  const [mockLngInput, setMockLngInput] = useState('');
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDebugTap = useCallback(() => {
    tapCount.current += 1;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    if (tapCount.current >= DEBUG_TAP_COUNT) {
      tapCount.current = 0;
      setMockVisible((v) => !v);
      return;
    }
    tapTimer.current = setTimeout(() => { tapCount.current = 0; }, 1500);
  }, []);

  const applyMock = useCallback((lat: number, lng: number) => {
    setMockLocation({ lat, lng });
  }, [setMockLocation]);

  const clearMock = useCallback(() => {
    setMockLocation(null);
    setMockLatInput('');
    setMockLngInput('');
  }, [setMockLocation]);

  const handleCustomApply = useCallback(() => {
    const lat = parseFloat(mockLatInput);
    const lng = parseFloat(mockLngInput);
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      applyMock(lat, lng);
    }
  }, [mockLatInput, mockLngInput, applyMock]);

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

      {/* ── 状态提示条 ── */}
      {activeSpots.length === 0 && (
        <View style={[styles.bar, styles.barInfo, { top: insets.top + Spacing.md }]} pointerEvents="none">
          <Text style={styles.barInfoText}>正在同步景点数据...</Text>
        </View>
      )}
      {activeSpots.length > 0 && !isAccuracyGood && !mockLocation && (
        <View style={[styles.bar, styles.barWarn, { top: insets.top + Spacing.md }]} pointerEvents="none">
          <Text style={styles.barWarnText}>⚠ 定位精度不足，自动触发已暂停</Text>
        </View>
      )}
      {mockLocation && (
        <View style={[styles.bar, styles.barMock, { top: insets.top + Spacing.md }]} pointerEvents="none">
          <Text style={styles.barMockText}>
            🧪 模拟定位中：{mockLocation.lat.toFixed(5)}, {mockLocation.lng.toFixed(5)}（精度固定 5m）
          </Text>
        </View>
      )}

      {/* ── 5 击触发器（右上角小字） ── */}
      <TouchableOpacity
        style={[styles.debugTrigger, { top: insets.top + 60, right: Spacing.pageH }]}
        onPress={handleDebugTap}
        activeOpacity={0.6}
        hitSlop={12}
      >
        <Text style={styles.debugTriggerText}>模拟</Text>
      </TouchableOpacity>

      {/* ── 模拟定位面板 ── */}
      {mockVisible && (
        <ScrollView
          style={[styles.mockPanel, { top: insets.top + 100 }]}
          contentContainerStyle={styles.mockPanelInner}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.mockTitle}>🧪 模拟定位调试</Text>

          {/* 快捷定位 */}
          <Text style={styles.mockLabel}>快捷定位</Text>
          <View style={styles.mockQuickRow}>
            {QUICK_POINTS.map((p) => (
              <TouchableOpacity
                key={p.label}
                style={styles.mockQuickBtn}
                onPress={() => applyMock(p.lat, p.lng)}
                activeOpacity={0.7}
              >
                <Text style={styles.mockQuickText}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 自定义经纬度 */}
          <Text style={styles.mockLabel}>自定义坐标（GCJ-02）</Text>
          <View style={styles.mockInputRow}>
            <TextInput
              style={styles.mockInput}
              placeholder="纬度 lat"
              placeholderTextColor={Color.caption}
              value={mockLatInput}
              onChangeText={setMockLatInput}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={styles.mockInput}
              placeholder="经度 lng"
              placeholderTextColor={Color.caption}
              value={mockLngInput}
              onChangeText={setMockLngInput}
              keyboardType="decimal-pad"
            />
            <TouchableOpacity style={styles.mockApplyBtn} onPress={handleCustomApply} activeOpacity={0.7}>
              <Text style={styles.mockApplyText}>定位</Text>
            </TouchableOpacity>
          </View>

          {/* 清除 */}
          {mockLocation && (
            <TouchableOpacity style={styles.mockClearBtn} onPress={clearMock} activeOpacity={0.7}>
              <Text style={styles.mockClearText}>✕ 清除模拟定位，恢复真实 GPS</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.mockCloseBtn}
            onPress={() => setMockVisible(false)}
            activeOpacity={0.7}
          >
            <Text style={styles.mockCloseText}>关闭面板</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },

  // ── 状态条 ──
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
  barInfo: { backgroundColor: Color.cardBg, borderColor: Color.cardBorder },
  barInfoText: { fontSize: 13, fontWeight: '600', color: Color.heading },
  barWarn: { backgroundColor: Color.warningBg, borderColor: 'rgba(217,74,74,0.3)' },
  barWarnText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  barMock: { backgroundColor: 'rgba(26,122,90,0.88)', borderColor: 'rgba(26,122,90,0.5)' },
  barMockText: { fontSize: 12, fontWeight: '600', color: '#fff' },

  // ── 模拟触发 ──
  debugTrigger: {
    position: 'absolute',
    zIndex: 9998,
    padding: 6,
  },
  debugTriggerText: {
    fontSize: 11,
    fontWeight: '300',
    color: Color.caption,
    opacity: 0.5,
  },

  // ── 模拟面板 ──
  mockPanel: {
    position: 'absolute',
    left: Spacing.pageH,
    right: Spacing.pageH,
    maxHeight: 360,
    borderRadius: Radius.lg,
    backgroundColor: Color.cardBg,
    borderWidth: 1,
    borderColor: Color.primary,
    zIndex: 10000,
    ...Shadow.elevated,
  },
  mockPanelInner: { padding: Spacing.lg },
  mockTitle: { fontSize: 16, fontWeight: '700', color: Color.primary, marginBottom: Spacing.md },
  mockLabel: { fontSize: 12, fontWeight: '600', color: Color.caption, marginBottom: Spacing.sm, marginTop: Spacing.sm },
  mockQuickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  mockQuickBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Color.primarySoft,
  },
  mockQuickText: { fontSize: 12, fontWeight: '500', color: Color.primary },
  mockInputRow: { flexDirection: 'row', gap: 6 },
  mockInput: {
    flex: 1,
    height: 38,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Color.divider,
    paddingHorizontal: 10,
    fontSize: 13,
    color: Color.heading,
    backgroundColor: '#fff',
  },
  mockApplyBtn: {
    height: 38,
    paddingHorizontal: 16,
    borderRadius: Radius.sm,
    backgroundColor: Color.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mockApplyText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  mockClearBtn: {
    marginTop: Spacing.md,
    paddingVertical: 10,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Color.error,
    alignItems: 'center',
  },
  mockClearText: { fontSize: 13, fontWeight: '500', color: Color.error },
  mockCloseBtn: {
    marginTop: Spacing.sm,
    paddingVertical: 8,
    alignItems: 'center',
  },
  mockCloseText: { fontSize: 12, color: Color.caption },

  fallback: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  fallbackTitle: { fontSize: 17, fontWeight: '600', marginBottom: 8 },
  fallbackText: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
