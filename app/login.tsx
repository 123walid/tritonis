import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import BigButton from '../src/components/BigButton';
import FormField from '../src/components/FormField';
import Logo from '../src/components/Logo';
import Screen from '../src/components/Screen';
import { ApiError } from '../src/api/client';
import { t } from '../src/i18n';
import { useAuthStore } from '../src/store/auth';
import { colors, font, spacing } from '../src/theme';

type ErrorKind = 'credentials' | 'network' | null;

export default function LoginScreen() {
  const signIn = useAuthStore((s) => s.signIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorKind>(null);

  const submit = async () => {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      router.replace('/');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError('credentials');
      } else {
        setError('network');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.container}>
          <Logo size={88} />
          <Text style={styles.subtitle}>{t('login.subtitle')}</Text>

          {error ? (
            <View style={styles.banner} accessibilityRole="alert">
              <Text style={styles.bannerText}>
                {error === 'credentials' ? t('login.error') : t('login.network')}
              </Text>
            </View>
          ) : null}

          <FormField
            label={t('login.email')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="farmer@tritonis.tn"
          />
          <FormField
            label={t('login.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <BigButton
            title={t('login.button')}
            color={colors.accent}
            onPress={() => {
              void submit();
            }}
            loading={loading}
            disabled={email.trim().length === 0 || password.length === 0}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing(6),
  },
  subtitle: {
    fontSize: font.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing(2),
    marginBottom: spacing(8),
  },
  banner: {
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    padding: spacing(3),
    marginBottom: spacing(4),
  },
  bannerText: {
    fontSize: font.body,
    color: colors.danger,
    textAlign: 'center',
  },
});
