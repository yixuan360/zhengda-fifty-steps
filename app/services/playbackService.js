/**
 * react-native-track-player 后台播放服务（v4 官方模式）
 * 处理通知栏 / 锁屏遥控事件。必须在 index.js 中通过
 * TrackPlayer.registerPlaybackService 注册，否则 Android 前台服务启动即失败。
 *
 * 注意：本文件运行在 Headless JS 上下文，不能引用任何 React 组件。
 */
const TrackPlayer = require('react-native-track-player').default;
const { Event } = require('react-native-track-player');

module.exports = async function playbackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.reset());
  TrackPlayer.addEventListener(Event.RemoteSeek, (e) => TrackPlayer.seekTo(e.position));
};
