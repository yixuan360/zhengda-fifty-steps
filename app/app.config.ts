/**
 * Expo 应用配置 — 对齐 v4.0 §5 约定的 app.config.ts
 */
import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: '郑大五十步',
  slug: 'zhengda-fifty-steps',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  scheme: 'zhengda',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.zhengda.fiftysteps',
  },
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
    ],
  },
  plugins: [
    'expo-router',
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
