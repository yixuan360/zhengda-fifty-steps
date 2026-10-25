/**
 * V3 “带我走” — 时间/兴趣 → Agent 规划 → 进入走线页
 * 功能由 EXPO_PUBLIC_NARRATIVE_ROUTE_ENABLED 控制；关闭时 Tab 不显示。
 */
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Color, Radius, Shadow, Spacing } from '../../constants/theme';
import { useTourStore } from '../../stores/tourStore';
import { useRouteStore } from '../../stores/routeStore';
import {
  fetchRouteCatalog,
  fetchRouteDetail,
  planRoute,
  reportRouteEvent,
} from '../../services/routeApi';
import { haversineDistance } from '../../utils/distance';
import type { RoutePlan, RouteSummary } from '../../types/routes';

const ROUTE_ENABLED =
  process.env.EXPO_PUBLIC_NARRATIVE_ROUTE_ENABLED === 'true';

const TIME_OPTIONS = [
  { minutes: 20, label: '20 分钟', hint: '快走' },
  { minutes: 30, label: '30 分钟', hint: '标准' },
  { minutes: 45, label: '45 分钟', hint: '深度' },
];

const INTEREST_OPTIONS = [
  { key: 'architecture', label: '建筑' },
  { key: 'history', label: '校史' },
  { key: 'nature', label: '自然' },
  { key: 'civilization', label: '文明' },
];

const MAIN_ROUTE = 'meihu-8';

export default function RoutesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const spots = useTourStore((s) => s.spots);
  const userLocation = useTourStore((s) => s.userLocation);
  const setRoute = useRouteStore((s) => s.setRoute);

  const [minutes, setMinutes] = useState(30);
  const [interests, setInterests] = useState<string[]>([]);
  const [startAtNearest, setStartAtNearest] = useState(false);
  const [catalog, setCatalog] = useState<RouteSummary[]>([]);
  const [routeSpotIds, setRouteSpotIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ROUTE_ENABLED) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchRouteCatalog();
        if (cancelled) return;
        setCatalog(list);
        const details = await Promise.all(
          list.map((item) => fetchRouteDetail(item.code).catch(() => null)),
        );
        if (cancelled) return;
        const ids = new Set<number>();
        for (const detail of details) {
          for (const stop of detail?.stops ?? []) ids.add(stop.spot_id);
        }
        setRouteSpotIds(ids);
      } catch {
        // 目录拉取失败不阻断规划，Agent 仍可返回路线
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const nearest = (() => {
    if (!userLocation || spots.length === 0 || routeSpotIds.size === 0) {
      return null;
    }
    let best: { id: number; name: string; distance: number } | null = null;
    for (const spot of spots) {
      if (!routeSpotIds.has(spot.id)) continue;
      const distance = haversineDistance(userLocation, {
        lat: spot.lat, lng: spot.lng,
      });
      if (!best || distance < best.distance) {
        best = { id: spot.id, name: spot.name, distance };
      }
    }
    return best && best.distance <= 150 ? best : null;
  })();

  const toggleInterest = (key: string) => {
    setInterests((prev) => (
      prev.includes(key)
        ? prev.filter((item) => item !== key)
        : [...prev, key]
    ));
  };

  const openRoute = () => {
    router.push('/route/walk');
  };

  const handlePlan = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    const started = Date.now();
    const payload = {
      minutes,
      interests,
      start_spot_id: startAtNearest ? nearest?.id ?? null : null,
    };

    try {
      const plan = await planRoute(
        minutes,
        interests,
        startAtNearest ? nearest?.id ?? null : null,
      );
      const detail = await fetchRouteDetail(plan.route_code);
      setRoute(plan, detail);
      void reportRouteEvent(
        plan.route_code,
        'plan',
        null,
        { ...payload, fallback: false },
        Date.now() - started,
      );
      openRoute();
    } catch {
      try {
        const detail = await fetchRouteDetail(MAIN_ROUTE);
        const required = detail.stops.filter((stop) => !stop.optional);
        const optional = detail.stops.filter((stop) => stop.optional);
        const plan: RoutePlan = {
          route_code: detail.code,
          route_name: detail.name,
          stops: required.map((stop) => stop.order),
          excluded: optional.map((stop) => ({
            order: stop.order,
            reason: '时间不足，留到下次',
          })),
          total_minutes: detail.total_minutes,
          walking_km: detail.walking_km,
          explanation: '路线服务暂时不可用，先按默认眉湖线走；到点后仍可听固定讲解。',
          fallback: true,
          start_order: required[0]?.order ?? 1,
        };
        setRoute(plan, detail, '路线服务暂不可用，已切换到默认眉湖线');
        void reportRouteEvent(
          detail.code,
          'fallback',
          null,
          { ...payload, reason: 'agent_unavailable' },
          Date.now() - started,
        );
        openRoute();
      } catch {
        setError('路线服务暂不可用，请检查网络后重试');
      }
    } finally {
      setLoading(false);
    }
  };

  if (!ROUTE_ENABLED) {
    return (
      <View style={[styles.disabled, { paddingTop: insets.top + 80 }]}>
        <Text style={styles.disabledTitle}>路线功能未开启</Text>
        <Text style={styles.disabledHint}>
          请使用带 EXPO_PUBLIC_NARRATIVE_ROUTE_ENABLED=true 的构建。
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + Spacing.lg, paddingBottom: 96 },
      ]}
    >
      <Text style={styles.eyebrow}>校园文脉导演</Text>
      <Text style={styles.title}>今天，想怎么走？</Text>
      <Text style={styles.intro}>
        选一个时间和兴趣，Agent 会排一条路线：到点听固定讲解，
        站与站之间讲过渡，随时可以“时间不够 / 下雨 / 想多待”。
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>你有多少时间</Text>
        <View style={styles.chipRow}>
          {TIME_OPTIONS.map((item) => {
            const active = minutes === item.minutes;
            return (
              <TouchableOpacity
                key={item.minutes}
                accessibilityRole="button"
                activeOpacity={0.75}
                onPress={() => setMinutes(item.minutes)}
                style={[styles.timeChip, active && styles.chipActive]}
              >
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                  {item.label}
                </Text>
                <Text style={[styles.chipHint, active && styles.chipHintActive]}>
                  {item.hint}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.label, styles.labelGap]}>想看什么</Text>
        <View style={styles.chipRow}>
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.75}
            onPress={() => setInterests([])}
            style={[
              styles.interestChip,
              interests.length === 0 && styles.chipActive,
            ]}
          >
            <Text
              style={[
                styles.interestText,
                interests.length === 0 && styles.chipLabelActive,
              ]}
            >
              随便走走
            </Text>
          </TouchableOpacity>
          {INTEREST_OPTIONS.map((item) => {
            const active = interests.includes(item.key);
            return (
              <TouchableOpacity
                key={item.key}
                accessibilityRole="button"
                activeOpacity={0.75}
                onPress={() => toggleInterest(item.key)}
                style={[styles.interestChip, active && styles.chipActive]}
              >
                <Text
                  style={[styles.interestText, active && styles.chipLabelActive]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {nearest ? (
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.75}
            onPress={() => setStartAtNearest((value) => !value)}
            style={styles.nearestRow}
          >
            <Ionicons
              name={startAtNearest ? 'checkbox' : 'square-outline'}
              size={20}
              color={Color.primary}
            />
            <Text style={styles.nearestText}>
              从附近开始：{nearest.name}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        activeOpacity={0.85}
        disabled={loading}
        style={[styles.planBtn, loading && styles.planBtnDisabled]}
        onPress={() => { void handlePlan(); }}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="navigate" size={18} color="#fff" />
            <Text style={styles.planBtnText}>开始规划路线</Text>
          </>
        )}
      </TouchableOpacity>

      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : null}

      {catalog.length > 0 ? (
        <View style={styles.catalog}>
          <Text style={styles.sectionTitle}>可走路线</Text>
          {catalog.map((item) => (
            <View key={item.code} style={styles.catalogCard}>
              <View style={styles.catalogHeader}>
                <Text style={styles.catalogName}>{item.name}</Text>
                {item.code === MAIN_ROUTE ? (
                  <Text style={styles.mainBadge}>主推</Text>
                ) : null}
              </View>
              <Text style={styles.catalogSubtitle}>{item.subtitle}</Text>
              <Text style={styles.catalogMeta}>
                {item.stops_count} 站 · 约 {item.total_minutes} 分钟 ·{' '}
                {item.walking_km.toFixed(2)} km
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={styles.footnote}>
        路线内容由人工审核后发布；Agent 只负责排路线与现场调整。
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Color.pageBg },
  content: { paddingHorizontal: Spacing.pageH },
  disabled: {
    flex: 1,
    backgroundColor: Color.pageBg,
    alignItems: 'center',
    paddingHorizontal: Spacing.pageH,
  },
  disabledTitle: { fontSize: 18, fontWeight: '700', color: Color.heading },
  disabledHint: {
    marginTop: Spacing.sm,
    fontSize: 13,
    color: Color.caption,
    textAlign: 'center',
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    color: Color.accent,
    letterSpacing: 1,
  },
  title: {
    marginTop: Spacing.xs,
    fontSize: 28,
    fontWeight: '700',
    color: Color.heading,
    letterSpacing: -0.6,
  },
  intro: {
    marginTop: Spacing.sm,
    marginBottom: Spacing.lg,
    fontSize: 14,
    lineHeight: 22,
    color: Color.body,
  },
  card: {
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    backgroundColor: Color.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.cardBorder,
    ...Shadow.card,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: Color.primary,
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  labelGap: { marginTop: Spacing.lg },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  timeChip: {
    flex: 1,
    minWidth: 92,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Color.primarySoft,
    alignItems: 'center',
  },
  interestChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    backgroundColor: Color.primarySoft,
  },
  chipActive: { backgroundColor: Color.primary },
  chipLabel: { fontSize: 14, fontWeight: '700', color: Color.primary },
  chipHint: { marginTop: 2, fontSize: 10, color: Color.caption },
  chipLabelActive: { color: '#fff' },
  chipHintActive: { color: 'rgba(255,255,255,0.8)' },
  interestText: { fontSize: 13, fontWeight: '600', color: Color.primary },
  nearestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  nearestText: { fontSize: 13, color: Color.body },
  planBtn: {
    marginTop: Spacing.lg,
    minHeight: 52,
    borderRadius: Radius.md,
    backgroundColor: Color.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    ...Shadow.card,
  },
  planBtnDisabled: { opacity: 0.7 },
  planBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  error: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Color.primarySoft,
    fontSize: 13,
    lineHeight: 20,
    color: Color.error,
  },
  catalog: { marginTop: Spacing.xxl },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Color.heading,
    marginBottom: Spacing.sm,
  },
  catalogCard: {
    marginBottom: Spacing.sm,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    backgroundColor: Color.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.cardBorder,
  },
  catalogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  catalogName: { fontSize: 16, fontWeight: '700', color: Color.heading },
  mainBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: Color.primarySoft,
    fontSize: 10,
    fontWeight: '700',
    color: Color.primary,
  },
  catalogSubtitle: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    color: Color.caption,
  },
  catalogMeta: { marginTop: Spacing.sm, fontSize: 12, color: Color.body },
  footnote: {
    marginTop: Spacing.xl,
    fontSize: 11,
    lineHeight: 17,
    color: Color.caption,
    textAlign: 'center',
  },
});
