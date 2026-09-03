// ESP32 device simulator — replaces the real MQTT broker in development.
// This is the `sim` device driver (DEVICE_DRIVER=sim, default). It generates
// fake telemetry in-process and feeds the shared ingest path (ingest.js),
// exactly like mqtt-bridge.js does for the real hardware.
//
// Scenario env vars (read dynamically so they can be toggled between ticks):
//   SIM_OFFLINE=1        — device drops offline (no heartbeat, no readings, 409 on commands)
//   SIM_DRY_RUN=1        — 20s after start: water_flow=false; 10s later: auto OFF + dry_run alert
//   SIM_HIGH_LOAD=1      — ~6s after start current spikes >12A → high_load alert + auto OFF
//   SIM_UNEXPECTED_STOP=1— 15s after start the relay drops silently (scheduler → unexpected_stop)
//   SIM_DELAY_MS=<n>     — artificial command/apply latency
import { db } from './db.js';
import { createAlert } from './alerts.js';
import {
  VOLTAGE_V, loadRuntime, allRuntimes, getRelay, isOnline,
  startPump, stopPump, silentDrop, ingestReading,
  goOffline, goOnline, noteHeartbeat, tickWatchdog,
} from './ingest.js';
import { nowIso } from './util.js';

// Re-export the shared driver surface so existing callers keep working.
export {
  getLive, getRelay, isOnline, deviceSummary, listSummaries,
} from './ingest.js';

const NOMINAL_A = 8.5;        // pump nominal current
const NOISE_A = 0.6;          // ± noise
const READING_MS = 2000;
const HEARTBEAT_MS = 30000;

const env = (k) => process.env[k];
const envOn = (k) => env(k) === '1' || env(k) === 'true';

// Offline override: starts from SIM_OFFLINE, toggled at runtime with SIGUSR1
// (lets you rehearse offline → power_failure → online alert flows live).
let simForceOffline = envOn('SIM_OFFLINE');
process.on('SIGUSR1', () => {
  simForceOffline = !simForceOffline;
  console.log(`[sim] offline override → ${simForceOffline ? 'OFFLINE' : 'ONLINE'}`);
  tickHeartbeat(); // apply immediately, don't wait for the 30s tick
});

// ---- commands (equivalent of publishing to <prefix>/switch/water_pump/command)
export function command(deviceId, action, source = 'manual') {
  loadRuntime(deviceId);
  if (!isOnline(deviceId)) return { ok: false, offline: true };

  const apply = () => {
    if (!isOnline(deviceId)) return; // went offline during SIM_DELAY_MS
    if (action === 'ON') startPump(deviceId, source);
    else stopPump(deviceId, source);
  };

  const delay = parseInt(env('SIM_DELAY_MS') || '0', 10);
  if (delay > 0) setTimeout(apply, delay);
  else apply();
  return { ok: true }; // 202 semantics: accepted, applied async when delayed
}

// ---- readings loop (every 2s while relay ON) --------------------------------
function tickReadings() {
  const now = Date.now();
  for (const r of allRuntimes()) {
    const deviceId = r.id;
    if (!isOnline(deviceId) || getRelay(deviceId) !== 'ON') continue;
    const s = r.session;
    if (!s) continue;
    const runElapsedS = (now - s.startedAtMs) / 1000;

    // --- fault scenarios ------------------------------------------------
    let waterFlow = true;
    let current = NOMINAL_A + (Math.random() * 2 - 1) * NOISE_A;

    if (envOn('SIM_HIGH_LOAD') && runElapsedS >= 6) current = 12.5 + Math.random();
    if (envOn('SIM_DRY_RUN') && runElapsedS >= 20) waterFlow = false;

    // --- shared ingest: accumulate + store + broadcast -------------------
    const powerKw = (current * VOLTAGE_V) / 1000;
    const reading = ingestReading(r, current, powerKw, waterFlow, now);

    // --- protective stops -------------------------------------------------
    if (envOn('SIM_HIGH_LOAD') && current > 12 && !s.highLoadAlerted) {
      s.highLoadAlerted = true;
      createAlert(deviceId, 'high_load', `Abnormal load: ${reading.current_a} A — pump stopped`);
      stopPump(deviceId, 'high_load');
      continue;
    }
    if (envOn('SIM_DRY_RUN') && runElapsedS >= 30 && !s.dryRunAlerted) {
      s.dryRunAlerted = true;
      createAlert(deviceId, 'dry_run', 'No water detected for 10 s — pump stopped (dry-run protection)');
      stopPump(deviceId, 'dry_run');
      continue;
    }
    if (envOn('SIM_UNEXPECTED_STOP') && runElapsedS >= 15 && getRelay(deviceId) === 'ON') {
      silentDrop(deviceId); // scheduler's unexpected-stop detector will raise the alert
    }
  }
}

// ---- heartbeat / watchdog ----------------------------------------------------
function tickHeartbeat() {
  for (const r of allRuntimes()) {
    const id = r.id;
    const online = isOnline(id);
    if (simForceOffline) {
      if (online) goOffline(id);
      continue;
    }
    noteHeartbeat(id);
    if (!online) goOnline(id);
  }
}

// ---- lifecycle ----------------------------------------------------------------
let timers = [];
export function startSimulator() {
  for (const d of db.prepare('SELECT id FROM devices').all()) loadRuntime(d.id);
  // On boot after a crash the physical relay state is unknown → assume OFF.
  db.prepare(`UPDATE devices SET relay='OFF', current_a=NULL, power_kw=NULL, water_flow=NULL, online=1, last_seen_at=?`).run(nowIso());
  tickHeartbeat(); // apply SIM_OFFLINE etc. immediately, don't wait 30s
  timers = [
    setInterval(tickReadings, READING_MS),
    setInterval(tickHeartbeat, HEARTBEAT_MS),
    setInterval(tickWatchdog, 15000),
  ];
  for (const t of timers) t.unref?.();
  console.log('[sim] simulator started (readings 2s, heartbeat 30s, watchdog 90s)');
}

export function stopSimulator() {
  timers.forEach(clearInterval);
  timers = [];
}

// Driver-interface aliases (see driver.js).
export const startDriver = startSimulator;
export const stopDriver = stopSimulator;
