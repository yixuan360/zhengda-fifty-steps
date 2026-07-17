/**
 * 自定义入口 — expo-router entry + RNTP PlaybackService 注册
 *
 * RNTP 官方要求：registerPlaybackService 必须在 App 注册后立即调用（模块顶层），
 * 否则 Android 上 MusicService 启动时找不到 JS 服务 → 通知/锁屏控制失效甚至崩溃。
 *
 * try/catch：Expo Go 中 RNTP 原生模块不存在时静默降级（与 useAudioPlayer 策略一致）。
 */
import 'expo-router/entry';

try {
  const TrackPlayer = require('react-native-track-player').default;
  TrackPlayer.registerPlaybackService(() => require('./services/playbackService'));
} catch {
  // Expo Go / 原生模块缺失：跳过注册，App 以无后台音频模式运行
}
