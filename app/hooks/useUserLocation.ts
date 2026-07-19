/**
 * 定位 Hook — 高德定位 SDK（react-native-amap-geolocation） + 模拟定位
 * v4.0 §6.1：申请权限 → 高德连续定位 → 精度过滤 → 更新 store
 *
 * 高德定位在国内直接返回 GCJ-02 坐标，与服务端录入坐标系一致，
 * 无需（也绝不能再做）WGS-84 → GCJ-02 转换 —— v4.0 §3.4 坐标统一在此收口。
 *
 * 节流：SDK 层 setInterval(1000)（见 services/amap.ts），JS 侧不再重复节流。
 * 订阅只创建一次（依赖 []），状态存入 tourStore 供 useTour 消费。
 *
 * 模拟定位（开发调试用）：tourStore.mockLocation 非 null 时，本 Hook
 * 直接注入该值为用户位置（精度标记为合格，绕过真机 GPS），真实定位订阅
 * 仍保持运行——清除 mock 后无缝恢复。
 */
import { useEffect, useRef } from 'react';
import { Alert, PermissionsAndroid, Platform } from 'react-native';
import { useTourStore } from '../stores/tourStore';
import { initAMap } from '../services/amap';

/** 模拟定位的"伪精度"——标记为合格，让导览引擎正常触发 */
const MOCK_ACCURACY = 5;

export function useUserLocation() {
  const watchId = useRef<number | null>(null);
  const store = useTourStore();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // ── 1. 运行时权限（Android 12+ 精确/大致位置二选一弹窗） ──
        if (Platform.OS === 'android') {
          const result = await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
          ]);
          const fine = result[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
          const coarse = result[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION];

          if (fine !== 'granted' && coarse !== 'granted') {
            console.warn('[useUserLocation] 定位权限被拒绝');
            return;
          }
          // v4.0 §11 P1：仅授予"大致位置"时精度常年 >20m，自动触发永远不生效 → 引导
          if (fine !== 'granted') {
            Alert.alert(
              '需要精确位置',
              '当前仅授予了大致位置，无法在走近景点时自动播放讲解。\n请在系统设置中为本应用开启"精确位置"。',
            );
          }
        }

        // ── 2. 初始化高德 SDK（幂等；失败静默降级，不阻塞 App） ──
        const ok = await initAMap();
        if (!ok || cancelled) return;

        // ── 3. 连续定位（GCJ-02 直出） ──
        const { Geolocation } = require('react-native-amap-geolocation');
        watchId.current = Geolocation.watchPosition(
          (pos: { coords: { latitude: number; longitude: number; accuracy: number } }) => {
            const { latitude, longitude, accuracy } = pos.coords;
            store.setUserLocation({ lat: latitude, lng: longitude });
            store.setIsAccuracyGood(accuracy > 0 && accuracy <= 20);
          },
          (err: { code: number; message: string }) => {
            console.warn('[useUserLocation] 定位失败:', err.code, err.message);
          },
        );
      } catch (err) {
        console.error('[useUserLocation] 定位初始化失败:', err);
      }
    })();

    return () => {
      cancelled = true;
      if (watchId.current != null) {
        try {
          const { Geolocation } = require('react-native-amap-geolocation');
          Geolocation.clearWatch(watchId.current);
        } catch { /* 原生模块缺失时静默 */ }
        watchId.current = null;
      }
    };
  }, []);

  // ── 返回值：模拟定位优先 ──
  const mock = store.mockLocation;
  const real = store.userLocation;
  const effective = mock ?? real;

  return {
    /** 用户当前位置（GCJ-02），mock 优先 */
    location: effective,
    /** 精度是否足够 */
    isAccuracyGood: mock != null ? true : store.isAccuracyGood,
    /** 当前精度数值（米），mock 时为固定 5m */
    accuracy: mock != null ? MOCK_ACCURACY : null,
  };
}
