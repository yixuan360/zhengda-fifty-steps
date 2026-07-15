/**
 * 根路由 — 自动重定向至地图首页
 * v4.0 §2：打开 App 就是地图
 */
import { Redirect } from 'expo-router';

export default function Index() {
  return <Redirect href="/(tabs)/map" />;
}
