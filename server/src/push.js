// Push notification token storage + dispatch stub.
//
// ┌────────────────────────────────────────────────────────────────────┐
// │ FCM INTEGRATION POINT                                              │
// │ sendPush() currently only logs. To go live: create a Firebase      │
// │ project, add the service-account JSON, then replace the console.log│
// │ below with `admin.messaging().sendEachForMulticast({ tokens, ... })`│
// │ using the firebase-admin SDK. Everything else (token registry,     │
// │ per-user NotifPrefs filtering, offline debounce) already works.    │
// └────────────────────────────────────────────────────────────────────┘
import { db, toNotifPrefs } from './db.js';
import { newId, nowIso } from './util.js';

export function registerToken(userId, fcmToken, platform) {
  db.prepare(`INSERT INTO push_tokens (id, user_id, fcm_token, platform, created_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(user_id, fcm_token) DO UPDATE SET platform = excluded.platform`)
    .run(newId(), userId, fcmToken, platform, nowIso());
}

export function getPrefs(userId) {
  let row = db.prepare('SELECT * FROM notif_prefs WHERE user_id = ?').get(userId);
  if (!row) {
    db.prepare('INSERT INTO notif_prefs (user_id) VALUES (?)').run(userId);
    row = db.prepare('SELECT * FROM notif_prefs WHERE user_id = ?').get(userId);
  }
  return toNotifPrefs(row);
}

// 10-min debounce per (user, alert type) so e.g. a flapping link doesn't spam.
const lastPushAt = new Map();
const DEBOUNCE_MS = 10 * 60 * 1000;

export function sendPush(userId, title, body, data = {}) {
  const prefs = getPrefs(userId);
  if (data.type && data.type in prefs && !prefs[data.type]) return false;

  const key = `${userId}:${data.type || 'generic'}`;
  const now = Date.now();
  if (now - (lastPushAt.get(key) || 0) < DEBOUNCE_MS) return false;
  lastPushAt.set(key, now);

  const tokens = db.prepare('SELECT fcm_token, platform FROM push_tokens WHERE user_id = ?').all(userId);
  // FCM integration point (see header): replace this log with the real send.
  console.log(`[push] user=${userId} type=${data.type || 'generic'} title="${title}" body="${body}" tokens=${tokens.length}`);
  return true;
}
