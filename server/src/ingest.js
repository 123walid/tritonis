// Shared device-ingest path — used by BOTH device drivers:
//   - simulator.js    (DEVICE_DRIVER=sim, default: generates fake telemetry in-process)
//   - mqtt-bridge.js  (DEVICE_DRIVER=mqtt: real ESP32 via MQTT broker)
//
// Everything below is driver-agnostic: runtime state, session open/close with
// energy/cost/tariff accumulation, reading rows + WS broadcasts, online/offline
// transitions with alerts, and the offline watchdog. Drivers only produce the
// raw signals (relay state, current/power/flow values, heartbeats, alarms).
import { db, toDeviceSummary } from './db.js';
import { bus } from './bus.js';
import { createAlert } from './alerts.js';
import { costSegments, round3 } from './tariffs.js';
import { newId, nowIso } from './util.js';

export const VOLTAGE_V = 230;   // used to derive kW when a driver has amps only
export const FLOW_LPS = 4.5;    // water flow rate while water_flow is true
export const WATCHDOG_MS = 90000; // no heartbeat for 90s → offline
const OFFLINE_ALERT_DEBOUNCE_MS = 10 * 60 * 1000;
const LAST_SEEN_PERSIST_MS = 5000; // throttle last_seen_at writes on chatty drivers

/** runtime per device */
const rt = new Map();

export function loadRuntime(deviceId) {
  let r = rt.get(deviceId);
  if (!r) {
    r = {
      id: deviceId,
      lastHeartbeatAt: Date.now(),
      lastSeenPersistedAt: 0,
      lastChangeSource: null,   // manual|schedule|timer|pulse|dry_run|high_load|power_failure|unknown
      pulseControlsRelay: false,
      session: null,            // live session accumulator (see startSession)
    };
    rt.set(deviceId, r);
  }
  return r;
}

export function getLive(deviceId) {
  return loadRuntime(deviceId);
}

// All known device runtimes (drivers iterate these for their tick loops).
export function allRuntimes() {
  return rt.values();
}

export function getRelay(deviceId) {
  return db.prepare('SELECT relay FROM devices WHERE id = ?').get(deviceId)?.relay ?? 'OFF';
}

export function isOnline(deviceId) {
  return !!db.prepare('SELECT online FROM devices WHERE id = ?').get(deviceId)?.online;
}

export function deviceSummary(deviceId) {
  const row = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  return row ? toDeviceSummary(row) : null;
}

// userId given → only devices owned by that user; null → all (internal use).
export function listSummaries(userId = null) {
  if (userId) {
    return db.prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY name').all(userId).map(toDeviceSummary);
  }
  return db.prepare('SELECT * FROM devices ORDER BY name').all().map(toDeviceSummary);
}

function persist(deviceId, patch) {
  const sets = Object.keys(patch).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE devices SET ${sets} WHERE id = @__id`).run({ ...patch, __id: deviceId });
}

function emitState(deviceId) {
  bus.emit('device_state', deviceSummary(deviceId));
}

// Any sign of life from the device (driver-specific: sim heartbeat tick, any
// MQTT message). Refreshes the watchdog timer; DB write throttled.
export function noteHeartbeat(deviceId) {
  const r = loadRuntime(deviceId);
  r.lastHeartbeatAt = Date.now();
  if (r.lastHeartbeatAt - r.lastSeenPersistedAt >= LAST_SEEN_PERSIST_MS || r.lastSeenPersistedAt === 0) {
    r.lastSeenPersistedAt = r.lastHeartbeatAt;
    persist(deviceId, { last_seen_at: nowIso() });
  }
}

// ---- relay state changes (PUMP_START/STOP → Session rows) ------------------
export function startPump(deviceId, source) {
  const r = loadRuntime(deviceId);
  if (getRelay(deviceId) === 'ON') return;
  r.lastChangeSource = source;
  startSession(r);
  persist(deviceId, { relay: 'ON', last_seen_at: nowIso() });
  emitState(deviceId);
  console.log(`[ingest] ${deviceId} PUMP_START (source=${source})`);
}

export function stopPump(deviceId, source) {
  const r = loadRuntime(deviceId);
  if (getRelay(deviceId) !== 'ON') return;
  r.lastChangeSource = source;
  if (source !== 'pulse') r.pulseControlsRelay = false;
  stopSession(r, source);
  persist(deviceId, { relay: 'OFF', current_a: null, power_kw: null, water_flow: null, last_seen_at: nowIso() });
  emitState(deviceId);
  console.log(`[ingest] ${deviceId} PUMP_STOP (source=${source})`);
}

// Silent relay drop (hardware fault / power cut side effect / uncommanded stop
// reported by the device) — no command path, end_reason stays NULL so the
// scheduler's unexpected-stop detector can fire.
export function silentDrop(deviceId) {
  const r = loadRuntime(deviceId);
  r.lastChangeSource = 'unknown';
  stopSession(r, null);
  persist(deviceId, { relay: 'OFF', current_a: null, power_kw: null, water_flow: null });
  emitState(deviceId);
  console.log(`[ingest] ${deviceId} relay dropped unexpectedly`);
}

// ---- sessions ----------------------------------------------------------------
function startSession(r) {
  const now = Date.now();
  r.session = {
    id: newId(),
    startedAtMs: now,
    lastTickMs: now,
    segments: [],          // [{ts, kwh}] timestamped energy for tariff splitting
    sumA: 0, countA: 0, minA: null, maxA: null,
    energy_wh: 0, water_m3: 0,
    dryRunAlerted: false, highLoadAlerted: false, stopped: false,
  };
  db.prepare('INSERT INTO sessions (id, device_id, started_at) VALUES (?, ?, ?)')
    .run(r.session.id, r.id, new Date(now).toISOString());
}

export function stopSession(r, endReason) {
  const s = r.session;
  if (!s || s.stopped) return;
  s.stopped = true;
  const endedMs = Date.now();
  const { cost_tnd, tariff_period } = costSegments(s.segments, new Date(s.startedAtMs));
  db.prepare(`UPDATE sessions SET ended_at=?, duration_s=?, energy_wh=?, avg_a=?, min_a=?, max_a=?,
              water_m3=?, cost_tnd=?, tariff_period=?, end_reason=? WHERE id=?`)
    .run(
      new Date(endedMs).toISOString(),
      Math.max(0, Math.round((endedMs - s.startedAtMs) / 1000)),
      round3(s.energy_wh),
      s.countA ? round3(s.sumA / s.countA) : null,
      s.minA == null ? null : round3(s.minA), s.maxA == null ? null : round3(s.maxA),
      round3(s.water_m3),
      cost_tnd, tariff_period, endReason,
      s.id,
    );
  r.session = null;
}

// ---- reading ingest ----------------------------------------------------------
// Store a Reading row, accumulate into the open session (energy, min/max/avg A,
// water volume, tariff segments) and broadcast on the bus. Caller decides WHEN
// (sim: 2s loop; mqtt bridge: throttled to ≥2s per device).
export function ingestReading(r, current, powerKw, waterFlow, now = Date.now()) {
  const s = r.session;
  if (!s) return null;
  const dtS = Math.min(10, (now - s.lastTickMs) / 1000); // cap after long sleeps
  s.lastTickMs = now;

  const kwh = powerKw * (dtS / 3600);
  s.energy_wh += kwh * 1000;
  s.segments.push({ ts: now, kwh });
  s.sumA += current; s.countA += 1;
  s.minA = s.minA == null ? current : Math.min(s.minA, current);
  s.maxA = s.maxA == null ? current : Math.max(s.maxA, current);
  // Only estimate water when the pump is really loaded (current above the
  // 0.5 A noise floor) AND the water sensor doesn't explicitly say "no water".
  if (waterFlow !== false && current > 0.5) s.water_m3 += (FLOW_LPS * dtS) / 1000;

  const reading = {
    device_id: r.id,
    ts: new Date(now).toISOString(),
    current_a: round3(current),
    power_kw: round3(powerKw),
    water_flow: waterFlow,
  };
  db.prepare('INSERT INTO readings (device_id, ts, current_a, power_kw, water_flow) VALUES (?, ?, ?, ?, ?)')
    .run(r.id, reading.ts, reading.current_a, reading.power_kw, waterFlow ? 1 : 0);
  const prevFlow = db.prepare('SELECT water_flow FROM devices WHERE id = ?').get(r.id)?.water_flow;
  persist(r.id, { current_a: reading.current_a, power_kw: reading.power_kw, water_flow: waterFlow ? 1 : 0 });
  bus.emit('reading', reading);
  if ((prevFlow == null ? null : !!prevFlow) !== waterFlow) emitState(r.id);
  return reading;
}

// ---- online / offline ---------------------------------------------------------
export function goOffline(deviceId) {
  const wasOn = getRelay(deviceId) === 'ON';
  const r = loadRuntime(deviceId);
  if (wasOn) { // power cut at the pump: relay physically drops
    r.lastChangeSource = 'power_failure';
    stopSession(r, null);
    persist(deviceId, { relay: 'OFF', current_a: null, power_kw: null, water_flow: null });
  }
  persist(deviceId, { online: 0 });
  createAlert(deviceId, 'offline', 'Device is offline', { debounceMs: OFFLINE_ALERT_DEBOUNCE_MS });
  if (wasOn) createAlert(deviceId, 'power_failure', 'Pump lost power while running — possible power cut');
  emitState(deviceId);
  console.log(`[ingest] ${deviceId} offline`);
}

export function goOnline(deviceId) {
  persist(deviceId, { online: 1, last_seen_at: nowIso() });
  createAlert(deviceId, 'online', 'Device is back online');
  emitState(deviceId);
  console.log(`[ingest] ${deviceId} online`);
}

// Offline watchdog: no heartbeat for WATCHDOG_MS → offline. Both drivers run
// this on a 15s interval (mqtt: backstop in case the LWT is missed).
export function tickWatchdog() {
  for (const r of rt.values()) {
    if (isOnline(r.id) && Date.now() - r.lastHeartbeatAt > WATCHDOG_MS) goOffline(r.id);
  }
}
