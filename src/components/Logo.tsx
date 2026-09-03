import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, font } from '../theme';

interface LogoProps {
  /** Height of the mark in dp; wordmark scales with it. Default 72. */
  size?: number;
  /** Show the "Tritonis" wordmark under the mark. Default true. */
  wordmark?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOGO_SOURCE = require('../../assets/logo.png');

/** Tritonis brand logo: trident mark + wordmark. */
export default function Logo({ size = 72, wordmark = true }: LogoProps) {
  return (
    <View style={styles.wrap}>
      <Image
        source={LOGO_SOURCE}
        style={{ width: size, height: size, borderRadius: size * 0.22 }}
        resizeMode="cover"
      />
      {wordmark ? (
        <Text style={[styles.wordmark, { fontSize: Math.max(font.h2, size * 0.32) }]}>
          Tritonis
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    marginTop: 8,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 1,
  },
});
