/**
 * 地图测试页（Expo Go 兼容版）
 *
 * 功能：
 * 1. expo-location 获取 WGS-84 原始定位（需要真机/有 GMS 的模拟器）
 * 2. 手动输入 WGS-84 坐标，测试 GCJ-02 转换
 * 3. 页面显示：原始坐标、转换后坐标、偏移量、精度
 *
 * 注意：本页不含 MapView，纯文本展示，可在 Expo Go 中直接运行。
 * 模拟器无 GPS 时可使用手动输入模式验证坐标转换算法。
 */
import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TouchableOpacity,
  ScrollView,
  TextInput,
} from 'react-native';
import * as Location from 'expo-location';
import { wgs84ToGcj02 } from '../../utils/coordinate';

/** 郑州大学 WGS-84 近似坐标 */
const ZZU_WGS84 = { lat: 34.812, lng: 113.528 };

export default function MapTestScreen() {
  // ===== 自动定位 =====
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [autoLat, setAutoLat] = useState<number | null>(null);
  const [autoLng, setAutoLng] = useState<number | null>(null);
  const [autoGcjLat, setAutoGcjLat] = useState<number | null>(null);
  const [autoGcjLng, setAutoGcjLng] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [isAccuracyGood, setIsAccuracyGood] = useState(false);
  const [updateCount, setUpdateCount] = useState(0);
  const [locError, setLocError] = useState<string | null>(null);
  const [locStatus, setLocStatus] = useState<string>('⏳ 等待权限...');

  // ===== 手动输入 =====
  const [manualLat, setManualLat] = useState(String(ZZU_WGS84.lat));
  const [manualLng, setManualLng] = useState(String(ZZU_WGS84.lng));
  const [manualResult, setManualResult] = useState<{
    lat: number;
    lng: number;
    offsetM: number;
  } | null>(null);

  // ===== 自动定位 =====
  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;

        if (status !== 'granted') {
          setLocError('定位权限被拒绝');
          setLocStatus('⚠️ 权限被拒绝，请使用手动输入模式');
          return;
        }
        setPermissionGranted(true);
        setLocStatus('✅ 权限已授予，等待位置更新...');

        // 先试一次 getCurrentPositionAsync
        try {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          if (!cancelled && pos?.coords) {
            const { latitude, longitude, accuracy: acc } = pos.coords;
            console.log(
              `[P0-2] getCurrentPosition WGS-84: lat=${latitude.toFixed(6)} lng=${longitude.toFixed(6)} acc=${acc?.toFixed(1) ?? 'N/A'}m`,
            );
            setAutoLat(latitude);
            setAutoLng(longitude);
            setAccuracy(acc ?? null);
            setIsAccuracyGood(acc != null && acc <= 20);
            const gcj = wgs84ToGcj02(latitude, longitude);
            setAutoGcjLat(gcj.lat);
            setAutoGcjLng(gcj.lng);
            setUpdateCount((c) => c + 1);
            setLocStatus('✅ 定位成功（getCurrentPosition）');
          }
        } catch (e) {
          console.warn('[P0-2] getCurrentPositionAsync 失败，尝试 watchPositionAsync:', e);
          setLocStatus('⚠️ 快速定位失败，尝试持续监听...');
        }

        // 备用：watchPositionAsync
        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 2000,
            distanceInterval: 0,
          },
          (loc) => {
            if (cancelled) return;
            try {
              const { latitude, longitude, accuracy: acc } = loc.coords;
              console.log(
                `[P0-2] watchPosition WGS-84: lat=${latitude.toFixed(6)} lng=${longitude.toFixed(6)} acc=${acc?.toFixed(1) ?? 'N/A'}m`,
              );
              setAutoLat(latitude);
              setAutoLng(longitude);
              setAccuracy(acc ?? null);
              setIsAccuracyGood(acc != null && acc <= 20);
              const gcj = wgs84ToGcj02(latitude, longitude);
              setAutoGcjLat(gcj.lat);
              setAutoGcjLng(gcj.lng);
              setUpdateCount((c) => c + 1);
              setLocStatus('✅ 持续定位中...');
            } catch (e) {
              console.error('[P0-2] 位置回调异常:', e);
            }
          },
        );
      } catch (e) {
        if (!cancelled) {
          console.error('[P0-2] 定位初始化失败:', e);
          setLocError(String(e));
          setLocStatus('❌ 定位服务不可用，请使用手动输入模式');
        }
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  // ===== 手动坐标转换 =====
  const handleManualConvert = useCallback(() => {
    const lat = parseFloat(manualLat);
    const lng = parseFloat(manualLng);
    if (isNaN(lat) || isNaN(lng)) {
      Alert.alert('输入错误', '请输入有效的经纬度数值');
      return;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      Alert.alert('输入错误', '纬度范围 -90~90，经度范围 -180~180');
      return;
    }
    const gcj = wgs84ToGcj02(lat, lng);
    const deltaLat = gcj.lat - lat;
    const deltaLng = gcj.lng - lng;
    const offsetM = Math.sqrt(
      (deltaLat * 111320) ** 2 +
        (deltaLng * 111320 * Math.cos((lat * Math.PI) / 180)) ** 2,
    );
    setManualResult({ lat: gcj.lat, lng: gcj.lng, offsetM });
    console.log(
      `[P0-2] 手动转换: WGS-84(${lat}, ${lng}) → GCJ-02(${gcj.lat.toFixed(6)}, ${gcj.lng.toFixed(6)}) 偏移=${offsetM.toFixed(1)}m`,
    );
  }, [manualLat, manualLng]);

  const autoDeltaLat =
    autoGcjLat != null && autoLat != null ? autoGcjLat - autoLat : null;
  const autoDeltaLng =
    autoGcjLng != null && autoLng != null ? autoGcjLng - autoLng : null;
  const autoOffsetM =
    autoDeltaLat != null && autoDeltaLng != null
      ? Math.sqrt(
          (autoDeltaLat * 111320) ** 2 +
            (autoDeltaLng * 111320 * Math.cos(((autoLat ?? 0) * Math.PI) / 180)) ** 2,
        )
      : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 标题 */}
      <Text style={styles.title}>📍 P0-2 坐标转换验证</Text>

      {/* ==================== 自动定位 ==================== */}
      <Text style={styles.section}>📡 自动定位（expo-location）</Text>
      <Text style={styles.status}>{locStatus}</Text>
      {locError && <Text style={styles.errorText}>{locError}</Text>}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>WGS-84 原始坐标</Text>
        {autoLat != null ? (
          <>
            <Text style={styles.coordRow}>
              lat: <Text style={styles.mono}>{autoLat.toFixed(8)}</Text>
            </Text>
            <Text style={styles.coordRow}>
              lng: <Text style={styles.mono}>{autoLng?.toFixed(8)}</Text>
            </Text>
          </>
        ) : (
          <Text style={styles.waiting}>等待定位...</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>GCJ-02 转换坐标</Text>
        {autoGcjLat != null ? (
          <>
            <Text style={styles.coordRow}>
              lat: <Text style={styles.mono}>{autoGcjLat.toFixed(8)}</Text>
            </Text>
            <Text style={styles.coordRow}>
              lng: <Text style={styles.mono}>{autoGcjLng?.toFixed(8)}</Text>
            </Text>
          </>
        ) : (
          <Text style={styles.waiting}>—</Text>
        )}
      </View>

      {autoOffsetM != null && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>偏移量</Text>
          <Text style={styles.coordRow}>
            Δlat: <Text style={styles.mono}>{autoDeltaLat!.toFixed(6)}°</Text>
            {'  '}Δlng:{' '}
            <Text style={styles.mono}>{autoDeltaLng!.toFixed(6)}°</Text>
          </Text>
          <Text style={styles.coordRow}>
            距离:{' '}
            <Text
              style={[
                styles.mono,
                {
                  color:
                    autoOffsetM >= 100 && autoOffsetM <= 700
                      ? '#4CAF50'
                      : '#FF6B6B',
                },
              ]}
            >
              {autoOffsetM.toFixed(1)}m
            </Text>
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>定位精度</Text>
        <Text
          style={[
            styles.bigValue,
            {
              color:
                accuracy == null
                  ? '#888'
                  : isAccuracyGood
                    ? '#4CAF50'
                    : '#FF6B6B',
            },
          ]}
        >
          {accuracy != null ? `${accuracy.toFixed(1)}m` : '—'}
        </Text>
        <Text style={styles.hint}>
          更新次数: {updateCount}
          {accuracy != null &&
            (isAccuracyGood ? '  ✓ ≤20m' : '  ⚠ >20m')}
        </Text>
      </View>

      {/* ==================== 手动输入 ==================== */}
      <Text style={styles.section}>✏️ 手动输入测试</Text>
      <Text style={styles.hint}>
        输入 WGS-84 坐标点击转换，直接验证算法（模拟器推荐）
      </Text>

      <View style={styles.inputRow}>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>纬度 (lat)</Text>
          <TextInput
            style={styles.input}
            value={manualLat}
            onChangeText={setManualLat}
            keyboardType="decimal-pad"
            placeholder="34.8120"
            placeholderTextColor="#555"
          />
        </View>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>经度 (lng)</Text>
          <TextInput
            style={styles.input}
            value={manualLng}
            onChangeText={setManualLng}
            keyboardType="decimal-pad"
            placeholder="113.5280"
            placeholderTextColor="#555"
          />
        </View>
      </View>

      <TouchableOpacity style={styles.convertBtn} onPress={handleManualConvert}>
        <Text style={styles.convertBtnText}>🔄 转换 WGS-84 → GCJ-02</Text>
      </TouchableOpacity>

      {manualResult != null && (
        <View style={styles.resultCard}>
          <Text style={styles.resultTitle}>转换结果</Text>
          <Text style={styles.resultRow}>
            GCJ-02 lat:{' '}
            <Text style={styles.resultMono}>
              {manualResult.lat.toFixed(6)}
            </Text>
          </Text>
          <Text style={styles.resultRow}>
            GCJ-02 lng:{' '}
            <Text style={styles.resultMono}>
              {manualResult.lng.toFixed(6)}
            </Text>
          </Text>
          <Text style={styles.resultRow}>
            偏移距离:{' '}
            <Text
              style={[
                styles.resultMono,
                {
                  color:
                    manualResult.offsetM >= 100 && manualResult.offsetM <= 700
                      ? '#4CAF50'
                      : '#FF6B6B',
                },
              ]}
            >
              {manualResult.offsetM.toFixed(1)}m
            </Text>
          </Text>
        </View>
      )}

      {/* 预设坐标快速测试 */}
      <Text style={styles.section}>🔢 预设坐标快速测试</Text>
      <View style={styles.presets}>
        {[
          { label: '郑州大学', lat: 34.812, lng: 113.528 },
          { label: '北京天安门', lat: 39.90734, lng: 116.39123 },
          { label: '纽约（境外）', lat: 40.7128, lng: -74.006 },
        ].map((p) => (
          <TouchableOpacity
            key={p.label}
            style={styles.presetBtn}
            onPress={() => {
              setManualLat(String(p.lat));
              setManualLng(String(p.lng));
              // 自动触发转换
              const gcj = wgs84ToGcj02(p.lat, p.lng);
              const dLat = gcj.lat - p.lat;
              const dLng = gcj.lng - p.lng;
              const off = Math.sqrt(
                (dLat * 111320) ** 2 +
                  (dLng * 111320 * Math.cos((p.lat * Math.PI) / 180)) ** 2,
              );
              setManualResult({ lat: gcj.lat, lng: gcj.lng, offsetM: off });
            }}
          >
            <Text style={styles.presetText}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { padding: 20, paddingTop: 60, paddingBottom: 80 },

  title: {
    color: '#FFFFFF', fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 20,
  },
  section: {
    color: '#1677FF', fontSize: 15, fontWeight: '700', marginTop: 8, marginBottom: 4,
  },
  status: {
    color: '#aaa', fontSize: 12, marginBottom: 4,
  },
  errorText: {
    color: '#FF6B6B', fontSize: 12, marginBottom: 4,
  },

  // 卡片
  card: {
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 14, marginBottom: 10,
  },
  cardTitle: {
    color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6,
  },
  coordRow: {
    color: 'rgba(255,255,255,0.85)', fontSize: 14, marginBottom: 3,
  },
  mono: { fontFamily: 'monospace', color: '#00d4ff', fontSize: 14 },
  bigValue: { fontSize: 28, fontWeight: '700', fontFamily: 'monospace' },
  waiting: { color: 'rgba(255,255,255,0.35)', fontSize: 14, fontStyle: 'italic' },
  hint: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 2 },

  // 输入
  inputRow: { flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 10 },
  inputGroup: { flex: 1 },
  inputLabel: { color: '#aaa', fontSize: 11, marginBottom: 4 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    color: '#fff',
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
    fontFamily: 'monospace',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  convertBtn: {
    backgroundColor: '#1677FF', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 12,
  },
  convertBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  // 结果
  resultCard: {
    backgroundColor: 'rgba(22, 119, 255, 0.15)',
    borderWidth: 1, borderColor: 'rgba(22, 119, 255, 0.4)',
    borderRadius: 12, padding: 14, marginBottom: 10,
  },
  resultTitle: { color: '#1677FF', fontSize: 13, fontWeight: '700', marginBottom: 8 },
  resultRow: { color: 'rgba(255,255,255,0.85)', fontSize: 14, marginBottom: 4 },
  resultMono: { fontFamily: 'monospace', color: '#00d4ff', fontSize: 14 },

  // 预设
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  presetBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  presetText: { color: '#ccc', fontSize: 13 },
});
