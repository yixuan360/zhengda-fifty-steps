/**
 * V3 路线播放状态机
 *
 *   idle → intro → stop(index) → transition → stop(index+1) → … → outro → summary
 *
 * - 只依赖现有 audioStore / getPlayer，不改导览引擎；
 * - 每段音频用 expectedKey 校验，切站/退出时丢弃过期回调；
 * - 无音频的段落用短定时器推进，保证没有生成音频时也能走完。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPlayer } from './useAudioPlayer';
import { useAudioStore } from '../stores/audioStore';
import { resolveRouteAudioUrl } from '../services/routeApi';
import { audioKey } from '../utils/routes';
import type { Spot } from '../types';
import type {
  RouteDetail,
  RouteEvent,
  RoutePlan,
  RouteStop,
} from '../types/routes';

export type RoutePhase =
  | 'idle'
  | 'intro'
  | 'stop'
  | 'transition'
  | 'outro'
  | 'summary';

interface PlaybackState {
  phase: RoutePhase;
  index: number;
  /** 重试/重播时递增，驱动播放副作用重新执行 */
  run: number;
}

interface Segment {
  url: string | null;
  name: string;
  spotId?: number;
  text: string;
}

export type RouteEventReporter = (
  event: RouteEvent,
  spotId: number | null,
  payload?: Record<string, unknown>,
) => void;

interface Options {
  detail: RouteDetail | null;
  plan: RoutePlan | null;
  spots: Record<number, Spot>;
  onEvent?: RouteEventReporter;
}

const PHASE_LABELS: Record<RoutePhase, string> = {
  idle: '准备出发',
  intro: '路线开场',
  stop: '景点讲解',
  transition: '走向下一站',
  outro: '路线收尾',
  summary: '路线完成',
};

export function useRoutePlayback({
  detail,
  plan,
  spots,
  onEvent,
}: Options) {
  const [state, setState] = useState<PlaybackState>({
    phase: 'idle',
    index: 0,
    run: 0,
  });
  const [suspended, setSuspended] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [endedEarly, setEndedEarly] = useState(false);

  const audioState = useAudioStore((s) => s.state);
  const audioError = useAudioStore((s) => s.error);

  const stops = useMemo<RouteStop[]>(() => {
    if (!detail || !plan) return [];
    const byOrder = new Map(detail.stops.map((stop) => [stop.order, stop]));
    return plan.stops
      .map((order) => byOrder.get(order))
      .filter((stop): stop is RouteStop => Boolean(stop));
  }, [detail, plan]);

  const expectedKey = useRef<string | null>(null);
  const stateRef = useRef(state);
  const stopsRef = useRef<RouteStop[]>(stops);
  const detailRef = useRef<RouteDetail | null>(detail);
  const spotsRef = useRef<Record<number, Spot>>(spots);
  const planRef = useRef<RoutePlan | null>(plan);
  const onEventRef = useRef<RouteEventReporter | undefined>(onEvent);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { stopsRef.current = stops; }, [stops]);
  useEffect(() => { detailRef.current = detail; }, [detail]);
  useEffect(() => { spotsRef.current = spots; }, [spots]);
  useEffect(() => { planRef.current = plan; }, [plan]);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  const getSegment = useCallback(
    (phase: RoutePhase, index: number): Segment | null => {
      const currentDetail = detailRef.current;
      const currentStops = stopsRef.current;
      if (!currentDetail) return null;

      if (phase === 'intro' || phase === 'outro') {
        const narrative = currentDetail.narratives.find(
          (item) => item.kind === phase,
        );
        if (!narrative) return null;
        return {
          url: narrative.audio_url
            ? resolveRouteAudioUrl(narrative.audio_url)
            : null,
          name: phase === 'intro' ? '路线开场' : '路线收尾',
          text: narrative.text,
        };
      }

      if (phase === 'transition') {
        const from = currentStops[index];
        const to = currentStops[index + 1];
        if (!from || !to) return null;
        const narrative = currentDetail.narratives.find(
          (item) => item.kind === 'transition'
            && item.from_order === from.order
            && item.to_order === to.order,
        );
        if (!narrative) return null;
        return {
          url: narrative.audio_url
            ? resolveRouteAudioUrl(narrative.audio_url)
            : null,
          name: `${from.note || `第 ${from.order} 站`} → ${to.note || `第 ${to.order} 站`}`,
          text: narrative.text,
        };
      }

      if (phase === 'stop') {
        const stop = currentStops[index];
        if (!stop) return null;
        const spot = spotsRef.current[stop.spot_id];
        return {
          url: spot?.audioUrl || null,
          name: spot?.name ?? stop.note ?? `第 ${stop.order} 站`,
          spotId: stop.spot_id,
          text: spot?.summary ?? stop.note ?? '',
        };
      }

      return null;
    },
    [],
  );

  const next = useCallback(() => {
    setState((prev) => {
      const length = stopsRef.current.length;
      if (prev.phase === 'intro') {
        return { phase: 'stop', index: 0, run: prev.run + 1 };
      }
      if (prev.phase === 'stop') {
        if (length === 0 || prev.index >= length - 1) {
          return { phase: 'outro', index: prev.index, run: prev.run + 1 };
        }
        return { phase: 'transition', index: prev.index, run: prev.run + 1 };
      }
      if (prev.phase === 'transition') {
        if (prev.index + 1 < length) {
          return {
            phase: 'stop', index: prev.index + 1, run: prev.run + 1,
          };
        }
        return { phase: 'outro', index: prev.index, run: prev.run + 1 };
      }
      if (prev.phase === 'outro') {
        return { phase: 'summary', index: prev.index, run: prev.run + 1 };
      }
      return prev;
    });
  }, []);

  const start = useCallback(() => {
    const length = stopsRef.current.length;
    const startOrder = planRef.current?.start_order ?? 1;
    setPlaybackError(null);
    setSuspended(false);
    setEndedEarly(false);
    setState((prev) => ({
      phase: length === 0 ? 'summary' : startOrder > 1 ? 'stop' : 'intro',
      index: 0,
      run: prev.run + 1,
    }));
    onEventRef.current?.('start', null, {
      stops: stopsRef.current.map((stop) => stop.order),
      start_order: startOrder,
    });
  }, []);

  const skip = useCallback(() => {
    setSuspended(false);
    setPlaybackError(null);
    expectedKey.current = null;
    useAudioStore.getState().setManuallyStopped(true);
    getPlayer().stop();
    next();
  }, [next]);

  const retry = useCallback(() => {
    setPlaybackError(null);
    setState((prev) => ({ ...prev, run: prev.run + 1 }));
  }, []);

  const stopRoute = useCallback(() => {
    const stop = stopsRef.current[stateRef.current.index];
    expectedKey.current = null;
    setPlaybackError(null);
    setSuspended(false);
    setEndedEarly(false);
    useAudioStore.getState().setManuallyStopped(true);
    getPlayer().stop();
    setState((prev) => ({ phase: 'idle', index: 0, run: prev.run + 1 }));
    onEventRef.current?.('stop', stop?.spot_id ?? null, {
      order: stop?.order ?? null,
    });
  }, []);

  /** 现场调整提前收尾：停当前段，直接进入小结。 */
  const finish = useCallback(() => {
    expectedKey.current = null;
    setPlaybackError(null);
    setSuspended(false);
    setEndedEarly(true);
    useAudioStore.getState().setManuallyStopped(true);
    getPlayer().stop();
    setState((prev) => ({
      phase: 'summary',
      index: prev.index,
      run: prev.run + 1,
    }));
  }, []);

  /** “想多待”在收尾阶段加回新站时，从指定下标继续播。 */
  const jumpToIndex = useCallback((target: number) => {
    expectedKey.current = null;
    setPlaybackError(null);
    setSuspended(false);
    useAudioStore.getState().setManuallyStopped(true);
    getPlayer().stop();
    setState((prev) => ({
      phase: 'stop',
      index: Math.max(0, target),
      run: prev.run + 1,
    }));
  }, []);

  const togglePause = useCallback(() => {
    const current = useAudioStore.getState().state;
    if (current === 'playing') {
      getPlayer().pause();
    } else if (current === 'paused') {
      getPlayer().resume();
    } else if (current !== 'loading') {
      setPlaybackError(null);
      setState((prev) => ({ ...prev, run: prev.run + 1 }));
    }
  }, []);

  const suspend = useCallback(() => {
    expectedKey.current = null;
    setSuspended(true);
    useAudioStore.getState().setManuallyStopped(true);
    getPlayer().stop();
  }, []);

  const resume = useCallback(() => {
    setSuspended(false);
    next();
  }, [next]);

  // 播放当前段落
  useEffect(() => {
    if (suspended || !detailRef.current) return;
    if (state.phase === 'idle' || state.phase === 'summary') return;

    const segment = getSegment(state.phase, state.index);
    if (!segment) {
      const timer = setTimeout(next, 350);
      return () => clearTimeout(timer);
    }
    if (!segment.url) {
      const timer = setTimeout(next, segment.text ? 1800 : 800);
      return () => clearTimeout(timer);
    }

    expectedKey.current = audioKey(segment.url);
    setPlaybackError(null);
    getPlayer().play(segment.url, segment.name, segment.spotId);
  }, [state.phase, state.index, state.run, suspended, getSegment, next]);

  // 自然播完 → 下一段；手动停止/暂停不推进
  useEffect(() => {
    return useAudioStore.subscribe((audio, prev) => {
      if (prev.state !== 'playing' || audio.state !== 'idle') return;
      if (audio.manuallyStopped) return;
      const key = expectedKey.current;
      if (!key) return;
      if (!(prev.currentUrl ?? '').includes(key)) return;
      expectedKey.current = null;
      next();
    });
  }, [next]);

  // 播放失败 → 暂停状态机，等用户重试/跳过
  useEffect(() => {
    if (audioState !== 'error' || !audioError) return;
    if (!expectedKey.current) return;
    const stop = stopsRef.current[stateRef.current.index];
    expectedKey.current = null;
    setPlaybackError(audioError.message);
    onEventRef.current?.('fallback', stop?.spot_id ?? null, {
      order: stop?.order ?? null,
      reason: 'audio_error',
    });
  }, [audioState, audioError]);

  // 进入某站/完成路线时记账
  useEffect(() => {
    if (state.phase === 'stop') {
      const stop = stopsRef.current[state.index];
      if (stop) {
        onEventRef.current?.('view', stop.spot_id, { order: stop.order });
      }
    } else if (state.phase === 'summary' && !endedEarly) {
      onEventRef.current?.('complete', null, {
        stops: stopsRef.current.map((stop) => stop.order),
      });
    }
  }, [state.phase, state.index, endedEarly]);

  // 路线被调整变短时夹住当前下标
  useEffect(() => {
    if (state.phase === 'idle' || state.phase === 'summary') return;
    if (stops.length === 0) {
      setState((prev) => ({
        phase: 'summary', index: 0, run: prev.run + 1,
      }));
    } else if (state.index >= stops.length) {
      setState((prev) => ({
        ...prev, index: stops.length - 1, run: prev.run + 1,
      }));
    }
  }, [stops.length, state.phase, state.index]);

  // 离开路线页：只停本页发起的音频，避免误停其他页面的播放
  useEffect(() => {
    return () => {
      const key = expectedKey.current;
      expectedKey.current = null;
      const currentUrl = useAudioStore.getState().currentUrl ?? '';
      if (key && currentUrl.includes(key)) {
        useAudioStore.getState().setManuallyStopped(true);
        getPlayer().stop();
      }
    };
  }, []);

  const currentStop = stops[state.index] ?? null;
  const currentSpot = currentStop ? spots[currentStop.spot_id] : undefined;
  const activeSegment = getSegment(state.phase, state.index);
  const progress = stops.length === 0
    ? 0
    : state.phase === 'idle'
      ? 0
      : state.phase === 'summary'
        ? 1
        : Math.min(1, (state.index + 1) / stops.length);

  return {
    phase: state.phase,
    phaseLabel: PHASE_LABELS[state.phase],
    index: state.index,
    stops,
    currentStop,
    currentSpot,
    activeText: activeSegment?.text ?? '',
    progress,
    isPlaying: audioState === 'playing',
    isPaused: audioState === 'paused',
    isLoading: audioState === 'loading',
    endedEarly,
    playbackError,
    start,
    skip,
    retry,
    stopRoute,
    finish,
    jumpToIndex,
    togglePause,
    suspend,
    resume,
  };
}
