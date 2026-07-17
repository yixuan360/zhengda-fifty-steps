/**
 * Expo Config Plugin — 注入高德地图/定位 SDK 的 Android Key
 *
 * 作用：EAS Build / npx expo prebuild 重新生成 android/ 时，向
 * AndroidManifest.xml 的 <application> 写入：
 *   <meta-data android:name="com.amap.api.v2.apikey" android:value="..."/>
 *
 * 与本地已提交的 android/app/src/main/AndroidManifest.xml 保持一致，
 * 保证「本地 Gradle 构建」与「EAS 云构建」两条路径的原生配置不漂移。
 */
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const withAMapKey = (config, props = {}) => {
  const apiKey = props.apiKey || 'YOUR_AMAP_ANDROID_KEY';
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      app,
      'com.amap.api.v2.apikey',
      apiKey,
    );
    return cfg;
  });
};

module.exports = withAMapKey;
