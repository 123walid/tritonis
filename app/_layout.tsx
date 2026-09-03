import React, { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Logo from '../src/components/Logo';
import { startRealtime } from '../src/api/realtime';
import { registerPushToken } from '../src/api/client';
import { useAuthStore } from '../src/store/auth';
import { useDevicesStore } from '../src/store/devices';
import { colors, font } from '../src/theme';

// expo-notifications throws at import time inside Expo Go (SDK 53+),
// so load it lazily: the app runs fine in Expo Go, and push notifications
// activate automatically in a development/production build.
let Notifications: typeof import('expo-notifications') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require('expo-notifications');
} catch {
  Notifications = null; // Running inside Expo Go — push unavailable.
}

/** Fire-and-forget Expo push token registration (no-op in Expo Go). */
async function registerPush(): Promise<void> {
  if (!Notifications) return;
  try {
    const { data } = await Notifications.getExpoPushTokenAsync();
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    await registerPushToken(data, platform);
  } catch (e) {
    console.warn('[push] token registration skipped', e);
  }
}

function Splash() {
  return (
    <View style={styles.splash}>
      <Logo size={96} />
    </View>
  );
}

export default function RootLayout() {
  const status = useAuthStore((s) => s.status);

  // Restore persisted session on mount.
  useEffect(() => {
    void useAuthStore.getState().restore();
  }, []);

  // Manage realtime lifecycle: run while signed in, stop on sign-out.
  useEffect(() => {
    if (status !== 'signedIn') return undefined;
    const applyEvent = useDevicesStore.getState().applyEvent;
    const stop = startRealtime(applyEvent);
    void registerPush();
    return stop;
  }, [status]);

  const headerOptions = {
    headerStyle: { backgroundColor: colors.cream },
    headerTintColor: colors.primary,
    headerTitleStyle: { color: colors.primary, fontSize: font.h2, fontWeight: '700' as const },
    headerBackButtonDisplayMode: 'minimal' as const,
    contentStyle: { backgroundColor: colors.bg },
  };

  // Auth restore splash: cream background + Logo.
  if (status === 'restoring') {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Splash />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={headerOptions}>
        <Stack.Protected guard={status === 'signedOut'}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={status === 'signedIn'}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="device/[id]/index" options={{ headerShown: true, title: '' }} />
          <Stack.Screen name="device/[id]/reports" options={{ headerShown: true }} />
          <Stack.Screen name="device/[id]/schedule" options={{ headerShown: true }} />
          <Stack.Screen name="device/[id]/timer" options={{ headerShown: true }} />
          <Stack.Screen name="device/[id]/pulse" options={{ headerShown: true }} />
          <Stack.Screen name="onboarding" options={{ headerShown: true }} />
        </Stack.Protected>
      </Stack>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
