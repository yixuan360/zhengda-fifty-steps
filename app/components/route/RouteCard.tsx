/**
 * V3 路线卡 — 站点、时长、距离、当前站高亮
 */
import { StyleSheet, Text, View } from 'react-native';
import { Color, Radius, Shadow, Spacing } from '../../constants/theme';
import type { RouteDetail, RoutePlan } from '../../types/routes';

interface Props {
  detail: RouteDetail;
  plan: RoutePlan;
  currentOrder?: number | null;
}

function fmtMinutes(value: number): string {
  return `${Math.max(1, Math.round(value))} 分钟`;
}

export default function RouteCard({ detail, plan, currentOrder }: Props) {
  const selected = new Set(plan.stops);
  const excluded = new Map(
    plan.excluded.map((item) => [item.order, item.reason]),
  );

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{detail.theme || '路线'}</Text>
        </View>
        <Text style={styles.meta}>
          {fmtMinutes(plan.total_minutes)} · {plan.walking_km.toFixed(2)} km
        </Text>
      </View>

      <Text style={styles.title}>{detail.name}</Text>
      {detail.subtitle ? (
        <Text style={styles.subtitle}>{detail.subtitle}</Text>
      ) : null}
      {plan.explanation ? (
        <Text style={styles.explanation}>{plan.explanation}</Text>
      ) : null}

      <View style={styles.stopList}>
        {detail.stops.map((stop) => {
          const isSelected = selected.has(stop.order);
          const isCurrent = currentOrder === stop.order;
          const reason = excluded.get(stop.order);
          return (
            <View
              key={stop.order}
              style={[
                styles.stopRow,
                isCurrent && styles.stopRowCurrent,
                !isSelected && styles.stopRowExcluded,
              ]}
            >
              <View
                style={[
                  styles.orderDot,
                  isCurrent && styles.orderDotCurrent,
                  !isSelected && styles.orderDotExcluded,
                ]}
              >
                <Text
                  style={[
                    styles.orderText,
                    isCurrent && styles.orderTextCurrent,
                  ]}
                >
                  {stop.order}
                </Text>
              </View>
              <View style={styles.stopBody}>
                <Text
                  style={[
                    styles.stopName,
                    isCurrent && styles.stopNameCurrent,
                    !isSelected && styles.stopNameExcluded,
                  ]}
                  numberOfLines={1}
                >
                  {stop.note || `第 ${stop.order} 站`}
                  {stop.optional ? (
                    <Text style={styles.optionalTag}>  可选</Text>
                  ) : null}
                </Text>
                <Text style={styles.stopMeta}>
                  {fmtMinutes(stop.duration_seconds / 60)}
                  {reason ? ` · ${reason}` : isCurrent ? ' · 当前站' : ''}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    backgroundColor: Color.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.cardBorder,
    ...Shadow.card,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    backgroundColor: Color.primarySoft,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Color.primary,
  },
  meta: {
    fontSize: 12,
    color: Color.caption,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: Color.heading,
    letterSpacing: -0.3,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: Color.caption,
    lineHeight: 19,
  },
  explanation: {
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Color.primarySoft,
    fontSize: 13,
    lineHeight: 20,
    color: Color.primary,
  },
  stopList: {
    marginTop: Spacing.md,
    gap: Spacing.xs,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
  },
  stopRowCurrent: {
    backgroundColor: Color.infoBg,
  },
  stopRowExcluded: {
    opacity: 0.5,
  },
  orderDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Color.primarySoft,
    marginRight: Spacing.md,
  },
  orderDotCurrent: {
    backgroundColor: Color.primary,
  },
  orderDotExcluded: {
    backgroundColor: Color.divider,
  },
  orderText: {
    fontSize: 12,
    fontWeight: '700',
    color: Color.primary,
  },
  orderTextCurrent: {
    color: '#fff',
  },
  stopBody: {
    flex: 1,
  },
  stopName: {
    fontSize: 14,
    fontWeight: '600',
    color: Color.heading,
  },
  stopNameCurrent: {
    color: Color.primary,
  },
  stopNameExcluded: {
    color: Color.caption,
  },
  optionalTag: {
    fontSize: 10,
    fontWeight: '500',
    color: Color.accent,
  },
  stopMeta: {
    marginTop: 2,
    fontSize: 11,
    color: Color.caption,
  },
});
