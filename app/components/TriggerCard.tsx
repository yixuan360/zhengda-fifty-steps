/**
 * 临时触发卡 — TriggerCard（v6，替代 AudioBar）
 *
 * 自动触发（useTour 设置 currentHit）时在屏幕上方弹卡：
 *   景点名 + 播放/停止按钮，约 4 秒自动淡出，音频继续播放。
 *
 * 不再常驻、不显示进度条。锁屏/后台控制由 RNTP 系统媒体通知承担（useAudioPlayer）。
 * 详情页手动播放不经过 currentHit，因此不会弹卡。
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTourStore } from '../stores/tourStore';
import { useAudioStore } from '../stores/audioStore';
import { getPlayer } from '../hooks/useAudioPlayer';
import { Color, Spacing, Radius, Shadow } from '../constants/theme';

/** 自动淡出时长（音频不停止，仅收起卡片） */
const AUTO_DISMISS_MS = 4000;

export default function TriggerCard() {
  const insets = useSafeAreaInsets();
  const currentHit = useTourStore((s) => s.currentHit);
  const audioState = useAudioStore((s) => s.state);
  const spotName = useAudioStore((s) => s.spotName);
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHitId = useRef<number | null>(null);
  const [visible, setVisible] = useState(false);

  const hitId = currentHit?.spot.id ?? null;

  // 新触发 → 弹卡 → 4s 后淡出（音频继续播放）
  useEffect(() => {
    if (hitId !== null && hitId !== lastHitId.current) {
      lastHitId.current = hitId;
      setVisible(true);
      opacity.setValue(0);
      Animated.spring(opacity, {
        toValue: 1, useNativeDriver: true, friction: 8, tension: 60,
      }).start();

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0, duration: 350, useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) setVisible(false);
        });
      }, AUTO_DISMISS_MS);
    }
    if (hitId === null) {
      lastHitId.current = null;
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [hitId, opacity]);

  // 手动停止：不写历史/不设冷却（useTour 的 onPlaybackComplete 会识别 manuallyStopped）
  const handleStop = () => {
    useAudioStore.getState().setManuallyStopped(true);
    getPlayer().stop();
  };

  if (!visible || !currentHit) return null;

  const isPlaying = audioState === 'playing' || audioState === 'loading';
  // v7：标签必须绑定真实播放状态，不能硬编码"正在讲解"——
  // 否则下载失败时卡片仍显示"正在讲解"（截图状态不一致的根因）
  const tagText =
    audioState === 'loading' ? '⏳ 正在加载语音'
    : audioState === 'paused' ? '⏸ 已暂停'
    : audioState === 'error' ? '⚠ 语音加载失败'
    : audioState === 'idle' ? '⏹ 已停止'
    : '▶ 正在讲解';
  const title = spotName ?? currentHit.spot.name;

  return (
    <Animated.View
      style={[styles.card, { top: insets.top + 60, opacity }]}
      pointerEvents="box-none"
    >
      <View style={styles.body}>
        <View style={styles.info}>
          <Text style={styles.tag}>{tagText}</Text>
          <Text style={styles.name} numberOfLines={1}>{title}</Text>
        </View>
        <TouchableOpacity style={styles.stopBtn} onPress={handleStop} activeOpacity={0.8}>
          <Ionicons name="stop" size={15} color="#fff" />
          <Text style={styles.stopText}>{isPlaying ? '停止播放' : '停止'}</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: Spacing.pageH,
    right: Spacing.pageH,
    zIndex: 9500,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(20,22,26,0.94)',
    borderRadius: Radius.lg,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.15)',
    ...Shadow.elevated,
  },
  info: { flex: 1, marginRight: Spacing.md },
  tag: { fontSize: 11, fontWeight: '600', color: Color.accent, marginBottom: 2 },
  name: { fontSize: 15, fontWeight: '700', color: '#fff' },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    gap: 4,
  },
  stopText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
