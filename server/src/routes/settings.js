// /settings/notifications + /push/register + /provision/*
import { Router } from 'express';
import crypto from 'node:crypto';
import { db, toNotifPrefs } from '../db.js';
import { registerToken, getPrefs } from '../push.js';
import { nowIso } from '../util.js';

const router = Router();

const PREF_KEYS = ['offline', 'online', 'dry_run', 'high_load', 'unexpected_stop', 'schedule_executed'];

router.get('/settings/notifications', (req, res) => {
  res.json(getPrefs(req.user.id));
});

router.patch('/settings/notifications', (req, res) => {
  const body = req.body || {};
  for (const k of Object.keys(body)) {
    if (!PREF_KEYS.includes(k) || typeof body[k] !== 'boolean') {
      return res.status(400).json({ error: 'bad_request', message: `Invalid pref key/value: ${k}` });
    }
  }
  getPrefs(req.user.id); // ensure row exists
  const sets = Object.keys(body).map((k) => `${k} = ?`).join(', ');
  if (sets) {
    db.prepare(`UPDATE notif_prefs SET ${sets} WHERE user_id = ?`)
      .run(...Object.values(body).map((v) => (v ? 1 : 0)), req.user.id);
  }
  res.json(toNotifPrefs(db.prepare('SELECT * FROM notif_prefs WHERE user_id = ?').get(req.user.id)));
});

router.post('/push/register', (req, res) => {
  const { fcm_token, platform } = req.body || {};
  if (typeof fcm_token !== 'string' || !fcm_token || !['android', 'ios'].includes(platform)) {
    return res.status(400).json({ error: 'bad_request', message: "fcm_token + platform('android'|'ios') required" });
  }
  registerToken(req.user.id, fcm_token, platform);
  res.status(204).end();
});

// --- provisioning (device-side stub; real flow goes over BLE Improv) -------
router.post('/provision/token', (req, res) => {
  const token = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min TTL
  db.prepare('INSERT INTO provision_tokens (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, req.user.id, expiresAt.toISOString());
  res.status(201).json({ token, expires_at: expiresAt.toISOString() });
});

router.post('/provision/confirm', (req, res) => {
  const { token, device_id, name } = req.body || {};
  const row = db.prepare('SELECT * FROM provision_tokens WHERE token = ? AND used = 0').get(String(token || ''));
  if (!row || row.user_id !== req.user.id) {
    return res.status(400).json({ error: 'invalid_token', message: 'Unknown or already-used provisioning token' });
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: 'token_expired', message: 'Provisioning token expired' });
  }
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(String(device_id || ''));
  if (!device) return res.status(404).json({ error: 'not_found', message: 'Unknown device' });
  db.prepare('UPDATE provision_tokens SET used = 1 WHERE token = ?').run(token);
  if (typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 40) {
    db.prepare('UPDATE devices SET name = ? WHERE id = ?').run(name.trim(), device.id);
  }
  console.log(`[provision] device ${device.id} confirmed for user ${req.user.id} at ${nowIso()}`);
  res.json({ ok: true });
});

export default router;
