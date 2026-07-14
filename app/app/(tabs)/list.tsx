/**
 * 景点列表页 — FlatList + SpotCard
 * v4.0 §2：列表 + 详情
 */
import { View, StyleSheet, Text } from 'react-native';

export default function ListScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.placeholder}>📋 景点列表 — 待集成</Text>
      <Text style={styles.subtext}>FlatList + SpotCard 组件 + pull-to-refresh</Text>
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
