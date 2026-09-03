// Countdown timer (SPEC §3) — create / live countdown / cancel.
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import BigButton from '../../../src/components/BigButton';
import FormField from '../../../src/components/FormField';
import Panel from '../../../src/components/Panel';
import Screen from '../../../src/components/Screen';
import { cancelTimer, createTimer, getTimers } from '../../../src/api/client';
import type { RelayState, Timer } from '../../../src/api/types';
import { t } from '../../../src/i18n';
import { colors, font, minTouch, radius, spacing } from '../../../src/theme';
import { fmtDateTime, fmtMin } from '../../../src/utils/format';

function formatCountdown(msLeft: number): string {
  const totalSec = Math.max(0, Math.ceil(msLeft / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function TimerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const deviceId = String(id ?? '');

  const [timers, setTimers] = useState<Timer[] | null>(null);
  const [action, setAction] = useState<RelayState>('OFF');
  const [minutes, setMinutes] = useState('30');
  const [inputError, setInputError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setTimers(await getTimers(deviceId));
    } catch {
      setTimers([]);
    }
  }, [deviceId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const active = timers && timers.length > 0 ? timers[0] : null;

  // 1s countdown tick while a timer is active.
  useEffect(() => {
    if (!active) return undefined;
    const iv = setInterval(() => {
      setNow(Date.now());
      // Timer elapsed server-side → re-read so the card disappears promptly.
      if (active && Date.parse(active.run_at) <= Date.now()) void load();
    }, 1000);
    return () => clearInterval(iv);
  }, [active, load]);

  const start = async () => {
    if (busy) return;
    const mins = Number(minutes);
    if (!Number.isInteger(mins) || mins < 1 || mins > 1440) {
      setInputError(true);
      return;
    }
    setInputError(false);
    setBusy(true);
    try {
      await createTimer(deviceId, action, mins);
      await load();
    } catch {
      Alert.alert(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (tid: string) => {
    setBusy(true);
    try {
      await cancelTimer(deviceId, tid);
      await load();
    } catch {
      Alert.alert(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const msLeft = active ? Date.parse(active.run_at) - now : 0;

  return (
    <Screen scroll contentStyle={styles.content}>
      <Stack.Screen options={{ title: t('timer.title') }} />

      {active ? (
        <Panel title={t('timer.title')}>
          <View style={styles.activeWrap}>
            <Ionicons name="timer" size={40} color={colors.accent} />
            <Text style={styles.countdown}>{formatCountdown(msLeft)}</Text>
            <Text style={styles.activeText}>
              {active.action === 'OFF'
                ? t('timer.activeOff', { time: fmtMin(msLeft / 60000) })
                : t('timer.activeOn', { time: fmtMin(msLeft / 60000) })}
            </Text>
            <Text style={styles.runAt}>{fmtDateTime(active.run_at)}</Text>
            <BigButton
              title={t('timer.cancel')}
              color={colors.danger}
              loading={busy}
              onPress={() => {
                void cancel(active.id);
              }}
              style={styles.cancelBtn}
            />
          </View>
        </Panel>
      ) : null}

      <Panel>
        <View style={styles.segmented}>
          {(
            [
              { a: 'OFF' as RelayState, label: t('timer.turnOffIn'), icon: 'stop-circle-outline' as const },
              { a: 'ON' as RelayState, label: t('timer.turnOnIn'), icon: 'play-circle-outline' as const },
            ]
          ).map((o) => {
            const selected = action === o.a;
            return (
              <Pressable
                key={o.a}
                onPress={() => setAction(o.a)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={[styles.segment, selected && styles.segmentActive]}
              >
                <Ionicons
                  name={o.icon}
                  size={22}
                  color={selected ? '#FFFFFF' : colors.primary}
                />
                <Text style={[styles.segmentText, selected && styles.segmentTextActive]}>
                  {o.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <FormField
          label={t('timer.minutes')}
          value={minutes}
          onChangeText={(v) => {
            setInputError(false);
            setMinutes(v.replace(/[^0-9]/g, ''));
          }}
          keyboardType="number-pad"
          placeholder="30"
          error={inputError ? t('timer.invalidMinutes') : undefined}
          style={styles.minutesField}
        />

        <BigButton
          title={t('timer.start')}
          loading={busy}
          disabled={minutes.length === 0}
          onPress={() => {
            void start();
          }}
        />
        {timers === null ? (
          <Text style={styles.muted}>{t('common.loading')}</Text>
        ) : null}
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing(4),
    gap: spacing(4),
  },
  activeWrap: {
    alignItems: 'center',
    gap: spacing(2),
  },
  countdown: {
    fontSize: font.hero,
    fontWeight: '800',
    color: colors.accent,
    fontVariant: ['tabular-nums'],
  },
  activeText: {
    fontSize: font.body,
    color: colors.text,
    textAlign: 'center',
  },
  runAt: {
    fontSize: font.small,
    color: colors.textMuted,
  },
  cancelBtn: {
    alignSelf: 'stretch',
    marginTop: spacing(3),
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.cream,
    borderRadius: radius.md,
    padding: spacing(1),
    gap: spacing(1),
    marginBottom: spacing(4),
  },
  segment: {
    flex: 1,
    minHeight: minTouch,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(2),
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
  minutesField: {
    marginBottom: spacing(4),
  },
  muted: {
    fontSize: font.small,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing(3),
  },
});
