/**
 * ★ 导览引擎 — useTour Hook（v4.0 §6.1 核心）
 *
 * 全部逻辑集中在此文件，不拆分为多个 service/manager。
 *
 * 数据流：
 *   GPS 更新 → Haversine 距离 → 50m 触发 + 滞回确认
 *   → 命中排队（距离最近优先）→ 调用音频播放
 *   → 播放完成 → 60s 冷却 → 出队下一个
 *
 * 滞回机制：进入 ≤ 50m 触发，离开 > 70m 确认，20m 缓冲带防 GPS 抖动
 * 多景点冲突：按距离最近优先，其余入内存队列顺位播放
 * 冷却规则：单景点独立冷却 60s，离开触发区域后自动重置
 */
import { useEffect, useRef } from 'react';
import { useTourStore } from '../stores/tourStore';
import { useAudioStore } from '../stores/audioStore';
import { haversineDistance } from '../utils/distance';
import { insertPlayHistory } from '../services/database';
import { getPlayer } from './useAudioPlayer';
import type { LatLng } from '../utils/coordinate';
import type { HitSpot } from '../types';

const BUFFER_METERS = 20; // 滞回缓冲带宽度（米）

export function useTour() {
  const enteredSpotIds = useRef<Set<number>>(new Set());
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

  // ─── 订阅播放完成（audioStore.state 回到 idle 时触发） ──
  useEffect(() => {
    const unsub = useAudioStore.subscribe((state, prevState) => {
      const wasActive =
        prevState.state === 'playing' || prevState.state === 'loading';
      if (wasActive && state.state === 'idle' && currentSpotId.current !== null) {
        onPlaybackComplete(currentSpotId.current, state.manuallyStopped);
      }
    });
    return unsub;
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

    const hits: HitSpot[] = [];

    for (const spot of spots) {
      if (!spot.isActive) continue;

      const dist = haversineDistance(userLoc, { lat: spot.lat, lng: spot.lng });
      const triggerDist = spot.triggerRadius;
      const leaveDist = triggerDist + BUFFER_METERS;

      if (dist <= triggerDist && !enteredSpotIds.current.has(spot.id)) {
        enteredSpotIds.current.add(spot.id);
        if (!isInCooldown(spot.id)) {
          hits.push({ spot, distance: dist, hitAt: Date.now() });
        }
      } else if (dist > leaveDist && enteredSpotIds.current.has(spot.id)) {
        enteredSpotIds.current.delete(spot.id);
      }
    }

    if (hits.length > 0) {
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
    // 传递 spotId 用于 track id（🟡#6）
    getPlayer().play(hit.spot.audioUrl, hit.spot.name, hit.spot.id);
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
      const next = store.dequeue();
      if (next) {
        // 清除当前播放
        getPlayer().stop();
        // 短延迟后播下一个
        if (dequeueTimer.current) clearTimeout(dequeueTimer.current);
        dequeueTimer.current = setTimeout(() => {
          dequeueTimer.current = null;
          playSpot(next);
        }, 300);
      }
    },
  };
}
