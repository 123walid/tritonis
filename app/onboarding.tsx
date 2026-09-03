// Onboarding — add a device (SPEC §3/§4).
// Three options: QR claim (expo-camera), manual device ID claim, and BLE
// Wi-Fi provisioning (Improv over BLE — needs a development build).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack, router } from 'expo-router';
import BigButton from '../src/components/BigButton';
import FormField from '../src/components/FormField';
import ListRow from '../src/components/ListRow';
import Panel from '../src/components/Panel';
import Screen from '../src/components/Screen';
import { ApiError, claimDevice, getDevices, getProvisionToken } from '../src/api/client';
import {
  createProvisioning,
  requestBlePermissions,
  type ProvDevice,
  type ProvisioningHandle,
} from '../src/ble/provisioning';
import { API_URL } from '../src/config';
import { t } from '../src/i18n';
import { useDevicesStore } from '../src/store/devices';
import { colors, font, spacing } from '../src/theme';

type Mode = 'menu' | 'qr' | 'manual' | 'ble' | 'success';
type BleStep = 'intro' | 'scanning' | 'wifi' | 'provisioning' | 'success' | 'error';
type ErrKey =
  | 'ble.permission'
  | 'ble.errWifi'
  | 'ble.errTimeout'
  | 'ble.errInternet'
  | 'ble.errGeneric'
  | 'onboarding.errNotFound'
  | 'onboarding.errClaimed'
  | 'onboarding.invalidQr'
  | 'login.network'
  | 'common.error'
  | null;

const PROV_STATUS_KEYS: Record<string, string> = {
  connecting: 'onboarding.connecting',
  writing: 'onboarding.waiting',
  waiting: 'onboarding.waiting',
};

const DEVICE_ID_RE = /^[a-zA-Z0-9\-_]{1,64}$/;

/**
 * Parses a scanned QR payload into a device id. Accepts a plain id
 * (e.g. `dev-pump-1`) or the URL form `tritonis://claim/<device_id>`.
 * Returns null when the payload is not a valid Tritonis device code.
 */
function parseQrPayload(raw: string): string | null {
  let s = raw.trim();
  const m = /^tritonis:\/\/claim\/([a-zA-Z0-9\-_]{1,64})\/?$/i.exec(s);
  if (m) s = m[1];
  return DEVICE_ID_RE.test(s) ? s : null;
}

export default function OnboardingScreen() {
  // ── Top-level mode + claim state ──────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('menu');
  const [busy, setBusy] = useState(false);
  const [claimError, setClaimError] = useState<ErrKey>(null);
  const [claimedName, setClaimedName] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [name, setName] = useState('');
  const [qrError, setQrError] = useState<ErrKey>(null);
  const qrScannedRef = useRef(false);

  // ── Camera (expo-camera) ─────────────────────────────────────────────────
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  // ── BLE availability (lazy require throws in Expo Go) ────────────────────
  const bleAvailable = useMemo(() => {
    try {
      createProvisioning().cancel();
      return true;
    } catch {
      return false;
    }
  }, []);

  // ── BLE flow state ─────────────────────────────────────────────────────────
  const [bleStep, setBleStep] = useState<BleStep>('intro');
  const [devices, setDevices] = useState<ProvDevice[]>([]);
  const [selected, setSelected] = useState<ProvDevice | null>(null);
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [provStatus, setProvStatus] = useState('waiting');
  const [bleError, setBleError] = useState<ErrKey>(null);
  const handleRef = useRef<ProvisioningHandle | null>(null);

  const cancelHandle = () => {
    handleRef.current?.cancel();
    handleRef.current = null;
  };

  useEffect(() => cancelHandle, []);

  const claim = async (id: string, deviceName?: string) => {
    if (busy) return;
    setBusy(true);
    setClaimError(null);
    try {
      const dev = await claimDevice(id, deviceName);
      setClaimedName(dev.name ?? id);
      setMode('success');
      getDevices()
        .then((list) => useDevicesStore.getState().hydrate(list))
        .catch(() => undefined);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setClaimError('onboarding.errNotFound');
      else if (e instanceof ApiError && e.status === 403) setClaimError('onboarding.errClaimed');
      else if (e instanceof ApiError && (e.code === 'network_error' || e.code === 'timeout'))
        setClaimError('login.network');
      else setClaimError('common.error');
    } finally {
      setBusy(false);
    }
  };

  const openQr = () => {
    qrScannedRef.current = false;
    setQrError(null);
    setClaimError(null);
    setMode('qr');
  };

  const onBarcodeScanned = ({ data }: { data: string }) => {
    if (qrScannedRef.current || busy) return;
    const id = parseQrPayload(data ?? '');
    if (!id) {
      setQrError('onboarding.invalidQr'); // keep scanning
      return;
    }
    qrScannedRef.current = true;
    setQrError(null);
    void claim(id);
  };

  const startBle = () => {
    if (!bleAvailable) return; // devBuildRequired panel is shown instead
    setMode('ble');
    setBleStep('intro');
    void startScan();
  };

  const startScan = async () => {
    cancelHandle();
    setDevices([]);
    setBleError(null);
    setBleStep('scanning');
    const granted = await requestBlePermissions();
    if (!granted) {
      setBleError('ble.permission');
      setBleStep('error');
      return;
    }
    try {
      const handle = createProvisioning();
      handleRef.current = handle;
      handle.scan((found) => setDevices(found));
    } catch {
      setBleError('ble.errGeneric');
      setBleStep('error');
    }
  };

  const pollForDevice = async (knownIds: Set<string>): Promise<void> => {
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        const list = await getDevices();
        useDevicesStore.getState().hydrate(list);
        if (list.some((d) => !knownIds.has(d.id))) return;
      } catch {
        /* backend unreachable — keep polling */
      }
      if (Date.now() >= deadline) return; // show success anyway: BLE side OK
      await new Promise((r) => setTimeout(r, 3000));
    }
  };

  const startProvision = async () => {
    if (!selected || ssid.trim().length === 0) return;
    setBleError(null);
    setProvStatus('waiting');
    setBleStep('provisioning');
    try {
      cancelHandle();
      const handle = createProvisioning();
      handleRef.current = handle;
      const { token } = await getProvisionToken();
      const knownIds = new Set(Object.keys(useDevicesStore.getState().devices));
      await handle.provision(
        selected.id,
        { ssid: ssid.trim(), password },
        API_URL,
        token,
        (state, errCode) => {
          if (state === 'success') {
            void pollForDevice(knownIds).then(() => setBleStep('success'));
          } else if (state === 'error') {
            setBleError((errCode as ErrKey) ?? 'ble.errGeneric');
            setBleStep('error');
          } else {
            setProvStatus(state);
          }
        }
      );
    } catch {
      setBleError('ble.errGeneric');
      setBleStep('error');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const renderSuccess = (label: string) => (
    <Panel>
      <View style={styles.center}>
        <Ionicons name="checkmark-circle" size={72} color={colors.success} />
        <Text style={styles.successText}>{t('onboarding.added')}</Text>
        <Text style={styles.body}>{label}</Text>
        <BigButton
          title={t('onboarding.done')}
          color={colors.primary}
          onPress={() => router.back()}
          style={styles.stretch}
        />
      </View>
    </Panel>
  );

  const backToMenu = () => {
    cancelHandle();
    setClaimError(null);
    setMode('menu');
  };

  return (
    <Screen scroll contentStyle={styles.content}>
      <Stack.Screen options={{ title: t('onboarding.title') }} />

      {mode === 'menu' ? (
        <>
          <Panel>
            <View style={styles.center}>
              <Ionicons name="hardware-chip-outline" size={64} color={colors.primary} />
              <Text style={styles.body}>{t('onboarding.step1')}</Text>
              <Text style={styles.sectionTitle}>{t('onboarding.chooseMethod')}</Text>
            </View>
          </Panel>

          <Panel>
            <ListRow
              title={t('onboarding.scanQr')}
              subtitle={t('onboarding.scanHint')}
              right={<Ionicons name="qr-code-outline" size={28} color={colors.primary} />}
              onPress={openQr}
            />
            <ListRow
              title={t('onboarding.manual')}
              right={<Ionicons name="keypad-outline" size={28} color={colors.primary} />}
              onPress={() => {
                setClaimError(null);
                setMode('manual');
              }}
              style={styles.rowBorder}
            />
            {bleAvailable ? (
              <ListRow
                title={t('onboarding.ble')}
                right={<Ionicons name="bluetooth-outline" size={28} color={colors.primary} />}
                onPress={startBle}
                style={styles.rowBorder}
              />
            ) : null}
          </Panel>

          {!bleAvailable ? (
            <Panel>
              <View style={styles.center}>
                <Ionicons name="bluetooth-outline" size={48} color={colors.textMuted} />
                <Text style={styles.body}>{t('ble.devBuildRequired')}</Text>
              </View>
            </Panel>
          ) : null}
        </>
      ) : null}

      {mode === 'qr' ? (
        <>
          <Panel>
            <View style={styles.center}>
              {cameraPermission?.granted ? (
                <CameraView
                  style={styles.camera}
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={onBarcodeScanned}
                />
              ) : cameraPermission && !cameraPermission.granted ? (
                <>
                  <Ionicons name="camera-outline" size={48} color={colors.textMuted} />
                  <Text style={styles.body}>{t('onboarding.cameraPermission')}</Text>
                  <BigButton
                    title={t('common.retry')}
                    onPress={() => {
                      void requestCameraPermission();
                    }}
                    style={styles.stretch}
                  />
                </>
              ) : (
                <ActivityIndicator size="large" color={colors.primary} />
              )}
              <Text style={styles.body}>{t('onboarding.scanHint')}</Text>
              {busy ? <ActivityIndicator size="small" color={colors.primary} /> : null}
            </View>
          </Panel>
          {qrError || claimError ? (
            <Text style={styles.errorText} accessibilityRole="alert">
              {t(qrError ?? claimError ?? 'common.error')}
            </Text>
          ) : null}
          <BigButton
            title={t('common.back')}
            color={colors.surface}
            textColor={colors.primary}
            onPress={backToMenu}
            style={[styles.stretch, styles.ghostBtn]}
          />
        </>
      ) : null}

      {mode === 'manual' ? (
        <>
          <Panel>
            <FormField
              label={t('onboarding.deviceId')}
              value={deviceId}
              onChangeText={(v) => {
                setClaimError(null);
                setDeviceId(v);
              }}
              autoCapitalize="none"
              placeholder="dev-pump-1"
            />
            <FormField
              label={t('onboarding.deviceName')}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              placeholder={t('device.renamePlaceholder')}
            />
            <BigButton
              title={t('onboarding.claim')}
              loading={busy}
              disabled={!DEVICE_ID_RE.test(deviceId.trim())}
              onPress={() => {
                void claim(deviceId.trim(), name.trim() || undefined);
              }}
            />
          </Panel>
          {claimError ? (
            <Text style={styles.errorText} accessibilityRole="alert">
              {t(claimError)}
            </Text>
          ) : null}
          <BigButton
            title={t('common.back')}
            color={colors.surface}
            textColor={colors.primary}
            onPress={backToMenu}
            style={[styles.stretch, styles.ghostBtn]}
          />
        </>
      ) : null}

      {mode === 'success' ? renderSuccess(claimedName ?? '') : null}

      {mode === 'ble' && bleStep === 'scanning' ? (
        <>
          <Panel>
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.body}>{t('onboarding.scanning')}</Text>
            </View>
          </Panel>
          {devices.length > 0 ? (
            <Panel>
              <Text style={styles.sectionTitle}>{t('onboarding.select')}</Text>
              {devices.map((d) => (
                <ListRow
                  key={d.id}
                  title={d.name}
                  right={<Ionicons name="chevron-forward" size={20} color={colors.textMuted} />}
                  onPress={() => {
                    cancelHandle();
                    setSelected(d);
                    setBleStep('wifi');
                  }}
                />
              ))}
            </Panel>
          ) : null}
          <BigButton
            title={t('onboarding.rescan')}
            color={colors.surface}
            textColor={colors.primary}
            onPress={() => {
              void startScan();
            }}
            style={[styles.stretch, styles.ghostBtn]}
          />
          <BigButton
            title={t('common.back')}
            color={colors.surface}
            textColor={colors.primary}
            onPress={backToMenu}
            style={[styles.stretch, styles.ghostBtn]}
          />
        </>
      ) : null}

      {mode === 'ble' && bleStep === 'wifi' ? (
        <Panel>
          <Text style={styles.sectionTitle}>{t('onboarding.wifiTitle')}</Text>
          <FormField
            label={t('onboarding.ssid')}
            value={ssid}
            onChangeText={setSsid}
            autoCapitalize="none"
          />
          <FormField
            label={t('onboarding.wifiPassword')}
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            secureTextEntry
          />
          <BigButton
            title={t('onboarding.connect')}
            disabled={ssid.trim().length === 0}
            onPress={() => {
              void startProvision();
            }}
          />
          <BigButton
            title={t('common.back')}
            color={colors.surface}
            textColor={colors.primary}
            onPress={() => {
              void startScan();
            }}
            style={[styles.stretch, styles.ghostBtn]}
          />
        </Panel>
      ) : null}

      {mode === 'ble' && bleStep === 'provisioning' ? (
        <Panel>
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.body}>
              {t(PROV_STATUS_KEYS[provStatus] ?? 'onboarding.waiting')}
            </Text>
          </View>
        </Panel>
      ) : null}

      {mode === 'ble' && bleStep === 'success' ? (
        renderSuccess(t('onboarding.success'))
      ) : null}

      {mode === 'ble' && bleStep === 'error' ? (
        <Panel>
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={64} color={colors.danger} />
            <Text style={styles.errorText} accessibilityRole="alert">
              {t(bleError ?? 'ble.errGeneric')}
            </Text>
            <BigButton
              title={t('common.retry')}
              onPress={() => {
                if (selected && bleError !== 'ble.permission') setBleStep('wifi');
                else void startScan();
              }}
              style={styles.stretch}
            />
            <BigButton
              title={t('common.back')}
              color={colors.surface}
              textColor={colors.primary}
              onPress={backToMenu}
              style={[styles.stretch, styles.ghostBtn]}
            />
          </View>
        </Panel>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing(4),
    gap: spacing(4),
    flexGrow: 1,
  },
  center: {
    alignItems: 'center',
    gap: spacing(4),
    paddingVertical: spacing(3),
  },
  body: {
    fontSize: font.body,
    color: colors.text,
    textAlign: 'center',
  },
  stretch: {
    alignSelf: 'stretch',
  },
  sectionTitle: {
    fontSize: font.h2,
    fontWeight: '700',
    color: colors.text,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  camera: {
    alignSelf: 'stretch',
    height: 320,
    borderRadius: 12,
    overflow: 'hidden',
  },
  errorText: {
    fontSize: font.body,
    color: colors.danger,
    textAlign: 'center',
  },
  ghostBtn: {
    marginTop: spacing(3),
    borderWidth: 1,
    borderColor: colors.border,
  },
  successText: {
    fontSize: font.h2,
    fontWeight: '700',
    color: colors.success,
  },
});
