/**
 * 高德 SDK 统一初始化 — 地图(react-native-amap3d) + 定位(react-native-amap-geolocation)
 *
 * 成熟方案要点：
 * 1. AMapSdk.init 原生侧已调用 MapsInitializer/AMapLocationClient 的
 *    updatePrivacyShow/updatePrivacyAgree（高德 8.x 隐私合规，未调用会启动即崩溃）。
 * 2. 必须在渲染 <MapView> / 启动定位之前完成初始化。
 * 3. Key 配置错误 → 降级为静默失败（返回 false），绝不阻塞 App 运行。
 *
 * Android 原生 Key 与 Web 服务 Key 不同类型（原生 Key 绑定包名 + SHA1）。
 */
import { Platform } from 'react-native';

/** 高德 Android 原生 Key：.env 的 EXPO_PUBLIC_AMAP_ANDROID_KEY，占位符稍后替换 */
const AMAP_ANDROID_KEY =
  process.env.EXPO_PUBLIC_AMAP_ANDROID_KEY ?? 'YOUR_AMAP_ANDROID_KEY';

let initPromise: Promise<boolean> | null = null;

/**
 * 幂等初始化（多处调用只执行一次）。
 * @returns true = SDK 可用；false = 原生模块缺失或 Key 异常（App 继续以无地图/无定位模式运行）
 */
export function initAMap(): Promise<boolean> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const { AMapSdk } = require('react-native-amap3d');
      const Geo = require('react-native-amap-geolocation');

      // 地图 SDK：设置 Key + 隐私合规（原生侧完成）
      AMapSdk.init(Platform.select({ android: AMAP_ANDROID_KEY }));

      // 定位 SDK：设置 Key + 隐私合规 + 连续定位参数
      await Geo.init({ android: AMAP_ANDROID_KEY, ios: '' });
      Geo.setLocationMode(Geo.LocationMode.Hight_Accuracy); // 网络+卫星混合，精度优先
      Geo.setInterval(1000); // 1 次/s（v4.0 §6.1 节流由 SDK 层保证）
      return true;
    } catch (err: any) {
      console.warn('[AMap] SDK 初始化失败（降级为无地图/定位模式）:', err?.message ?? err);
      return false;
    }
  })();
  return initPromise;
}
