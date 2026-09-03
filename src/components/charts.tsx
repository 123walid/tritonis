// Simple SVG charts — SPEC §2 (react-native-svg, no extra deps).
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Polygon } from 'react-native-svg';
import { colors, font, spacing } from '../theme';

export interface BarDatum {
  /** x-axis label (e.g. weekday). */
  label: string;
  value: number;
  /** Secondary label under the axis label (e.g. cost). */
  sublabel?: string;
}

interface BarChartProps {
  data: BarDatum[];
  /** Chart area height in dp. Default 140. */
  height?: number;
  color?: string;
  selectedIndex?: number;
  onSelect?: (index: number) => void;
}

/** Vertical bar chart with optional per-bar selection and sublabels. */
export function BarChart({
  data,
  height = 140,
  color = colors.secondary,
  selectedIndex,
  onSelect,
}: BarChartProps) {
  const max = Math.max(0, ...data.map((d) => d.value));
  return (
    <View style={styles.barsRow}>
      {data.map((d, i) => {
        const frac = max > 0 ? d.value / max : 0;
        const barH = Math.max(2, Math.round(frac * (height - 44)));
        const selected = selectedIndex === i;
        return (
          <Pressable
            key={`${d.label}-${i}`}
            style={styles.barCol}
            disabled={!onSelect}
            onPress={() => onSelect?.(i)}
            accessibilityRole={onSelect ? 'button' : undefined}
          >
            <Text style={styles.barValue} numberOfLines={1}>
              {d.value > 0 ? trimNum(d.value) : ''}
            </Text>
            <View style={[styles.barTrack, { height: height - 44 }]}>
              <View
                style={[
                  styles.bar,
                  {
                    height: barH,
                    backgroundColor: selected ? colors.accent : color,
                    opacity: selectedIndex !== undefined && !selected ? 0.45 : 1,
                  },
                ]}
              />
            </View>
            <Text style={[styles.barLabel, selected && styles.barLabelSelected]} numberOfLines={1}>
              {d.label}
            </Text>
            {d.sublabel ? (
              <Text style={styles.barSub} numberOfLines={1}>
                {d.sublabel}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

interface LineChartProps {
  /** Series values (already ordered by time). */
  points: number[];
  height?: number;
  color?: string;
  /** Max value label rendered above the chart. */
  maxLabel?: string;
}

/** Minimal line chart (area fill + stroke) over the full width. */
export function LineChart({ points, height = 140, color = colors.primary, maxLabel }: LineChartProps) {
  const W = 100;
  const H = 100;
  const max = Math.max(1, ...points);
  const n = points.length;
  const coords = points.map((v, i) => {
    const x = n > 1 ? (i / (n - 1)) * W : W / 2;
    const y = H - 6 - (Math.max(0, v) / max) * (H - 14);
    return [x, y] as const;
  });
  const line = coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `0,${H} ${line} ${W},${H}`;
  return (
    <View>
      {maxLabel ? <Text style={styles.maxLabel}>{maxLabel}</Text> : null}
      <Svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((f) => (
          <Line
            key={f}
            x1={0}
            x2={W}
            y1={H * f}
            y2={H * f}
            stroke={colors.border}
            strokeWidth={0.4}
          />
        ))}
        {n > 0 ? (
          <>
            <Polygon points={area} fill={color} opacity={0.12} />
            <Polygon points={line} fill="none" stroke={color} strokeWidth={1.4} />
          </>
        ) : null}
      </Svg>
    </View>
  );
}

function trimNum(n: number): string {
  return n >= 100 ? String(Math.round(n)) : n.toFixed(1);
}

const styles = StyleSheet.create({
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 1,
  },
  barValue: {
    fontSize: font.small - 2,
    color: colors.textMuted,
    height: 16,
  },
  barTrack: {
    justifyContent: 'flex-end',
  },
  bar: {
    width: '72%',
    alignSelf: 'center',
    borderRadius: 4,
  },
  barLabel: {
    marginTop: spacing(1),
    fontSize: font.small - 2,
    color: colors.textMuted,
  },
  barLabelSelected: {
    color: colors.accent,
    fontWeight: '700',
  },
  barSub: {
    fontSize: font.small - 3,
    color: colors.textMuted,
  },
  maxLabel: {
    fontSize: font.small,
    color: colors.textMuted,
    marginBottom: spacing(1),
  },
});
