// Schedule CRUD (SPEC §3) — weekly schedules with day picker.
import React, { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import BigButton from '../../../src/components/BigButton';
import ConfirmDialog from '../../../src/components/ConfirmDialog';
import EmptyState from '../../../src/components/EmptyState';
import FormField from '../../../src/components/FormField';
import Panel from '../../../src/components/Panel';
import Screen from '../../../src/components/Screen';
import {
  createSchedule,
  deleteSchedule,
  getSchedules,
  updateSchedule,
} from '../../../src/api/client';
import type { RelayState, Schedule } from '../../../src/api/types';
import { t } from '../../../src/i18n';
import { colors, font, minTouch, radius, spacing } from '../../../src/theme';
import { DAY_ORDER, maskToLabel, toggleDay } from '../../../src/utils/days';

const DAY_KEYS = ['days.mon', 'days.tue', 'days.wed', 'days.thu', 'days.fri', 'days.sat', 'days.sun'];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

interface EditorState {
  /** null id = creating. */
  id: string | null;
  hour: string;
  minute: string;
  action: RelayState;
  daysMask: number;
}

function ActionSegment({
  value,
  onChange,
}: {
  value: RelayState;
  onChange: (a: RelayState) => void;
}) {
  const options: { action: RelayState; label: string }[] = [
    { action: 'ON', label: t('schedule.turnOn') },
    { action: 'OFF', label: t('schedule.turnOff') },
  ];
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const active = value === o.action;
        return (
          <Pressable
            key={o.action}
            onPress={() => onChange(o.action)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.segment,
              active && {
                backgroundColor: o.action === 'ON' ? colors.primary : colors.accent,
              },
            ]}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function ScheduleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const deviceId = String(id ?? '');

  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorError, setEditorError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Schedule | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      setSchedules(await getSchedules(deviceId));
    } catch {
      setLoadError(true);
    }
  }, [deviceId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openEditor = (s?: Schedule) => {
    setEditorError(false);
    if (s) {
      const [hh, mm] = s.time_local.split(':');
      setEditor({ id: s.id, hour: hh, minute: mm, action: s.action, daysMask: s.days_mask });
    } else {
      setEditor({ id: null, hour: '06', minute: '00', action: 'ON', daysMask: 127 });
    }
  };

  const saveEditor = async () => {
    if (!editor || saving) return;
    const hh = editor.hour.padStart(2, '0');
    const mm = editor.minute.padStart(2, '0');
    const time = `${hh}:${mm}`;
    if (!TIME_RE.test(time)) {
      setEditorError(true);
      return;
    }
    setSaving(true);
    try {
      if (editor.id) {
        await updateSchedule(deviceId, editor.id, {
          time_local: time,
          action: editor.action,
          days_mask: editor.daysMask,
        });
      } else {
        await createSchedule(deviceId, {
          time_local: time,
          action: editor.action,
          days_mask: editor.daysMask,
        });
      }
      setEditor(null);
      await load();
    } catch {
      Alert.alert(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteSchedule(deviceId, deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch {
      setDeleteTarget(null);
      Alert.alert(t('common.error'));
    }
  };

  const toggleEnabled = async (s: Schedule, enabled: boolean) => {
    setSchedules((prev) =>
      prev ? prev.map((x) => (x.id === s.id ? { ...x, enabled } : x)) : prev,
    );
    try {
      await updateSchedule(deviceId, s.id, { enabled });
    } catch {
      Alert.alert(t('common.error'));
      await load();
    }
  };

  return (
    <Screen scroll contentStyle={styles.content}>
      <Stack.Screen options={{ title: t('schedule.title') }} />

      {schedules === null && !loadError ? (
        <Text style={styles.mutedCenter}>{t('common.loading')}</Text>
      ) : loadError ? (
        <EmptyState
          icon={<Ionicons name="cloud-offline-outline" size={56} color={colors.offline} />}
          title={t('common.error')}
          ctaLabel={t('common.retry')}
          onCta={() => {
            void load();
          }}
        />
      ) : (schedules ?? []).length === 0 ? (
        <EmptyState
          icon={<Ionicons name="calendar-outline" size={56} color={colors.secondary} />}
          title={t('schedule.empty')}
          ctaLabel={t('schedule.add')}
          onCta={() => openEditor()}
        />
      ) : (
        <Panel style={styles.listPanel}>
          {(schedules ?? []).map((s, i) => (
            <Pressable
              key={s.id}
              onPress={() => openEditor(s)}
              onLongPress={() => setDeleteTarget(s)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.row,
                i > 0 && styles.rowBorder,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.rowMain}>
                <View style={styles.rowTop}>
                  <Text style={[styles.time, !s.enabled && styles.disabledText]}>
                    {s.time_local}
                  </Text>
                  <View
                    style={[
                      styles.chip,
                      { backgroundColor: s.action === 'ON' ? colors.primary : colors.accent },
                    ]}
                  >
                    <Text style={styles.chipText}>
                      {s.action === 'ON' ? t('common.on') : t('common.off')}
                    </Text>
                  </View>
                </View>
                <Text style={styles.repeat}>{maskToLabel(s.days_mask)}</Text>
              </View>
              <Switch
                value={s.enabled}
                onValueChange={(v) => {
                  void toggleEnabled(s, v);
                }}
                trackColor={{ false: colors.offline, true: colors.secondary }}
                thumbColor={colors.surface}
              />
            </Pressable>
          ))}
        </Panel>
      )}

      {schedules !== null && schedules.length > 0 ? (
        <BigButton
          title={t('schedule.add')}
          color={colors.primary}
          onPress={() => openEditor()}
        />
      ) : null}

      {/* Editor modal */}
      <Modal
        visible={editor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditor(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {editor?.id ? t('schedule.edit') : t('schedule.add')}
            </Text>

            <Text style={styles.fieldLabel}>{t('schedule.time')}</Text>
            <View style={styles.timeRow}>
              <FormField
                label="HH"
                value={editor?.hour ?? ''}
                onChangeText={(v) => {
                  setEditorError(false);
                  setEditor((e) => (e ? { ...e, hour: v.replace(/[^0-9]/g, '').slice(0, 2) } : e));
                }}
                keyboardType="number-pad"
                placeholder="06"
                style={styles.timeField}
                error={editorError ? t('schedule.invalidTime') : undefined}
              />
              <Text style={styles.timeColon}>:</Text>
              <FormField
                label="MM"
                value={editor?.minute ?? ''}
                onChangeText={(v) => {
                  setEditorError(false);
                  setEditor((e) =>
                    e ? { ...e, minute: v.replace(/[^0-9]/g, '').slice(0, 2) } : e,
                  );
                }}
                keyboardType="number-pad"
                placeholder="00"
                style={styles.timeField}
              />
            </View>

            <Text style={styles.fieldLabel}>{t('schedule.action')}</Text>
            <ActionSegment
              value={editor?.action ?? 'ON'}
              onChange={(action) => setEditor((e) => (e ? { ...e, action } : e))}
            />

            <Text style={styles.fieldLabel}>{t('schedule.repeat')}</Text>
            <View style={styles.daysRow}>
              {DAY_ORDER.map((dayIdx) => {
                const active = editor ? (editor.daysMask & (1 << dayIdx)) !== 0 : false;
                return (
                  <Pressable
                    key={dayIdx}
                    onPress={() =>
                      setEditor((e) =>
                        e ? { ...e, daysMask: toggleDay(e.daysMask, dayIdx) } : e,
                      )
                    }
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.dayChip, active && styles.dayChipActive]}
                  >
                    <Text style={[styles.dayChipText, active && styles.dayChipTextActive]}>
                      {t(DAY_KEYS[dayIdx])}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.modalButtons}>
              <BigButton
                title={t('common.cancel')}
                color={colors.surface}
                textColor={colors.text}
                style={styles.cancelBtn}
                onPress={() => setEditor(null)}
              />
              <BigButton
                title={t('common.save')}
                style={styles.saveBtn}
                loading={saving}
                onPress={() => {
                  void saveEditor();
                }}
              />
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        visible={deleteTarget !== null}
        title={t('schedule.deleteTitle')}
        confirmText={t('common.delete')}
        danger
        onConfirm={() => {
          void doDelete();
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing(4),
    gap: spacing(4),
  },
  mutedCenter: {
    fontSize: font.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing(8),
  },
  listPanel: {
    paddingVertical: spacing(1),
    paddingHorizontal: spacing(1),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: minTouch,
    padding: spacing(3),
    gap: spacing(3),
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  pressed: {
    opacity: 0.75,
  },
  rowMain: {
    flex: 1,
    gap: 2,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
  },
  time: {
    fontSize: font.title,
    fontWeight: '700',
    color: colors.text,
  },
  disabledText: {
    color: colors.offline,
  },
  chip: {
    borderRadius: radius.full,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(1),
  },
  chipText: {
    color: '#FFFFFF',
    fontSize: font.small,
    fontWeight: '700',
  },
  repeat: {
    fontSize: font.small,
    color: colors.textMuted,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(26, 46, 50, 0.45)',
    justifyContent: 'center',
    padding: spacing(5),
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing(6),
    maxWidth: 460,
    alignSelf: 'center',
    width: '100%',
  },
  modalTitle: {
    fontSize: font.h2,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing(4),
  },
  fieldLabel: {
    fontSize: font.body,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing(2),
    marginBottom: spacing(2),
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing(3),
  },
  timeField: {
    flex: 1,
  },
  timeColon: {
    fontSize: font.title,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing(9),
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
  segmentText: {
    fontSize: font.body,
    fontWeight: '600',
    color: colors.primary,
  },
  segmentTextActive: {
    color: '#FFFFFF',
  },
  daysRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing(2),
    marginTop: spacing(1),
  },
  dayChip: {
    minWidth: 48,
    minHeight: 48,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing(2),
  },
  dayChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dayChipText: {
    fontSize: font.small,
    fontWeight: '600',
    color: colors.textMuted,
  },
  dayChipTextActive: {
    color: '#FFFFFF',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: spacing(3),
    marginTop: spacing(5),
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
