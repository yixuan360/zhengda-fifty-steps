# 设计：去掉高德底图 POI 标注 + 初始视野对准郑大主校区

日期：2026-08-06
状态：已批准（用户指示执行）

## 背景与目标

地图首页（`app/(tabs)/map.tsx`）使用 `react-native-amap3d` 3.2.4 集成高德 3D 地图 SDK `3dmap:9.6.0`。用户希望：

1. **去掉高德默认底图上的全部 POI 标注**（文字 + 图标），配色等其他底图元素保持不变。
2. **地图页初始视野对准郑大主校区矩形范围**（右上 113.54206/34.827075，左下 113.52951/34.808282）。只做初始对准，不锁定用户拖动/缩放。

约束与既有事实：

- `android/` 目录被 `.gitignore` 排除（CNG 模式），EAS 云构建以 `app.config.ts` + `plugins/` 为真源重新 prebuild 生成。因此**不能**把样式文件直接放进 `android/app/src/main/assets/`，必须走 config plugin。
- 项目已在用 patch-package（`postinstall: patch-package`），且已有 `patches/react-native-amap3d+3.2.4.patch`。改 node_modules 里的 amap3d 原生代码会跟随 prebuild 生效。
- `labelsEnabled` 是 amap3d 的「死 prop」：JS 类型里声明了（`lib/src/map-view.tsx`），但 Android `MapViewManager.kt` 无对应 `@ReactProp`，传了被忽略。本次不动它。
- amap3d 3.2.4 没有暴露 fitBounds / visibleRegion API，只有 `initialCameraPosition`（中心点+zoom）。按矩形定位需在原生层补能力。

## 技术方案

三条改动路径，全部与现有 CNG + patch-package 基建对齐：

### ① 样式文件落位（已完成的准备步骤）

用户从高德「地图自定义平台」下载的离线样式包 `mystyle_sdk_1786025545_0100.zip` 已解压到 `app/assets/map-style/`（git 跟踪）：

- `style.data`（207KB）—— 样式主文件（只关标注大类，配色保持默认）
- `style_extra.data`（2.2KB）—— 扩展内容

无 `textures.zip`，符合免费模板结构。

### ② 新建 config plugin `plugins/withMapStyle.js`

参照 `plugins/withExcludeAmapLocation.js` 写法，prebuild 时把 `app/assets/map-style/*.data` 拷贝到生成的 `android/app/src/main/assets/`。用 `withDangerousMod(android, 'android', ...)` 执行文件拷贝。注册进 `app.config.ts` 的 `plugins` 数组。

这样本地 `expo run:android` 与 EAS 云构建两条路径都能拿到样式文件。

### ③ patch-package 改 amap3d 原生层

#### 加载自定义样式（`MapView.kt`）

在 `init` 块里加载 assets 中样式并调用 `map.setCustomMapStyle(...)`：

```kotlin
map.setCustomMapStyle(
  CustomMapStyleOptions()
    .setEnable(true)
    .setStyleDataPath("style.data")        // assets 相对路径
    .setStyleExtraPath("style_extra.data")
)
```

> 注：`setStyleDataPath` 在 3dmap 中接收的是设备文件路径。assets 内文件需要先用 `setStyleData(byte[])` 读字节数组传入，或先把文件从 assets 拷贝到应用私有目录再传路径。实现时以 9.6.0 实际 API 为准，优先 `setStyleData(byte[])` 读取 assets 字节。

若样式文件缺失/加载失败，`setCustomMapStyle` 抛异常会崩——需 try-catch 包裹并降级为默认地图，保证用户仍能看到底图。

#### 初始视野按矩形定位（`MapView.kt` + `MapViewManager.kt` + `map-view.tsx`）

- `MapView.kt`：新增 `setInitialLatLngBounds(bounds: LatLngBounds)`，用 `map.moveCamera(CameraUpdateFactory.newLatLngBounds(bounds, padding))` 实现适配。
- `MapViewManager.kt`：新增 `@ReactProp(name = "initialLatLngBounds")`。
- `map-view.tsx`：类型加 `initialLatLngBounds?: LatLngBounds`。
- `map.tsx`：把 `initialCameraPosition={{ target: ZZU_CAMPUS, zoom: 15, tilt: 0 }}` 换成 `initialLatLngBounds={{ southwest: {latitude: 34.808282, longitude: 113.52951}, northeast: {latitude: 34.827075, longitude: 113.54206} }}`。

padding 取 60~100 让主校区铺满视口且不贴边。`tilt`/`bearing` 保持 0。

## 验证方式

本地 `npx expo run:android` 打 dev-client：

1. 地图页初始视野对准主校区矩形。
2. 底图 POI 文字/图标消失，道路、水系等配色保持默认。
3. 现有 Marker/Circle/Polygon、回中按钮、模拟定位面板等 JS 功能不受影响。
4. 若样式加载失败，地图降级为默认样式而非白屏。

## 边界与不做的事

- 不删除/遮挡「高德地图」logo（协议红线，保留）。
- 不改动任何配色（用户明确只需去 POI）。
- 不锁定用户拖动/缩放（用户选「初始对准」而非「锁定范围」）。
- 不动 `labelsEnabled` 死 prop（无关本次目标，且 JS 层为透明改动）。
