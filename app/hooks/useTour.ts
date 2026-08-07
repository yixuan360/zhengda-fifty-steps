/**
 * ★ 导览引擎 — useTour Hook（v4.0 §6.1 核心）
 *
 * 全部逻辑集中在此文件，不拆分为多个 service/manager。
 *
 * 数据流：
 *   GPS 更新 → 到区域的有符号距离（圆/走廊/多边形统一，v4.1）→ 进围栏 + 滞回确认
 *   → 命中排队（距离最近优先）→ 调用音频播放
 *   → 播放完成 → 60s 冷却 → 出队下一个
 *
 * 滞回机制：进入 d ≤ 0 触发（d=到区域边界距离，负=区内），离开 d > 20m 确认，20m 缓冲带防 GPS 抖动
 * 多景点冲突：按距离最近优先，其余入内存队列顺位播放
 * 冷却规则：单景点独立冷却 60s，离开触发区域后自动重置
 */
import { useEffect, useRef } from 'react';
import { useTourStore } from '../stores/tourStore';
import { useAudioStore } from '../stores/audioStore';
import { getTriggerSignedDistance } from '../utils/trigger';
import { insertPlayHistory } from '../services/database';
import { getPlayer } from './useAudioPlayer';
import type { LatLng, HitSpot } from '../types';
import {
  evaluateSpatialTrigger,
  nextConfirmCount,
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_MIN_MOVEMENT_DISTANCE,
  DEFAULT_PATH_CONFIRM_SAMPLES,
} from '../utils/spatial/triggerEvaluator';
import { computeMovement } from '../utils/spatial/mapMatcher';

const BUFFER_METERS = 20; // 滞回缓冲带宽度（米）

export function useTour() {
  const enteredSpotIds = useRef<Set<number>>(new Set());
  /** 位置历史（窗口 ≤12 个点，约 12s），用于计算移动段航向 */
  const positionHistory = useRef<LatLng[]>([]);
  /** directionCheck 景点的连续空间命中计数（轨迹确认） */
  const confirmCounts = useRef<Record<number, number>>({});
  const currentSpotId = useRef<number | null>(null);
  /** 🟢#13: setTimeout ID，cleanup 时清除 */
  const dequeueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── 订阅位置变化 ──────────────────────────────────
  useEffect(() => {
    const unsub = useTourStore.subscribe((state, prevState) => {
      if (state.userLocation && state.userLocation !== prevState.userLocation) {
        processLocationUpdate(state.userLocation);
      }
    });
    return unsub;
  }, []);

  // ─── 订阅播放事件 ─────────────────────────────────────
  useEffect(() => {
    const unsub = useAudioStore.subscribe((state, prevState) => {
      // 非引擎播放（详情页手动 / hint 切换，engineArmed=false）→ 放弃当前引擎曲目，
      // 否则该曲目结束时会被误判为"播完"而写历史/冷却/出队（审查 LOW-3）。
      // 用 engineArmed 而非 id 比对：失败后保留 ref 时，手动播放"同一景点"
      // 也能被正确识别为手动（审查 MEDIUM-3）。
      if (
        state.state === 'loading' &&
        state.currentSpotId != null &&
        !state.engineArmed
      ) {
        currentSpotId.current = null;
        useTourStore.getState().clearQueue();
        useTourStore.getState().setCurrentHit(null);
        if (dequeueTimer.current !== null) {
          clearTimeout(dequeueTimer.current);
          dequeueTimer.current = null;
        }
        return;
      }

      // 播放/下载失败 → 解卡引擎（v7 新增 error 分支，原代码完全缺失）：
      // 只清当前命中与队列；不清 currentSpotId —— 保留它让"点击重试"仍按引擎语义
      // 播放（完成时正常写历史/设冷却）。音频 store 的 error 由 AppToast 展示后自行复位。
      if (state.state === 'error' && currentSpotId.current !== null) {
        const tourStore = useTourStore.getState();
        tourStore.setCurrentHit(null);
        tourStore.clearQueue();
        if (dequeueTimer.current !== null) {
          clearTimeout(dequeueTimer.current);
          dequeueTimer.current = null;
        }
        return;
      }

      const wasActive =
        prevState.state === 'playing' || prevState.state === 'loading';
      if (wasActive && state.state === 'idle' && currentSpotId.current !== null) {
        onPlaybackComplete(currentSpotId.current, state.manuallyStopped);
      }
    });
    return unsub;
  }, []);

  // ─── 订阅 mock 清除：清空"已进入"集合 ─────────────────
  // mock 期间"进入"的景点在真实定位也处于半径内时不会重新触发，
  // 清除 mock 后应重新按真实 GPS 判定（审查 LOW-2b）。
  useEffect(() => {
    return useTourStore.subscribe((state, prevState) => {
      if (prevState.mockLocation != null && state.mockLocation == null) {
        enteredSpotIds.current.clear();
        confirmCounts.current = {};
        positionHistory.current = [];
      }
    });
  }, []);

  // ─── 🟢#13 cleanup：组件卸载时清除定时器 ──────────────
  useEffect(() => {
    return () => {
      if (dequeueTimer.current !== null) {
        clearTimeout(dequeueTimer.current);
        dequeueTimer.current = null;
      }
    };
  }, []);

  // ─── 核心：处理位置更新 ──────────────────────────────
  function processLocationUpdate(userLoc: LatLng): void {
    const { spots, isAccuracyGood, isInCooldown } = useTourStore.getState();
    if (!isAccuracyGood) return;
    if (spots.length === 0) return;

    // 移动段航向：窗口内找第一个间距 ≥ 8m 的历史点算方向（spec §5.5）
    const history = positionHistory.current;
    history.push(userLoc);
    if (history.length > 12) history.shift();
    const movement = computeMovement(history, DEFAULT_MIN_MOVEMENT_DISTANCE);
    const store = useTourStore.getState();

    const hits: HitSpot[] = [];

    for (const spot of spots) {
      if (!spot.isActive) continue;
      const trigger = spot.trigger;
      const isDirectionPath = trigger?.type === 'corridor' && trigger.directionCheck === true;

      // ── directionCheck corridor：三级判定 + 轨迹确认（pending 语义）──
      // 空间命中(d≤0) → 连续样本计数 → 方向置信度。
      // unknown(方向未分辨,confidence=0)不直接可播：计数在 pending 窗口累积，
      // 直到轨迹分辨为 aligned(0.9) 才播；停留者恒 unknown → 永不播（无 60s 循环）。
      if (isDirectionPath) {
        const d = getTriggerSignedDistance(userLoc, spot);
        if (d <= 0) {
          const hit = evaluateSpatialTrigger(userLoc, movement, spot);
          if (hit) {
            const n = nextConfirmCount(confirmCounts.current[spot.id] ?? 0, true);
            confirmCounts.current[spot.id] = n;
            if (
              n >= DEFAULT_PATH_CONFIRM_SAMPLES &&
              !isInCooldown(spot.id) &&
              hit.confidence >= DEFAULT_CONFIDENCE_THRESHOLD
            ) {
              confirmCounts.current[spot.id] = 0; // 已触发，复位计数
              hits.push({
                spot,
                distance: hit.distance,
                hitAt: Date.now(),
                confidence: hit.confidence,
                reason: hit.reason,
                directionState: hit.directionState,
              });
            }
          }
        } else if (d > BUFFER_METERS) {
          confirmCounts.current[spot.id] = 0;
          store.clearCooldown(spot.id); // 离开围栏清除冷却（Step 0）
        }
        continue;
      }

      // ── 原有 circle/polygon/corridor（无 directionCheck）逻辑不变 ──
      const d = getTriggerSignedDistance(userLoc, spot);
      if (d <= 0 && !enteredSpotIds.current.has(spot.id)) {
        enteredSpotIds.current.add(spot.id);
        if (!isInCooldown(spot.id)) {
          hits.push({ spot, distance: d, hitAt: Date.now() });
        }
      } else if (d > BUFFER_METERS && enteredSpotIds.current.has(spot.id)) {
        enteredSpotIds.current.delete(spot.id);
        store.clearCooldown(spot.id); // 离开围栏清除冷却（Step 0）
      }
    }

    if (hits.length > 0) {
      // 排序键 = 到区域的有符号距离（d 越小越深入/越近，优先播放）。
      // 注意：v4.1 起由旧"到圆心距"改为"区域深度"——半径异构的两个重叠圆，
      // 个别站位下播放顺序可能与旧版不同，属有意变更（圆形区域大小不再被忽略，
      // 且 R2 混入走廊/多边形后"到区域深度"才是跨形状统一的优先级）。
      hits.sort((a, b) => a.distance - b.distance);
      handleHits(hits);
    }
  }

  // ─── 处理命中景点 ──────────────────────────────────
  function handleHits(hits: HitSpot[]): void {
    const audioState = useAudioStore.getState().state;
    const isPlaying = audioState === 'playing' || audioState === 'loading';
    const store = useTourStore.getState();

    if (isPlaying) {
      for (const h of hits) store.enqueue(h);
      store.setNewSpotHint(`发现新景点: ${hits[0].spot.name}`);
    } else {
      const [nearest, ...rest] = hits;
      for (const r of rest) store.enqueue(r);
      playSpot(nearest);
    }
  }

  // ─── 播放指定景点 ──────────────────────────────────
  function playSpot(hit: HitSpot): void {
    const store = useTourStore.getState();
    store.setCurrentHit(hit);
    currentSpotId.current = hit.spot.id;
    // 🟢 触发日志（调试面板展示最近触发记录，含方向置信度状态）
    store.logTrigger(hit.spot.name, {
      confidence: hit.confidence,
      reason: hit.reason,
      directionState: hit.directionState,
    });
    // 传递 spotId 用于 track id（🟡#6）；标记引擎播放（engineArmed），
    // 完成时写历史/设冷却/出队；失败后"点击重试"也走 { engine: true } 保持引擎语义
    getPlayer().play(hit.spot.audioUrl, hit.spot.name, hit.spot.id, { engine: true });
  }

  // ─── 播放完成回调 ──────────────────────────────────
  function onPlaybackComplete(spotId: number, wasManualStop: boolean): void {
    const store = useTourStore.getState();

    // 🟡#3: 用户主动关闭不写历史/不设冷却/不出队
    if (wasManualStop) {
      store.setCurrentHit(null);
      currentSpotId.current = null;
      return;
    }

    store.setCooldown(spotId);
    insertPlayHistory(spotId).catch((e) =>
      console.error('[useTour] 写入播放历史失败:', e),
    );

    store.setCurrentHit(null);
    currentSpotId.current = null;

    const next = store.dequeue();
    if (next) {
      // 🟢#13: 存 ref 以便 cleanup 清除
      dequeueTimer.current = setTimeout(() => {
        dequeueTimer.current = null;
        playSpot(next);
      }, 500);
    }
  }

  return {
    get hint() {
      return useTourStore.getState().newSpotHint;
    },
    dismissHint: () => useTourStore.getState().setNewSpotHint(null),
    /** 🟢#9: 用户确认切到队列中的下一个景点 */
    switchToNext: () => {
      const store = useTourStore.getState();
      const next = store.switchToNext();
      if (next) {
        getPlayer().stop();
        if (dequeueTimer.current) clearTimeout(dequeueTimer.current);
        dequeueTimer.current = setTimeout(() => {
          dequeueTimer.current = null;
          playSpot(next);
        }, 300);
      }
    },
  };
}
