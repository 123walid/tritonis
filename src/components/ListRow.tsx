import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, font, minTouch, spacing } from '../theme';

interface ListRowProps {
  title: string;
  subtitle?: string;
  /** Right-hand accessory (icon, switch, chevron, value text…). */
  right?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Standard list row: title, optional subtitle, right accessory. Min height 56. */
export default function ListRow({ title, subtitle, right, onPress, onLongPress, style }: ListRowProps) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, style]}
    >
      <View style={styles.texts}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: minTouch,
    paddingVertical: spacing(2),
    paddingHorizontal: spacing(3),
  },
  pressed: {
    opacity: 0.7,
  },
  texts: {
    flex: 1,
    marginRight: spacing(3),
  },
  title: {
    fontSize: font.body,
    fontWeight: '600',
    color: colors.text,
  },
  subtitle: {
    fontSize: font.small,
    color: colors.textMuted,
    marginTop: 2,
  },
  right: {
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
});
