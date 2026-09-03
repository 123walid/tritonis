# Tritonis dev backend + ESP32 simulator

Development backend for the Tritonis smart-irrigation app. Plain ESM JavaScript, Node 20, no build step.
Implements the full HTTP/WebSocket contract from `../SPEC.md` §1 and replaces the real
ESP32/MQTT hardware with an in-process simulator, so the mobile app is testable end-to-end.

## Run

```bash
npm install          # once (express, ws, better-sqlite3, jsonwebtoken, bcryptjs, cors)
npm start            # = node src/index.js → http://0.0.0.0:4000  (WS: ws://0.0.0.0:4000/ws)
npm run smoke        # end-to-end contract test on port 4100 (must print SMOKE: PASS)
```

Seeded account: **farmer@tritonis.tn / tritonis2026**. Seeded device: `dev-pump-1` ("Pump 1", mqtt_prefix `farm/pump`).

## Device claiming & ownership

Devices are per-user: `GET /devices` and every device-scoped route (status,
sessions, readings, schedules, timers, pulse, command) only see devices whose
`user_id` matches the JWT user; unclaimed or other-user devices answer
`404 { error: 'not_found' }`. WS `hello`/`device_state`/`reading`/`alert`
messages are likewise filtered per connection owner.

When the MQTT bridge sees a message from an unknown `farm/<key>` prefix it
**auto-registers** the device as unclaimed: id `dev-<key>` (key sanitized to
lowercase alnum/dash; a collision with a different `mqtt_prefix` is logged and
ignored), name `Pump <key>`, `user_id = NULL`. Unclaimed devices are invisible
to users until claimed:

```
POST /api/v1/devices/claim   { device_id, name? }
  → 200 DeviceSummary            (device unclaimed or already yours; name 1–40 chars optional)
  → 403 { error: 'already_claimed' }   (owned by another account)
  → 404 { error: 'device_not_found' }  (no device with this ID has connected yet)
```

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `4000` | HTTP + WebSocket port |
| `JWT_SECRET` | `tritonis-dev-secret-change-me` | JWT signing secret. **Dev default — always set in production.** |
| `DB_PATH` | `server/data/tritonis.db` | SQLite file location. If the default path is on a filesystem that SQLite cannot use (some network/overlay mounts → `disk I/O error`), the server logs a warning and falls back to `$TMPDIR/tritonis-data/tritonis.db`. |
| `SIM_OFFLINE` | — | `1` = simulated device is offline at boot (commands → 409, `offline` alert). At runtime, send `kill -USR1 <pid>` to toggle offline/online — dropping offline while the pump is ON also raises the `power_failure` hint. |
| `SIM_DRY_RUN` | — | `1` = 20 s after pump start `water_flow` goes false; 10 s later the pump auto-stops with a `dry_run` alert and session `end_reason=dry_run`. |
| `SIM_HIGH_LOAD` | — | `1` = ~6 s after start the current spikes >12 A → `high_load` alert + auto OFF (`end_reason=high_load`). |
| `SIM_UNEXPECTED_STOP` | — | `1` = 15 s after start the relay silently drops OFF (no command path) → scheduler raises `unexpected_stop` if a schedule window expected ON. |
| `SIM_DELAY_MS` | `0` | artificial latency applied to command execution |
| `DEVICE_DRIVER` | `sim` | `sim` = in-process ESP32 simulator (default). `mqtt` = real ESP32 controllers via MQTT broker (see below). |
| `MQTT_URL` | `mqtt://45.94.209.43:1883` | broker URL used when `DEVICE_DRIVER=mqtt` |
| `MQTT_USERNAME` | — | optional broker username |
| `MQTT_PASSWORD` | — | optional broker password |

## Architecture

```
src/
  index.js      express app + http server + ws setup + driver/scheduler start
  db.js         better-sqlite3 schema (spec §7) + seed + row→API serializers
  auth.js       bcrypt login, JWT sign/verify (24 h), requireAuth middleware
  driver.js     picks the device driver from DEVICE_DRIVER (sim | mqtt)
  ingest.js     shared ingest path for both drivers: runtime state, sessions
                (energy/cost/tariff accumulation), reading rows + WS broadcast,
                online/offline transitions + alerts, 90 s offline watchdog
  simulator.js  `sim` driver: fake telemetry generator (2 s readings, scenarios)
  mqtt-bridge.js `mqtt` driver: real ESP32 via MQTT broker (see below)
  scheduler.js  15 s tick (Africa/Tunis): schedules, timers, pulse phase machine,
                schedule_executed alerts (pref-gated), unexpected-stop detection
  tariffs.js    STEG tariff periods, per-segment session cost (mixed when spanning)
  alerts.js     alert rows + WS fan-out + push dispatch (with debounce)
  push.js       FCM token registry + sendPush() stub (integration point marked)
  ws.js         /ws?token= — hello, device_state, reading, alert
  routes/       auth, devices, schedules, timers, pulse, alerts, settings(push/provision)
config/tariffs.json   STEG tariff, editable, loaded at boot
scripts/smoke.js      end-to-end contract test (node scripts/smoke.js [--dry-run])
scripts/mqtt-smoke.js MQTT-driver test: embedded aedes broker + fake ESP32 client
```

## Real ESP32 hardware (DEVICE_DRIVER=mqtt)

`src/mqtt-bridge.js` is a full driver for real ESP32 pump controllers running
ESPHome firmware. Flip to it with:

```bash
DEVICE_DRIVER=mqtt MQTT_URL=mqtt://<broker-host>:1883 npm start
# optional: MQTT_USERNAME / MQTT_PASSWORD
```

The bridge subscribes to `farm/+` topics and resolves each device by its
`mqtt_prefix` column (seeded device: `farm/pump`; unknown prefixes are
auto-registered as unclaimed devices — see "Device claiming" above):

| ESP32 MQTT topic (`<prefix>` = `farm/<key>`) | Bridge behavior |
|---|---|
| `<prefix>/status` (`online`/`offline`, birth + LWT) | online/offline transitions + alerts; LWT marks offline immediately |
| `<prefix>/switch/water_pump/state` (`ON`/`OFF`, retained) | opens/closes the Session (energy, cost, tariff) + `device_state` broadcast |
| `<prefix>/switch/water_pump/command` | commands from the app are published here (qos 1) |
| `<prefix>/sensor/pump_current/state` (amps) | combined with latest power/flow into a Reading |
| `<prefix>/sensor/pump_power/state` (kW) | (if absent, kW is derived as A × 230 / 1000) |
| `<prefix>/binary_sensor/water_flow_detected/state` | water_flow flag on readings |
| `<prefix>/events` (`PUMP_START`/`PUMP_STOP`) | logged; switch state topic stays authoritative |
| `<prefix>/alarms` (`DRY_RUN_DETECTED`/`HIGH_LOAD_DETECTED`) | `dry_run`/`high_load` alert + pump stopped (`end_reason` set) |

Semantics match the simulator: any message counts as a heartbeat
(`last_seen_at`, 90 s watchdog as backstop to the LWT), readings are stored and
broadcast at most once per 2 s per device and only while the relay is ON, and
`POST /devices/:id/command` returns `202` on publish / `409 device_offline`
when the device is offline. Reconnects use exponential backoff (1 s → 30 s cap).

### Deployment note (VPS)

Host this backend on the same VPS as the MQTT broker (e.g. Mosquitto on
`45.94.209.43:1883`) so the bridge talks to the broker over localhost:

```bash
cd server && npm install
DEVICE_DRIVER=mqtt MQTT_URL=mqtt://127.0.0.1:1883 \
JWT_SECRET=<strong-secret> PORT=4000 node src/index.js
```

Put it under systemd/pm2 for auto-restart, keep port 4000 behind your reverse
proxy, and open 1883 on the VPS only for the ESP32 devices (use
`MQTT_USERNAME`/`MQTT_PASSWORD` on the broker — do not expose an anonymous
broker to the internet).

`scripts/mqtt-smoke.js` verifies this whole path without hardware: it starts an
embedded `aedes` broker, boots the server with `DEVICE_DRIVER=mqtt`, plays a
fake ESP32 (birth, switch state, current/power, alarms) and asserts the REST/WS
contract — must print `MQTT-SMOKE: PASS`.

## Notes

- All schedule times are `HH:MM` in **Africa/Tunis**; the scheduler matches against Tunis local wall-clock (fixed UTC+1, no DST).
- Session energy is tracked as timestamped segments, so a session spanning a tariff boundary is billed per period and marked `tariff_period='mixed'`.
- `offline` alerts are debounced to one per 10 min per device; push dispatch additionally respects per-user notification prefs and a 10-min per-type debounce.
- The DB seeds idempotently; open sessions left by a crashed process are closed at boot.
