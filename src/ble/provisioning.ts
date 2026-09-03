// BLE Wi-Fi provisioning using the Improv Wi-Fi over BLE standard
// (https://www.improv-wifi.org/ble/), as implemented by ESPHome's
// `esp32_improv` component (SPEC §4).
//
// IMPORTANT: `react-native-ble-plx` is a native module and crashes Expo Go if
// statically imported. It is therefore loaded lazily via require() inside
// createProvisioning(); when unavailable (Expo Go), createProvisioning()
// throws and the UI shows the ble.devBuildRequired fallback.
import { PermissionsAndroid, Platform } from 'react-native';

// ── Public contract (SPEC §4) ────────────────────────────────────────────────

export type ProvState =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'writing'
  | 'waiting'
  | 'success'
  | 'error';

export interface ProvDevice {
  id: string;
  name: string;
  rssi: number | null;
}

export interface ProvisioningHandle {
  scan(cb: (d: ProvDevice[]) => void): void;
  provision(
    deviceId: string,
    wifi: { ssid: string; password: string },
    backendUrl: string,
    provToken: string,
    onState: (s: ProvState, errCode?: string) => void
  ): Promise<void>;
  cancel(): void;
}

// ── Improv over BLE constants ────────────────────────────────────────────────

const SERVICE_UUID = '00467768-6228-2272-4663-277478268000';
const CHAR_STATUS = '00467768-6228-2272-4663-277478268001'; // read / notify
const CHAR_ERROR = '00467768-6228-2272-4663-277478268002'; // read / notify
const CHAR_RPC_COMMAND = '00467768-6228-2272-4663-277478268003'; // write
// -0004 RPC result (read/notify) carries redirect URLs after provisioning;
// the pump reports via MQTT instead, so we only need STATUS/ERROR.

// RPC commands
const CMD_SEND_WIFI = 0x01;

// Current State values
const STATE_AUTHORIZATION_REQUIRED = 0x01;
const STATE_PROVISIONING = 0x03;
const STATE_PROVISIONED = 0x04;

// Error State values
const ERR_NONE = 0x00;
const ERR_UNABLE_TO_CONNECT = 0x03;

const PROVISION_TIMEOUT_MS = 60_000;
const MTU = 247;

// ── Minimal structural types for the react-native-ble-plx surface we use ────
// (The package is not installed in this sandbox / Expo Go, so we cannot rely
// on its bundled types.)

interface BleCharacteristicLike {
  value: string | null; // base64
}

interface BleDeviceLike {
  id: string;
  name: string | null;
  rssi: number | null;
  discoverAllServicesAndCharacteristics(): Promise<BleDeviceLike>;
  requestMTU(mtu: number): Promise<BleDeviceLike>;
  writeCharacteristicWithResponseForService(
    serviceUUID: string,
    characteristicUUID: string,
    base64Value: string
  ): Promise<BleCharacteristicLike>;
  monitorCharacteristicForService(
    serviceUUID: string,
    characteristicUUID: string,
    listener: (error: unknown, characteristic: BleCharacteristicLike | null) => void
  ): void;
  cancelConnection(): Promise<BleDeviceLike>;
}

interface BleManagerLike {
  startDeviceScan(
    uuids: string[] | null,
    options: { allowDuplicates?: boolean } | null,
    listener: (error: unknown, device: BleDeviceLike | null) => void
  ): void;
  stopDeviceScan(): void;
  connectToDevice(deviceId: string, options?: { timeout?: number }): Promise<BleDeviceLike>;
  destroy(): void;
}

type BleManagerCtor = new () => BleManagerLike;

function loadBleManagerCtor(): BleManagerCtor {
  // Lazy require: throws in Expo Go (native module missing).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('react-native-ble-plx') as { BleManager?: BleManagerCtor };
  if (!mod || typeof mod.BleManager !== 'function') {
    throw new Error('BLE native module unavailable');
  }
  return mod.BleManager;
}

// ── Byte helpers ─────────────────────────────────────────────────────────────

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode raw bytes to base64 without relying on global btoa. */
function bytesToBase64(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64_CHARS[b2 & 0x3f] : '=';
  }
  return out;
}

function base64ToBytes(b64: string): number[] {
  const clean = b64.replace(/=+$/, '');
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B64_CHARS.indexOf(ch);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return bytes;
}

function encodeUtf8(s: string): number[] {
  const encoded = unescape(encodeURIComponent(s));
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i++) bytes.push(encoded.charCodeAt(i));
  return bytes;
}

/**
 * Build an Improv RPC packet:
 *   [command, dataLength, ...data, checksum]
 * checksum = (command + dataLength + sum(data)) & 0xFF
 *
 * For "Send WiFi settings" (0x01) the payload is:
 *   [ssidLength, ...ssidBytes, passwordLength, ...passwordBytes]
 * (length-prefixed, per https://www.improv-wifi.org/ble/ RPC command 0x01)
 */
export function buildWifiSettingsPacket(ssid: string, password: string): number[] {
  const ssidBytes = encodeUtf8(ssid);
  const passBytes = encodeUtf8(password);
  const data = [ssidBytes.length, ...ssidBytes, passBytes.length, ...passBytes];
  const packet = [CMD_SEND_WIFI, data.length, ...data];
  let sum = 0;
  for (const b of packet) sum = (sum + b) & 0xff;
  packet.push(sum);
  return packet;
}

// ── Android runtime permissions ──────────────────────────────────────────────

/** Request BLE permissions. Returns true when granted. */
export async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true; // iOS prompts via Info.plist
  const api = typeof Platform.Version === 'number' ? Platform.Version : 0;
  const perms = PermissionsAndroid.PERMISSIONS as Record<string, string>;
  if (api >= 31) {
    const res = await PermissionsAndroid.requestMultiple([
      (perms.BLUETOOTH_SCAN ?? 'android.permission.BLUETOOTH_SCAN') as never,
      (perms.BLUETOOTH_CONNECT ?? 'android.permission.BLUETOOTH_CONNECT') as never,
    ]);
    const vals = Object.values(res);
    return vals.every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
  }
  const res = await PermissionsAndroid.request(
    (perms.ACCESS_FINE_LOCATION ?? 'android.permission.ACCESS_FINE_LOCATION') as never,
    {
      title: 'Bluetooth permission',
      message: 'Tritonis needs location access to find your device over Bluetooth.',
      buttonPositive: 'OK',
    }
  );
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

// ── Provisioning handle ──────────────────────────────────────────────────────

class BleProvisioning implements ProvisioningHandle {
  private manager: BleManagerLike;
  private cancelled = false;
  private device: BleDeviceLike | null = null;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(ManagerCtor: BleManagerCtor) {
    this.manager = new ManagerCtor();
  }

  scan(cb: (d: ProvDevice[]) => void): void {
    const found = new Map<string, ProvDevice>();
    void requestBlePermissions().then((granted) => {
      if (!granted || this.cancelled) return;
      this.manager.startDeviceScan([SERVICE_UUID], { allowDuplicates: false }, (error, dev) => {
        if (error || !dev || this.cancelled) return;
        const name = dev.name ?? '';
        // ESPHome improv devices advertise with their device name and the
        // improv service UUID (already filtered). Accept TRITONIS-* / improv /
        // any device carrying the improv service UUID.
        if (!/^TRITONIS-/i.test(name) && !/improv/i.test(name) && name.length === 0) return;
        const entry: ProvDevice = { id: dev.id, name: name || 'Tritonis', rssi: dev.rssi ?? null };
        found.set(dev.id, entry);
        cb([...found.values()].sort((a, b) => (b.rssi ?? -127) - (a.rssi ?? -127)));
      });
    });
  }

  async provision(
    deviceId: string,
    wifi: { ssid: string; password: string },
    backendUrl: string,
    provToken: string,
    onState: (s: ProvState, errCode?: string) => void
  ): Promise<void> {
    // NOTE: the Improv over BLE protocol only carries WiFi credentials. The
    // backend URL / provisioning token are not sent over BLE — the ESP32
    // firmware has its MQTT broker hardcoded and the backend maps its topic
    // prefix (SPEC §4); these params are part of the contract for future use.
    void backendUrl;
    void provToken;

    const granted = await requestBlePermissions();
    if (!granted) {
      onState('error', 'ble.permission');
      this.cleanup();
      return;
    }
    if (this.cancelled) return;

    let finished = false;
    const finish = (s: ProvState, errCode?: string) => {
      if (finished) return;
      finished = true;
      if (this.timeoutHandle) {
        clearTimeout(this.timeoutHandle);
        this.timeoutHandle = null;
      }
      onState(s, errCode);
      this.cleanup();
    };

    this.timeoutHandle = setTimeout(() => {
      finish('error', 'ble.errTimeout');
    }, PROVISION_TIMEOUT_MS);

    try {
      this.manager.stopDeviceScan();
      onState('connecting');
      this.device = await this.manager.connectToDevice(deviceId, { timeout: 15000 });
      if (this.cancelled) return;
      await this.device.discoverAllServicesAndCharacteristics();
      if (this.cancelled) return;
      try {
        await this.device.requestMTU(MTU);
      } catch {
        // MTU negotiation is best-effort; default 23-byte MTU still works.
      }

      const device = this.device;

      // Watch ERROR characteristic.
      device.monitorCharacteristicForService(SERVICE_UUID, CHAR_ERROR, (err, ch) => {
        if (err || !ch || !ch.value || finished) return;
        const code = base64ToBytes(ch.value)[0] ?? ERR_NONE;
        if (code === ERR_NONE) return;
        if (code === ERR_UNABLE_TO_CONNECT) finish('error', 'ble.errWifi');
        else finish('error', 'ble.errGeneric');
      });

      // Watch STATUS characteristic.
      device.monitorCharacteristicForService(SERVICE_UUID, CHAR_STATUS, (err, ch) => {
        if (err || !ch || !ch.value || finished) return;
        const state = base64ToBytes(ch.value)[0];
        if (state === STATE_PROVISIONED) {
          finish('success');
        } else if (state === STATE_PROVISIONING || state === STATE_AUTHORIZATION_REQUIRED) {
          onState('waiting');
        }
      });

      onState('writing');
      const packet = buildWifiSettingsPacket(wifi.ssid, wifi.password);
      await device.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        CHAR_RPC_COMMAND,
        bytesToBase64(packet)
      );
      if (this.cancelled) return;
      onState('waiting');
    } catch {
      finish('error', 'ble.errGeneric');
    }
  }

  cancel(): void {
    this.cancelled = true;
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    this.cleanup();
  }

  private cleanup(): void {
    try {
      this.manager.stopDeviceScan();
    } catch {
      /* noop */
    }
    const device = this.device;
    this.device = null;
    if (device) {
      device.cancelConnection().catch(() => undefined);
    }
    try {
      this.manager.destroy();
    } catch {
      /* noop */
    }
  }
}

/** Create a provisioning handle. Throws when the BLE native module is missing. */
export function createProvisioning(): ProvisioningHandle {
  return new BleProvisioning(loadBleManagerCtor());
}
