// Pulse mode (SPEC §3) — start / status / stop a pulse program.
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import BigButton from '../../../src/components/BigButton';
import ConfirmDialog from '../../../src/components/ConfirmDialog';
import FormField from '../../../src/components/FormField';
import Panel from '../../../src/components/Panel';
import Screen from '../../../src/components/Screen';
import { getPulse, startPulse, stopPulse } from '../../../src/api/client';
import type { PulseProgram } from '../../../src/api/types';
import { t } from '../../../src/i18n';
import { colors, font, spacing } from '../../../src/theme';
import { fmtMin } from '../../../src/utils/format';

/** Minutes left in the current phase, derived from the deterministic schedule. */
function phaseLeftMin(p: PulseProgram, nowMs: number): number | null {
  if (!p.start_at) return null;
  const start = Date.parse(p.start_at);
  if (Number.isNaN(start) || nowMs < start) return null;
  const cycle = p.on_min + p.off_min;
  if (cycle <= 0) return null;
  const pos = ((nowMs - start) / 60000) % cycle;
  return p.phase === 'ON' ? Math.max(0, p.on_min - pos) : Math.max(0, cycle - pos);
}

export default function PulseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const deviceId = String(id ?? '');

  const [pulse, setPulse] = useState<PulseProgram | null | undefined>(undefined);
  const [onMin, setOnMin] = useState('10');
  const [offMin, setOffMin] = useState('30');
  const [cycles, setCycles] = useState('');
  const [delay, setDelay] = useState('');
  const [inputError, setInputError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setPulse(await getPulse(deviceId));
    } catch {
      setPulse(null);
    }
  }, [deviceId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Poll the server for phase/cycles while a program runs; tick 1s for countdown.
  useEffect(() => {
    if (!pulse) return undefined;
    const poll = setInterval(() => void load(), 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [pulse, load]);

  const start = async () => {
    if (busy) return;
    const on = Number(onMin);
    const off = Number(offMin);
    const cyc = cycles.trim() === '' ? undefined : Number(cycles);
    const delayMin = delay.trim() === '' ? 0 : Number(delay);
    const valid =
      Number.isInteger(on) &&
      on >= 1 &&
      on <= 180 &&
      Number.isInteger(off) &&
      off >= 1 &&
      off <= 180 &&
      (cyc === undefined || (Number.isInteger(cyc) && cyc >= 1 && cyc <= 99)) &&
      Number.isInteger(delayMin) &&
      delayMin >= 0;
    if (!valid) {
      setInputError(true);
      return;
    }
    setInputError(false);
    setBusy(true);
    try {
      const body: { on_min: number; off_min: number; cycles?: number; start_at?: string } = {
        on_min: on,
        off_min: off,
      };
      if (cyc !== undefined) body.cycles = cyc;
      if (delayMin > 0) body.start_at = new Date(Date.now() + delayMin * 60000).toISOString();
      await startPulse(deviceId, body);
      await load();
    } catch {
      Alert.alert(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setConfirmStop(false);
    setBusy(true);
    try {
      await stopPulse(deviceId);
      await load();
    } catch {
      Alert.alert(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const left = pulse ? phaseLeftMin(pulse, now) : null;

  return (
    <Screen scroll contentStyle={styles.content}>
      <Stack.Screen options={{ title: t('pulse.title') }} />

      {pulse ? (
        <Panel title={t('pulse.running')}>
          <View style={styles.activeWrap}>
            <Ionicons
              name={pulse.phase === 'ON' ? 'water' : 'water-outline'}
              size={40}
              color={pulse.phase === 'ON' ? colors.success : colors.offline}
            />
            <Text style={styles.phaseText}>
              {pulse.phase === 'ON'
                ? t('pulse.phaseOn', { left: left === null ? '…' : fmtMin(left) })
                : t('pulse.phaseOff', { left: left === null ? '…' : fmtMin(left) })}
            </Text>
            <Text style={styles.cyclesText}>
              {pulse.cycles !== null
                ? t('pulse.cycleOf', { done: pulse.cycles_done, total: pulse.cycles })
                : `${pulse.on_min} / ${pulse.off_min} min`}
            </Text>
            <BigButton
              title={t('pulse.stop')}
              color={colors.danger}
              loading={busy}
              onPress={() => setConfirmStop(true)}
              style={styles.stopBtn}
            />
          </View>
        </Panel>
      ) : (
        <Panel>
          <FormField
            label={t('pulse.onFor')}
            value={onMin}
            onChangeText={(v) => {
              setInputError(false);
              setOnMin(v.replace(/[^0-9]/g, ''));
            }}
            keyboardType="number-pad"
            placeholder="10"
          />
          <FormField
            label={t('pulse.offFor')}
            value={offMin}
            onChangeText={(v) => {
              setInputError(false);
              setOffMin(v.replace(/[^0-9]/g, ''));
            }}
            keyboardType="number-pad"
            placeholder="30"
          />
          <FormField
            label={t('pulse.cycles')}
            value={cycles}
            onChangeText={(v) => {
              setInputError(false);
              setCycles(v.replace(/[^0-9]/g, ''));
            }}
            keyboardType="number-pad"
            placeholder={t('pulse.cyclesHint')}
          />
          <FormField
            label={t('pulse.startDelay')}
            value={delay}
            onChangeText={(v) => {
              setInputError(false);
              setDelay(v.replace(/[^0-9]/g, ''));
            }}
            keyboardType="number-pad"
            placeholder="0"
            error={inputError ? t('pulse.invalid') : undefined}
          />
          <BigButton
            title={t('pulse.start')}
            loading={busy}
            disabled={onMin.length === 0 || offMin.length === 0}
            onPress={() => {
              void start();
            }}
          />
          {pulse === undefined ? (
            <Text style={styles.muted}>{t('common.loading')}</Text>
          ) : null}
        </Panel>
      )}

      <ConfirmDialog
        visible={confirmStop}
        title={t('home.confirmOffTitle')}
        body={t('home.confirmOffBody')}
        confirmText={t('pulse.stop')}
        danger
        onConfirm={() => {
          void stop();
        }}
        onCancel={() => setConfirmStop(false)}
      />
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
  phaseText: {
    fontSize: font.h2,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  cyclesText: {
    fontSize: font.body,
    color: colors.textMuted,
  },
  stopBtn: {
    alignSelf: 'stretch',
    marginTop: spacing(3),
  },
  muted: {
    fontSize: font.small,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing(3),
  },
});
