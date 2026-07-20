/**
 * 景点详情页 — 玻璃拟态卡片 + 图片 + 播放/暂停按钮（V5.6）
 * 播放器简化为纯播放/暂停切换，移除进度条和点击跳转。
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, Image, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, Stack } from 'expo-router';
import { getSpotById } from '../../services/database';
import { haversineDistance } from '../../utils/distance';
import { useTourStore } from '../../stores/tourStore';
import { useAudioStore } from '../../stores/audioStore';
import { getPlayer } from '../../hooks/useAudioPlayer';
import { Color, Spacing, Radius, Shadow } from '../../constants/theme';
import type { Spot } from '../../types';

const PLACEHOLDER_IMG = require('../../assets/icon.png');

function fmtDist(m: number): string {
  return m < 1000 ? '约 ' + Math.round(m) + 'm' : '约 ' + (m / 1000).toFixed(1) + 'km';
}

function cacheKey(url: string): string { return url.split('/').pop() || ''; }

export default function SpotDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userLocation = useTourStore((s) => s.userLocation);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const audioState = useAudioStore((s) => s.state);
  const audioUrl = useAudioStore((s) => s.currentUrl);
  const spotRef = useRef<Spot | null>(null);

  useEffect(() => {
    (async () => {
      if (!id) return;
      const n = Number(id);
      if (isNaN(n)) { setLoading(false); return; }
      const s = await getSpotById(n);
      spotRef.current = s;
      setSpot(s);
      setLoading(false);
    })();
  }, [id]);

  // 播放/暂停切换（通过 spotRef + getState 避免闭包过期，空 deps 保证 hook 位置恒定）
  const handleToggle = useCallback(() => {
    const s = spotRef.current;
    if (!s?.audioUrl) return;
    const st = useAudioStore.getState();
    const active = !!(s.audioUrl && st.currentUrl && st.currentUrl.includes(cacheKey(s.audioUrl)));
    if (!active) { getPlayer().play(s.audioUrl, s.name, s.id); }
    else if (st.state === 'playing') getPlayer().pause();
    else if (st.state === 'paused') getPlayer().resume();
  }, []);

  if (!id || isNaN(Number(id))) return <View style={[styles.centered,{backgroundColor:Color.pageBg}]}><Text style={{color:Color.caption}}>参数无效</Text></View>;
  if (loading) return <View style={[styles.centered,{backgroundColor:Color.pageBg}]}><ActivityIndicator size='large' color={Color.primary}/></View>;
  if (!spot) return <View style={[styles.centered,{backgroundColor:Color.pageBg}]}><Text style={{color:Color.caption}}>景点不存在</Text></View>;

  const distance = userLocation ? haversineDistance(userLocation, { lat: spot.lat, lng: spot.lng }) : null;
  const isThisActive = !!(spot.audioUrl && audioUrl && audioUrl.includes(cacheKey(spot.audioUrl)));
  const isPlaying = isThisActive && audioState === 'playing';
  const isPaused = isThisActive && audioState === 'paused';
  const isLoadingAudio = isThisActive && audioState === 'loading';

  let btnIcon = 'play';
  let btnLabel = '播放语音讲解';
  if (isLoadingAudio) { btnIcon = 'hourglass-outline'; btnLabel = '加载中...'; }
  else if (isPlaying) { btnIcon = 'pause'; btnLabel = '暂停'; }
  else if (isPaused) { btnIcon = 'play'; btnLabel = '继续播放'; }

  return (
    <ScrollView style={[styles.container,{backgroundColor:Color.pageBg}]}>
      <Stack.Screen options={{ title: spot.name, headerStyle: { backgroundColor: Color.pageBg } }}/>
      <Image source={spot.imageUrl && !imageError ? { uri: spot.imageUrl } : PLACEHOLDER_IMG} style={styles.image} resizeMode='cover' onError={()=>setImageError(true)}/>
      <View style={styles.body}>
        {distance != null && (<View style={styles.distanceCard}><View style={styles.distanceDot}/><Text style={styles.distanceText}>距您 {fmtDist(distance)}</Text></View>)}
        <Text style={styles.name}>{spot.name}</Text>
        {spot.summary ? (<View style={styles.section}><Text style={styles.label}>简介</Text><Text style={styles.summary}>{spot.summary}</Text></View>) : null}
        <View style={styles.section}><Text style={styles.label}>详细介绍</Text><Text style={styles.text}>{spot.description}</Text></View>
        {spot.audioUrl ? (
          <TouchableOpacity style={[styles.playBtn, isPlaying && styles.playBtnActive]} onPress={handleToggle} activeOpacity={0.8}>
            <Ionicons name={btnIcon as any} size={20} color={isPlaying ? '#fff' : Color.primary}/>
            <Text style={[styles.playBtnText, isPlaying && { color: '#fff' }]}>{btnLabel}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.audioHint}><Text style={styles.audioHintText}>📝 该景点暂无语音导览</Text><Text style={styles.audioHintSub}>请连接服务器后下拉刷新同步最新数据</Text></View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:{flex:1}, centered:{flex:1,justifyContent:'center',alignItems:'center'},
  image:{width:'100%',height:260,backgroundColor:Color.divider},
  body:{padding:Spacing.pageH,paddingBottom:32},
  name:{fontSize:24,fontWeight:'700',color:Color.heading,marginBottom:Spacing.md,letterSpacing:-0.4},
  distanceCard:{flexDirection:'row',alignItems:'center',alignSelf:'flex-start',marginBottom:Spacing.lg,paddingHorizontal:Spacing.md,paddingVertical:Spacing.sm,backgroundColor:Color.cardBg,borderRadius:Radius.pill,borderWidth:StyleSheet.hairlineWidth,borderColor:Color.cardBorder,...Shadow.card},
  distanceDot:{width:8,height:8,borderRadius:4,backgroundColor:Color.primary,marginRight:Spacing.sm},
  distanceText:{fontSize:14,fontWeight:'500',color:Color.primary},
  section:{marginTop:Spacing.xl},
  label:{fontSize:12,fontWeight:'600',color:Color.primary,textTransform:'uppercase',letterSpacing:1,marginBottom:Spacing.sm},
  summary:{fontSize:16,color:Color.body,lineHeight:26,fontWeight:'500'},
  text:{fontSize:15,color:Color.body,lineHeight:25,marginTop:Spacing.xs},
  playBtn:{marginTop:Spacing.xxl,flexDirection:'row',alignItems:'center',justifyContent:'center',paddingVertical:14,borderRadius:Radius.md,borderWidth:1.5,borderColor:Color.primary,backgroundColor:Color.primarySoft,gap:8},
  playBtnActive:{backgroundColor:Color.primary},
  playBtnText:{fontSize:15,fontWeight:'600',color:Color.primary},
  audioHint:{marginTop:Spacing.xxl,padding:Spacing.lg,borderRadius:Radius.md,backgroundColor:Color.primarySoft,alignItems:'center'},
  audioHintText:{fontSize:13,color:Color.primary,fontWeight:'500'},
  audioHintSub:{fontSize:12,color:Color.caption,marginTop:Spacing.sm},
});
