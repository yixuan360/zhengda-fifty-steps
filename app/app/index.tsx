/**
 * 根路由 — 重定向至地图首页
 */
import { Redirect } from 'expo-router';
export default function Index() {
  return <Redirect href="/(tabs)/map" />;
}
