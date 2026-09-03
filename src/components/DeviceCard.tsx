import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DeviceSummary } from '../api/types';
import { t } from '../i18n';
import { colors, font, hitSlop, radius, spacing } from '../theme';
import { fmtA } from '../utils/format';
import StatusDot from './StatusDot';

interface DeviceCardProps {
  device: DeviceSummary;
  /** Called when the big power toggle is tapped (confirmation happens in the caller). */
  onToggle: () => void;
  /** Called when the card body is tapped (navigate to device page). */
  onPress: () => void;
}

const TOGGLE_SIZE = 64;

/** Device list card: name, status, ON/OFF state, live current, large power toggle. */
export default function DeviceCard({ device, onToggle, onPress }: DeviceCardProps) {
  const isOn = device.relay === 'ON';
  const stateColor = isOn ? colors.success : colors.textMuted;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {device.name}
        </Text>
        <StatusDot online={device.online} />
        <View style={styles.stateRow}>
          <Text style={[styles.state, { color: stateColor }]}>
            {isOn ? t('common.on') : t('common.off')}
          </Text>
          {isOn && device.current_a !== null ? (
            <Text style={styles.current}>{fmtA(device.current_a)}</Text>
          ) : null}
        </View>
      </View>

      <Pressable
        onPress={onToggle}
        hitSlop={hitSlop}
        disabled={!device.online}
        accessibilityRole="button"
        accessibilityLabel={isOn ? t('common.off') : t('common.on')}
        style={({ pressed }) => [
          styles.toggle,
          { backgroundColor: isOn ? colors.primary : colors.accent },
          pressed && styles.pressed,
          !device.online && styles.toggleDisabled,
        ]}
      >
        <Ionicons name="power" size={30} color="#FFFFFF" />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing(4),
    minHeight: 96,
  },
  pressed: {
    opacity: 0.85,
  },
  info: {
    flex: 1,
    marginRight: spacing(3),
    gap: spacing(1.5),
  },
  name: {
    fontSize: font.h2,
    fontWeight: '700',
    color: colors.text,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing(3),
  },
  state: {
    fontSize: font.body,
    fontWeight: '700',
  },
  current: {
    fontSize: font.body,
    color: colors.textMuted,
  },
  toggle: {
    width: TOGGLE_SIZE,
    height: TOGGLE_SIZE,
    borderRadius: TOGGLE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleDisabled: {
    backgroundColor: colors.offline,
    opacity: 0.5,
  },
});
