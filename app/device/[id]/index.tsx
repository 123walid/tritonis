// Device page (SPEC §3) — hero power control, live readings, today totals,
// last session, links to Schedule / Timer / Pulse / Reports.
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import BigButton from '../../../src/components/BigButton';
import ConfirmDialog from '../../../src/components/ConfirmDialog';
import EmptyState from '../../../src/components/EmptyState';
import FormField from '../../../src/components/FormField';
import Panel from '../../../src/components/Panel';
import Screen from '../../../src/components/Screen';
import StatusDot from '../../../src/components/StatusDot';
import {
  ApiError,
  getDevices,
  getDeviceStatus,
  renameDevice,
  sendCommand,
} from '../../../src/api/client';
import type { DeviceStatus } from '../../../src/api/types';
import { t } from '../../../src/i18n';
import { useDevicesStore } from '../../../src/store/devices';
import { colors, font, hitSlop, minTouch, radius, spacing } from '../../../src/theme';
import { fmtA, fmtDateTime, fmtKw, fmtKwh, fmtM3, fmtMin, fmtTnd } from '../../../src/utils/format';

const HERO_SIZE = 132;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={28} color={colors.primary} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

export default function DeviceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const deviceId = String(id ?? '');
  const liveDevice = useDevicesStore((s) => s.devices[deviceId]);

  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'ON' | 'OFF' | null>(null);
  const [sending, setSending] = useState(false);
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  const online = liveDevice?.online ?? status?.online ?? false;
  const relay = liveDevice?.relay ?? status?.relay ?? 'OFF';
  const isOn = relay === 'ON';
  const name = liveDevice?.name ?? status?.name ?? '';
  const currentA = liveDevice?.current_a ?? status?.current_a ?? null;
  const powerKw = liveDevice?.power_kw ?? status?.power_kw ?? null;
  const waterFlow = liveDevice?.water_flow ?? status?.water_flow ?? null;

  const loadStatus = useCallback(async () => {
    try {
      const s = await getDeviceStatus(deviceId);
      setStatus(s);
      setNotFound(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
    }
  }, [deviceId]);

  // Load on focus and re-read after every relay flip (today/last-session change).
  useFocusEffect(
    useCallback(() => {
      void loadStatus();
    }, [loadStatus]),
  );
  useEffect(() => {
    void loadStatus();
  }, [relay, loadStatus]);

  const doCommand = async () => {
    if (!confirmAction || sending) return;
    setSending(true);
    try {
      await sendCommand(deviceId, confirmAction);
      setConfirmAction(null);
    } catch (e) {
      setConfirmAction(null);
      if (e instanceof ApiError && e.status === 409) Alert.alert(t('common.deviceOffline'));
      else Alert.alert(t('common.error'));
    } finally {
      setSending(false);
    }
  };

  const submitRename = async () => {
    const next = renameValue.trim();
    if (renaming || next.length === 0) return;
    setRenaming(true);
    try {
      await renameDevice(deviceId, next);
      const list = await getDevices();
      useDevicesStore.getState().hydrate(list);
      setRenameVisible(false);
    } catch {
      Alert.alert(t('common.error'));
    } finally {
      setRenaming(false);
    }
  };

  if (notFound) {
    return (
      <Screen>
        <Stack.Screen options={{ title: '' }} />
        <EmptyState
          icon={<Ionicons name="alert-circle-outline" size={56} color={colors.offline} />}
          title={t('common.error')}
          ctaLabel={t('common.close')}
          onCta={() => router.back()}
        />
      </Screen>
    );
  }

  const last = status?.last_session ?? null;
  const today = status?.today ?? null;

  return (
    <Screen scroll contentStyle={styles.content}>
      <Stack.Screen
        options={{
          title: name,
          headerRight: () => (
            <Ionicons
              name="stats-chart-outline"
              size={24}
              color={colors.primary}
              hitSlop={hitSlop}
              accessibilityLabel={t('device.reports')}
              onPress={() => router.push(`/device/${deviceId}/reports`)}
              style={styles.headerBtn}
            />
          ),
        }}
      />

      {!online ? (
        <View style={styles.offlineBanner} accessibilityRole="alert">
          <Ionicons name="cloud-offline" size={20} color={colors.danger} />
          <Text style={styles.offlineText}>{t('common.offlineMsg')}</Text>
        </View>
      ) : null}

      {/* Hero power control */}
      <View style={styles.heroWrap}>
        <Pressable
          onPress={() => setConfirmAction(isOn ? 'OFF' : 'ON')}
          disabled={!online}
          accessibilityRole="button"
          accessibilityLabel={isOn ? t('common.off') : t('common.on')}
          accessibilityState={{ disabled: !online }}
          style={({ pressed }) => [
            styles.hero,
            { backgroundColor: isOn ? colors.primary : colors.accent },
            pressed && styles.pressed,
            !online && styles.heroDisabled,
          ]}
        >
          <Ionicons name="power" size={56} color="#FFFFFF" />
          <Text style={styles.heroText}>{isOn ? t('common.on') : t('common.off')}</Text>
        </Pressable>
      </View>

      {/* Status strip */}
      <Panel>
        <View style={styles.strip}>
          <StatusDot online={online} />
          <View style={styles.stripItem}>
            <Text style={[styles.stripValue, !online && styles.muted]}>
              {online || currentA !== null ? fmtA(currentA) : fmtA(null)}
            </Text>
            <Text style={styles.stripLabel}>{t('device.current')}</Text>
          </View>
          <View style={styles.stripItem}>
            <Text style={[styles.stripValue, !online && styles.muted]}>{fmtKw(powerKw)}</Text>
            <Text style={styles.stripLabel}>{t('device.power')}</Text>
          </View>
        </View>
        {isOn ? (
          <Text
            style={[
              styles.waterText,
              { color: waterFlow === false ? colors.danger : colors.success },
            ]}
          >
            {waterFlow === null
              ? t('device.sensorNa')
              : waterFlow
                ? t('device.waterFlowing')
                : t('device.noWater')}
          </Text>
        ) : null}
      </Panel>

      {/* Today */}
      <Panel title={t('device.today')}>
        {today ? (
          <View style={styles.statsGrid}>
            <Stat label={t('device.energy')} value={fmtKwh(today.energy_kwh)} />
            <Stat label={t('device.cost')} value={fmtTnd(today.cost_tnd)} />
            <Stat label={t('device.water')} value={fmtM3(today.water_m3)} />
            <Stat label={t('device.runtime')} value={fmtMin(today.runtime_min)} />
            <Stat label={t('device.sessions')} value={String(today.sessions)} />
          </View>
        ) : (
          <Text style={styles.muted}>{t('common.loading')}</Text>
        )}
      </Panel>

      {/* Last session */}
      <Panel title={t('device.lastSession')}>
        {last ? (
          <View style={styles.lastSession}>
            <Text style={styles.lastSessionTime}>{fmtDateTime(last.started_at)}</Text>
            <View style={styles.statsGrid}>
              <Stat label={t('device.duration')} value={fmtMin(last.duration_s / 60)} />
              <Stat label={t('device.energy')} value={fmtKwh(last.energy_wh / 1000)} />
              <Stat label={t('device.avgCurrent')} value={fmtA(last.avg_a)} />
              <Stat label={t('device.volume')} value={fmtM3(last.water_m3)} />
              <Stat label={t('device.cost')} value={fmtTnd(last.cost_tnd)} />
            </View>
            {last.end_reason ? (
              <Text style={styles.endReason}>
                {t('device.endReason')}: {t(`endReason.${last.end_reason}`)}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text style={styles.muted}>{t('reports.noData')}</Text>
        )}
      </Panel>

      {/* Sub-screen navigation */}
      <View style={styles.actionsBar}>
        <ActionButton
          icon="calendar-outline"
          label={t('device.schedule')}
          onPress={() => router.push(`/device/${deviceId}/schedule`)}
        />
        <ActionButton
          icon="timer-outline"
          label={t('device.timer')}
          onPress={() => router.push(`/device/${deviceId}/timer`)}
        />
        <ActionButton
          icon="pulse-outline"
          label={t('device.pulse')}
          onPress={() => router.push(`/device/${deviceId}/pulse`)}
        />
        <ActionButton
          icon="create-outline"
          label={t('device.rename')}
          onPress={() => {
            setRenameValue(name);
            setRenameVisible(true);
          }}
        />
      </View>

      {/* Rename modal */}
      <Modal
        visible={renameVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameVisible(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('device.rename')}</Text>
            <FormField
              label={t('device.rename')}
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder={t('device.renamePlaceholder')}
              autoCapitalize="words"
            />
            <View style={styles.modalButtons}>
              <BigButton
                title={t('common.cancel')}
                color={colors.surface}
                textColor={colors.text}
                style={styles.cancelBtn}
                onPress={() => setRenameVisible(false)}
              />
              <BigButton
                title={t('common.save')}
                style={styles.saveBtn}
                loading={renaming}
                disabled={renameValue.trim().length === 0}
                onPress={() => {
                  void submitRename();
                }}
              />
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        visible={confirmAction !== null}
        title={
          confirmAction === 'ON' ? t('home.confirmOnTitle') : t('home.confirmOffTitle')
        }
        body={confirmAction === 'ON' ? t('home.confirmOnBody') : t('home.confirmOffBody')}
        confirmText={confirmAction === 'ON' ? t('common.on') : t('common.off')}
        onConfirm={() => {
          void doCommand();
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing(4),
    gap: spacing(4),
  },
  headerBtn: {
    marginRight: spacing(3),
  },
  pressed: {
    opacity: 0.85,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    padding: spacing(3),
  },
  offlineText: {
    flex: 1,
    fontSize: font.small,
    color: colors.danger,
  },
  heroWrap: {
    alignItems: 'center',
    paddingVertical: spacing(3),
  },
  hero: {
    width: HERO_SIZE,
    height: HERO_SIZE,
    borderRadius: HERO_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroDisabled: {
    backgroundColor: colors.offline,
    opacity: 0.5,
  },
  heroText: {
    color: '#FFFFFF',
    fontSize: font.body,
    fontWeight: '800',
    marginTop: 2,
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stripItem: {
    alignItems: 'center',
  },
  stripValue: {
    fontSize: font.h2,
    fontWeight: '700',
    color: colors.text,
  },
  stripLabel: {
    fontSize: font.small,
    color: colors.textMuted,
  },
  muted: {
    color: colors.offline,
  },
  waterText: {
    marginTop: spacing(3),
    fontSize: font.body,
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  stat: {
    width: '33.33%',
    paddingVertical: spacing(2),
  },
  statValue: {
    fontSize: font.h2,
    fontWeight: '700',
    color: colors.text,
  },
  statLabel: {
    fontSize: font.small,
    color: colors.textMuted,
    marginTop: 2,
  },
  lastSession: {
    gap: spacing(2),
  },
  lastSessionTime: {
    fontSize: font.body,
    fontWeight: '600',
    color: colors.text,
  },
  endReason: {
    fontSize: font.small,
    color: colors.textMuted,
  },
  actionsBar: {
    flexDirection: 'row',
    gap: spacing(3),
  },
  actionBtn: {
    flex: 1,
    minHeight: minTouch * 1.4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing(3),
    gap: spacing(1),
  },
  actionLabel: {
    fontSize: font.small,
    fontWeight: '600',
    color: colors.primary,
    textAlign: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(26, 46, 50, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing(6),
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing(6),
  },
  modalTitle: {
    fontSize: font.h2,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing(4),
  },
  modalButtons: {
    flexDirection: 'row',
    gap: spacing(3),
    marginTop: spacing(2),
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  saveBtn: {
    flex: 1,
  },
});
