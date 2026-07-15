/**
 * 地图共享常量 — AMAP_TILE_URL / 兜底坐标 / 蓝点样式
 * map.tsx 和 map-test.tsx 共用，避免三处重复
 */
import type { Region } from 'react-native-maps';
import { ViewStyle, ImageStyle } from 'react-native';

/** 高德矢量瓦片 URL 模板 */
export const AMAP_TILE_URL =
  'https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}';

/** 郑州大学主校区兜底初始位置（GCJ-02） */
export const ZZU_CAMPUS: Region = {
  latitude: 34.8172,
  longitude: 113.5348,
  latitudeDelta: 0.008,
  longitudeDelta: 0.008,
};

/** GPS 蓝点外圈样式 */
export const blueDotOuterStyle: ViewStyle = {
  width: 24,
  height: 24,
  borderRadius: 12,
  backgroundColor: 'rgba(22, 119, 255, 0.25)',
  justifyContent: 'center',
  alignItems: 'center',
};

/** GPS 蓝点内核样式 */
export const blueDotStyle: ViewStyle = {
  width: 12,
  height: 12,
  borderRadius: 6,
  backgroundColor: '#1677FF',
  borderWidth: 2,
  borderColor: '#FFFFFF',
};
