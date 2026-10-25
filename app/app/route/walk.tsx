/**
 * V3 走线页 — 路线卡 + 播放状态机 + 现场调整 + 深度稿
 *
 * 不改 useTour/trigger/map：进入页面后清空引擎队列，并周期性给路线站点
 * 设冷却，让 GPS 引擎在走线期间不抢播放。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Color, Radius, Shadow, Spacing } from '../../constants/theme';
import { getSpotById } from '../../services/database';
import { useTourStore } from '../../stores/tourStore';
import { useRouteStore } from '../../stores/routeStore';
import { useRoutePlayback } from '../../hooks/useRoutePlayback';
import type { RouteEventReporter } from '../../hooks/useRoutePlayback';
import {
  adaptRoute,
  reportRouteEvent,
} from '../../services/routeApi';
import { derivePlanAfterAdapt } from '../../utils/routes';
import RouteCard from '../../components/route/RouteCard';
import RouteAdaptBar from '../../components/route/RouteAdaptBar';
import RouteDeepDive from '../../components/route/RouteDeepDive';
import type { Spot } from '../../types';
import type { RouteAdaptAction } from '../../types/routes';

const GPS_SUPPRESS_MS = 20_000;

function SummaryCard({
  routeName,
  visited,
  minutes,
  endedEarly,
  note,
  shelterName,
  onAgain,
  onHome,
}: {
  routeName: string;
  visited: number;
  minutes: number;
  endedEarly?: boolean;
  note?: string | null;
  shelterName?: string | null;
  onAgain: () => void;
  onHome: () => void;
}) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryEyebrow}>
        {endedEarly ? '路线提前收尾' : '路线完成'}
      </Text>
      <Text style={styles.summaryTitle}>
        {endedEarly ? '今天走到这里，' : '走完了，'}
        {routeName}
      </Text>
      <Text style={styles.summaryText}>
        共走过 {visited} 站，约 {minutes} 分钟。固定讲解、站点过渡和现场调整
        都已记录到本次路线。
      </Text>
      {note ? <Text style={styles.summaryNote}>{note}</Text> : null}
      {shelterName ? (
        <Text style={styles.summaryNote}>避雨点：{shelterName}</Text>
      ) : null}
      <View style={styles.summaryRow}>
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.8}
          style={[styles.summaryBtn, styles.summaryBtnOutline]}
          onPress={onAgain}
        >
          <Text style={styles.summaryBtnOutlineText}>再走一次</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.8}
          style={styles.summaryBtn}
          onPress={onHome}
        >
          <Text style={styles.summaryBtnText}>回到地图</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function RouteWalkScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const plan = useRouteStore((s) => s.plan);
  const detail = useRouteStore((s) => s.detail);
  const notice = useRouteStore((s) => s.notice);
  const updatePlan = useRouteStore((s) => s.updatePlan);
  const setNotice = useRouteStore((s) => s.setNotice);
  const storeSpots = useTourStore((s) => s.spots);

  const [spots, setSpots] = useState<Record<number, Spot>>({});
  const [spotsLoaded, setSpotsLoaded] = useState(false);
  const [deepOpen, setDeepOpen] = useState(false);
  const [adapting, setAdapting] = useState(false);
  const [adaptMessage, setAdaptMessage] = useState<string | null>(null);
  const [shelter, setShelter] = useState<{ id: number; name: string } | null>(
    null,
  );

  const routeCode = plan?.route_code ?? '';

  useEffect(() => {
    if (!detail) return;
    let cancelled = false;
    const ids = detail.stops.map((stop) => stop.spot_id);
    const idSet = new Set(ids);
    const baseMap: Record<number, Spot> = {};
    for (const spot of storeSpots) {
      if (idSet.has(spot.id)) baseMap[spot.id] = spot;
    }
    setSpots(baseMap);
    setSpotsLoaded(false);

    (async () => {
      try {
        const entries = await Promise.all(
          ids.map(async (id) => [id, await getSpotById(id)] as const),
        );
        if (cancelled) return;
        const map: Record<number, Spot> = { ...baseMap };
        for (const [id, spot] of entries) {
          if (spot) map[id] = spot;
        }
        setSpots(map);
      } catch {
        // SQLite 读取失败时保留 storeSpots 预填结果
      } finally {
        if (!cancelled) setSpotsLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, [detail, storeSpots]);

  // 走线期间压制导览引擎：清队列 + 周期冷却所有景点
  // （路线站点之外的地方也不应抢播放，所以冷却全量 spot）
  useEffect(() => {
    if (!detail) return;
    const ids = storeSpots.length > 0
      ? storeSpots.map((spot) => spot.id)
      : detail.stops.map((stop) => stop.spot_id);
    const tour = useTourStore.getState();
    tour.clearQueue();
    tour.setCurrentHit(null);

    const tick = () => {
      const current = useTourStore.getState();
      for (const id of ids) current.setCooldown(id);
    };
    tick();
    const timer = setInterval(tick, GPS_SUPPRESS_MS);
    return () => {
      clearInterval(timer);
      // 离开路线后立即恢复导览：否则全量景点的 60s 冷却会让第一次靠近被吞掉
      const current = useTourStore.getState();
      for (const id of ids) current.clearCooldown(id);
    };
  }, [detail, storeSpots]);

  const onEvent = useCallback<RouteEventReporter>((event, spotId, payload) => {
    if (!routeCode) return;
    void reportRouteEvent(routeCode, event, spotId, payload ?? {});
  }, [routeCode]);

  const playback = useRoutePlayback({ detail, plan, spots, onEvent });
  const phaseRef = useRef(playback.phase);
  useEffect(() => { phaseRef.current = playback.phase; }, [playback.phase]);

  const currentStop = playback.currentStop;
  const currentSpot = playback.currentSpot;
  const summary = playback.phase === 'summary';
  const idle = playback.phase === 'idle';
  const canDeep = playback.phase === 'stop' && !!currentStop?.category;
  const spotsReady = spotsLoaded;

  const handleStart = () => {
    if (!spotsReady) return;
    setDeepOpen(false);
    setNotice(null);
    setAdaptMessage(null);
    setShelter(null);
    playback.start();
  };

  const handleStop = () => {
    setDeepOpen(false);
    setAdaptMessage(null);
    setShelter(null);
    playback.stopRoute();
  };

  const handleSkip = () => {
    setDeepOpen(false);
    playback.skip();
  };

  const handleDeep = () => {
    if (!canDeep) return;
    playback.suspend();
    setDeepOpen(true);
  };

  const handleDeepContinue = () => {
    setDeepOpen(false);
    playback.resume();
  };

  const handleAdapt = async (action: RouteAdaptAction) => {
    if (!plan || !detail || adapting) return;
    const order = currentStop?.order
      ?? plan.stops[plan.stops.length - 1]
      ?? plan.start_order;
    const previousStops = playback.stops.map((stop) => stop.order);
    setAdapting(true);
    setAdaptMessage(null);
    try {
      const result = await adaptRoute(
        plan.route_code,
        order,
        action,
        previousStops,
        action === 'rain' ? { weather: 'rain' } : {},
      );
      updatePlan(derivePlanAfterAdapt(detail, plan, result));
      setAdaptMessage(result.message);
      setNotice(null);
      if (action === 'rain' && result.shelter_spot_id && result.shelter_name) {
        setShelter({
          id: result.shelter_spot_id,
          name: result.shelter_name,
        });
      } else {
        setShelter(null);
      }
      void reportRouteEvent(
        plan.route_code,
        'adapt',
        currentStop?.spot_id ?? null,
        {
          action,
          order,
          stops: result.stops,
          shelter_spot_id: result.shelter_spot_id,
        },
      );

      if (result.deep_dive && currentStop) {
        playback.suspend();
        setDeepOpen(true);
      } else if (action !== 'more') {
        // 时间不够/下雨：立即停止当前段（包括正在播的过渡），进入小结
        playback.finish();
      } else {
        const added = result.stops.find(
          (item) => !previousStops.includes(item),
        );
        const currentPhase = phaseRef.current;
        if (
          added != null
          && (currentPhase === 'outro' || currentPhase === 'summary')
        ) {
          playback.jumpToIndex(result.stops.indexOf(added));
        }
      }
    } catch {
      setAdaptMessage('调整暂不可用，保持当前路线');
    } finally {
      setAdapting(false);
    }
  };

  if (!plan || !detail) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>还没有路线</Text>
        <Text style={styles.emptyHint}>先去“带我走”选一个时间和兴趣。</Text>
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.8}
          style={styles.emptyBtn}
          onPress={() => router.replace('/(tabs)/routes')}
        >
          <Text style={styles.emptyBtnText}>去规划路线</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const primaryLabel = !spotsReady
    ? '加载景点讲解…'
    : deepOpen
      ? '继续路线'
      : idle
        ? '开始走线'
        : summary
          ? '再走一次'
          : playback.isLoading
            ? '加载中…'
            : playback.isPaused
              ? '继续播放'
              : playback.isPlaying
                ? '暂停'
                : '继续播放';

  const handlePrimary = () => {
    if (!spotsReady) return;
    if (deepOpen) {
      handleDeepContinue();
      return;
    }
    if (idle || summary) {
      handleStart();
      return;
    }
    playback.togglePause();
  };

  const currentLabel = currentStop
    ? `${currentStop.order}. ${currentSpot?.name ?? currentStop.note}`
    : playback.phaseLabel;

  return (
    <>
      <Stack.Screen
        options={{
          title: detail.name,
          headerStyle: { backgroundColor: Color.pageBg },
          headerTintColor: Color.primary,
        }}
      />
      <ScrollView
        style={styles.page}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 32 + insets.bottom },
        ]}
      >
        {notice ? (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setNotice(null)}
            style={styles.notice}
          >
            <Text style={styles.noticeText}>{notice}</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.progressTrack}>
          <View
            style={[styles.progressFill, { width: `${playback.progress * 100}%` }]}
          />
        </View>

        <View style={styles.statusRow}>
          <View style={styles.phasePill}>
            <Text style={styles.phaseText}>{playback.phaseLabel}</Text>
          </View>
          <Text style={styles.currentLabel} numberOfLines={1}>
            {summary ? '路线完成' : currentLabel}
          </Text>
        </View>

        {!summary && playback.activeText ? (
          <View style={styles.narrationCard}>
            <Text style={styles.narrationLabel}>
              {playback.isPlaying ? '正在播放' : '本段讲解'}
            </Text>
            <Text style={styles.narrationText}>{playback.activeText}</Text>
          </View>
        ) : null}

        {playback.playbackError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{playback.playbackError}</Text>
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.8}
              onPress={playback.retry}
            >
              <Text style={styles.errorAction}>重试本段</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!summary ? (
          <View style={styles.controls}>
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.85}
              disabled={!spotsReady}
              style={[styles.primaryBtn, !spotsReady && styles.primaryBtnDisabled]}
              onPress={handlePrimary}
            >
              <Ionicons
                name={
                  deepOpen
                    ? 'arrow-forward'
                    : idle || (!playback.isPlaying && !playback.isPaused)
                      ? 'play'
                      : playback.isPlaying
                        ? 'pause'
                        : 'play'
                }
                size={20}
                color="#fff"
              />
              <Text style={styles.primaryText}>{primaryLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.75}
              style={styles.secondaryBtn}
              onPress={handleSkip}
            >
              <Ionicons name="play-skip-forward" size={18} color={Color.primary} />
              <Text style={styles.secondaryText}>下一站</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.75}
              style={styles.secondaryBtn}
              onPress={handleStop}
            >
              <Ionicons name="stop" size={18} color={Color.primary} />
              <Text style={styles.secondaryText}>结束</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {canDeep && !deepOpen ? (
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.8}
            style={styles.deepBtn}
            onPress={handleDeep}
          >
            <Ionicons name="sparkles" size={18} color={Color.accent} />
            <Text style={styles.deepText}>在当前站深入一点</Text>
          </TouchableOpacity>
        ) : null}

        {deepOpen && currentStop ? (
          <RouteDeepDive
            key={`${currentStop.spot_id}-${currentStop.category}`}
            spotId={currentStop.spot_id}
            category={currentStop.category}
            spotName={currentSpot?.name ?? currentStop.note}
            onContinue={handleDeepContinue}
          />
        ) : null}

        {summary ? (
          <SummaryCard
            routeName={detail.name}
            visited={Math.min(
              playback.index + 1,
              playback.stops.length,
            )}
            minutes={plan.total_minutes}
            endedEarly={playback.endedEarly}
            note={adaptMessage}
            shelterName={shelter?.name ?? null}
            onAgain={handleStart}
            onHome={() => router.replace('/(tabs)/map')}
          />
        ) : null}

        {!summary && adaptMessage ? (
          <View style={styles.adaptCard}>
            <Text style={styles.adaptText}>{adaptMessage}</Text>
          </View>
        ) : null}

        {!summary ? (
          <View style={styles.adaptWrap}>
            <RouteAdaptBar
              disabled={idle || deepOpen}
              loading={adapting}
              onAction={(action) => { void handleAdapt(action); }}
            />
          </View>
        ) : null}

        {!summary && shelter ? (
          <View style={styles.shelterCard}>
            <Ionicons name="umbrella-outline" size={18} color={Color.accent} />
            <View style={styles.shelterBody}>
              <Text style={styles.shelterTitle}>避雨点：{shelter.name}</Text>
              <Text style={styles.shelterHint}>
                路线在这里收尾，往这个方向走即可避雨。
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.cardWrap}>
          <RouteCard
            detail={detail}
            plan={plan}
            currentOrder={currentStop?.order ?? null}
          />
        </View>

        {!summary && !spotsReady ? (
          <View style={styles.loadingHint}>
            <ActivityIndicator size="small" color={Color.primary} />
            <Text style={styles.loadingText}>正在加载景点讲解…</Text>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Color.pageBg },
  content: { paddingHorizontal: Spacing.pageH, paddingTop: Spacing.md },
  empty: {
    flex: 1,
    backgroundColor: Color.pageBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.pageH,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: Color.heading },
  emptyHint: {
    marginTop: Spacing.sm,
    fontSize: 14,
    color: Color.caption,
    textAlign: 'center',
  },
  emptyBtn: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Color.primary,
  },
  emptyBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  notice: {
    marginBottom: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Color.primarySoft,
  },
  noticeText: { fontSize: 13, lineHeight: 20, color: Color.primary },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Color.divider,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Color.primary,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  phasePill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    backgroundColor: Color.primarySoft,
  },
  phaseText: { fontSize: 11, fontWeight: '700', color: Color.primary },
  currentLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: Color.heading },
  narrationCard: {
    marginTop: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    backgroundColor: Color.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.cardBorder,
    ...Shadow.card,
  },
  narrationLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Color.accent,
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  narrationText: { fontSize: 15, lineHeight: 24, color: Color.body },
  errorCard: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Color.primarySoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  errorText: { flex: 1, fontSize: 13, color: Color.error, lineHeight: 19 },
  errorAction: { fontSize: 13, fontWeight: '700', color: Color.primary },
  controls: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  primaryBtn: {
    flex: 2,
    minHeight: 50,
    borderRadius: Radius.md,
    backgroundColor: Color.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  primaryBtnDisabled: { opacity: 0.55 },
  primaryText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  secondaryBtn: {
    flex: 1,
    minHeight: 50,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.primary,
    backgroundColor: Color.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  secondaryText: { fontSize: 11, fontWeight: '600', color: Color.primary },
  deepBtn: {
    marginTop: Spacing.sm,
    minHeight: 46,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Color.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  deepText: { fontSize: 14, fontWeight: '600', color: Color.accent },
  adaptWrap: { marginTop: Spacing.md },
  adaptCard: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Color.primarySoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  adaptText: { flex: 1, fontSize: 13, lineHeight: 20, color: Color.primary },
  shelterCard: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Color.cardBg,
    borderWidth: 1,
    borderColor: Color.accent,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  shelterBody: { flex: 1 },
  shelterTitle: { fontSize: 13, fontWeight: '700', color: Color.accent },
  shelterHint: { marginTop: 2, fontSize: 11, color: Color.caption },
  cardWrap: { marginTop: Spacing.lg },
  summaryCard: {
    marginTop: Spacing.lg,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    backgroundColor: Color.cardBg,
    borderWidth: 1,
    borderColor: Color.primary,
    ...Shadow.card,
  },
  summaryEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: Color.accent,
    letterSpacing: 1,
  },
  summaryTitle: {
    marginTop: Spacing.xs,
    fontSize: 20,
    fontWeight: '700',
    color: Color.heading,
  },
  summaryText: {
    marginTop: Spacing.sm,
    fontSize: 14,
    lineHeight: 22,
    color: Color.body,
  },
  summaryNote: {
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Color.primarySoft,
    fontSize: 13,
    lineHeight: 20,
    color: Color.primary,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  summaryBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: Radius.md,
    backgroundColor: Color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryBtnOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Color.primary,
  },
  summaryBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  summaryBtnOutlineText: { fontSize: 14, fontWeight: '700', color: Color.primary },
  loadingHint: {
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  loadingText: { fontSize: 12, color: Color.caption },
});
