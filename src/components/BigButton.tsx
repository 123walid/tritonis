import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { colors, font, hitSlop, minTouch, radius, spacing } from '../theme';

interface BigButtonProps {
  title: string;
  onPress: () => void;
  /** Background color. Default: colors.accent (copper — primary actions). */
  color?: string;
  /** Text color. Default: white. */
  textColor?: string;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Large touch-friendly action button (min height 56, bold body font). */
export default function BigButton({
  title,
  onPress,
  color = colors.accent,
  textColor = '#FFFFFF',
  loading = false,
  disabled = false,
  style,
}: BigButtonProps) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: off }}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: color },
        pressed && styles.pressed,
        off && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <Text style={[styles.label, { color: textColor }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: minTouch,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing(6),
    paddingVertical: spacing(3),
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontSize: font.body,
    fontWeight: '700',
  },
});
