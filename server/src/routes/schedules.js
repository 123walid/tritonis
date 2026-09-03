// /devices/:id/schedules — CRUD. Times are 'HH:MM' in Africa/Tunis.
import { Router } from 'express';
import { db, toSchedule } from '../db.js';
import { newId } from '../util.js';

const router = Router({ mergeParams: true });

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function findDevice(req, res) {
  const row = db.prepare('SELECT id FROM devices WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) res.status(404).json({ error: 'not_found', message: 'Unknown device' });
  return row;
}

function validate(body, partial = false) {
  const out = {};
  if (!partial || body.time_local !== undefined) {
    if (!TIME_RE.test(body.time_local || '')) return { error: 'time_local must be HH:MM (24h)' };
    out.time_local = body.time_local;
  }
  if (!partial || body.action !== undefined) {
    if (body.action !== 'ON' && body.action !== 'OFF') return { error: "action must be 'ON' or 'OFF'" };
    out.action = body.action;
  }
  if (!partial || body.days_mask !== undefined) {
    const m = Number(body.days_mask);
    if (!Number.isInteger(m) || m < 1 || m > 127) return { error: 'days_mask must be an integer 1–127' };
    out.days_mask = m;
  }
  if (body.type !== undefined) {
    if (!['manual', 'tariff_optimized'].includes(body.type)) return { error: "type must be manual|tariff_optimized" };
    out.type = body.type;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') return { error: 'enabled must be boolean' };
    out.enabled = body.enabled ? 1 : 0;
  }
  return { value: out };
}

router.get('/', (req, res) => {
  if (!findDevice(req, res)) return;
  const rows = db.prepare('SELECT * FROM schedules WHERE device_id = ? ORDER BY time_local').all(req.params.id);
  res.json({ schedules: rows.map(toSchedule) });
});

router.post('/', (req, res) => {
  if (!findDevice(req, res)) return;
  const { value, error } = validate(req.body || {});
  if (error) return res.status(400).json({ error: 'bad_request', message: error });
  const row = {
    id: newId(),
    device_id: req.params.id,
    time_local: value.time_local,
    action: value.action,
    days_mask: value.days_mask,
    type: value.type ?? 'manual',
    enabled: value.enabled ?? 1,
  };
  db.prepare(`INSERT INTO schedules (id, device_id, time_local, action, days_mask, type, enabled)
              VALUES (@id, @device_id, @time_local, @action, @days_mask, @type, @enabled)`).run(row);
  res.status(201).json(toSchedule(row));
});

router.patch('/:sid', (req, res) => {
  if (!findDevice(req, res)) return;
  const existing = db.prepare('SELECT * FROM schedules WHERE id = ? AND device_id = ?')
    .get(req.params.sid, req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found', message: 'Unknown schedule' });
  const { value, error } = validate(req.body || {}, true);
  if (error) return res.status(400).json({ error: 'bad_request', message: error });
  const merged = { ...existing, ...value };
  db.prepare(`UPDATE schedules SET time_local=@time_local, action=@action, days_mask=@days_mask,
              type=@type, enabled=@enabled WHERE id=@id`).run(merged);
  res.json(toSchedule(db.prepare('SELECT * FROM schedules WHERE id = ?').get(existing.id)));
});

router.delete('/:sid', (req, res) => {
  const info = db.prepare('DELETE FROM schedules WHERE id = ? AND device_id = ?')
    .run(req.params.sid, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found', message: 'Unknown schedule' });
  res.status(204).end();
});

export default router;
