/**
 * Expo 应用配置 — 对齐 v4.0 §5 约定的 app.config.ts
 */
import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: '郑大五十步',
  slug: 'zhengda-fifty-steps',
  owner: 'arony',
  version: '1.0.0',
  extra: {
    eas: {
      projectId: '24ed8f97-073a-4539-bea9-f54db4bc4363',
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
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
      // 🔴#3: Android 14+ RNTP 必需权限
      'FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      'POST_NOTIFICATIONS',
      'WAKE_LOCK',
    ],
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          '允许郑大五十步在后台获取位置，以便在您走近景点时自动播放语音介绍。',
        locationWhenInUsePermission:
          '允许郑大五十步在使用期间获取位置。',
      },
    ],
  ],
});
