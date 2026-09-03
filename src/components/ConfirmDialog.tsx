import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { colors, font, radius, spacing } from '../theme';
import BigButton from './BigButton';

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  body?: string;
  /** Default: t('common.confirm'). */
  confirmText?: string;
  /** Default: t('common.cancel'). */
  cancelText?: string;
  /** Use the danger color for the confirm button. Default false (copper accent). */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Modal confirmation dialog with big buttons (pump safety confirmations). */
export default function ConfirmDialog({
  visible,
  title,
  body,
  confirmText,
  cancelText,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityRole="button">
        <Pressable style={styles.card} onPress={() => undefined} accessibilityRole="none">
          <Text style={styles.title}>{title}</Text>
          {body ? <Text style={styles.body}>{body}</Text> : null}
          <View style={styles.buttons}>
            <BigButton
              title={cancelText ?? t('common.cancel')}
              onPress={onCancel}
              color={colors.surface}
              textColor={colors.text}
              style={styles.cancelBtn}
            />
            <BigButton
              title={confirmText ?? t('common.confirm')}
              onPress={onConfirm}
              color={danger ? colors.danger : colors.accent}
              style={styles.confirmBtn}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(26, 46, 50, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing(6),
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing(6),
  },
  title: {
    fontSize: font.h2,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing(2),
  },
  body: {
    fontSize: font.body,
    color: colors.textMuted,
    marginBottom: spacing(4),
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing(3),
    marginTop: spacing(2),
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  confirmBtn: {
    flex: 1,
  },
});
