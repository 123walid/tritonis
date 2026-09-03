// /devices/:id/pulse — alternating ON/OFF irrigation programs.
import { Router } from 'express';
import { db, toPulse } from '../db.js';
import * as driver from '../driver.js';
import { newId } from '../util.js';

const router = Router({ mergeParams: true });

function findDevice(req, res) {
  const row = db.prepare('SELECT id FROM devices WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) res.status(404).json({ error: 'not_found', message: 'Unknown device' });
  return row;
}

const inRange = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;

router.get('/', (req, res) => {
  if (!findDevice(req, res)) return;
  const row = db.prepare(
    'SELECT * FROM pulse_programs WHERE device_id = ? AND enabled = 1 ORDER BY rowid DESC LIMIT 1')
    .get(req.params.id);
  res.json({ pulse: row ? toPulse(row) : null });
});

router.post('/', (req, res) => {
  if (!findDevice(req, res)) return;
  const { on_min, off_min, cycles, start_at } = req.body || {};
  if (!inRange(Number(on_min), 1, 180) || !inRange(Number(off_min), 1, 180)) {
    return res.status(400).json({ error: 'bad_request', message: 'on_min/off_min must be integers 1–180' });
  }
  if (cycles !== undefined && cycles !== null && !inRange(Number(cycles), 1, 99)) {
    return res.status(400).json({ error: 'bad_request', message: 'cycles must be an integer 1–99' });
  }
  let startAtIso = null;
  if (start_at) {
    const d = new Date(start_at);
    if (isNaN(d)) return res.status(400).json({ error: 'bad_request', message: 'start_at must be ISO' });
    startAtIso = d.toISOString();
  }
  // replaces any active program
  disableActive(req.params.id);
  const row = {
    id: newId(),
    device_id: req.params.id,
    on_min: Number(on_min),
    off_min: Number(off_min),
    cycles: cycles == null ? null : Number(cycles),
    start_at: startAtIso,
    end_at: null,
    enabled: 1,
    phase: 'OFF',
    cycles_done: 0,
    phase_started_at: startAtIso ? null : new Date().toISOString(),
  };
  db.prepare(`INSERT INTO pulse_programs (id, device_id, on_min, off_min, cycles, start_at, end_at, enabled, phase, cycles_done, phase_started_at)
              VALUES (@id, @device_id, @on_min, @off_min, @cycles, @start_at, @end_at, @enabled, @phase, @cycles_done, @phase_started_at)`).run(row);
  res.status(201).json(toPulse(row));
});

router.post('/stop', (req, res) => {
  if (!findDevice(req, res)) return;
  disableActive(req.params.id);
  // turn pump OFF if the pulse program started it
  const r = driver.getLive(req.params.id);
  if (r.pulseControlsRelay && driver.getRelay(req.params.id) === 'ON') {
    driver.command(req.params.id, 'OFF', 'pulse');
  }
  r.pulseControlsRelay = false;
  res.status(204).end();
});

function disableActive(deviceId) {
  db.prepare('UPDATE pulse_programs SET enabled = 0 WHERE device_id = ? AND enabled = 1').run(deviceId);
}

export default router;
