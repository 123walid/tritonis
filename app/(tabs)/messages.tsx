// Messages — alerts feed (SPEC §3).
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import EmptyState from '../../src/components/EmptyState';
import Screen from '../../src/components/Screen';
import { getAlerts, markAlertRead, markAllAlertsRead } from '../../src/api/client';
import type { Alert as TritonisAlert, AlertType } from '../../src/api/types';
import { t } from '../../src/i18n';
import { useDevicesStore } from '../../src/store/devices';
import { colors, font, hitSlop, minTouch, spacing } from '../../src/theme';
import { fmtDateTime } from '../../src/utils/format';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const ALERT_STYLE: Record<AlertType, { icon: IoniconName; color: string }> = {
  dry_run: { icon: 'warning', color: colors.accent },
  high_load: { icon: 'flash', color: colors.accent },
  offline: { icon: 'cloud-offline', color: colors.offline },
  online: { icon: 'cloud-done', color: colors.success },
  unexpected_stop: { icon: 'alert-circle', color: colors.danger },
  schedule_executed: { icon: 'calendar', color: colors.primary },
  power_failure: { icon: 'thunderstorm', color: colors.secondary },
};

function AlertRow({ alert }: { alert: TritonisAlert }) {
  const style = ALERT_STYLE[alert.type] ?? { icon: 'notifications' as IoniconName, color: colors.primary };
  const onPress = () => {
    if (!alert.read) {
      useDevicesStore.getState().markRead(alert.id);
      void markAlertRead(alert.id).catch(() => undefined);
    }
    router.push(`/device/${alert.device_id}`);
  };
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.iconWrap, { backgroundColor: style.color }]}>
        <Ionicons name={style.icon} size={22} color="#FFFFFF" />
      </View>
      <View style={styles.texts}>
        <View style={styles.titleRow}>
          <Text style={[styles.deviceName, !alert.read && styles.unread]} numberOfLines={1}>
            {alert.device_name}
          </Text>
          {!alert.read ? <View style={styles.unreadDot} /> : null}
        </View>
        <Text style={styles.typeLabel}>{t(`alert.${alert.type}`)}</Text>
        {alert.message ? (
          <Text style={styles.message} numberOfLines={2}>
            {alert.message}
          </Text>
        ) : null}
        <Text style={styles.time}>{fmtDateTime(alert.created_at)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.offline} />
    </Pressable>
  );
}

export default function MessagesScreen() {
  const navigation = useNavigation();
  const alerts = useDevicesStore((s) => s.alerts);
  const unreadCount = useDevicesStore((s) => s.unreadCount);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const list = await getAlerts();
      useDevicesStore.getState().setAlerts(list);
    } catch {
      setLoadError(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Header action: mark all read.
  useEffect(() => {
    navigation.setOptions({
      title: t('messages.title'),
      headerRight: () =>
        unreadCount > 0 ? (
          <Pressable
            onPress={() => {
              useDevicesStore.getState().markAllRead();
              void markAllAlertsRead().catch(() => undefined);
            }}
            hitSlop={hitSlop}
            accessibilityRole="button"
            style={styles.markAllBtn}
          >
            <Text style={styles.markAllText}>{t('messages.markAll')}</Text>
          </Pressable>
        ) : null,
    });
  }, [navigation, unreadCount]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <Screen>
      <FlatList
        data={alerts}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => <AlertRow alert={item} />}
        contentContainerStyle={alerts.length === 0 ? styles.emptyContainer : styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void onRefresh();
            }}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          loadError ? (
            <EmptyState
              icon={<Ionicons name="cloud-offline-outline" size={56} color={colors.offline} />}
              title={t('common.error')}
              ctaLabel={t('common.retry')}
              onCta={() => {
                void load();
              }}
            />
          ) : (
            <EmptyState
              icon={<Ionicons name="notifications-off-outline" size={56} color={colors.secondary} />}
              title={t('messages.empty')}
            />
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingVertical: spacing(2),
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: minTouch,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3),
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing(3),
  },
  pressed: {
    opacity: 0.75,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
  },
  deviceName: {
    fontSize: font.body,
    fontWeight: '600',
    color: colors.text,
  },
  unread: {
    fontWeight: '800',
  },
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  typeLabel: {
    fontSize: font.small,
    fontWeight: '600',
    color: colors.primary,
    marginTop: 1,
  },
  message: {
    fontSize: font.small,
    color: colors.textMuted,
    marginTop: 2,
  },
  time: {
    fontSize: font.small - 1,
    color: colors.offline,
    marginTop: 2,
  },
  markAllBtn: {
    marginRight: spacing(3),
    minHeight: 40,
    justifyContent: 'center',
  },
  markAllText: {
    fontSize: font.small,
    fontWeight: '700',
    color: colors.accent,
  },
});
