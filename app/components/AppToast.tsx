/**
 * 应用级轻提示 — AppToast（v6，替代 AudioBar 的弱提示条/错误条）
 *
 * 不常驻，临时 toast：
 *  - hint（发现新景点，点此切换）：自动 3s 消失，可点击切换到队列中下一景点
 *  - error（播放失败）：自动 4s 消失并复位播放状态
 */
import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAudioStore } from '../stores/audioStore';
import { useTourStore } from '../stores/tourStore';
import { getPlayer } from '../hooks/useAudioPlayer';
import { Spacing, Radius, Shadow } from '../constants/theme';

const ERROR_MS = 4000;
const HINT_MS = 3000;

type ToastType = 'hint' | 'error';

export default function AppToast() {
  const insets = useSafeAreaInsets();
  const error = useAudioStore((s) => s.error);
  const hint = useTourStore((s) => s.newSpotHint);
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!error && !hint) {
      // 无提示 → 淡出已显示内容（若有）
      Animated.timing(opacity, {
        toValue: 0, duration: 200, useNativeDriver: true,
      }).start();
      return;
    }

    const type: ToastType = error ? 'error' : 'hint';
    opacity.setValue(0);
    Animated.spring(opacity, {
      toValue: 1, useNativeDriver: true, friction: 8, tension: 60,
    }).start();

    timerRef.current = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0, duration: 300, useNativeDriver: true,
      }).start(({ finished }) => {
        // 错误提示淡出完成后复位播放状态（对齐旧 AudioBar 行为）
        if (finished && type === 'error') {
          useAudioStore.getState().reset();
        }
      });
    }, type === 'error' ? ERROR_MS : HINT_MS);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [error, hint, opacity]);

  // 点击 hint → 立即切到队列中的下一个景点
  const handleHintTap = () => {
    useTourStore.getState().setNewSpotHint(null);
    const next = useTourStore.getState().switchToNext();
    if (next) {
      // 先标记手动停止：使被中断景点不写历史/不设冷却/不出队，
      // 避免 useTour 的 onPlaybackComplete 再弹出一个景点造成双播竞态（审查 MEDIUM-2）。
      useAudioStore.getState().setManuallyStopped(true);
      getPlayer().stop();
      setTimeout(() => {
        getPlayer().play(next.spot.audioUrl, next.spot.name, next.spot.id);
      }, 300);
    }
  };

  const shown: { type: ToastType; text: string } | null = error
    ? { type: 'error', text: error }
    : hint
      ? { type: 'hint', text: hint }
      : null;

  if (!shown) return null;

  return (
    <Animated.View style={[styles.toast, { top: insets.top + 110, opacity }]} pointerEvents="box-none">
      {shown.type === 'error' ? (
        <View style={[styles.bar, styles.errorBar]}>
          <Ionicons name="alert-circle" size={14} color="#fff" style={{ marginRight: 6 }} />
          <Text style={styles.errorText} numberOfLines={2}>{shown.text}</Text>
        </View>
      ) : (
        <TouchableOpacity onPress={handleHintTap} activeOpacity={0.85}>
          <View style={[styles.bar, styles.hintBar]}>
            <Text style={styles.hintText} numberOfLines={2}>{shown.text}</Text>
            <Text style={styles.hintTapText}>点此切换</Text>
          </View>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: Spacing.pageH,
    right: Spacing.pageH,
    zIndex: 9490,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    ...Shadow.card,
  },
  errorBar: { backgroundColor: 'rgba(217,74,74,0.94)', borderColor: 'rgba(217,74,74,0.3)' },
  errorText: { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
  hintBar: { backgroundColor: 'rgba(198,123,75,0.94)', borderColor: 'rgba(198,123,75,0.3)' },
  hintText: { color: '#fff', fontSize: 12, fontWeight: '600', flex: 1 },
  hintTapText: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginLeft: 8, fontWeight: '500' },
});
