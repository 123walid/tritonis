import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, font, radius, spacing } from '../theme';

interface PanelProps {
  title?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** White card with an optional section title. */
export default function Panel({ title, children, style }: PanelProps) {
  return (
    <View style={[styles.card, style]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing(4),
  },
  title: {
    fontSize: font.body,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing(3),
  },
});
