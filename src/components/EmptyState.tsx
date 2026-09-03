import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, font, spacing } from '../theme';
import BigButton from './BigButton';

interface EmptyStateProps {
  /** Optional icon element rendered above the title. */
  icon?: React.ReactNode;
  title: string;
  body?: string;
  /** CTA label; when omitted no button is shown. */
  ctaLabel?: string;
  onCta?: () => void;
}

/** Friendly empty-list placeholder with optional call to action. */
export default function EmptyState({ icon, title, body, ctaLabel, onCta }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {ctaLabel && onCta ? (
        <BigButton title={ctaLabel} onPress={onCta} style={styles.cta} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing(8),
  },
  icon: {
    marginBottom: spacing(4),
  },
  title: {
    fontSize: font.h2,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  body: {
    fontSize: font.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing(2),
  },
  cta: {
    marginTop: spacing(6),
    alignSelf: 'stretch',
  },
});
