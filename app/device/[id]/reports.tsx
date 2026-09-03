// Usage reports (SPEC §3) — Day/Week/Month: energy/cost bars, current curve,
// water bars, session table. STEG tariff period shown per session.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import EmptyState from '../../../src/components/EmptyState';
import Panel from '../../../src/components/Panel';
import Screen from '../../../src/components/Screen';
import { BarChart, LineChart, type BarDatum } from '../../../src/components/charts';
import { getReadings, getSessions } from '../../../src/api/client';
import type { Session } from '../../../src/api/types';
import { currentLocale, t } from '../../../src/i18n';
import { colors, font, minTouch, radius, spacing } from '../../../src/theme';
import { TZ, fmtA, fmtDate, fmtDateTime, fmtKwh, fmtM3, fmtMin, fmtTnd } from '../../../src/utils/format';

type Range = 'day' | 'week' | 'month';

const RANGE_DAYS: Record<Range, number> = { day: 1, week: 7, month: 30 };

/** 'YYYY-MM-DD' in Africa/Tunis (fixed UTC+1, no DST). */
function tunisDayKey(d: Date): string {
  const ps = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type: string): string => ps.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

interface DayBucket {
  key: string;
  startIso: string; // Tunis midnight as ISO UTC
  endIso: string;
  label: string;
  energyKwh: number;
  costTnd: number;
  waterM3: number;
}

function buildDays(range: Range): DayBucket[] {
  const count = RANGE_DAYS[range];
  const todayKey = tunisDayKey(new Date());
  const [y, m, d] = todayKey.split('-').map(Number);
  // Noon UTC on the Tunis day keeps Date arithmetic safely inside the same day.
  const anchor = new Date(Date.UTC(y, m - 1, d, 12));
  const days: DayBucket[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const day = new Date(anchor.getTime() - i * 86400000);
    const key = tunisDayKey(day);
    const startIso = new Date(`${key}T00:00:00+01:00`).toISOString();
    const endIso = new Date(new Date(`${key}T00:00:00+01:00`).getTime() + 86400000).toISOString();
    days.push({
      key,
      startIso,
      endIso,
      label: range === 'month' ? key.slice(8) : shortLabel(key),
      energyKwh: 0,
      costTnd: 0,
      waterM3: 0,
    });
  }
  return days;
}

function shortLabel(key: string): string {
  // Localized short weekday for the Tunis day key, matching the app language.
  return new Intl.DateTimeFormat(currentLocale(), { weekday: 'short', timeZone: TZ }).format(
    new Date(`${key}T12:00:00+01:00`),
  );
}

export default function ReportsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const deviceId = String(id ?? '');

  const [range, setRange] = useState<Range>('week');
  const [days, setDays] = useState<DayBucket[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState(0);
  const [currentSeries, setCurrentSeries] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const buckets = buildDays(range);
      const list = await getSessions(deviceId, buckets[0].startIso, new Date().toISOString());
      for (const s of list) {
        const key = tunisDayKey(new Date(s.started_at));
        const bucket = buckets.find((b) => b.key === key);
        if (bucket) {
          bucket.energyKwh += s.energy_wh / 1000;
          bucket.costTnd += s.cost_tnd ?? 0;
          bucket.waterM3 += s.water_m3 ?? 0;
        }
      }
      setDays(buckets);
      setSessions(list);
      setSelected(buckets.length - 1); // default: today / latest day
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [deviceId, range]);

  useEffect(() => {
    void load();
  }, [load]);

  // Current (A) curve for the selected day.
  const selectedDay = days[selected];
  useEffect(() => {
    if (!selectedDay) return;
    let cancelled = false;
    getReadings(deviceId, selectedDay.startIso, selectedDay.endIso, 'hour')
      .then((readings) => {
        if (!cancelled) setCurrentSeries(readings.map((r) => r.current_a));
      })
      .catch(() => {
        if (!cancelled) setCurrentSeries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId, selectedDay]);

  const energyBars: BarDatum[] = useMemo(
    () =>
      days.map((d) => ({
        label: d.label,
        value: round1(d.energyKwh),
        sublabel: d.costTnd > 0 ? fmtTnd(d.costTnd).replace(' TND', '') : undefined,
      })),
    [days],
  );
  const waterBars: BarDatum[] = useMemo(
    () => days.map((d) => ({ label: d.label, value: round1(d.waterM3) })),
    [days],
  );
  const hasData = sessions.length > 0;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('reports.title') }} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Range segmented control */}
        <View style={styles.segmented}>
          {(['day', 'week', 'month'] as Range[]).map((r) => {
            const active = range === r;
            return (
              <Pressable
                key={r}
                onPress={() => setRange(r)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.segment, active && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                  {t(`reports.${r}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {loading ? (
          <Text style={styles.mutedCenter}>{t('common.loading')}</Text>
        ) : error ? (
          <EmptyState
            icon={<Ionicons name="cloud-offline-outline" size={56} color={colors.offline} />}
            title={t('common.error')}
            ctaLabel={t('common.retry')}
            onCta={() => {
              void load();
            }}
          />
        ) : !hasData ? (
          <EmptyState
            icon={<Ionicons name="stats-chart-outline" size={56} color={colors.secondary} />}
            title={t('reports.noData')}
          />
        ) : (
          <>
            <Panel title={t('reports.energy')}>
              <BarChart
                data={energyBars}
                color={colors.primary}
                selectedIndex={selected}
                onSelect={setSelected}
              />
              <Text style={styles.hint}>{t('reports.selectDay')}</Text>
            </Panel>

            <Panel
              title={`${t('reports.current')} — ${selectedDay ? fmtDate(selectedDay.startIso) : ''}`}
            >
              {currentSeries.length > 0 ? (
                <LineChart
                  points={currentSeries}
                  color={colors.accent}
                  maxLabel={fmtA(Math.max(...currentSeries))}
                />
              ) : (
                <Text style={styles.muted}>{t('reports.noData')}</Text>
              )}
            </Panel>

            <Panel title={t('reports.water')}>
              <BarChart data={waterBars} color={colors.secondary} />
            </Panel>

            <Panel title={t('reports.sessions')}>
              {sessions.map((s, i) => (
                <View key={s.id} style={[styles.sessionRow, i > 0 && styles.sessionBorder]}>
                  <View style={styles.sessionMain}>
                    <Text style={styles.sessionStart}>{fmtDateTime(s.started_at)}</Text>
                    <Text style={styles.sessionMeta}>
                      {fmtMin(s.duration_s / 60)} · {fmtKwh(s.energy_wh / 1000)}
                      {s.water_m3 !== null ? ` · ${fmtM3(s.water_m3)}` : ''}
                      {s.cost_tnd !== null ? ` · ${fmtTnd(s.cost_tnd)}` : ''}
                    </Text>
                    <Text style={styles.sessionSub}>
                      {t(`tariff.${s.tariff_period}`)}
                      {s.end_reason ? ` · ${t(`endReason.${s.end_reason}`)}` : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </Panel>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const styles = StyleSheet.create({
  content: {
    padding: spacing(4),
    gap: spacing(4),
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.cream,
    borderRadius: radius.md,
    padding: spacing(1),
    gap: spacing(1),
  },
  segment: {
    flex: 1,
    minHeight: minTouch,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: colors.primary,
  },
  segmentText: {
    fontSize: font.body,
    fontWeight: '600',
    color: colors.primary,
  },
  segmentTextActive: {
    color: '#FFFFFF',
  },
  mutedCenter: {
    fontSize: font.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing(8),
  },
  muted: {
    fontSize: font.small,
    color: colors.textMuted,
  },
  hint: {
    fontSize: font.small,
    color: colors.textMuted,
    marginTop: spacing(2),
    textAlign: 'center',
  },
  sessionRow: {
    paddingVertical: spacing(3),
    paddingHorizontal: spacing(2),
  },
  sessionBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sessionMain: {
    gap: 2,
  },
  sessionStart: {
    fontSize: font.body,
    fontWeight: '600',
    color: colors.text,
  },
  sessionMeta: {
    fontSize: font.small,
    color: colors.text,
  },
  sessionSub: {
    fontSize: font.small,
    color: colors.textMuted,
  },
});
