import React from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, font, minTouch, radius, spacing } from '../theme';

interface FormFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  /** Error message shown under the field. */
  error?: string;
  editable?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Label + styled text input (min height 56, body font, secure entry support). */
export default function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  keyboardType,
  autoCapitalize = 'none',
  autoCorrect = false,
  error,
  editable = true,
  style,
}: FormFieldProps) {
  return (
    <View style={[styles.wrap, style]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        editable={editable}
        style={[styles.input, !editable && styles.inputDisabled]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing(4),
  },
  label: {
    fontSize: font.body,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing(1.5),
  },
  input: {
    minHeight: minTouch,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing(4),
    fontSize: font.body,
    color: colors.text,
  },
  inputDisabled: {
    opacity: 0.6,
  },
  error: {
    marginTop: spacing(1.5),
    fontSize: font.small,
    color: colors.danger,
  },
});
