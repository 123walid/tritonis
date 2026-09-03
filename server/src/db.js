// SQLite layer (better-sqlite3). Schema per product spec §7; API shapes fixed by SPEC §1.
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowIso } from './util.js';

const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_DB = path.join(SERVER_DIR, 'data', 'tritonis.db');

// Open the DB at `p`, probing that SQLite can actually read/write there
// (some overlay/shared filesystems reject WAL/fstat and throw I/O errors).
function openDb(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const d = new Database(p);
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');
  d.exec('CREATE TABLE IF NOT EXISTS __probe (a INTEGER)');
  d.prepare('INSERT INTO __probe VALUES (?)').run(1);
  d.prepare('SELECT a FROM __probe').all();
  d.exec('DROP TABLE __probe');
  return d;
}

function resolveDb() {
  if (process.env.DB_PATH) return openDb(process.env.DB_PATH);
  try {
    return openDb(DEFAULT_DB);
  } catch (err) {
    const fallback = path.join(os.tmpdir(), 'tritonis-data', 'tritonis.db');
    console.warn(`[db] cannot use ${DEFAULT_DB} (${err.message}); falling back to ${fallback}`);
    try { fs.rmSync(DEFAULT_DB, { force: true }); } catch { /* ignore */ }
    return openDb(fallback);
  }
}

export const db = resolveDb();
export const dbFile = process.env.DB_PATH || DEFAULT_DB;

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id),   -- NULL = unclaimed (auto-registered)
  name         TEXT NOT NULL,
  mqtt_prefix  TEXT NOT NULL,
  relay        TEXT NOT NULL DEFAULT 'OFF',
  online       INTEGER NOT NULL DEFAULT 1,
  current_a    REAL,
  power_kw     REAL,
  water_flow   INTEGER,                 -- NULL = sensor n/a
  last_seen_at TEXT
);
CREATE TABLE IF NOT EXISTS schedules (
  id         TEXT PRIMARY KEY,
  device_id  TEXT NOT NULL REFERENCES devices(id),
  time_local TEXT NOT NULL,             -- 'HH:MM' Africa/Tunis
  action     TEXT NOT NULL,             -- 'ON' | 'OFF'
  days_mask  INTEGER NOT NULL,          -- bit0=Mon … bit6=Sun
  type       TEXT NOT NULL DEFAULT 'manual',
  enabled    INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS timers (
  id        TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  action    TEXT NOT NULL,
  run_at    TEXT NOT NULL,
  enabled   INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS pulse_programs (
  id               TEXT PRIMARY KEY,
  device_id        TEXT NOT NULL REFERENCES devices(id),
  on_min           INTEGER NOT NULL,
  off_min          INTEGER NOT NULL,
  cycles           INTEGER,             -- NULL = until end_at / stopped
  start_at         TEXT,
  end_at           TEXT,
  enabled          INTEGER NOT NULL DEFAULT 1,
  phase            TEXT NOT NULL DEFAULT 'OFF',
  cycles_done      INTEGER NOT NULL DEFAULT 0,
  phase_started_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  device_id     TEXT NOT NULL REFERENCES devices(id),
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  duration_s    INTEGER NOT NULL DEFAULT 0,
  energy_wh     REAL NOT NULL DEFAULT 0,
  avg_a         REAL,
  min_a         REAL,
  max_a         REAL,
  water_m3      REAL,
  cost_tnd      REAL,
  tariff_period TEXT NOT NULL DEFAULT 'standard',
  end_reason    TEXT                    -- manual|schedule|timer|pulse|dry_run|high_load|running|NULL
);
CREATE TABLE IF NOT EXISTS readings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id  TEXT NOT NULL REFERENCES devices(id),
  ts         TEXT NOT NULL,
  current_a  REAL NOT NULL,
  power_kw   REAL NOT NULL,
  water_flow INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_readings_dev_ts ON readings(device_id, ts);
CREATE INDEX IF NOT EXISTS idx_sessions_dev_start ON sessions(device_id, started_at);
CREATE TABLE IF NOT EXISTS alerts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  device_id  TEXT NOT NULL REFERENCES devices(id),
  type       TEXT NOT NULL,
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS push_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  fcm_token  TEXT NOT NULL,
  platform   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, fcm_token)
);
CREATE TABLE IF NOT EXISTS notif_prefs (
  user_id           TEXT PRIMARY KEY REFERENCES users(id),
  offline           INTEGER NOT NULL DEFAULT 1,
  online            INTEGER NOT NULL DEFAULT 1,
  dry_run           INTEGER NOT NULL DEFAULT 1,
  high_load         INTEGER NOT NULL DEFAULT 1,
  unexpected_stop   INTEGER NOT NULL DEFAULT 1,
  schedule_executed INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS provision_tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);
`);

// Migration: devices.user_id was NOT NULL before device claiming existed.
// SQLite can't drop a column constraint in place → rebuild the table.
{
  const uidCol = db.prepare('PRAGMA table_info(devices)').all().find((c) => c.name === 'user_id');
  if (uidCol && uidCol.notnull) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN;
      CREATE TABLE devices_mig (
        id           TEXT PRIMARY KEY,
        user_id      TEXT REFERENCES users(id),
        name         TEXT NOT NULL,
        mqtt_prefix  TEXT NOT NULL,
        relay        TEXT NOT NULL DEFAULT 'OFF',
        online       INTEGER NOT NULL DEFAULT 1,
        current_a    REAL,
        power_kw     REAL,
        water_flow   INTEGER,
        last_seen_at TEXT
      );
      INSERT INTO devices_mig SELECT id, user_id, name, mqtt_prefix, relay, online, current_a, power_kw, water_flow, last_seen_at FROM devices;
      DROP TABLE devices;
      ALTER TABLE devices_mig RENAME TO devices;
      COMMIT;
    `);
    db.pragma('foreign_keys = ON');
  }
}

// ---- seed ----------------------------------------------------------------
const SEED_EMAIL = 'farmer@tritonis.tn';
const SEED_PASSWORD = 'tritonis2026';

export function seed() {
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(SEED_EMAIL);
  if (!user) {
    user = {
      id: 'user-farmer-1',
      email: SEED_EMAIL,
      password_hash: bcrypt.hashSync(SEED_PASSWORD, 10),
      created_at: nowIso(),
    };
    db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (@id, @email, @password_hash, @created_at)').run(user);
  }
  let device = db.prepare('SELECT * FROM devices WHERE id = ?').get('dev-pump-1');
  if (!device) {
    db.prepare(`INSERT INTO devices (id, user_id, name, mqtt_prefix, relay, online, last_seen_at)
                VALUES (?, ?, ?, ?, 'OFF', 1, ?)`)
      .run('dev-pump-1', user.id, 'Pump 1', 'farm/pump', nowIso());
  }
  db.prepare(`INSERT INTO notif_prefs (user_id) VALUES (?)
              ON CONFLICT(user_id) DO NOTHING`).run(user.id);
  // Close sessions left open by a previous process crash/stop.
  db.prepare(`UPDATE sessions SET ended_at = COALESCE(ended_at, ?),
              duration_s = CAST((julianday(COALESCE(ended_at, ?)) - julianday(started_at)) * 86400 AS INTEGER)
              WHERE ended_at IS NULL`).run(nowIso(), nowIso());
  return { userId: user.id };
}

// ---- row → API serializers (SPEC §1 snake_case shapes) --------------------
export function toDeviceSummary(row) {
  return {
    id: row.id,
    name: row.name,
    online: !!row.online,
    relay: row.relay,
    current_a: row.current_a ?? null,
    power_kw: row.power_kw ?? null,
    water_flow: row.water_flow == null ? null : !!row.water_flow,
    last_seen_at: row.last_seen_at ?? null,
  };
}

export function toSession(row) {
  const running = row.ended_at == null;
  return {
    id: row.id,
    device_id: row.device_id,
    started_at: row.started_at,
    ended_at: row.ended_at ?? null,
    duration_s: running
      ? Math.max(0, Math.round((Date.now() - new Date(row.started_at).getTime()) / 1000))
      : row.duration_s,
    energy_wh: row.energy_wh,
    avg_a: row.avg_a ?? null,
    min_a: row.min_a ?? null,
    max_a: row.max_a ?? null,
    water_m3: row.water_m3 ?? null,
    cost_tnd: row.cost_tnd ?? null,
    tariff_period: row.tariff_period,
    end_reason: running ? 'running' : (row.end_reason ?? null),
  };
}

export const toSchedule = (r) => ({
  id: r.id, device_id: r.device_id, time_local: r.time_local, action: r.action,
  days_mask: r.days_mask, type: r.type, enabled: !!r.enabled,
});

export const toTimer = (r) => ({
  id: r.id, device_id: r.device_id, action: r.action, run_at: r.run_at, enabled: !!r.enabled,
});

export const toPulse = (r) => ({
  id: r.id, device_id: r.device_id, on_min: r.on_min, off_min: r.off_min,
  cycles: r.cycles ?? null, start_at: r.start_at ?? null, end_at: r.end_at ?? null,
  enabled: !!r.enabled, phase: r.phase, cycles_done: r.cycles_done,
});

export const toAlert = (r) => ({
  id: r.id, device_id: r.device_id, device_name: r.device_name ?? '',
  type: r.type, message: r.message, created_at: r.created_at, read: !!r.read,
});

export const toNotifPrefs = (r) => ({
  offline: !!r.offline, online: !!r.online, dry_run: !!r.dry_run,
  high_load: !!r.high_load, unexpected_stop: !!r.unexpected_stop,
  schedule_executed: !!r.schedule_executed,
});
