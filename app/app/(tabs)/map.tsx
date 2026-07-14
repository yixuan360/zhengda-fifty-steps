/**
 * 地图首页 — 全屏高德地图 + GPS 蓝点 + 景点 Marker
 * v4.0 §2：打开 App 就是地图
 */
import { View, StyleSheet, Text } from 'react-native';

export default function MapScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.placeholder}>🗺️ 地图页 — 待集成 react-native-maps</Text>
      <Text style={styles.subtext}>高德瓦片 + GPS 蓝点 + 景点 Marker</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  placeholder: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  subtext: {
    fontSize: 13,
    color: '#999',
    marginTop: 8,
  },
});
