/**
 * Expo Config Plugin — 注入高德自定义地图样式文件
 *
 * 作用：EAS Build / npx expo prebuild 重新生成 android/ 时，把项目源文件
 *   app/assets/map-style/style.data + style_extra.data
 * 拷贝到生成的 android/app/src/main/assets/ 下，供 amap3d 原生层在
 * MapView.init 里通过 CustomMapStyleOptions 读取（去高德底图 POI 标注）。
 *
 * 与「本地已提交 android/ 目录」无关：android/ 被 .gitignore 排除（CNG 模式），
 * 本地 expo run:android 同样走 prebuild，本插件两条路径都会执行。
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const STYLE_FILES = ['style.data', 'style_extra.data'];

const withMapStyle = (config) => {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const srcDir = path.join(cfg.modRequest.projectRoot, 'assets', 'map-style');
      const destDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'assets');
      fs.mkdirSync(destDir, { recursive: true });

      for (const file of STYLE_FILES) {
        const src = path.join(srcDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(destDir, file));
          console.log(`[withMapStyle] copied ${file} → android/app/src/main/assets/`);
        } else {
          console.warn(`[withMapStyle] ${src} 不存在，跳过（样式加载会降级为默认底图）`);
        }
      }
      return cfg;
    },
  ]);
};

module.exports = withMapStyle;
