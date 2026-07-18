/**
 * 播放悬浮条 — AudioBar
 * v4.0 §6.2：景点名 + 播放/暂停 + 进度条 + 弱提示 + 错误提示
 *
 * 全局悬浮在底部 Tab 上方，由 audioStore 状态驱动显示/隐藏。
 * 播放中命中新景点时显示弱提示（点击可立即切换）。
 * 播放异常时显示红色错误条 + Toast 文案。
 */
import { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAudioStore } from '../stores/audioStore';
import { useTourStore } from '../stores/tourStore';
import { getPlayer } from '../hooks/useAudioPlayer';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function AudioBar() {
  const insets = useSafeAreaInsets();
  const { state, spotName, position, duration, error } = useAudioStore();
  const newSpotHint = useTourStore((s) => s.newSpotHint);

  const isActive = state === 'playing' || state === 'paused' || state === 'loading' || state === 'error';
  const slideAnim = useRef(new Animated.Value(100)).current;
  const hintOpacity = useRef(new Animated.Value(0)).current;
  /** 🟡#7: 跟踪当前动画，cleanup 时停止旧动画 */
  const hintAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  // 显示/隐藏动画
  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: isActive ? 0 : 100,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  }, [isActive]);

  // 🟡#7: 弱提示动画（cleanup 停止旧动画，避免 completion 误清新提示）
  useEffect(() => {
    if (newSpotHint) {
      // 停止上一次未完成的动画
      hintAnimRef.current?.stop();
      hintOpacity.setValue(0);

      const anim = Animated.sequence([
        Animated.timing(hintOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.delay(3000),
        Animated.timing(hintOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]);
      hintAnimRef.current = anim;
      anim.start(({ finished }) => {
        // 只有自然完成才清 hint，被 stop 中断的不清
        if (finished) {
          useTourStore.getState().setNewSpotHint(null);
        }
      });
    }

    return () => {
      hintAnimRef.current?.stop();
    };
  }, [newSpotHint]);

  // 🟢#11: 数字宽度，不用 as any
  const progressPct = duration > 0 ? (position / duration) * 100 : 0;
  const progressWidth = (SCREEN_WIDTH * progressPct) / 100;

  // 🔴#1: 错误 3s 后自动清除
  useEffect(() => {
    if (error && state === 'error') {
      const t = setTimeout(() => {
        useAudioStore.getState().setError(null);
        useAudioStore.getState().reset();
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [error, state]);

  const handlePlayPause = () => {
    if (state === 'playing') getPlayer().pause();
    else if (state === 'paused') getPlayer().resume();
  };

  const handleClose = () => {
    // 🟡#3: 标记为主动停止，useTour 的 onPlaybackComplete 会识别
    useAudioStore.getState().setManuallyStopped(true);
    getPlayer().stop();
  };

  // 🟢#9: 点击弱提示 → 立即切到下一个
  const handleHintTap = () => {
    useTourStore.getState().setNewSpotHint(null);
    const next = useTourStore.getState().switchToNext();
    if (next) {
      getPlayer().stop();
      useAudioStore.getState().setManuallyStopped(false);
      setTimeout(() => {
        getPlayer().play(next.spot.audioUrl, next.spot.name, next.spot.id);
      }, 300);
    }
  };

  // 🟡#8: Tab 栏高度 ~49 + safe bottom
  const tabBarHeight = 49;
  const bottomOffset = insets.bottom + tabBarHeight;

  return (
    <Animated.View
      style={[styles.container, { bottom: bottomOffset, transform: [{ translateY: slideAnim }] }]}
      pointerEvents={isActive ? 'auto' : 'none'}
    >
      {/* ===== 🔴#1: 错误提示条 ===== */}
      {state === 'error' && error && (
        <View style={styles.errorBar}>
          <Ionicons name="alert-circle" size={14} color="#fff" style={{ marginRight: 6 }} />
          <Text style={styles.errorText} numberOfLines={1}>{error}</Text>
          <TouchableOpacity
            onPress={() => { useAudioStore.getState().setError(null); useAudioStore.getState().reset(); }}
            style={{ marginLeft: 'auto', padding: 4 }}
          >
            <Ionicons name="close" size={16} color="rgba(255,255,255,0.8)" />
          </TouchableOpacity>
        </View>
      )}

      {/* ===== 🟢#9: 弱提示条（可点击立即切换） ===== */}
      {newSpotHint && state !== 'error' && (
        <TouchableOpacity onPress={handleHintTap} activeOpacity={0.8}>
          <Animated.View style={[styles.hintBar, { opacity: hintOpacity }]}>
            <Text style={styles.hintText}>{newSpotHint}</Text>
            <Text style={styles.hintTapText}>点此切换</Text>
          </Animated.View>
        </TouchableOpacity>
      )}

      {/* ===== 主播放条 ===== */}
      {state !== 'error' && (
        <>
          <View style={styles.bar}>
            <View style={styles.info}>
              <Text style={styles.spotName} numberOfLines={1}>
                {state === 'loading' ? '加载中...' : spotName || '未选择'}
              </Text>
              <Text style={styles.time}>
                {fmtTime(position)} / {fmtTime(duration)}
              </Text>
            </View>

            <View style={styles.controls}>
              <TouchableOpacity onPress={handlePlayPause} style={styles.btn}>
                <Ionicons
                  name={state === 'playing' ? 'pause' : 'play'}
                  size={22}
                  color="#fff"
                />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleClose} style={styles.btn}>
                <Ionicons name="close" size={20} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
            </View>
          </View>

          {/* 进度条 */}
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: progressWidth }]} />
          </View>
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 9000,
  },

  // ── 错误条 ──
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E53935',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    minHeight: 48,
  },
  errorText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },

  // ── 弱提示 ──
  hintBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 152, 0, 0.9)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  hintText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  hintTapText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    marginLeft: 8,
  },

  // ── 主播放条 ──
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(20, 20, 30, 0.94)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    minHeight: 56,
  },
  info: { flex: 1, marginRight: 12 },
  spotName: { color: '#fff', fontSize: 14, fontWeight: '600', marginBottom: 2 },
  time: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btn: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
  },

  // ── 进度条 ──
  progressTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.12)',
    width: SCREEN_WIDTH,
  },
  progressFill: {
    height: 3,
    backgroundColor: '#2EBD85',
    borderRadius: 1.5,
  },
});
