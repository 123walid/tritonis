// /devices — list, rename, command, status, sessions, readings.
import { Router } from 'express';
import { db, toDeviceSummary, toSession, toTimer, toPulse } from '../db.js';
import * as driver from '../driver.js';
import { costSegments, round3 } from '../tariffs.js';
import { tunisDateKey } from '../util.js';

const router = Router();

// Device-scoped routes only see devices owned by the requesting user;
// unclaimed or other-user devices look the same as nonexistent ones.
function findDevice(req, res) {
  const row = db.prepare('SELECT * FROM devices WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) {
    res.status(404).json({ error: 'not_found', message: 'Unknown device' });
    return null;
  }
  return row;
}

// "Today" = Africa/Tunis calendar day. Tunisia is fixed UTC+1 (no DST).
function tunisStartOfDayIso() {
  return new Date(`${tunisDateKey()}T00:00:00+01:00`).toISOString();
}

function todayStats(deviceId) {
  const rows = db.prepare('SELECT * FROM sessions WHERE device_id = ? AND started_at >= ?')
    .all(deviceId, tunisStartOfDayIso());
  const live = driver.getLive(deviceId).session;
  let energyWh = 0, cost = 0, water = 0, runtimeS = 0;
  for (const row of rows) {
    if (row.ended_at == null && live && live.id === row.id) {
      energyWh += live.energy_wh;
      water += live.water_m3;
      runtimeS += (Date.now() - live.startedAtMs) / 1000;
      cost += costSegments(live.segments).cost_tnd;
    } else {
      energyWh += row.energy_wh;
      cost += row.cost_tnd ?? 0;
      water += row.water_m3 ?? 0;
      runtimeS += row.duration_s;
    }
  }
  return {
    energy_kwh: round3(energyWh / 1000),
    cost_tnd: round3(cost),
    water_m3: round3(water),
    runtime_min: Math.round(runtimeS / 60),
    sessions: rows.length,
  };
}

router.get('/', (req, res) => {
  res.json({ devices: driver.listSummaries(req.user.id) });
});

// Claim an auto-registered (unclaimed) device, e.g. after scanning its QR code.
router.post('/claim', (req, res) => {
  const { device_id, name } = req.body || {};
  if (typeof device_id !== 'string' || device_id.trim().length < 1 || device_id.trim().length > 64) {
    return res.status(400).json({ error: 'bad_request', message: 'device_id must be a string of 1–64 characters' });
  }
  if (name !== undefined && (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 40)) {
    return res.status(400).json({ error: 'invalid_name', message: 'Name must be 1–40 characters' });
  }
  const id = device_id.trim();
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
  if (!device) {
    return res.status(404).json({
      error: 'device_not_found',
      message: 'No device with this ID has connected yet. Power it on and check its MQTT connection.',
    });
  }
  if (device.user_id && device.user_id !== req.user.id) {
    return res.status(403).json({ error: 'already_claimed', message: 'This device is claimed by another account' });
  }
  db.prepare('UPDATE devices SET user_id = ?, name = COALESCE(?, name) WHERE id = ?')
    .run(req.user.id, name === undefined ? null : name.trim(), id);
  res.json(toDeviceSummary(db.prepare('SELECT * FROM devices WHERE id = ?').get(id)));
});

router.patch('/:id', (req, res) => {
  const device = findDevice(req, res);
  if (!device) return;
  const { name } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 40) {
    return res.status(400).json({ error: 'invalid_name', message: 'Name must be 1–40 characters' });
  }
  db.prepare('UPDATE devices SET name = ? WHERE id = ?').run(name.trim(), device.id);
  const summary = toDeviceSummary(db.prepare('SELECT * FROM devices WHERE id = ?').get(device.id));
  res.json(summary);
});

router.post('/:id/command', (req, res) => {
  const device = findDevice(req, res);
  if (!device) return;
  const { action } = req.body || {};
  if (action !== 'ON' && action !== 'OFF') {
    return res.status(400).json({ error: 'invalid_action', message: "action must be 'ON' or 'OFF'" });
  }
  const result = driver.command(device.id, action, 'manual');
  if (!result.ok && result.offline) {
    return res.status(409).json({ error: 'device_offline', message: 'Device is offline' });
  }
  res.status(202).json({ accepted: true });
});

router.get('/:id/status', (req, res) => {
  const device = findDevice(req, res);
  if (!device) return;
  const lastSessionRow = db.prepare(
    'SELECT * FROM sessions WHERE device_id = ? ORDER BY started_at DESC LIMIT 1').get(device.id);
  const timerRow = db.prepare(
    'SELECT * FROM timers WHERE device_id = ? AND enabled = 1 ORDER BY run_at LIMIT 1').get(device.id);
  const pulseRow = db.prepare(
    'SELECT * FROM pulse_programs WHERE device_id = ? AND enabled = 1 ORDER BY rowid DESC LIMIT 1').get(device.id);
  res.json({
    ...toDeviceSummary(device),
    today: todayStats(device.id),
    last_session: lastSessionRow ? toSession(lastSessionRow) : null,
    active_timer: timerRow ? toTimer(timerRow) : null,
    active_pulse: pulseRow ? toPulse(pulseRow) : null,
  });
});

router.get('/:id/sessions', (req, res) => {
  const device = findDevice(req, res);
  if (!device) return;
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 30 * 86400000);
  if (isNaN(from) || isNaN(to)) return res.status(400).json({ error: 'bad_request', message: 'from/to must be ISO dates' });
  const rows = db.prepare(
    `SELECT * FROM sessions WHERE device_id = ? AND started_at >= ? AND started_at <= ?
     ORDER BY started_at DESC`).all(device.id, from.toISOString(), to.toISOString());
  res.json({ sessions: rows.map(toSession) });
});

router.get('/:id/readings', (req, res) => {
  const device = findDevice(req, res);
  if (!device) return;
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 86400000);
  const resolution = req.query.resolution || 'raw';
  if (isNaN(from) || isNaN(to)) return res.status(400).json({ error: 'bad_request', message: 'from/to must be ISO dates' });
  if (!['raw', 'hour', 'day'].includes(resolution)) {
    return res.status(400).json({ error: 'bad_request', message: "resolution must be raw|hour|day" });
  }
  const args = [device.id, from.toISOString(), to.toISOString()];
  let rows;
  if (resolution === 'raw') {
    rows = db.prepare(
      `SELECT ts, current_a, power_kw, water_flow FROM readings
       WHERE device_id = ? AND ts >= ? AND ts <= ? ORDER BY ts LIMIT 50000`).all(...args);
  } else {
    // Aggregate in SQLite; Tunisia is fixed UTC+1 → '+1 hour' gives local buckets.
    const bucket = resolution === 'hour' ? '%Y-%m-%d %H:00:00' : '%Y-%m-%d';
    rows = db.prepare(
      `SELECT strftime('${bucket}', ts, '+1 hour') || 'Z' AS bucket,
              AVG(current_a) AS current_a, AVG(power_kw) AS power_kw, MAX(water_flow) AS water_flow
       FROM readings WHERE device_id = ? AND ts >= ? AND ts <= ?
       GROUP BY bucket ORDER BY bucket`).all(...args)
      .map((r) => ({ ts: r.bucket.replace(' ', 'T'), current_a: r.current_a, power_kw: r.power_kw, water_flow: r.water_flow }));
  }
  res.json({
    readings: rows.map((r) => ({
      ts: r.ts,
      current_a: round3(r.current_a),
      power_kw: round3(r.power_kw),
      water_flow: !!r.water_flow,
    })),
  });
});

export default router;
