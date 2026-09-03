// Home — device list (SPEC §3).
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useNavigation } from 'expo-router';
import BigButton from '../../src/components/BigButton';
import ConfirmDialog from '../../src/components/ConfirmDialog';
import DeviceCard from '../../src/components/DeviceCard';
import EmptyState from '../../src/components/EmptyState';
import Screen from '../../src/components/Screen';
import { ApiError, getDevices, sendCommand } from '../../src/api/client';
import type { DeviceSummary, RelayState } from '../../src/api/types';
import { t } from '../../src/i18n';
import { useDevicesStore } from '../../src/store/devices';
import { colors, font, hitSlop, spacing } from '../../src/theme';

interface PendingToggle {
  device: DeviceSummary;
  action: RelayState;
}

export default function HomeScreen() {
  const navigation = useNavigation();
  const devicesMap = useDevicesStore((s) => s.devices);
  const devices = Object.values(devicesMap).sort((a, b) => a.name.localeCompare(b.name));

  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(devices.length === 0);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState<PendingToggle | null>(null);
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => {
    setLoadError(false);
    try {
      const list = await getDevices();
      useDevicesStore.getState().hydrate(list);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void refresh().finally(() => setInitialLoading(false));
  }, [refresh]);

  // Header: "My Farm" + add-device button.
  useEffect(() => {
    navigation.setOptions({
      title: t('home.myFarm'),
      headerRight: () => (
        <Ionicons
          name="add-circle-outline"
          size={30}
          color={colors.primary}
          hitSlop={hitSlop}
          accessibilityLabel={t('home.addDevice')}
          onPress={() => router.push('/onboarding')}
          style={styles.headerBtn}
        />
      ),
    });
  }, [navigation]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const confirmToggle = async () => {
    if (!pending || sending) return;
    setSending(true);
    try {
      await sendCommand(pending.device.id, pending.action);
      setPending(null);
    } catch (e) {
      setPending(null);
      if (e instanceof ApiError && e.status === 409) {
        Alert.alert(t('common.deviceOffline'));
      } else {
        Alert.alert(t('common.error'));
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen
      scroll
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            void onRefresh();
          }}
          tintColor={colors.primary}
        />
      }
      contentStyle={styles.content}
    >
      {devices.map((d) => (
        <DeviceCard
          key={d.id}
          device={d}
          onPress={() => router.push(`/device/${d.id}`)}
          onToggle={() =>
            setPending({ device: d, action: d.relay === 'ON' ? 'OFF' : 'ON' })
          }
        />
      ))}

      {initialLoading ? (
        <Text style={styles.muted}>{t('common.loading')}</Text>
      ) : devices.length === 0 ? (
        loadError ? (
          <EmptyState
            icon={<Ionicons name="cloud-offline-outline" size={56} color={colors.offline} />}
            title={t('common.error')}
            ctaLabel={t('common.retry')}
            onCta={() => {
              setInitialLoading(true);
              void refresh().finally(() => setInitialLoading(false));
            }}
          />
        ) : (
          <EmptyState
            icon={<Ionicons name="water-outline" size={56} color={colors.secondary} />}
            title={t('home.emptyTitle')}
            body={t('home.emptyBody')}
            ctaLabel={t('home.emptyCta')}
            onCta={() => router.push('/onboarding')}
          />
        )
      ) : null}

      {loadError && devices.length > 0 ? (
        <View style={styles.errorRow}>
          <Text style={styles.errorText}>{t('common.error')}</Text>
          <BigButton
            title={t('common.retry')}
            onPress={() => {
              void refresh();
            }}
            color={colors.primary}
            style={styles.retryBtn}
          />
        </View>
      ) : null}

      <ConfirmDialog
        visible={pending !== null}
        title={
          pending?.action === 'ON' ? t('home.confirmOnTitle') : t('home.confirmOffTitle')
        }
        body={pending?.action === 'ON' ? t('home.confirmOnBody') : t('home.confirmOffBody')}
        confirmText={pending?.action === 'ON' ? t('common.on') : t('common.off')}
        onConfirm={() => {
          void confirmToggle();
        }}
        onCancel={() => setPending(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing(4),
    gap: spacing(3),
    flexGrow: 1,
  },
  headerBtn: {
    marginRight: spacing(3),
  },
  muted: {
    fontSize: font.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing(8),
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
  },
  errorText: {
    flex: 1,
    fontSize: font.small,
    color: colors.danger,
  },
  retryBtn: {
    minHeight: 44,
    paddingVertical: spacing(2),
  },
});
