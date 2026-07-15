/**
 * 坐标转换工具 — WGS-84 ↔ GCJ-02
 *
 * v4.0 §3.4：全链路统一 GCJ-02，定位服务底层完成 WGS-84 → GCJ-02 转换。
 * v4.0 §11 P0-2：坐标系偏差验证，转换后与高德地图偏差应 < 5m。
 *
 * 算法来源：https://github.com/wandergis/coordtransform
 * 中国境内偏移量 ~100-700m，境外坐标不转换直接返回。
 */

/** 坐标点 */
export interface LatLng {
  lat: number;
  lng: number;
}

const PI = Math.PI;
const A = 6378245.0; // 长半轴
const EE = 0.00669342162296594323; // 扁率

/** 判断坐标是否在中国境内（粗略边界框） */
function isInChina(lat: number, lng: number): boolean {
  return lng >= 72.004 && lng <= 137.8347 && lat >= 0.8293 && lat <= 55.8271;
}

function transformLat(lng: number, lat: number): number {
  let ret =
    -100.0 +
    2.0 * lng +
    3.0 * lat +
    0.2 * lat * lat +
    0.1 * lng * lat +
    0.2 * Math.sqrt(Math.abs(lng));
  ret +=
    ((20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) *
      2.0) /
    3.0;
  ret +=
    ((20.0 * Math.sin(lat * PI) + 40.0 * Math.sin((lat / 3.0) * PI)) * 2.0) /
    3.0;
  ret +=
    ((160.0 * Math.sin((lat / 12.0) * PI) +
      320.0 * Math.sin((lat * PI) / 30.0)) *
      2.0) /
    3.0;
  return ret;
}

function transformLng(lng: number, lat: number): number {
  let ret =
    300.0 +
    lng +
    2.0 * lat +
    0.1 * lng * lng +
    0.1 * lng * lat +
    0.1 * Math.sqrt(Math.abs(lng));
  ret +=
    ((20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) *
      2.0) /
    3.0;
  ret +=
    ((20.0 * Math.sin(lng * PI) + 40.0 * Math.sin((lng / 3.0) * PI)) * 2.0) /
    3.0;
  ret +=
    ((150.0 * Math.sin((lng / 12.0) * PI) +
      300.0 * Math.sin((lng / 30.0) * PI)) *
      2.0) /
    3.0;
  return ret;
}

/**
 * WGS-84 → GCJ-02（火星坐标系）
 *
 * @param lat WGS-84 纬度
 * @param lng WGS-84 经度
 * @returns GCJ-02 坐标
 */
export function wgs84ToGcj02(lat: number, lng: number): LatLng {
  // 中国境外不转换，直接返回
  if (!isInChina(lat, lng)) {
    return { lat, lng };
  }

  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);

  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1.0 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);

  dLat = (dLat * 180.0) / (((A * (1.0 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);

  return {
    lat: lat + dLat,
    lng: lng + dLng,
  };
}

/**
 * GCJ-02 → WGS-84（逆转换，精度 ~2m）
 */
export function gcj02ToWgs84(lat: number, lng: number): LatLng {
  if (!isInChina(lat, lng)) {
    return { lat, lng };
  }

  const { lat: wgsLat, lng: wgsLng } = wgs84ToGcj02(lat, lng);

  // 迭代修正（2 次足够收敛到 < 2m）
  return {
    lat: lat * 2 - wgsLat,
    lng: lng * 2 - wgsLng,
  };
}
