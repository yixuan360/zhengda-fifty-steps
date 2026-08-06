/**
 * react-native-amap3d 类型 shim
 *
 * 背景：该库的 package.json main 直接指向未编译的 TSX 源码（lib/src），
 * 在 TS 6 + React 19 下其内部类型无法通过 tsc 严格检查（上游问题）。
 * 通过 tsconfig paths 将类型解析指向本文件，仅声明本项目用到的 API 子集；
 * Metro 打包仍使用真实源码，运行时行为不受影响。
 */
declare module 'react-native-amap3d' {
  import * as React from 'react';
  import { ViewProps, ImageSourcePropType } from 'react-native';

  export interface LatLng {
    latitude: number;
    longitude: number;
  }

  export interface CameraPosition {
    target?: LatLng;
    zoom?: number;
    bearing?: number;
    tilt?: number;
  }

  export interface LatLngBounds {
    southwest: LatLng;
    northeast: LatLng;
  }

  export interface MapViewProps extends ViewProps {
    initialCameraPosition?: CameraPosition;
    /** 初始视野：按矩形边界适配（fitBounds，android） */
    initialLatLngBounds?: LatLngBounds;
    myLocationEnabled?: boolean;
    myLocationButtonEnabled?: boolean;
    compassEnabled?: boolean;
    scaleControlsEnabled?: boolean;
    zoomControlsEnabled?: boolean;
    rotateGesturesEnabled?: boolean;
    tiltGesturesEnabled?: boolean;
    trafficEnabled?: boolean;
    onLoad?: () => void;
    children?: React.ReactNode;
  }

  export class MapView extends React.Component<MapViewProps> {
    /** 移动视角 */
    moveCamera(cameraPosition: CameraPosition, duration?: number): void;
  }

  export interface MarkerProps {
    position: LatLng;
    icon?: ImageSourcePropType;
    zIndex?: number;
    draggable?: boolean;
    onPress?: () => void;
    children?: React.ReactNode;
  }

  export class Marker extends React.Component<MarkerProps> {}

  export interface CircleProps {
    center: LatLng;
    /** 半径（米） */
    radius: number;
    strokeWidth?: number;
    strokeColor?: string;
    fillColor?: string;
    zIndex?: number;
  }

  export class Circle extends React.Component<CircleProps> {}

  export interface PolygonProps {
    /** 节点坐标（环形，自动闭合） */
    points: LatLng[];
    strokeWidth?: number;
    strokeColor?: string;
    fillColor?: string;
    zIndex?: number;
  }

  export class Polygon extends React.Component<PolygonProps> {}

  export interface PolylineProps {
    /** 节点坐标 */
    points: LatLng[];
    /** 线段宽度（px） */
    width?: number;
    color?: string;
    colors?: (string | number)[];
    zIndex?: number;
    gradient?: boolean;
    geodesic?: boolean;
    dotted?: boolean;
    onPress?: () => void;
  }

  export class Polyline extends React.Component<PolylineProps> {}

  export namespace AMapSdk {
    function init(apiKey?: string): void;
    function getVersion(): Promise<string>;
  }
}
