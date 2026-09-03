// /devices/:id/timers — one-shot delayed ON/OFF. Creating replaces any enabled timer.
import { Router } from 'express';
import { db, toTimer } from '../db.js';
import { newId } from '../util.js';

const router = Router({ mergeParams: true });

function findDevice(req, res) {
  const row = db.prepare('SELECT id FROM devices WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) res.status(404).json({ error: 'not_found', message: 'Unknown device' });
  return row;
}

router.get('/', (req, res) => {
  if (!findDevice(req, res)) return;
  const rows = db.prepare('SELECT * FROM timers WHERE device_id = ? AND enabled = 1 ORDER BY run_at')
    .all(req.params.id);
  res.json({ timers: rows.map(toTimer) });
});

router.post('/', (req, res) => {
  if (!findDevice(req, res)) return;
  const { action, delay_min } = req.body || {};
  if (action !== 'ON' && action !== 'OFF') {
    return res.status(400).json({ error: 'bad_request', message: "action must be 'ON' or 'OFF'" });
  }
  const delay = Number(delay_min);
  if (!Number.isFinite(delay) || delay < 1 || delay > 1440) {
    return res.status(400).json({ error: 'bad_request', message: 'delay_min must be 1–1440' });
  }
  // replaces any existing enabled timer for this device
  db.prepare('UPDATE timers SET enabled = 0 WHERE device_id = ? AND enabled = 1').run(req.params.id);
  const row = {
    id: newId(),
    device_id: req.params.id,
    action,
    run_at: new Date(Date.now() + delay * 60000).toISOString(),
    enabled: 1,
  };
  db.prepare('INSERT INTO timers (id, device_id, action, run_at, enabled) VALUES (@id, @device_id, @action, @run_at, @enabled)').run(row);
  res.status(201).json(toTimer(row));
});

router.delete('/:tid', (req, res) => {
  const info = db.prepare('UPDATE timers SET enabled = 0 WHERE id = ? AND device_id = ? AND enabled = 1')
    .run(req.params.tid, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found', message: 'Unknown timer' });
  res.status(204).end();
});

export default router;
