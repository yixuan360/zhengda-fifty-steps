/**
 * 设计系统 — 玻璃拟态 + 自然色系（V5.4）
 *
 * 定位：校园户外导览场景，底图为主体，UI 组件用半透明白色玻璃卡不遮挡视野。
 * 主色取自郑大校徽青绿，点缀赭石暖色呼应中原文化。
 */
import { StyleSheet } from 'react-native';

// ── 色彩 ─────────────────────────────────────────────
export const Color = {
  /** 郑大校徽青绿 — 按钮 / 选中态 / 进度条 */
  primary: '#1A7A5A',
  /** 柔和青绿 — 卡片内强调 */
  primarySoft: '#E8F5F0',
  /** 赭石 — 小面积点缀（距离标签 / 图标） */
  accent: '#C67B4B',
  /** 晨曦灰白 — 列表/详情页背景（室外柔和，不刺眼） */
  pageBg: '#F2F4F6',
  /** 卡片白 — 玻璃拟态底色 */
  cardBg: 'rgba(255,255,255,0.88)',
  /** 卡片边框 — 微妙的玻璃边缘 */
  cardBorder: 'rgba(255,255,255,0.6)',
  /** 标题 */
  heading: '#1A1A1A',
  /** 正文 */
  body: '#4A4A4A',
  /** 辅助文字 */
  caption: '#999999',
  /** 分割线 */
  divider: '#EAEAEA',
  /** 播放条底色 */
  playerBg: 'rgba(20,22,26,0.94)',
  /** 弱提示 */
  hintBg: 'rgba(198,123,75,0.92)',
  /** 错误 */
  error: '#D94A4A',
  /** 警告条 */
  warningBg: 'rgba(217,74,74,0.88)',
  /** 信息条 */
  infoBg: 'rgba(26,122,90,0.10)',
  /** 距离标签底色 */
  distanceBg: '#F0F8F5',
} as const;

// ── 间距 ─────────────────────────────────────────────
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  pageH: 16, // 页面左右边距
} as const;

// ── 圆角 ─────────────────────────────────────────────
export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

// ── 阴影（玻璃拟态：柔和、大面积、低不透明度）────────
export const Shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  elevated: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 5,
  },
} as const;

// ── 文字层级（使用系统默认字体系列）───────────────────
export const Type = StyleSheet.create({
  h1: { fontSize: 22, fontWeight: '700', color: Color.heading, letterSpacing: -0.3 },
  h2: { fontSize: 18, fontWeight: '700', color: Color.heading },
  title: { fontSize: 16, fontWeight: '600', color: Color.heading },
  body: { fontSize: 15, color: Color.body, lineHeight: 24 },
  caption: { fontSize: 13, color: Color.caption },
  label: { fontSize: 12, fontWeight: '500', color: Color.primary },
});
