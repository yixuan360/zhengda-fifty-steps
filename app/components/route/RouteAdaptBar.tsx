/**
 * V3 现场调整条 — 时间不够 / 下雨了 / 想多待
 */
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Color, Radius, Spacing } from '../../constants/theme';
import type { RouteAdaptAction } from '../../types/routes';

interface Props {
  disabled?: boolean;
  loading?: boolean;
  onAction: (action: RouteAdaptAction) => void;
}

const ACTIONS: Array<{
  action: RouteAdaptAction;
  label: string;
  hint: string;
}> = [
  { action: 'time_short', label: '时间不够', hint: '提前收尾' },
  { action: 'rain', label: '下雨了', hint: '就近避雨' },
  { action: 'more', label: '想多待', hint: '加回可选站' },
];

export default function RouteAdaptBar({ disabled, loading, onAction }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>现场调整</Text>
        {loading ? (
          <ActivityIndicator size="small" color={Color.primary} />
        ) : null}
      </View>
      <View style={styles.row}>
        {ACTIONS.map((item) => (
          <TouchableOpacity
            key={item.action}
            accessibilityRole="button"
            activeOpacity={0.75}
            disabled={disabled || loading}
            style={[styles.btn, (disabled || loading) && styles.btnDisabled]}
            onPress={() => onAction(item.action)}
          >
            <Text style={styles.btnLabel}>{item.label}</Text>
            <Text style={styles.btnHint}>{item.hint}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Color.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.cardBorder,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: 12,
    fontWeight: '600',
    color: Color.primary,
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  btn: {
    flex: 1,
    minHeight: 48,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Color.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.45,
  },
  btnLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Color.primary,
  },
  btnHint: {
    marginTop: 2,
    fontSize: 10,
    color: Color.caption,
  },
});
