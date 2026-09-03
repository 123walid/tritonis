import React from 'react';
import { ScrollView, StyleSheet, View, type RefreshControlProps, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors } from '../theme';

interface ScreenProps {
  children: React.ReactNode;
  /** Wrap content in a ScrollView. Default false. */
  scroll?: boolean;
  /** RefreshControl element forwarded to the ScrollView when scroll is true. */
  refreshControl?: React.ReactElement<RefreshControlProps>;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  /** Safe-area edges to respect. Default: bottom (top is handled by headers). */
  edges?: Edge[];
}

/** Safe-area screen wrapper with the app background color. */
export default function Screen({
  children,
  scroll = false,
  refreshControl,
  style,
  contentStyle,
  edges = ['bottom'],
}: ScreenProps) {
  return (
    <SafeAreaView style={[styles.root, style]} edges={edges}>
      {scroll ? (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={contentStyle}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  fill: {
    flex: 1,
  },
});
