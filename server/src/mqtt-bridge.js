// MQTT device driver (DEVICE_DRIVER=mqtt) — talks to REAL ESP32 pump
// controllers (ESPHome firmware) through an MQTT broker.
//
// Topic layout (per-device prefix = devices.mqtt_prefix, e.g. "farm/pump"):
//   <prefix>/status                               online|offline (birth + LWT)
//   <prefix>/switch/water_pump/state              ON|OFF (retained relay state)
//   <prefix>/switch/water_pump/command            publish ON|OFF to control
//   <prefix>/sensor/pump_current/state            amps (plain float)
//   <prefix>/sensor/pump_power/state              kW (plain float)
//   <prefix>/binary_sensor/water_flow_detected/state  ON|OFF
//   <prefix>/events                               PUMP_START|PUMP_STOP (info)
//   <prefix>/alarms                               DRY_RUN_DETECTED|HIGH_LOAD_DETECTED
//
// All signals are fed into the shared ingest path (ingest.js), so sessions,
// readings, tariffs, alerts and the REST/WS contract behave exactly as with
// the simulator.
import mqtt from 'mqtt';
import { db } from './db.js';
import { createAlert } from './alerts.js';
import {
  VOLTAGE_V, loadRuntime, getRelay, isOnline,
  startPump, stopPump, silentDrop, ingestReading,
  goOffline, goOnline, noteHeartbeat, tickWatchdog,
} from './ingest.js';
import { nowIso } from './util.js';

const MQTT_URL = process.env.MQTT_URL || 'mqtt://45.94.209.43:1883';
const READING_THROTTLE_MS = 2000;   // ≤1 stored+broadcast reading per device per 2s
const PENDING_COMMAND_MS = 30000;   // attribute a relay change to our command within this window
const SUBSCRIPTIONS = [
  'farm/+/status',
  'farm/+/switch/+/state',
  'farm/+/sensor/+/state',
  'farm/+/binary_sensor/+/state',
  'farm/+/events',
  'farm/+/alarms',
];

let client = null;
let watchdogTimer = null;
let reconnectTimer = null;
let reconnectDelayMs = 1000;
let stopping = false;

// prefix → device row cache; unknown prefixes logged once.
const byPrefix = new Map();
const unknownLogged = new Set();

// per-device driver state: latest known sensor values + reading throttle
const st = new Map();
function devState(deviceId) {
  let s = st.get(deviceId);
  if (!s) {
    s = { currentA: null, powerKw: null, waterFlow: null, lastReadingAt: 0, pendingCommand: null };
    st.set(deviceId, s);
  }
  return s;
}

function refreshDevices() {
  byPrefix.clear();
  for (const d of db.prepare('SELECT id, name, mqtt_prefix FROM devices').all()) {
    byPrefix.set(d.mqtt_prefix, d);
  }
}

function deviceForTopic(topic) {
  // topics look like farm/<key>/<rest…>; mqtt_prefix is "farm/<key>"
  const parts = topic.split('/');
  if (parts.length < 3 || parts[0] !== 'farm') return null;
  const prefix = `${parts[0]}/${parts[1]}`;
  let dev = byPrefix.get(prefix);
  if (!dev) { // cache miss → DB lookup (covers devices added after boot)
    dev = db.prepare('SELECT id, name, mqtt_prefix FROM devices WHERE mqtt_prefix = ?').get(prefix);
    if (dev) byPrefix.set(prefix, dev);
  }
  if (!dev) dev = autoRegister(prefix, parts[1]); // unknown prefix → unclaimed device row
  return dev || null;
}

// A real ESP32 phones home from farm/<key> before anyone claimed it → create
// the device row (user_id NULL = unclaimed) so it is claimable via the API.
function autoRegister(prefix, rawKey) {
  const key = String(rawKey).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  if (!key) {
    if (!unknownLogged.has(prefix)) {
      unknownLogged.add(prefix);
      console.log(`[mqtt] ignoring topics for unusable prefix "${prefix}" (key not sanitizable)`);
    }
    return null;
  }
  const id = `dev-${key}`;
  const byId = db.prepare('SELECT id, name, mqtt_prefix FROM devices WHERE id = ?').get(id);
  if (byId && byId.mqtt_prefix !== prefix) {
    if (!unknownLogged.has(prefix)) {
      unknownLogged.add(prefix);
      console.log(`[mqtt] prefix "${prefix}" collides with ${byId.id} (mqtt_prefix ${byId.mqtt_prefix}) — ignoring`);
    }
    return null;
  }
  let dev = byId;
  if (!dev) {
    db.prepare(`INSERT INTO devices (id, user_id, name, mqtt_prefix, relay, online, last_seen_at)
                VALUES (?, NULL, ?, ?, 'OFF', 1, ?)`)
      .run(id, `Pump ${key}`, prefix, nowIso());
    console.log(`[mqtt] auto-registered unclaimed device ${id}`);
    dev = db.prepare('SELECT id, name, mqtt_prefix FROM devices WHERE id = ?').get(id);
  }
  byPrefix.set(prefix, dev);
  return dev;
}

// ---- command path (REST/scheduler → driver) ----------------------------------
export function command(deviceId, action, source = 'manual') {
  loadRuntime(deviceId);
  if (!isOnline(deviceId)) return { ok: false, offline: true };
  const dev = db.prepare('SELECT mqtt_prefix FROM devices WHERE id = ?').get(deviceId);
  if (!dev) return { ok: false, offline: false };
  if (!client || !client.connected) {
    console.error(`[mqtt] command ${action} for ${deviceId}: broker not connected`);
    return { ok: false, offline: true }; // safest equivalent: device unreachable
  }
  // Attribute the relay state echo back to this command when it arrives.
  devState(deviceId).pendingCommand = { action, source, at: Date.now() };
  client.publish(`${dev.mqtt_prefix}/switch/water_pump/command`, action, { qos: 1 }, (err) => {
    if (err) console.error(`[mqtt] publish command ${action} for ${deviceId} failed:`, err.message);
    else console.log(`[mqtt] ${deviceId} ← command ${action} (source=${source})`);
  });
  return { ok: true }; // 202 semantics: accepted; relay change confirmed via state topic
}

// ---- inbound messages ---------------------------------------------------------
function onMessage(topic, payloadBuf) {
  const payload = payloadBuf.toString().trim();
  const dev = deviceForTopic(topic);
  if (!dev) return;
  const deviceId = dev.id;
  loadRuntime(deviceId);

  // Any message is a heartbeat (watchdog backstop in case the LWT is missed).
  noteHeartbeat(deviceId);
  if (!isOnline(deviceId)) {
    // A live message implies the device is up even if we missed its birth.
    goOnline(deviceId);
  }

  const rest = topic.split('/').slice(2); // after "farm/<key>/"
  if (rest[0] === 'status') return onStatus(deviceId, payload);
  if (rest[0] === 'switch' && rest[2] === 'state') return onSwitchState(deviceId, payload);
  if (rest[0] === 'sensor' && rest[2] === 'state') return onSensor(deviceId, rest[1], payload);
  if (rest[0] === 'binary_sensor' && rest[2] === 'state') return onBinarySensor(deviceId, rest[1], payload);
  if (rest[0] === 'events') return onEvent(deviceId, payload);
  if (rest[0] === 'alarms') return onAlarm(deviceId, payload);
}

function onStatus(deviceId, payload) {
  if (payload === 'online') {
    if (!isOnline(deviceId)) goOnline(deviceId); // noteHeartbeat already refreshed last_seen_at
  } else if (payload === 'offline') {
    if (isOnline(deviceId)) goOffline(deviceId); // LWT: mark offline immediately
  }
}

function onSwitchState(deviceId, payload) {
  if (payload !== 'ON' && payload !== 'OFF') return;
  const s = devState(deviceId);
  const pending = s.pendingCommand;
  s.pendingCommand = null;
  const attributed = pending && pending.action === payload && (Date.now() - pending.at) < PENDING_COMMAND_MS
    ? pending.source : null;

  const current = getRelay(deviceId);
  if (payload === current) return;
  if (payload === 'ON') {
    startPump(deviceId, attributed ?? 'unknown'); // physical/uncommanded start
  } else if (attributed) {
    stopPump(deviceId, attributed);
  } else {
    silentDrop(deviceId); // uncommanded stop → end_reason NULL; scheduler may flag unexpected_stop
  }
}

function onSensor(deviceId, name, payload) {
  const value = parseFloat(payload);
  if (Number.isNaN(value)) return;
  const s = devState(deviceId);
  if (name === 'pump_current') s.currentA = value;
  else if (name === 'pump_power') s.powerKw = value;
  else return; // other sensors: heartbeat only
  maybeReading(deviceId);
}

function onBinarySensor(deviceId, name, payload) {
  if (name !== 'water_flow_detected') return;
  devState(deviceId).waterFlow = payload === 'ON';
  maybeReading(deviceId);
}

function onEvent(deviceId, payload) {
  // Informational: relay state topic is authoritative for sessions.
  if (payload === 'PUMP_START' || payload === 'PUMP_STOP') {
    console.log(`[mqtt] ${deviceId} event ${payload}`);
  }
}

function onAlarm(deviceId, payload) {
  if (payload === 'DRY_RUN_DETECTED') {
    const r = loadRuntime(deviceId);
    if (r.session?.dryRunAlerted) return;
    if (r.session) r.session.dryRunAlerted = true;
    createAlert(deviceId, 'dry_run', 'Dry run detected by device — pump stopped (dry-run protection)');
    if (getRelay(deviceId) === 'ON') stopPump(deviceId, 'dry_run');
    console.log(`[mqtt] ${deviceId} alarm DRY_RUN_DETECTED`);
  } else if (payload === 'HIGH_LOAD_DETECTED') {
    const r = loadRuntime(deviceId);
    if (r.session?.highLoadAlerted) return;
    if (r.session) r.session.highLoadAlerted = true;
    createAlert(deviceId, 'high_load', 'Abnormal load detected by device — pump stopped');
    if (getRelay(deviceId) === 'ON') stopPump(deviceId, 'high_load');
    console.log(`[mqtt] ${deviceId} alarm HIGH_LOAD_DETECTED`);
  }
}

// Combine latest known sensor values into one Reading — throttled to ≤1 per
// 2s per device, and only while the relay is ON (matches simulator semantics).
function maybeReading(deviceId) {
  if (getRelay(deviceId) !== 'ON') return;
  const r = loadRuntime(deviceId);
  if (!r.session) return;
  const s = devState(deviceId);
  const now = Date.now();
  if (now - s.lastReadingAt < READING_THROTTLE_MS) return;
  if (s.currentA == null) return; // need at least amps
  s.lastReadingAt = now;
  const powerKw = s.powerKw ?? (s.currentA * VOLTAGE_V) / 1000;
  ingestReading(r, s.currentA, powerKw, s.waterFlow ?? false, now);
}

// ---- lifecycle ------------------------------------------------------------------
function connect() {
  const opts = {
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    reconnectPeriod: 0, // manual backoff below
  };
  client = mqtt.connect(MQTT_URL, opts);

  client.on('connect', () => {
    reconnectDelayMs = 1000;
    console.log(`[mqtt] connected to ${MQTT_URL}`);
    client.subscribe(SUBSCRIPTIONS, { qos: 1 }, (err) => {
      if (err) console.error('[mqtt] subscribe failed:', err.message);
      else console.log(`[mqtt] subscribed: ${SUBSCRIPTIONS.join(', ')}`);
    });
  });
  client.on('message', onMessage);
  client.on('close', () => {
    if (stopping) return;
    console.warn(`[mqtt] disconnected from broker — reconnecting in ${reconnectDelayMs}ms`);
    scheduleReconnect();
  });
  client.on('error', (err) => {
    console.error('[mqtt] broker error:', err.message);
    // 'close' follows and handles the reconnect.
  });
}

function scheduleReconnect() {
  if (reconnectTimer || stopping) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30000); // 1s → 30s cap
    try { client.reconnect(); } catch (err) { console.error('[mqtt] reconnect failed:', err.message); scheduleReconnect(); }
  }, reconnectDelayMs);
  reconnectTimer.unref?.();
}

export function startDriver() {
  for (const d of db.prepare('SELECT id FROM devices').all()) loadRuntime(d.id);
  refreshDevices();
  // Same crash-recovery assumption as the simulator: relay unknown → OFF;
  // device gets a 90s watchdog grace period to prove it is alive (retained
  // status/relay messages usually arrive within a second of subscribing).
  db.prepare(`UPDATE devices SET relay='OFF', current_a=NULL, power_kw=NULL, water_flow=NULL, online=1, last_seen_at=?`).run(nowIso());
  connect();
  watchdogTimer = setInterval(tickWatchdog, 15000);
  watchdogTimer.unref?.();
  console.log(`[mqtt] bridge started (broker ${MQTT_URL}, watchdog 90s)`);
}

export function stopDriver() {
  stopping = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (watchdogTimer) clearInterval(watchdogTimer);
  reconnectTimer = null;
  watchdogTimer = null;
  if (client) client.end(true);
  client = null;
}
