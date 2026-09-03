# Tritonis — Implementation SPEC (Single Source of Truth)

Derived from `Tritonis_Mobile_App_Specification.md` v1.0. Stack override per product owner: **React Native + Expo (SDK 57) + TypeScript**, Android-first. This file defines exact contracts. Implement faithfully — no unilateral changes to interfaces, field names, or file ownership.

---

## 0. Repo layout & ownership

Repo root: `/mnt/agents/output/tritonis-app` (shared git repo, branch `main`).

```
tritonis-app/                    # Expo app root (package.json, app.json, tsconfig.json)
├── app/                         # expo-router routes
│   ├── _layout.tsx              # [core] root stack + auth gate
│   ├── login.tsx                # [core]
│   ├── onboarding.tsx           # [ble]
│   ├── (tabs)/
│   │   ├── _layout.tsx          # [core] bottom tabs: Home | Scene | Messages | Profile
│   │   ├── index.tsx            # [screensA] Home — device list
│   │   ├── scene.tsx            # [screensB] placeholder
│   │   ├── messages.tsx         # [screensB] alerts feed
│   │   └── profile.tsx          # [screensB]
│   └── device/[id]/
│       ├── index.tsx            # [screensA] device page
│       ├── reports.tsx          # [screensA]
│       ├── schedule.tsx         # [screensB]
│       ├── timer.tsx            # [screensB]
│       └── pulse.tsx            # [screensB]
├── src/
│   ├── theme.ts                 # [core]
│   ├── config.ts                # [core]
│   ├── i18n/ index.ts, en.ts, fr.ts   # [core]
│   ├── api/ types.ts, client.ts, realtime.ts  # [core]
│   ├── store/ auth.ts, devices.ts     # [core]
│   ├── utils/ format.ts, days.ts      # [core]
│   ├── components/ (Logo, BigButton, DeviceCard, StatusDot, ConfirmDialog,
│   │   Panel, ListRow, EmptyState, Screen, FormField)   # [core]
│   ├── components/charts.tsx    # [screensA] BarChart, LineChart (react-native-svg)
│   └── ble/ provisioning.ts     # [ble]
├── server/                      # [backend] dev backend — own package.json, plain ESM JS
│   ├── package.json
│   ├── config/tariffs.json
│   └── src/ index.js, db.js, auth.js, ws.js, simulator.js, scheduler.js,
│       alerts.js, tariffs.js, push.js, routes/*.js
└── SPEC.md (symlink/copy of this file at repo root for agents)
```

**Rules**
- Each agent works ONLY on files tagged with its owner name. `package.json`, `app.json`, `tsconfig.json`, `.gitignore` are owned by the main agent — already final; do not edit.
- TypeScript strict. No `any` unless unavoidable. No new npm dependencies (everything needed is preinstalled).
- All styling via `src/theme.ts`. Light theme only. Min touch target 56dp. Sunlight-readable contrast.
- All user-facing strings via `t('key')` from `src/i18n` — never hardcoded English in JSX.
- All displayed times in Africa/Tunis via `src/utils/format.ts`.

---

## 1. Backend HTTP/WS contract (app ⇄ server)

Base URL: `http://<host>:4000/api/v1`. Auth: `Authorization: Bearer <token>` on everything except `POST /auth/login`. Token: JWT (24h expiry). Error shape (non-2xx): `{ "error": "<machine_code>", "message"?: "<human>" }`.

Seeded account (phase 1, hardcoded): **email `farmer@tritonis.tn`, password `tritonis2026`**. Seeded device: id `dev-pump-1`, name `Pump 1`, mqtt_prefix `farm/pump`.

### Types (JSON field names are contractual — snake_case)

```ts
type RelayState = 'ON' | 'OFF';

interface DeviceSummary {
  id: string; name: string; online: boolean; relay: RelayState;
  current_a: number | null;      // null when off/unknown
  power_kw: number | null;
  water_flow: boolean | null;    // null = sensor n/a
  last_seen_at: string | null;   // ISO 8601 UTC
}

interface Session {
  id: string; device_id: string;
  started_at: string; ended_at: string | null; duration_s: number;
  energy_wh: number; avg_a: number | null; min_a: number | null; max_a: number | null;
  water_m3: number | null; cost_tnd: number | null;
  tariff_period: 'off_peak' | 'standard' | 'peak' | 'mixed';
  end_reason: 'manual' | 'schedule' | 'timer' | 'pulse' | 'dry_run' | 'high_load' | 'running' | null;
}

interface DeviceStatus extends DeviceSummary {
  today: { energy_kwh: number; cost_tnd: number; water_m3: number; runtime_min: number; sessions: number };
  last_session: Session | null;
  active_timer: Timer | null;
  active_pulse: PulseProgram | null;
}

interface Schedule {
  id: string; device_id: string; time_local: string;        // 'HH:MM' 24h, Africa/Tunis
  action: RelayState; days_mask: number;                    // bit0=Mon … bit6=Sun; 127 = everyday
  type: 'manual' | 'tariff_optimized'; enabled: boolean;
}

interface Timer { id: string; device_id: string; action: RelayState; run_at: string; enabled: boolean; }

interface PulseProgram {
  id: string; device_id: string; on_min: number; off_min: number;
  cycles: number | null;                 // null = until end_at
  start_at: string | null; end_at: string | null;
  enabled: boolean; phase: RelayState; cycles_done: number;
}

interface Reading { ts: string; current_a: number; power_kw: number; water_flow: boolean; }

type AlertType = 'offline' | 'online' | 'dry_run' | 'high_load' | 'unexpected_stop' | 'schedule_executed' | 'power_failure';
interface Alert { id: string; device_id: string; device_name: string; type: AlertType; message: string; created_at: string; read: boolean; }

interface NotifPrefs { offline: boolean; online: boolean; dry_run: boolean; high_load: boolean; unexpected_stop: boolean; schedule_executed: boolean; }
```

### REST endpoints

```
POST   /auth/login                      { email, password } → 200 { token, user:{id,email} } | 401 { error:'invalid_credentials' }
POST   /auth/logout                     → 204
POST   /auth/password                   { current_password, new_password } → 204 | 400 { error:'wrong_password' } | 400 { error:'weak_password' } (min 8 chars)
GET    /devices                         → { devices: DeviceSummary[] }
PATCH  /devices/:id                     { name } (1–40 chars) → DeviceSummary
POST   /devices/:id/command             { action:'ON'|'OFF' } → 202 { accepted:true } | 409 { error:'device_offline' }
GET    /devices/:id/status              → DeviceStatus
GET    /devices/:id/sessions?from&to    → { sessions: Session[] }   (from/to ISO, default last 30 days, desc)
GET    /devices/:id/readings?from&to&resolution → { readings: Reading[] }  resolution: 'raw'|'hour'|'day' (avg)
GET    /devices/:id/schedules           → { schedules: Schedule[] }  (sorted by time_local)
POST   /devices/:id/schedules           { time_local, action, days_mask, type?='manual', enabled?=true } → 201 Schedule
PATCH  /devices/:id/schedules/:sid      partial { time_local?, action?, days_mask?, enabled? } → Schedule
DELETE /devices/:id/schedules/:sid      → 204
GET    /devices/:id/timers              → { timers: Timer[] }        (enabled only)
POST   /devices/:id/timers              { action, delay_min: 1–1440 } → 201 Timer   (replaces any existing enabled timer)
DELETE /devices/:id/timers/:tid         → 204 (cancel)
GET    /devices/:id/pulse               → { pulse: PulseProgram | null }  (active = enabled)
POST   /devices/:id/pulse               { on_min:1–180, off_min:1–180, cycles?:1–99, start_at?:ISO } → 201 PulseProgram (replaces active)
POST   /devices/:id/pulse/stop          → 204 (disable + turn pump OFF if pulse started it)
GET    /alerts                          → { alerts: Alert[] }  (latest 100, desc)
POST   /alerts/:id/read                 → 204
POST   /alerts/read-all                 → 204
GET    /settings/notifications          → NotifPrefs
PATCH  /settings/notifications          partial NotifPrefs → NotifPrefs
POST   /push/register                   { fcm_token, platform:'android'|'ios' } → 204
POST   /provision/token                 → 201 { token, expires_at }  (15 min TTL)
POST   /provision/confirm               { token, device_id, name? } → 200 { ok:true }  (device-side stub)
```

### WebSocket

`ws://<host>:4000/ws?token=<jwt>`. Server → client JSON messages:

```ts
{ type:'device_state', device: DeviceSummary }
{ type:'reading', device_id, ts, current_a, power_kw, water_flow }   // every ~2s while pump ON
{ type:'alert', alert: Alert }
{ type:'hello', devices: DeviceSummary[] }                           // first message on connect
```

Client must reconnect with exponential backoff (1s → 30s cap). On 401 close, trigger logout.

---

## 2. App contracts (src/)

### src/theme.ts
```ts
export const colors = {
  primary: '#1E5560',      // deep teal
  secondary: '#458D93',    // mid teal
  accent: '#CF4908',       // copper — primary actions, alerts
  cream: '#F7EFE2',        // light backgrounds
  bg: '#FBF8F2', surface: '#FFFFFF', text: '#1A2E32', textMuted: '#5B7075',
  border: '#E3DCCF', success: '#2E7D4F', danger: '#B3261E', warning: '#CF4908',
  offline: '#9AA5A8',
};
export const spacing = (n:number)=>n*4;
export const radius = { sm:8, md:14, lg:22, full:999 };
export const font = { title:28, h2:22, body:17, small:14, hero:40 };  // min body 17 — sunlight
export const hitSlop = { top:12, bottom:12, left:12, right:12 };
export const minTouch = 56;
```

### src/config.ts
```ts
import Constants from 'expo-constants';
const extra = Constants.expoConfig?.extra ?? {};
export const API_URL: string = extra.apiUrl ?? 'http://localhost:4000';  // no trailing slash
export const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws';
```

### src/api/client.ts — exact exported signatures
```ts
export class ApiError extends Error { status: number; code: string; }
export async function login(email: string, password: string): Promise<{ token: string; user: { id: string; email: string } }>;
export async function logout(): Promise<void>;                       // best-effort, never throws
export async function changePassword(current: string, next: string): Promise<void>;
export async function getDevices(): Promise<DeviceSummary[]>;
export async function renameDevice(id: string, name: string): Promise<DeviceSummary>;
export async function sendCommand(id: string, action: RelayState): Promise<void>;  // throws ApiError 409 when offline
export async function getDeviceStatus(id: string): Promise<DeviceStatus>;
export async function getSessions(id: string, from?: string, to?: string): Promise<Session[]>;
export async function getReadings(id: string, from: string, to: string, resolution: 'raw'|'hour'|'day'): Promise<Reading[]>;
export async function getSchedules(id: string): Promise<Schedule[]>;
export async function createSchedule(id: string, s: Pick<Schedule,'time_local'|'action'|'days_mask'> & Partial<Pick<Schedule,'type'|'enabled'>>): Promise<Schedule>;
export async function updateSchedule(id: string, sid: string, patch: Partial<Pick<Schedule,'time_local'|'action'|'days_mask'|'enabled'>>): Promise<Schedule>;
export async function deleteSchedule(id: string, sid: string): Promise<void>;
export async function getTimers(id: string): Promise<Timer[]>;
export async function createTimer(id: string, action: RelayState, delayMin: number): Promise<Timer>;
export async function cancelTimer(id: string, tid: string): Promise<void>;
export async function getPulse(id: string): Promise<PulseProgram | null>;
export async function startPulse(id: string, p: { on_min: number; off_min: number; cycles?: number; start_at?: string }): Promise<PulseProgram>;
export async function stopPulse(id: string): Promise<void>;
export async function getAlerts(): Promise<Alert[]>;
export async function markAlertRead(id: string): Promise<void>;
export async function markAllAlertsRead(): Promise<void>;
export async function getNotifPrefs(): Promise<NotifPrefs>;
export async function setNotifPrefs(patch: Partial<NotifPrefs>): Promise<NotifPrefs>;
export async function registerPushToken(token: string, platform: 'android'|'ios'): Promise<void>;  // never throws (logs)
export async function getProvisionToken(): Promise<{ token: string; expires_at: string }>;
```
All read token from auth store; on 401 → `useAuthStore.getState().forceLogout()`. 15s timeout via AbortController. Small payloads, no caching client-side.

### src/api/realtime.ts
```ts
type RtEvent =
  | { kind:'hello'; devices: DeviceSummary[] }
  | { kind:'device_state'; device: DeviceSummary }
  | { kind:'reading'; device_id: string; ts: string; current_a: number; power_kw: number; water_flow: boolean }
  | { kind:'alert'; alert: Alert };
export function startRealtime(onEvent: (e: RtEvent) => void): () => void;  // returns stop(); manages backoff reconnect (1s→30s), pauses when logged out
```
Reads token reactively (reconnects after login/logout). Uses global `WebSocket`.

### src/store/auth.ts (zustand)
```ts
interface AuthState {
  status: 'restoring' | 'signedOut' | 'signedIn';
  token: string | null; user: { id: string; email: string } | null;
  restore(): Promise<void>;            // SecureStore 'tritonis.token' + 'tritonis.user'
  signIn(email: string, password: string): Promise<void>;  // throws ApiError
  signOut(): Promise<void>;
  forceLogout(): void;
}
export const useAuthStore: UseBoundStore<StoreApi<AuthState>>;
```
Token persisted in `expo-secure-store`; user JSON in AsyncStorage.

### src/store/devices.ts (zustand)
```ts
interface DevicesState {
  devices: Record<string, DeviceSummary>;   // keyed by id — realtime updates write here
  alerts: Alert[]; unreadCount: number;
  hydrate(devices: DeviceSummary[]): void;
  applyEvent(e: RtEvent): void;             // device_state/reading/hello/alert
  setAlerts(a: Alert[]): void; markRead(id: string): void; markAllRead(): void;
}
export const useDevicesStore: UseBoundStore<StoreApi<DevicesState>>;
```
`reading` events update `current_a/power_kw/water_flow` of the matching device. `alert` prepends, caps list at 100, bumps unreadCount unless already read.

### src/i18n
```ts
export function t(key: string, vars?: Record<string, string | number>): string;
export function useI18n(): { lang: 'en' | 'fr'; setLang(l: 'en' | 'fr'): void };
```
- `src/i18n/en.ts`, `src/i18n/fr.ts` export flat `Record<string,string>`; identical keys; `{{var}}` interpolation; fallback to en then to key.
- Default lang: device locale (fr → fr, else en) on first launch; persisted in AsyncStorage `tritonis.lang`.
- Full key list: see §5. Every screen string must use these keys (add keys to BOTH files).

### src/utils/format.ts
```ts
export const TZ = 'Africa/Tunis';
export function fmtTime(iso: string): string;          // 'HH:MM' in TZ (Intl, hour12:false)
export function fmtDateTime(iso: string): string;      // 'dd MMM, HH:MM' in TZ, locale-aware via i18n lang
export function fmtDate(iso: string): string;          // 'dd MMM yyyy' in TZ
export function fmtA(n: number | null): string;        // '8.4 A' / '—'
export function fmtKw(n: number | null): string;       // '2.31 kW' / '—'
export function fmtKwh(n: number | null): string;      // '12.4 kWh'
export function fmtTnd(n: number | null): string;      // '1.73 TND' (2 decimals)
export function fmtM3(n: number | null): string;       // '3.2 m³'
export function fmtMin(n: number): string;             // '1 h 25 min' / '42 min'
export function weekdayShort(dateIso: string): string; // localized short weekday in TZ
```

### src/utils/days.ts
```ts
export const DAY_BITS = [1,2,4,8,16,32,64];            // Mon..Sun
export function maskToLabel(mask: number): string;     // uses i18n: everyday/weekdays/weekend/custom 'Mon · Wed'
export function toggleDay(mask: number, dayIdx: number): number;  // never allows 0 (returns mask if would be 0)
export const DAY_ORDER = [0,1,2,3,4,5,6];              // Mon-first
```

---

## 3. Navigation & behavior (expo-router)

- `app/_layout.tsx`: Stack. On mount: `useAuthStore.restore()`, then `startRealtime` bound to devices store while signedIn. `status==='restoring'` → splash (cream bg, Logo). signedOut → only `login` reachable; signedIn → `(tabs)`, `device/[id]/*`, `onboarding`.
- `(tabs)/_layout.tsx`: 4 tabs — Home (house icon), Scene (grid icon, placeholder), Messages (bell + unread badge), Profile (person). Use `@expo/vector-icons` Ionicons (bundled with expo). Active tint `colors.primary`, labels via i18n.
- Headers: cream/teal palette, large titles (font.h2). Device routes show back chevron.

### Screen behavior contracts
- **Login** (`app/login.tsx`): Logo centered, email + password fields, copper "Log In" button (loading state). On `ApiError 401` show error banner `login.error`. On success router.replace('/').
- **Home**: header "My Farm" + `+` → `/onboarding`. DeviceCards (live from devices store). Toggle on card → ConfirmDialog (`home.confirmOn/Off`) → `sendCommand`; on 409 show `common.deviceOffline` toast/alert. Pull-to-refresh → `getDevices()` + hydrate. Empty state → EmptyState with CTA to onboarding.
- **Device page**: hero power button (copper when OFF, teal when ON, ≥120dp, confirm dialog), status strip (online, live A, kW, water flow 💧/⚠️/n/a), Today panel, Last session panel, bottom action bar → Schedule / Timer / Pulse (+ Reports icon-button in header). If `!online`: all controls disabled + banner `common.deviceOffline`; show last known values muted.
- **Schedule**: list rows (time big, ON/OFF chip, repeat label, enable switch). `+` → editor modal (time picker wheels or numeric input, action segmented ON/OFF, 7 day chips). Tap row → edit same modal. Delete: long-press → confirm. All via API; list refreshes from server after each mutation.
- **Timer**: segmented "Turn OFF in" / "Turn ON in", minutes input (large), Start → `createTimer`; active timer shown with live countdown (tick 1s from `run_at`), Cancel → `cancelTimer`. Server executes; screen re-reads `getDeviceStatus().active_timer` on focus + realtime.
- **Pulse**: inputs on_min/off_min/cycles (cycles empty = until stopped), optional start delay; Start → `startPulse`; active card shows phase (ON/OFF), cycles_done/cycles, countdown; Stop → `stopPulse`.
- **Messages**: Alert rows: icon+color per type (dry_run/high_load copper-red; offline grey; online green; others teal), device name, message, fmtDateTime. Tap → `/device/[id]` + markAlertRead. Header action "mark all read".
- **Profile**: account email; change password (modal: current/new/confirm → changePassword, localized errors); language selector EN/FR (useI18n); timezone display "Africa/Tunis (UTC+1)" (read-only phase 1); notification toggles (6 switches ← getNotifPrefs/setNotifPrefs); Log out (confirm → signOut → replace('/login')). NO upsell banners.
- **Scene**: placeholder — icon + `scene.placeholder` text.
- **Reports** (`app/device/[id]/reports.tsx`): Day/Week/Month segmented tabs. Bar chart energy kWh per day (+ cost TND labels), line chart current (A) for selected day (resolution hour/raw), water m³ per day bars. Session table rows: start, duration, kWh, m³, cost, tariff period, end reason. Data: getSessions + getReadings.
- **Onboarding** (`app/onboarding.tsx`): BLE provisioning flow — see §4.

Confirmation before EVERY pump ON/OFF (spec safety rule) — via `ConfirmDialog`.

---

## 4. BLE onboarding contract (owner: ble)

- Library `react-native-ble-plx` is installed but **crashes Expo Go if statically imported** → always `require('react-native-ble-plx')` lazily inside try/catch. If unavailable → friendly screen `ble.devBuildRequired` with steps.
- Flow states: `intro → scanning → found(list) → connecting → wifi-form → provisioning → waiting → success | error`.
- Scan for name prefix `TRITONIS-`. On select: connect, use **Improv over BLE** (service `00467768-6228-2272-4663-277478268000`; write WiFi SSID/password + backend URL + provisioning token from `getProvisionToken()` per Improv RPC; parse error states). Keep implementation isolated in `src/ble/provisioning.ts`:
```ts
export type ProvState = 'idle'|'scanning'|'connecting'|'writing'|'waiting'|'success'|'error';
export interface ProvDevice { id: string; name: string; rssi: number | null }
export interface ProvisioningHandle {
  scan(cb: (d: ProvDevice[]) => void): void;
  provision(deviceId: string, wifi: { ssid: string; password: string }, backendUrl: string, provToken: string,
            onState: (s: ProvState, errCode?: string) => void): Promise<void>;
  cancel(): void;
}
export function createProvisioning(): ProvisioningHandle;  // throws if BLE native module missing
```
- Error mapping: wrong wifi password → `ble.errWifi`, timeout(60s) → `ble.errTimeout`, no internet → `ble.errInternet`, generic → `ble.errGeneric`; all show retry.
- Success → `router.back()`; Home pull-refresh shows device (simulator: provision/confirm stub accepted).

---

## 5. i18n keys (en values; core creates fr equivalents)

```
common.ok=OK  common.cancel=Cancel  common.save=Save  common.delete=Delete  common.retry=Try again
common.confirm=Confirm  common.close=Close  common.loading=Loading…  common.deviceOffline=Device offline
common.offlineMsg=This device is offline. Showing last known state.
common.on=ON  common.off=OFF  common.enabled=Enabled  common.disabled=Disabled
tabs.home=Home  tabs.scene=Scene  tabs.messages=Messages  tabs.profile=Profile
login.title=Tritonis  login.subtitle=Smart Remote Irrigation  login.email=Email  login.password=Password
login.button=Log In  login.error=Wrong email or password.  login.network=Cannot reach server. Check connection.
home.myFarm=My Farm  home.addDevice=Add device  home.emptyTitle=No devices yet
home.emptyBody=Add your first pump controller to get started.  home.emptyCta=Add your first device
home.confirmOnTitle=Start the pump now?  home.confirmOffTitle=Stop the pump now?
home.confirmOnBody=Water will start flowing to your field.  home.confirmOffBody=Irrigation will stop.
home.lastSeen=Last seen {{time}}
device.status=Status  device.online=Online  device.offline=Offline
device.current=Current  device.power=Power  device.waterFlowing=💧 Water flowing
device.noWater=⚠️ No water detected  device.sensorNa=Sensor n/a
device.today=Today  device.energy=Energy  device.cost=Cost  device.water=Water  device.runtime=Runtime  device.sessions=Sessions
device.lastSession=Last session  device.duration=Duration  device.avgCurrent=Avg current
device.minCurrent=Min  device.maxCurrent=Max  device.volume=Water volume  device.endReason=Ended by
device.rename=Rename device  device.renamePlaceholder=Device name
device.schedule=Schedule  device.timer=Timer  device.pulse=Pulse  device.reports=Reports
endReason.manual=Manual  endReason.schedule=Schedule  endReason.timer=Timer  endReason.pulse=Pulse program
endReason.dry_run=Dry-run protection  endReason.high_load=High-load protection  endReason.running=Still running
schedule.title=Schedule  schedule.empty=No schedules yet  schedule.add=Add schedule  schedule.edit=Edit schedule
schedule.time=Time  schedule.action=Action  schedule.repeat=Repeat  schedule.deleteTitle=Delete this schedule?
schedule.turnOn=Turn ON  schedule.turnOff=Turn OFF
days.everyday=Everyday  days.weekdays=Weekdays  days.weekend=Weekend
days.mon=Mon days.tue=Tue days.wed=Wed days.thu=Thu days.fri=Fri days.sat=Sat days.sun=Sun
timer.title=Timer  timer.turnOffIn=Turn OFF in  timer.turnOnIn=Turn ON in  timer.minutes=Minutes
timer.start=Start timer  timer.cancel=Cancel timer  timer.activeOff=Pump will turn OFF in {{time}}
timer.activeOn=Pump will turn ON in {{time}}
pulse.title=Pulse program  pulse.onFor=ON for (min)  pulse.offFor=OFF for (min)  pulse.cycles=Cycles
pulse.cyclesHint=Leave empty to run until stopped  pulse.startDelay=Start delay (min, optional)
pulse.start=Start program  pulse.stop=Stop program  pulse.running=Program running
pulse.phaseOn=Phase: ON ({{left}} left)  pulse.phaseOff=Phase: OFF ({{left}} left)
pulse.cycleOf=Cycle {{done}} of {{total}}
messages.title=Messages  messages.empty=No messages yet  messages.markAll=Mark all read
alert.offline=Device offline  alert.online=Device back online  alert.dry_run=Dry run — pump stopped
alert.high_load=Abnormal load  alert.unexpected_stop=Pump stopped unexpectedly
alert.schedule_executed=Schedule executed  alert.power_failure=Possible power cut
profile.title=Profile  profile.account=Account  profile.changePassword=Change password
profile.currentPassword=Current password  profile.newPassword=New password  profile.confirmPassword=Repeat new password
profile.passwordChanged=Password changed  profile.wrongPassword=Current password is wrong
profile.weakPassword=Use at least 8 characters  profile.passwordMismatch=Passwords do not match
profile.language=Language  profile.timezone=Time zone
profile.notifications=Notifications  profile.notifOffline=Device offline  profile.notifOnline=Device back online
profile.notifDryRun=Dry-run alerts  profile.notifHighLoad=High-load alerts
profile.notifUnexpected=Unexpected stop  profile.notifSchedule=Schedule executions
profile.logout=Log out  profile.logoutConfirm=Log out of Tritonis?
scene.title=Scene  scene.placeholder=Scenes are coming in a later phase.
reports.title=Reports  reports.day=Day  reports.week=Week  reports.month=Month
reports.energy=Energy (kWh)  reports.cost=Cost (TND)  reports.water=Water (m³)  reports.current=Current (A)
reports.sessions=Sessions  reports.noData=No data for this period
reports.colStart=Start  reports.colDur=Duration  reports.colEnd=End reason
onboarding.title=Add device  onboarding.step1=Power the device and hold its button until the LED blinks.
onboarding.scanning=Looking for devices…  onboarding.select=Select your device
onboarding.wifiTitle=Farm WiFi  onboarding.ssid=WiFi name (SSID)  onboarding.wifiPassword=WiFi password
onboarding.connect=Connect device  onboarding.waiting=Setting up your device…
onboarding.success=Device added!  onboarding.done=Done
ble.devBuildRequired=Bluetooth setup needs a development build of the app. In Expo Go this step is unavailable.
ble.errWifi=The device could not join that WiFi. Check the password and try again.
ble.errTimeout=Setup timed out. Please try again.  ble.errInternet=The device has no internet access.
ble.errGeneric=Something went wrong. Please try again.  ble.permission=Bluetooth permission is needed to find your device.
```

---

## 6. Backend internals (owner: backend)

- Node 20, plain ESM JS (`"type":"module"`). Deps preinstalled: express, ws, better-sqlite3, jsonwebtoken, bcryptjs, cors. No build step. Start: `node src/index.js`, port 4000.
- `db.js`: better-sqlite3, file `server/data/tritonis.db`, schema = spec §7 (User, Device, Schedule, Timer, PulseProgram, Session, Reading, Alert, PushToken, NotifPrefs columns on User or separate table — implementer's choice, but API shape fixed). Seed on first run: user farmer@tritonis.tn (bcrypt hash of `tritonis2026`), device dev-pump-1 "Pump 1".
- `auth.js`: login (bcrypt compare), JWT sign/verify (secret from env `JWT_SECRET` default dev value, documented), middleware.
- `simulator.js`: replaces MQTT/ESP32 for dev. Emulates the §3 topic semantics in-process:
  - Heartbeat: device online; `last_seen_at` refreshed every 30s. Watchdog: offline if no simulated heartbeat for 90s OR env `SIM_OFFLINE=1` toggles offline. `SIM_DELAY_MS` optional.
  - When relay ON: every 2s emit reading — current ~8.5A ±0.6 noise, power = A×230/1000 kW, water_flow true. Env `SIM_DRY_RUN=1` → 20s after start: water_flow false, after 10 more s → auto OFF + `dry_run` alert + session end_reason dry_run. `SIM_HIGH_LOAD=1` → current spikes >12A → `high_load` alert + auto OFF.
  - PUMP_START/STOP → open/close Session; accumulate energy_wh, avg/min/max A, water_m3 = flow_rate 4.5 L/s × duration / 1000 (only when water_flow), cost via tariffs.
  - Offline → alert `offline` (once per 10 min debounce); back online → alert `online`. If goes offline while relay was ON → also `power_failure` hint alert.
- `scheduler.js`: tick every 15s (Africa/Tunis local): due schedules (match HH:MM + days_mask, fire once per minute), timers (run_at reached → command + disable), pulse programs (phase machine, cycles). Schedule executions → `schedule_executed` alert only if user pref on. Unexpected stop detection: relay OFF while a schedule window expected ON → `unexpected_stop` alert.
- `ws.js`: `/ws?token=` JWT-verified; broadcast hello + device_state + reading + alert.
- `tariffs.js` + `config/tariffs.json`: STEG periods off-peak 23:00–08:00 0.116, standard 08:00–18:00 0.140, peak 18:00–23:00 0.391 TND/kWh — editable JSON, reloaded on boot. Cost splits sessions across periods (`mixed` when spanning).
- `push.js`: register/list tokens; `sendPush(userId, title, body, data)` — logs to console now; clearly marked FCM integration point. Respect NotifPrefs + 10-min offline debounce.
- README section: how to run, env vars, how to point at the real MQTT backend later (`MQTT_URL` stub adapter file `mqtt-bridge.js` may be added as a thin optional module — optional).

---

## 7. Acceptance mapping (spec §13)

Every implemented feature must satisfy spec §13 items 1–8, 10 (item 9 BLE: code-complete, runtime-verifiable only on a dev build with real hardware — document this). `npx tsc --noEmit` must pass with 0 errors across app code. Backend: `node src/index.js` boots, login + devices + command + WS verified by smoke script `server/scripts/smoke.js` (run with node, asserts §1 contract end-to-end and prints PASS/FAIL per check).
