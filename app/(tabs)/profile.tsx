// Profile / settings (SPEC §3).
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import BigButton from '../../src/components/BigButton';
import ConfirmDialog from '../../src/components/ConfirmDialog';
import FormField from '../../src/components/FormField';
import ListRow from '../../src/components/ListRow';
import Panel from '../../src/components/Panel';
import Screen from '../../src/components/Screen';
import { ApiError, changePassword, getNotifPrefs, setNotifPrefs } from '../../src/api/client';
import type { NotifPrefs } from '../../src/api/types';
import { t, useI18n, type Lang } from '../../src/i18n';
import { useAuthStore } from '../../src/store/auth';
import { colors, font, minTouch, radius, spacing } from '../../src/theme';

const NOTIF_ROWS: { key: keyof NotifPrefs; labelKey: string }[] = [
  { key: 'offline', labelKey: 'profile.notifOffline' },
  { key: 'online', labelKey: 'profile.notifOnline' },
  { key: 'dry_run', labelKey: 'profile.notifDryRun' },
  { key: 'high_load', labelKey: 'profile.notifHighLoad' },
  { key: 'unexpected_stop', labelKey: 'profile.notifUnexpected' },
  { key: 'schedule_executed', labelKey: 'profile.notifSchedule' },
];

type PwError = 'wrong' | 'weak' | 'mismatch' | 'network' | null;

function ChangePasswordModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<PwError>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
    setDone(false);
    setBusy(false);
  };

  const submit = async () => {
    if (busy) return;
    if (next !== confirm) {
      setError('mismatch');
      return;
    }
    if (next.length < 8) {
      setError('weak');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await changePassword(current, next);
      setDone(true);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'wrong_password') setError('wrong');
      else if (e instanceof ApiError && e.code === 'weak_password') setError('weak');
      else setError('network');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        onClose();
        reset();
      }}
    >
      <View style={styles.backdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{t('profile.changePassword')}</Text>
          {done ? (
            <>
              <Text style={styles.successText}>{t('profile.passwordChanged')}</Text>
              <BigButton
                title={t('common.close')}
                color={colors.primary}
                onPress={() => {
                  onClose();
                  reset();
                }}
              />
            </>
          ) : (
            <>
              {error ? (
                <Text style={styles.errorText} accessibilityRole="alert">
                  {error === 'wrong'
                    ? t('profile.wrongPassword')
                    : error === 'weak'
                      ? t('profile.weakPassword')
                      : error === 'mismatch'
                        ? t('profile.passwordMismatch')
                        : t('common.error')}
                </Text>
              ) : null}
              <FormField
                label={t('profile.currentPassword')}
                value={current}
                onChangeText={setCurrent}
                secureTextEntry
              />
              <FormField
                label={t('profile.newPassword')}
                value={next}
                onChangeText={setNext}
                secureTextEntry
              />
              <FormField
                label={t('profile.confirmPassword')}
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
              />
              <View style={styles.modalButtons}>
                <BigButton
                  title={t('common.cancel')}
                  color={colors.surface}
                  textColor={colors.text}
                  style={styles.cancelBtn}
                  onPress={() => {
                    onClose();
                    reset();
                  }}
                />
                <BigButton
                  title={t('common.save')}
                  onPress={() => {
                    void submit();
                  }}
                  loading={busy}
                  disabled={!current || !next || !confirm}
                  style={styles.saveBtn}
                />
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function LanguagePicker() {
  const { lang, setLang } = useI18n();
  const langs: { code: Lang; label: string }[] = [
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
  ];
  return (
    <View style={styles.segmented}>
      {langs.map((l) => {
        const active = lang === l.code;
        return (
          <Pressable
            key={l.code}
            onPress={() => setLang(l.code)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
              {l.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const [prefs, setPrefs] = useState<NotifPrefs | null>(null);
  const [pwVisible, setPwVisible] = useState(false);
  const [logoutVisible, setLogoutVisible] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    getNotifPrefs()
      .then(setPrefs)
      .catch(() => undefined);
  }, []);

  const togglePref = (key: keyof NotifPrefs, value: boolean) => {
    if (!prefs) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next); // optimistic
    setNotifPrefs({ [key]: value })
      .then(setPrefs)
      .catch(() => setPrefs(prefs)); // revert on failure
  };

  const doLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await signOut();
      router.replace('/login');
    } finally {
      setLoggingOut(false);
      setLogoutVisible(false);
    }
  };

  return (
    <Screen scroll contentStyle={styles.content}>
      <Panel title={t('profile.account')}>
        <View style={styles.accountRow}>
          <Ionicons name="person-circle-outline" size={44} color={colors.primary} />
          <Text style={styles.email} numberOfLines={1}>
            {user?.email ?? '—'}
          </Text>
        </View>
        <ListRow
          title={t('profile.changePassword')}
          onPress={() => setPwVisible(true)}
          right={<Ionicons name="chevron-forward" size={20} color={colors.offline} />}
        />
      </Panel>

      <Panel title={t('profile.language')}>
        <LanguagePicker />
      </Panel>

      <Panel title={t('profile.timezone')}>
        <Text style={styles.tzValue}>{t('profile.tzValue')}</Text>
      </Panel>

      <Panel title={t('profile.notifications')}>
        {NOTIF_ROWS.map((row, i) => (
          <ListRow
            key={row.key}
            title={t(row.labelKey)}
            style={i > 0 ? styles.notifRow : undefined}
            right={
              <Switch
                value={prefs ? prefs[row.key] : false}
                onValueChange={(v) => togglePref(row.key, v)}
                disabled={!prefs}
                trackColor={{ false: colors.offline, true: colors.secondary }}
                thumbColor={colors.surface}
              />
            }
          />
        ))}
        {!prefs ? <Text style={styles.muted}>{t('common.loading')}</Text> : null}
      </Panel>

      <BigButton
        title={t('profile.logout')}
        color={colors.danger}
        onPress={() => setLogoutVisible(true)}
        style={styles.logoutBtn}
      />

      <ChangePasswordModal visible={pwVisible} onClose={() => setPwVisible(false)} />
      <ConfirmDialog
        visible={logoutVisible}
        title={t('profile.logoutConfirm')}
        confirmText={t('profile.logout')}
        danger
        onConfirm={() => {
          void doLogout();
        }}
        onCancel={() => setLogoutVisible(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing(4),
    gap: spacing(4),
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    paddingHorizontal: spacing(3),
    paddingBottom: spacing(2),
  },
  email: {
    flex: 1,
    fontSize: font.body,
    fontWeight: '600',
    color: colors.text,
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
  tzValue: {
    fontSize: font.body,
    color: colors.text,
    paddingHorizontal: spacing(3),
  },
  notifRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  muted: {
    fontSize: font.small,
    color: colors.textMuted,
    paddingHorizontal: spacing(3),
    paddingTop: spacing(2),
  },
  logoutBtn: {
    marginTop: spacing(2),
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
  successText: {
    fontSize: font.body,
    color: colors.success,
    marginBottom: spacing(4),
  },
  errorText: {
    fontSize: font.small,
    color: colors.danger,
    marginBottom: spacing(3),
  },
});
