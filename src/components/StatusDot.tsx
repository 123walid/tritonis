import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { colors, font, spacing } from '../theme';

interface StatusDotProps {
  online: boolean;
  /** Hide the text label and show only the dot. Default false. */
  dotOnly?: boolean;
}

/** Online (green) / offline (grey) indicator dot with label. */
export default function StatusDot({ online, dotOnly = false }: StatusDotProps) {
  const color = online ? colors.success : colors.offline;
  return (
    <View style={styles.wrap}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      {dotOnly ? null : (
        <Text style={[styles.label, { color }]}>
          {online ? t('device.online') : t('device.offline')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  label: {
    marginLeft: spacing(2),
    fontSize: font.small,
    fontWeight: '600',
  },
});
