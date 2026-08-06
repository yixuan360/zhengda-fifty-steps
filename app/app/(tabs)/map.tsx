/**
 * 地图首页 — 高德原生地图 + 玻璃拟态状态条 + 模拟定位调试（V5.4）
 * v4.0 §2：打开 App 就是地图
 *
 * v6 修复（问题 #2b/#3/#4）：
 *  - 弃用原生 myLocationEnabled 蓝点，改 JS 用户 Marker（mock 优先），
 *    保证"地图上看到的位置 = 引擎算的位置"，消除双定位源错位。
 *  - 用户 Marker + 回中按钮。
 *  - 触发圈可视化（Circle，半径 = spot.triggerRadius）+ 图层开关。
 *  - 模拟定位面板仅 DEBUG_UI 构建（EXPO_PUBLIC_ENABLE_DEBUG=preview）；启用前弹确认框；激活时顶部醒目黄标。
 *  - DEBUG_UI 调试面板：坐标 / 精度 / 档位 / 最近景点 / 引擎状态 / 触发记录。
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, StyleSheet, Text, TextInput, TouchableOpacity, ScrollView, Alert,
} from 'react-native';
import { MapView, Marker, Circle, Polygon, Polyline } from 'react-native-amap3d';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTourStore } from '../../stores/tourStore';
import { useUserLocation } from '../../hooks/useUserLocation';
import { useTour } from '../../hooks/useTour';
import { initAMap } from '../../services/amap';
import { getTriggerSignedDistance } from '../../utils/trigger';
import { Color, Spacing, Radius, Shadow } from '../../constants/theme';

/** 郑州大学主校区中心点（GCJ-02，42 个景点质心 + 北偏微调覆盖眉湖厚山） */
const ZZU_CAMPUS = { latitude: 34.8186, longitude: 113.5365 };

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

/** 触发圈填充/描边（主色青绿，15% 透明度） */
const CIRCLE_FILL = 'rgba(26,122,90,0.15)';
const CIRCLE_STROKE = 'rgba(26,122,90,0.45)';

/** 项目 LatLng({lat,lng}) → amap3d LatLng({latitude,longitude}) */
function toAmapLatLng(p: { lat: number; lng: number }): { latitude: number; longitude: number } {
  return { latitude: p.lat, longitude: p.lng };
}

/** 触发形状中文标签（调试面板） */
function triggerShapeLabel(s: { trigger?: { type?: string } }): string {
  switch (s.trigger?.type) {
    case 'corridor': return '走廊';
    case 'polygon': return '多边形';
    default: return '圆形';
  }
}

/**
 * 调试 UI（模拟定位面板 + 调试面板）开关。
 * 由 EAS 构建期环境变量控制：preview=true（自测带调试），production 不设（正式不含）。
 * 不能用 __DEV__ —— EAS preview/production 均为 release 构建，__DEV__ 恒为 false。
 */
const DEBUG_UI = process.env.EXPO_PUBLIC_ENABLE_DEBUG === 'true';

function DebugLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.debugRow}>
      <Text style={styles.debugLabel}>{label}</Text>
      <Text style={styles.debugValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const [amapReady, setAmapReady] = useState<boolean | null>(null);
  const { location: userLocation, isAccuracyGood, accuracy, accuracyLevel } = useUserLocation();
  useTour();
  const spots = useTourStore((s) => s.spots);
  const mockLocation = useTourStore((s) => s.mockLocation);
  const setMockLocation = useTourStore((s) => s.setMockLocation);
  const syncStatus = useTourStore((s) => s.syncStatus);
  const syncError = useTourStore((s) => s.syncError);
  const queue = useTourStore((s) => s.queue);
  const cooldowns = useTourStore((s) => s.cooldowns);
  const currentHit = useTourStore((s) => s.currentHit);
  const triggerLog = useTourStore((s) => s.triggerLog);
  const activeSpots = spots.filter((s) => s.isActive);

  const [showFences, setShowFences] = useState(true);

  useEffect(() => {
    let cancelled = false;
    initAMap().then((ready) => { if (!cancelled) setAmapReady(ready); });
    return () => { cancelled = true; };
  }, []);

  // ── 回中：把镜头移回用户当前位置 ──
  const recenter = useCallback(() => {
    const loc = useTourStore.getState().mockLocation ?? useTourStore.getState().userLocation;
    if (!loc) return;
    mapRef.current?.moveCamera(
      { target: { latitude: loc.lat, longitude: loc.lng }, zoom: 16 },
      300,
    );
  }, []);

  // ── 最近景点（调试面板用）：d = 到区域有符号距离（负=区内，越小越深入） ──
  const nearest = useMemo(() => {
    if (!userLocation || activeSpots.length === 0) return null;
    let best: { name: string; d: number; shape: string } | null = null;
    for (const s of activeSpots) {
      const d = getTriggerSignedDistance(userLocation, s);
      if (!best || d < best.d) best = { name: s.name, d: Math.round(d), shape: triggerShapeLabel(s) };
    }
    return best;
  }, [userLocation, activeSpots]);

  // ── 模拟定位面板（仅 __DEV__）：5 击触发 ──
  const [mockVisible, setMockVisible] = useState(false);
  const [mockLatInput, setMockLatInput] = useState('');
  const [mockLngInput, setMockLngInput] = useState('');
  const [debugOpen, setDebugOpen] = useState(false);
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
    Alert.alert(
      '启用模拟定位',
      `将忽略真实 GPS，使用坐标 (${lat.toFixed(5)}, ${lng.toFixed(5)})。\n仅用于演示/调试，确定继续？`,
      [
        { text: '取消', style: 'cancel' },
        { text: '确定', onPress: () => setMockLocation({ lat, lng }) },
      ],
    );
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

  const accuracyText = accuracy != null ? `${accuracy.toFixed(0)}m` : '--';

  return (
    <View style={styles.container}>
      {amapReady && (
        <MapView
          ref={mapRef}
          style={styles.map}
          initialCameraPosition={{ target: ZZU_CAMPUS, zoom: 15, tilt: 0 }}
          myLocationButtonEnabled={false}
          rotateGesturesEnabled={false}
          tiltGesturesEnabled={false}
          zoomControlsEnabled={false}
          labelsEnabled
        >
          {/* 触发围栏可视化（可开关）：circle→圆，corridor→中心线，polygon→多边形 */}
          {showFences && activeSpots.map((s) => {
            const t = s.trigger;
            if (t?.type === 'corridor' && (t.points?.length ?? 0) >= 2) {
              return (
                <Polyline
                  key={`f-${s.id}`}
                  points={t.points!.map(toAmapLatLng)}
                  width={2.5}
                  color={CIRCLE_STROKE}
                  zIndex={5}
                />
              );
            }
            if (t?.type === 'polygon' && (t.points?.length ?? 0) >= 3) {
              // 渲染时闭合环形（首点补到末位），保证原生 Polygon 绘制完整
              const ring = t.points!.map(toAmapLatLng);
              ring.push(ring[0]);
              return (
                <Polygon
                  key={`f-${s.id}`}
                  points={ring}
                  fillColor={CIRCLE_FILL}
                  strokeColor={CIRCLE_STROKE}
                  strokeWidth={1.5}
                  zIndex={5}
                />
              );
            }
            return (
              <Circle
                key={`f-${s.id}`}
                center={{ latitude: s.lat, longitude: s.lng }}
                radius={s.triggerRadius}
                fillColor={CIRCLE_FILL}
                strokeColor={CIRCLE_STROKE}
                strokeWidth={1.5}
              />
            );
          })}

          {/* 景点 Marker */}
          {activeSpots.map((spot) => (
            <Marker
              key={spot.id}
              position={{ latitude: spot.lat, longitude: spot.lng }}
              onPress={() => router.push(`/spot/${spot.id}`)}
            />
          ))}

          {/* 用户位置 Marker（mock 优先，与引擎同一数据源） */}
          {userLocation && (
            <Marker
              position={{ latitude: userLocation.lat, longitude: userLocation.lng }}
              zIndex={1000}
            >
              <View style={styles.userDot}>
                <View style={styles.userDotCore} />
              </View>
            </Marker>
          )}
        </MapView>
      )}

      {/* ── 状态提示条 ── */}
      {syncStatus === 'idle' && activeSpots.length === 0 && (
        <View style={[styles.bar, styles.barInfo, { top: insets.top + Spacing.md }]} pointerEvents="none">
          <Text style={styles.barInfoText}>⏳ 正在加载景点数据...</Text>
        </View>
      )}
      {syncStatus === 'syncing' && (
        <View style={[styles.bar, styles.barInfo, { top: insets.top + Spacing.md }]} pointerEvents="none">
          <Text style={styles.barInfoText}>⏳ 正在同步景点数据...</Text>
        </View>
      )}
      {syncStatus === 'error' && (
        <View style={[styles.bar, activeSpots.length === 0 ? styles.barWarn : styles.barInfo, { top: insets.top + Spacing.md }]} pointerEvents="none">
          <Text style={activeSpots.length === 0 ? styles.barWarnText : styles.barInfoText}>
            {syncError ?? (activeSpots.length === 0 ? '⚠ 网络连接失败，请检查网络后下拉刷新' : '⚠ 同步失败，显示的是缓存数据')}
          </Text>
        </View>
      )}
      {syncStatus === 'done' && activeSpots.length === 0 && (
        <View style={[styles.bar, styles.barInfo, { top: insets.top + Spacing.md }]} pointerEvents="none">
          <Text style={styles.barInfoText}>📭 暂无景点数据，请在管理后台添加</Text>
        </View>
      )}

      {/* 定位精度：poor 档（滞回后）→ 暂停横幅，显示实测精度 */}
      {syncStatus !== 'syncing' && !mockLocation && activeSpots.length > 0 && userLocation != null && !isAccuracyGood && (
        <View style={[styles.bar, styles.barWarn, { top: insets.top + Spacing.md }]} pointerEvents="none">
          <Text style={styles.barWarnText}>⚠ 定位精度不足（当前 {accuracyText}，需 ≤50m），自动触发已暂停</Text>
        </View>
      )}
      {/* 定位精度：fair 档 → 可触发但提示 */}
      {syncStatus !== 'syncing' && !mockLocation && activeSpots.length > 0 && userLocation != null && isAccuracyGood && accuracyLevel === 'fair' && (
        <View style={[styles.bar, styles.barFair, { top: insets.top + Spacing.md }]} pointerEvents="none">
          <Text style={styles.barFairText}>◐ 定位精度一般（{accuracyText}），可能偶发误触发</Text>
        </View>
      )}
      {/* 模拟定位：醒目黄色常驻标签 */}
      {mockLocation && syncStatus !== 'syncing' && (
        <View style={[styles.bar, styles.barMock, { top: insets.top + Spacing.md }]} pointerEvents="none">
          <Text style={styles.barMockText}>
            ⚠️ 模拟定位中：{mockLocation.lat.toFixed(5)}, {mockLocation.lng.toFixed(5)}（真实 GPS 已忽略）
          </Text>
        </View>
      )}

      {/* ── 触发围栏图层开关（右上，始终可用） ── */}
      <TouchableOpacity
        style={[styles.circleToggle, { top: insets.top + 60, right: Spacing.pageH }]}
        onPress={() => setShowFences((v) => !v)}
        activeOpacity={0.8}
        hitSlop={8}
      >
        <Ionicons name={showFences ? 'radio-button-on' : 'radio-button-off'} size={20} color={showFences ? Color.primary : Color.caption} />
      </TouchableOpacity>

      {/* ── 回中按钮（右下） ── */}
      {userLocation && (
        <TouchableOpacity
          style={[styles.recenterBtn, { right: Spacing.pageH, bottom: insets.bottom + 78 }]}
          onPress={recenter}
          activeOpacity={0.8}
          hitSlop={8}
        >
          <Ionicons name="locate" size={20} color={Color.primary} />
        </TouchableOpacity>
      )}

      {/* ── 调试 UI：模拟定位调试 + 调试面板（仅 DEBUG_UI 构建） ── */}
      {DEBUG_UI && (
        <>
          {/* 5 击触发器（右上角小字） */}
          <TouchableOpacity
            style={[styles.debugTrigger, { top: insets.top + 60, left: Spacing.pageH }]}
            onPress={handleDebugTap}
            activeOpacity={0.6}
            hitSlop={12}
          >
            <Text style={styles.debugTriggerText}>模拟</Text>
          </TouchableOpacity>

          {/* 模拟定位面板 */}
          {mockVisible && (
            <ScrollView
              style={[styles.mockPanel, { top: insets.top + 100 }]}
              contentContainerStyle={styles.mockPanelInner}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.mockTitle}>🧪 模拟定位调试</Text>

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

          {/* 调试面板（底部可折叠） */}
          <View style={[styles.debugPanel, { left: Spacing.pageH, right: Spacing.pageH, bottom: insets.bottom + 8 }]}>
            <TouchableOpacity
              style={styles.debugHeader}
              onPress={() => setDebugOpen((o) => !o)}
              activeOpacity={0.7}
            >
              <Text style={styles.debugHeaderText}>🔍 调试面板 {debugOpen ? '▾' : '▸'}</Text>
            </TouchableOpacity>
            {debugOpen && (
              <View style={styles.debugBody}>
                <DebugLine label="坐标" value={userLocation ? `${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)}` : '未获取'} />
                <DebugLine label="精度" value={`${accuracyText} · ${accuracyLevel ?? '--'}${mockLocation ? '（模拟）' : ''}`} />
                <DebugLine label="门控" value={isAccuracyGood ? '可触发' : '已暂停(连续poor)'} />
                <DebugLine label="最近景点" value={nearest ? `${nearest.name} · d=${nearest.d}m · ${nearest.shape}` : '无'} />
                <DebugLine label="引擎" value={`冷却${Object.keys(cooldowns).length} · 队列${queue.length} · 当前${currentHit?.spot.name ?? '无'}`} />
                <DebugLine label="触发记录" value={triggerLog.length ? triggerLog.map((t) => t.spotName).join(' → ') : '无'} />
              </View>
            )}
          </View>
        </>
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
  barFair: { backgroundColor: 'rgba(198,123,75,0.92)', borderColor: 'rgba(198,123,75,0.3)' },
  barFairText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  barMock: { backgroundColor: 'rgba(240,180,41,0.95)', borderColor: 'rgba(240,180,41,0.5)' },
  barMockText: { fontSize: 12, fontWeight: '700', color: '#3D2E00' },

  // ── 用户位置 Marker（蓝点） ──
  userDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(26,122,90,0.25)',
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.elevated,
  },
  userDotCore: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Color.primary,
  },

  // ── 浮层按钮 ──
  circleToggle: {
    position: 'absolute',
    zIndex: 9998,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Color.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.cardBorder,
    ...Shadow.card,
  },
  recenterBtn: {
    position: 'absolute',
    zIndex: 9998,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Color.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.cardBorder,
    ...Shadow.card,
  },

  // ── 模拟触发（__DEV__） ──
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

  // ── 模拟面板（__DEV__） ──
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

  // ── 调试面板（__DEV__） ──
  debugPanel: {
    position: 'absolute',
    zIndex: 9997,
    backgroundColor: 'rgba(20,22,26,0.92)',
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  debugHeader: { paddingVertical: 8, paddingHorizontal: Spacing.md },
  debugHeaderText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  debugBody: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.md, gap: 4 },
  debugRow: { flexDirection: 'row', alignItems: 'flex-start' },
  debugLabel: { width: 64, fontSize: 11, color: 'rgba(255,255,255,0.55)' },
  debugValue: { flex: 1, fontSize: 11, color: '#fff' },

  fallback: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  fallbackTitle: { fontSize: 17, fontWeight: '600', marginBottom: 8 },
  fallbackText: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
