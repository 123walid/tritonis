// Server-side execution of schedules, timers and pulse programs.
// 15s tick; schedule matching uses Africa/Tunis local wall-clock.
import { db } from './db.js';
import * as driver from './driver.js';
import { createAlert } from './alerts.js';
import { getPrefs } from './push.js';
import { tunisParts, nowIso } from './util.js';

const TICK_MS = 15000;
const UNEXPECTED_STOP_DEBOUNCE_MS = 10 * 60 * 1000;

const firedThisMinute = new Map(); // scheduleId → 'YYYY-MM-DD HH:MM'
const lastUnexpectedAlert = new Map(); // deviceId → epoch ms

function tick() {
  const now = new Date();
  const local = tunisParts(now);
  const minuteKey = `${local.dateStr} ${local.hhmm}`;

  // ---- schedules: match HH:MM + days_mask, fire once per minute ----------
  const schedules = db.prepare('SELECT * FROM schedules WHERE enabled = 1').all();
  for (const s of schedules) {
    if (s.time_local !== local.hhmm) continue;
    if (!(s.days_mask & local.dayBit)) continue;
    if (firedThisMinute.get(s.id) === minuteKey) continue;
    firedThisMinute.set(s.id, minuteKey);
    if (!driver.isOnline(s.device_id)) continue; // device will miss it; offline alert already raised
    driver.command(s.device_id, s.action, 'schedule');
    const user = db.prepare('SELECT user_id FROM devices WHERE id = ?').get(s.device_id);
    if (user && getPrefs(user.user_id).schedule_executed) {
      createAlert(s.device_id, 'schedule_executed', `Schedule ${s.time_local} turned pump ${s.action}`);
    }
  }

  // ---- timers --------------------------------------------------------------
  const dueTimers = db.prepare('SELECT * FROM timers WHERE enabled = 1 AND run_at <= ?').all(now.toISOString());
  for (const t of dueTimers) {
    db.prepare('UPDATE timers SET enabled = 0 WHERE id = ?').run(t.id);
    if (driver.isOnline(t.device_id)) driver.command(t.device_id, t.action, 'timer');
  }

  // ---- pulse programs --------------------------------------------------------
  const pulses = db.prepare('SELECT * FROM pulse_programs WHERE enabled = 1').all();
  for (const p of pulses) stepPulse(p, now);

  // ---- unexpected stop: schedule window expects ON but relay is OFF ---------
  detectUnexpectedStops(local, now);
}

function stepPulse(p, now) {
  const finish = () => {
    db.prepare('UPDATE pulse_programs SET enabled = 0, phase = ? WHERE id = ?').run('OFF', p.id);
    const r = driver.getLive(p.device_id);
    if (r.pulseControlsRelay && driver.getRelay(p.device_id) === 'ON') driver.command(p.device_id, 'OFF', 'pulse');
    r.pulseControlsRelay = false;
  };

  const startAtMs = p.start_at ? new Date(p.start_at).getTime() : null;
  const endAtMs = p.end_at ? new Date(p.end_at).getTime() : null;
  const nowMs = now.getTime();

  if (startAtMs && nowMs < startAtMs) return;       // scheduled start in the future
  if (endAtMs && nowMs >= endAtMs) return finish();
  if (!driver.isOnline(p.device_id)) return;

  const phaseElapsedMin = p.phase_started_at ? (nowMs - new Date(p.phase_started_at).getTime()) / 60000 : Infinity;

  if (p.phase === 'ON') {
    if (phaseElapsedMin < p.on_min) return;
    if (p.cycles != null && p.cycles_done + 1 >= p.cycles) return finish(); // program complete
    // ON → OFF
    db.prepare(`UPDATE pulse_programs SET phase='OFF', cycles_done=cycles_done+1, phase_started_at=? WHERE id=?`)
      .run(now.toISOString(), p.id);
    if (driver.getRelay(p.device_id) === 'ON') driver.command(p.device_id, 'OFF', 'pulse');
  } else {
    // OFF phase (initial or between cycles)
    if (p.phase_started_at && phaseElapsedMin < p.off_min) return;
    if (p.cycles != null && p.cycles_done >= p.cycles) return finish();
    db.prepare(`UPDATE pulse_programs SET phase='ON', phase_started_at=? WHERE id=?`)
      .run(now.toISOString(), p.id);
    const r = driver.getLive(p.device_id);
    r.pulseControlsRelay = true;
    driver.command(p.device_id, 'ON', 'pulse');
  }
}

function detectUnexpectedStops(local, now) {
  // "Expected ON": the latest enabled schedule event earlier today (local time) was ON.
  const devices = db.prepare('SELECT id FROM devices').all();
  for (const d of devices) {
    const todays = db.prepare(`
      SELECT time_local, action FROM schedules
      WHERE device_id = ? AND enabled = 1 AND time_local <= ? AND (days_mask & ?) != 0
      ORDER BY time_local DESC LIMIT 1`).get(d.id, local.hhmm, local.dayBit);
    if (!todays || todays.action !== 'ON') continue;
    if (!driver.isOnline(d.id)) continue;                       // offline/power_failure path handles it
    if (driver.getRelay(d.id) === 'ON') continue;
    const r = driver.getLive(d.id);
    // a legitimate stop (manual/timer/pulse/schedule/protection) is not "unexpected"
    if (r.lastChangeSource !== 'unknown') continue;
    const last = lastUnexpectedAlert.get(d.id) || 0;
    if (now.getTime() - last < UNEXPECTED_STOP_DEBOUNCE_MS) continue;
    lastUnexpectedAlert.set(d.id, now.getTime());
    createAlert(d.id, 'unexpected_stop', 'Pump stopped unexpectedly during a scheduled ON window');
  }
}

let timer = null;
export function startScheduler() {
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  console.log('[scheduler] started (15s tick, Africa/Tunis)');
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

// Exported for tests/smoke: force one immediate evaluation.
export function tickNow() {
  tick();
}
