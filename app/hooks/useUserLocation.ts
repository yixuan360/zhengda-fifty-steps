/**
 * 定位 Hook — expo-location 封装
 * v4.0 §6.1：申请权限 → 监听位置 → WGS-84 → GCJ-02 → 精度过滤 → 更新 store
 *
 * 订阅只创建一次（依赖 []），状态存入 tourStore 供 useTour 消费。
 */
import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { useTourStore } from '../stores/tourStore';
import { wgs84ToGcj02 } from '../utils/coordinate';
import type { LatLng } from '../utils/coordinate';

export function useUserLocation() {
  const subscription = useRef<Location.LocationSubscription | null>(null);
  const store = useTourStore();

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.warn('[useUserLocation] 定位权限被拒绝');
          return;
        }

        subscription.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 1000,   // 1次/s 节流（v4.0 §6.1）
            distanceInterval: 0,  // 不跳过任何位置更新
          },
          (loc) => {
            try {
              const { latitude, longitude, accuracy } = loc.coords;

              // WGS-84 → GCJ-02 转换（v4.0 §3.4）
              const gcj: LatLng = wgs84ToGcj02(latitude, longitude);

              store.setUserLocation(gcj);
              store.setIsAccuracyGood(accuracy != null && accuracy <= 20);
            } catch (err) {
              console.error('[useUserLocation] 位置回调异常:', err);
            }
          },
        );
      } catch (err) {
        console.error('[useUserLocation] 定位初始化失败:', err);
      }
    })();

    return () => {
      subscription.current?.remove();
    };
  }, []);

  return {
    /** 用户当前位置（GCJ-02），来自 tourStore */
    location: store.userLocation,
    /** 精度是否足够（≤20m） */
    isAccuracyGood: store.isAccuracyGood,
  };
}
