/**
 * 设计系统 — 玻璃拟态 + 自然色系 + 景点分类配色（V5.6）
 */
import { StyleSheet } from 'react-native';

export const Color = {
  primary: '#1A7A5A', primarySoft: '#E8F5F0', accent: '#C67B4B',
  pageBg: '#F2F4F6', cardBg: 'rgba(255,255,255,0.88)',
  cardBorder: 'rgba(255,255,255,0.6)', heading: '#1A1A1A',
  body: '#4A4A4A', caption: '#999999', divider: '#EAEAEA',
  playerBg: 'rgba(20,22,26,0.94)', hintBg: 'rgba(198,123,75,0.92)',
  error: '#D94A4A', warningBg: 'rgba(217,74,74,0.88)',
  infoBg: 'rgba(26,122,90,0.10)', distanceBg: '#F0F8F5',
} as const;

export const CATEGORY_COLORS: Record<string, string> = {
  college: '#8B1A2B', nature: '#2E7D32', architecture: '#6D4C41',
  teaching: '#00838F', service: '#7B1FA2', humanity: '#F9A825',
};

export const CATEGORY_LABELS: Record<string, string> = {
  college: '🏫 学院', nature: '🌿 自然景观',
  architecture: '🏛 特色建筑', teaching: '📚 教学区',
  service: '🍽 生活服务', humanity: '📖 人文景观',
};

export const CATEGORY_ORDER = ['college','nature','architecture','teaching','service','humanity'];
export const Spacing = { xs:4, sm:8, md:12, lg:16, xl:20, xxl:24, pageH:16 } as const;
export const Radius = { sm:8, md:12, lg:16, pill:999 } as const;
export const Shadow = {
  card: { shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.06, shadowRadius:12, elevation:3 },
  elevated: { shadowColor:'#000', shadowOffset:{width:0,height:4}, shadowOpacity:0.08, shadowRadius:16, elevation:5 },
} as const;
export const Type = StyleSheet.create({
  h1: { fontSize:22, fontWeight:'700', color:Color.heading, letterSpacing:-0.3 },
  h2: { fontSize:18, fontWeight:'700', color:Color.heading },
  title: { fontSize:16, fontWeight:'600', color:Color.heading },
  body: { fontSize:15, color:Color.body, lineHeight:24 },
  caption: { fontSize:13, color:Color.caption },
  label: { fontSize:12, fontWeight:'500', color:Color.primary },
});
