// /alerts — feed + read markers.
import { Router } from 'express';
import { db, toAlert } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const rows = db.prepare(
    `SELECT a.*, d.name AS device_name FROM alerts a
     JOIN devices d ON d.id = a.device_id
     WHERE a.user_id = ? ORDER BY a.created_at DESC, a.rowid DESC LIMIT 100`)
    .all(req.user.id);
  res.json({ alerts: rows.map(toAlert) });
});

router.post('/read-all', (req, res) => {
  db.prepare('UPDATE alerts SET read = 1 WHERE user_id = ?').run(req.user.id);
  res.status(204).end();
});

router.post('/:id/read', (req, res) => {
  const info = db.prepare('UPDATE alerts SET read = 1 WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found', message: 'Unknown alert' });
  res.status(204).end();
});

export default router;
