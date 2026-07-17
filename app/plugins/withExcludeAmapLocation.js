/**
 * Expo Config Plugin — 排除独立高德定位 SDK，解决 Duplicate class 冲突
 *
 * 背景：com.amap.api:3dmap 9.x 起内置定位核心类（AMapLocationClient 等），
 * 与 react-native-amap-geolocation 引入的 com.amap.api:location:6.2.0 重复，
 * 触发 checkReleaseDuplicateClasses 失败。
 * 标准解法：app 模块全局 exclude 独立 location 依赖，定位库复用 3dmap 内置类。
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const EXCLUDE_BLOCK = `
// 解决高德 3dmap 与 location SDK 的 Duplicate class 冲突（3dmap 9.x 已内置定位类）
configurations.all {
    exclude group: 'com.amap.api', module: 'location'
}
`;

module.exports = function withExcludeAmapLocation(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language === 'groovy' && !cfg.modResults.contents.includes("exclude group: 'com.amap.api', module: 'location'")) {
      cfg.modResults.contents += EXCLUDE_BLOCK;
    }
    return cfg;
  });
};
