/**
 * 景点详情页 — 图片 + 描述 + 手动播放
 * v4.0 §2：详情页展示
 */
import { useLocalSearchParams } from 'expo-router';
import { View, StyleSheet, Text } from 'react-native';

export default function SpotDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <View style={styles.container}>
      <Text style={styles.placeholder}>🏛️ 景点详情 #{id}</Text>
      <Text style={styles.subtext}>图片 + 描述 + 手动播放音频</Text>
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
