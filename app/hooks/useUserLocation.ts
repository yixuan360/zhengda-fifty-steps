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
 * 精度三档分级（v6 修复 #2）：good ≤ 30m / fair 30~50m / poor > 50m。
 * 滞回消抖：连续 POOR_THRESHOLD(3) 个 poor 样本才判不可触发（防止横幅闪烁），
 * 1 个非 poor 样本立即恢复。useTour 引擎只认 isAccuracyGood（= 非 poor）。
 *
 * 模拟定位（开发调试用）：tourStore.mockLocation 非 null 时，本 Hook
 * 直接注入该值为用户位置（精度标记为合格，绕过真机 GPS），真实定位订阅
 * 仍保持运行——清除 mock 后无缝恢复。
 * 每次挂载自动复位 mock，避免"在家开的模拟定位残留到校"导致引擎位置死锁。
 */
import { useEffect, useRef } from 'react';
import { Alert, PermissionsAndroid, Platform } from 'react-native';
import { useTourStore } from '../stores/tourStore';
import { initAMap } from '../services/amap';
import type { AccuracyLevel } from '../types';

/** 模拟定位的"伪精度"——标记为合格，让导览引擎正常触发 */
const MOCK_ACCURACY = 5;

/** 三档阈值：good ≤ 30m，fair ≤ 50m，poor > 50m */
const FAIR_MAX = 50;

/** 连续多少个 poor 样本才判不可触发（滞回消抖） */
const POOR_THRESHOLD = 3;

function tierOf(accuracy: number): AccuracyLevel {
  if (accuracy <= 30) return 'good';
  if (accuracy <= FAIR_MAX) return 'fair';
  return 'poor';
}

export function useUserLocation() {
  const watchId = useRef<number | null>(null);
  const store = useTourStore();
  /** 连续 poor 样本计数（滞回：连续 3 个 poor 才判不可触发） */
  const poorCount = useRef(0);

  useEffect(() => {
    let cancelled = false;

    // 每次挂载自动复位模拟定位：演示场景是"主动开"的动作，
    // 真实使用场景不应为模拟定位的残留买单（问题 #3）。
    useTourStore.getState().setMockLocation(null);

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
            // 模拟定位激活时跳过真实 GPS 写入，防止 mock 被 1s 后的 GPS 回调覆盖
            if (useTourStore.getState().mockLocation) return;
            const { latitude, longitude, accuracy } = pos.coords;
            store.setUserLocation({ lat: latitude, lng: longitude });

            const a = accuracy > 0 ? accuracy : null;
            if (a == null) {
              // 无有效精度（部分设备首帧上报 0/-1）→ 视为中性样本：
              // 不更新精度状态、不打断 poor 连击，避免绕过滞回瞬间暂停/横幅闪烁（审查 LOW-1）。
              // userLocation 已在上方更新，位置仍可用。
              return;
            }
            const level = tierOf(a);
            if (level === 'poor') {
              poorCount.current += 1;
              // 连续 3 个 poor 才暂停，避免单次漂移导致横幅闪烁
              store.setAccuracy(a, level, poorCount.current < POOR_THRESHOLD);
            } else {
              poorCount.current = 0;
              store.setAccuracy(a, level, true);
            }
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

  // ── mock 坐标 → store.userLocation，导览引擎才能感知并触发播放 ──
  const mock = store.mockLocation;
  useEffect(() => {
    if (mock) {
      store.setUserLocation(mock);
      store.setAccuracy(MOCK_ACCURACY, 'good', true);
      // 重置滞回计数，避免 mock 前的 poor 连击残留到真实定位（审查 LOW-2a）
      poorCount.current = 0;
    }
  }, [mock]);

  return {
    /** 用户当前位置（GCJ-02），mock 优先 */
    location: mock ?? store.userLocation,
    /** 是否可触发（滞回后），mock 时恒为 true */
    isAccuracyGood: mock != null ? true : store.isAccuracyGood,
    /** 当前精度数值（米），mock 时为固定 5m */
    accuracy: mock != null ? MOCK_ACCURACY : store.accuracy,
    /** 精度档位，mock 时为 good */
    accuracyLevel: mock != null ? 'good' : store.accuracyLevel,
  };
}
