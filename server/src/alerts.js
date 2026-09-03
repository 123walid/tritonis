// Alert creation + fan-out (DB row, WS broadcast, push with prefs/debounce).
import { db, toAlert } from './db.js';
import { bus } from './bus.js';
import { sendPush } from './push.js';
import { newId, nowIso } from './util.js';

const TITLES = {
  offline: 'Device offline',
  online: 'Device back online',
  dry_run: 'Dry run — pump stopped',
  high_load: 'Abnormal load',
  unexpected_stop: 'Pump stopped unexpectedly',
  schedule_executed: 'Schedule executed',
  power_failure: 'Possible power cut',
};

const lastAlertAt = new Map(); // debounce key → epoch ms

export function createAlert(deviceId, type, message, { debounceMs = 0 } = {}) {
  if (debounceMs > 0) {
    const key = `${deviceId}:${type}`;
    const now = Date.now();
    if (now - (lastAlertAt.get(key) || 0) < debounceMs) return null;
    lastAlertAt.set(key, now);
  }
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  if (!device || !device.user_id) return null; // unclaimed device: nobody to notify
  const row = {
    id: newId(),
    user_id: device.user_id,
    device_id: device.id,
    type,
    message,
    created_at: nowIso(),
    read: 0,
  };
  db.prepare(`INSERT INTO alerts (id, user_id, device_id, type, message, created_at, read)
              VALUES (@id, @user_id, @device_id, @type, @message, @created_at, @read)`).run(row);
  const alert = toAlert({ ...row, device_name: device.name });
  bus.emit('alert', alert);
  sendPush(row.user_id, TITLES[type] || type, message, { type, device_id: device.id, alert_id: row.id });
  return alert;
}
