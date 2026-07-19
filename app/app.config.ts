/**
 * Expo 应用配置 — 对齐 v4.0 §5 约定的 app.config.ts
 *
 * 注意：android/ 原生目录已提交（bare 模式），本文件的 android.permissions /
 * plugins 仅在重新 prebuild 时生效；日常真源在 android/app/src/main/AndroidManifest.xml。
 * 二者已保持同步，重新 prebuild 不会丢配置。
 */
import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: '郑大五十步',
  slug: 'zhengda-fifty-steps',
  owner: 'abc123098',
  version: '1.0.0',
  extra: {
    eas: {
      projectId: '1896ff8f-f0d8-40e0-a72e-ed8f7a12c1a2',
    },
  },
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  scheme: 'zhengda',
  android: {
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    package: 'com.zhengda.fiftysteps',
    permissions: [
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      // 高德定位 SDK（网络定位需要）
      'ACCESS_NETWORK_STATE',
      'ACCESS_WIFI_STATE',
      // RNTP 前台服务（Android 14+ 必需）
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      'POST_NOTIFICATIONS',
      'WAKE_LOCK',
    ],
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
    // 高德 Android Key：prebuild 时注入 <meta-data com.amap.api.v2.apikey>
    ['./plugins/withAMapKey', { apiKey: process.env.EXPO_PUBLIC_AMAP_ANDROID_KEY ?? 'YOUR_AMAP_ANDROID_KEY' }],
    // 排除独立 location SDK（3dmap 9.x 已内置定位类），解决 Duplicate class 构建失败
    './plugins/withExcludeAmapLocation',
    // 与 android/gradle.properties、AndroidManifest 对齐：EAS 云构建走 prebuild（android/
    // 目录被 .gitignore 排除、不会上传），因此原生配置必须同时在此声明才不会漂移
    [
      'expo-build-properties',
      {
        android: {
          // 注意：RN 0.86 / SDK 57 已移除旧架构，newArchEnabled:false 无效（实测运行时仍为
          // Bridgeless），不要再加回来。RNTP 兼容性由 patches/ 下的 void 补丁保证。
          useLegacyPackaging: true,
          usesCleartextTraffic: true, // 校园 http 接口；切 https 后移除
          extraProguardRules: `
            -keep class com.amap.api.** { *; }
            -keep class com.autonavi.** { *; }
            -keep class com.loc.** { *; }
            -dontwarn com.amap.api.**
            -keep class qiuxiang.amap3d.** { *; }
            -keep class cn.qiuxiang.react.geolocation.** { *; }
            -keep class com.doublesymmetry.trackplayer.** { *; }
          `,
        },
      },
    ],
  ],
});
