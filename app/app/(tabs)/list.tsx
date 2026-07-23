/**
 * 景点列表页 — 手风琴分组（V5.6）
 * 六个分类可独立展开/收起，每个分类独立着色指示条。
 */
import { useEffect, useState, useCallback } from 'react';
import { View, FlatList, Text, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import SpotCard from '../../components/SpotCard';
import { getAllSpots } from '../../services/database';
import { syncAll } from '../../services/sync';
import { haversineDistance } from '../../utils/distance';
import { useTourStore } from '../../stores/tourStore';
import { Color, Spacing, Radius, CATEGORY_COLORS as FALLBACK_COLORS, CATEGORY_LABELS as FALLBACK_LABELS, CATEGORY_ORDER as FALLBACK_ORDER } from '../../constants/theme';
import type { Spot } from '../../types';

interface Section { key: string; title: string; color: string; data: Spot[]; expanded: boolean }
type FlatItem = { type: 'header'; key: string; section: Section } | { type: 'spot'; key: string; spot: Spot; color: string };

export default function ListScreen() {
  const { spots, setSpots, userLocation, syncStatus, syncError, categories } = useTourStore();
  const apiCats = categories.length;
  const catColors: Record<string,string> = apiCats
    ? Object.fromEntries(categories.map(c=>[c.key,c.color]))
    : { ...FALLBACK_COLORS };
  const catLabels: Record<string,string> = apiCats
    ? Object.fromEntries(categories.map(c=>[c.key,c.label]))
    : { ...FALLBACK_LABELS };
  const catOrder = apiCats
    ? [...categories].sort((a,b)=>a.sortOrder-b.sortOrder).map(c=>c.key)
    : ((prefix: string[]) => {
        const extra = new Set<string>();
        for (const s of spots) { const k = s.category || ''; if (k && !prefix.includes(k)) extra.add(k); }
        return [...prefix, ...extra];
      })(FALLBACK_ORDER);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [localSyncFailed, setLocalSyncFailed] = useState<boolean|null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['college']));

  const loadData = useCallback(async () => { try { setSpots(await getAllSpots()); } finally { setLoading(false); } }, [setSpots]);
  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { const r = await syncAll(); setLocalSyncFailed(!r.spotsOk); } catch { setLocalSyncFailed(true); }
    await loadData(); setRefreshing(false);
  }, [loadData]);

  const showSyncError = localSyncFailed || syncStatus === 'error';
  const syncErrorMessage = syncError || '⚠ 无法连接服务器，请检查网络后下拉刷新';

  const toggleSection = (key: string) => setExpandedSections(p => { const n=new Set(p); n.has(key)?n.delete(key):n.add(key); return n; });

  const grouped: Record<string, Spot[]> = {};
  for (const s of spots) { const cat = s.category||'architecture'; (grouped[cat]??=[]).push(s); }
  for (const key of Object.keys(grouped)) grouped[key].sort((a,b) => userLocation ? haversineDistance(userLocation,{lat:a.lat,lng:a.lng})-haversineDistance(userLocation,{lat:b.lat,lng:b.lng}) : a.name.localeCompare(b.name,'zh'));

  const sections: Section[] = catOrder.filter(k=>grouped[k]?.length).map(k=>({key:k,title:catLabels[k]||k,color:catColors[k]||'#999',data:grouped[k],expanded:expandedSections.has(k)}));
  const flatData: FlatItem[] = [];
  for (const sec of sections) { flatData.push({type:'header',key:'h-'+sec.key,section:sec}); if (sec.expanded) for (const s of sec.data) flatData.push({type:'spot',key:'s-'+s.id,spot:s,color:sec.color}); }

  return (
    <FlatList data={flatData} keyExtractor={i=>i.key}
      renderItem={({item}) => {
        if (item.type==='header') {
          const sec=item.section;
          return (
            <TouchableOpacity style={[styles.header,{borderLeftColor:sec.color}]} onPress={()=>toggleSection(sec.key)} activeOpacity={0.7}>
              <Text style={styles.headerText}>{sec.title} ({sec.data.length})</Text>
              <Text style={[styles.headerArrow,sec.expanded&&styles.headerArrowOpen]}>{'▶'}</Text>
            </TouchableOpacity>
          );
        }
        const dist = userLocation ? haversineDistance(userLocation,{lat:item.spot.lat,lng:item.spot.lng}) : null;
        return (<View style={styles.spotRow}><View style={[styles.spotDot,{backgroundColor:item.color}]}/><View style={styles.spotCardWrap}><SpotCard spot={item.spot} distance={dist}/></View></View>);
      }}
      style={{backgroundColor:Color.pageBg}} contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Color.primary]} tintColor={Color.primary} progressBackgroundColor='#FFFFFF'/>}
      ListHeaderComponent={showSyncError?<View style={styles.syncBar}><Text style={styles.syncBarText}>{syncErrorMessage}</Text></View>:null}
      ListEmptyComponent={<View style={styles.centered}><Text style={styles.emptyIcon}>{'🗺️'}</Text><Text style={styles.hint}>{loading?'加载中...':'暂无景点数据'}</Text>{!loading&&<View style={styles.refreshHint}><Text style={styles.subHint}>↓ 下拉刷新从服务器同步</Text></View>}</View>}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 100 },
  header: { flexDirection: 'row', alignItems: 'center', marginHorizontal: Spacing.pageH, marginTop: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderRadius: Radius.md, backgroundColor: Color.cardBg, borderLeftWidth: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: Color.cardBorder },
  headerText: { flex: 1, fontSize: 15, fontWeight: '700', color: Color.heading },
  headerArrow: { fontSize: 12, color: Color.caption, transform: [{ rotate: '0deg' }] },
  headerArrowOpen: { transform: [{ rotate: '90deg' }] },
  spotRow: { flexDirection: 'row', alignItems: 'stretch', marginLeft: Spacing.pageH },
  spotDot: { width: 4, marginRight: Spacing.md },
  spotCardWrap: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.pageH, paddingTop: 120 },
  emptyIcon: { fontSize: 40, marginBottom: Spacing.md },
  hint: { fontSize: 16, fontWeight: '600', color: Color.heading },
  refreshHint: { marginTop: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: 999, backgroundColor: Color.primarySoft },
  subHint: { fontSize: 13, color: Color.primary },
  syncBar: { marginHorizontal: Spacing.pageH, marginTop: Spacing.sm, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Color.warningBg, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(217,74,74,0.3)' },
  syncBarText: { fontSize: 13, color: '#fff', fontWeight: '500', lineHeight: 19 },
});
