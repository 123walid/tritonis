// End-to-end smoke test of the SPEC §1 contract.
//   node scripts/smoke.js
// Starts the real server on a test port (4100) with a throwaway DB, exercises
// login / devices / command ON→reading / OFF→session / status / schedule CRUD /
// timer / pulse / alerts / notification prefs / push / provision / WebSocket.
// Prints PASS/FAIL per check; exits non-zero on any failure.
//
// Dry-run scenario: run `SIM_DRY_RUN=1 node scripts/smoke.js --dry-run`
// (kept out of the default run because it takes ~35 s).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const PORT = 4100;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;
const DRY_RUN = process.argv.includes('--dry-run');
if (DRY_RUN) process.env.SIM_DRY_RUN = '1';

const results = [];
let token = null;
const deviceId = 'dev-pump-1';

function check(name, cond, extra = '') {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, p, body, expectRaw = false) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (expectRaw) return res;
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 204 etc. */ }
  return { status: res.status, json };
}

function waitForWs(ws, predicate, timeoutMs, label) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
    const onMsg = (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (predicate(msg)) { cleanup(); resolve(msg); }
    };
    const cleanup = () => { clearTimeout(timer); ws.off('message', onMsg); };
    ws.on('message', onMsg);
    void label;
  });
}

async function main() {
  // ---- auth ----------------------------------------------------------------
  let r = await api('GET', '/devices');
  check('GET /devices without token → 401 {error:"unauthorized"}', r.status === 401 && r.json?.error === 'unauthorized');

  r = await api('POST', '/auth/login', { email: 'farmer@tritonis.tn', password: 'wrong' });
  check('login wrong password → 401 invalid_credentials', r.status === 401 && r.json?.error === 'invalid_credentials');

  r = await api('POST', '/auth/login', { email: 'farmer@tritonis.tn', password: 'tritonis2026' });
  check('login seeded user → 200 {token,user}', r.status === 200 && !!r.json?.token && r.json?.user?.email === 'farmer@tritonis.tn');
  token = r.json?.token;

  // ---- devices ---------------------------------------------------------------
  r = await api('GET', '/devices');
  const dev = r.json?.devices?.[0];
  check('GET /devices → seeded dev-pump-1 "Pump 1"', r.status === 200 && dev?.id === deviceId && dev.name === 'Pump 1' && dev.relay === 'OFF');

  r = await api('PATCH', `/devices/${deviceId}`, { name: 'Pump One' });
  check('PATCH /devices/:id rename → DeviceSummary', r.status === 200 && r.json?.name === 'Pump One');
  r = await api('PATCH', `/devices/${deviceId}`, { name: 'Pump 1' });
  check('rename back', r.status === 200 && r.json?.name === 'Pump 1');
  r = await api('PATCH', `/devices/${deviceId}`, { name: '' });
  check('rename empty → 400 invalid_name', r.status === 400 && r.json?.error === 'invalid_name');

  // ---- claim device ------------------------------------------------------------
  r = await api('POST', '/devices/claim', { device_id: 'dev-does-not-exist' });
  check('claim nonexistent device → 404 device_not_found', r.status === 404 && r.json?.error === 'device_not_found');
  r = await api('POST', '/devices/claim', { device_id: '' });
  check('claim empty device_id → 400', r.status === 400);
  r = await api('POST', '/devices/claim', { device_id: deviceId });
  check('claim device already owned by me → 200 DeviceSummary', r.status === 200 && r.json?.id === deviceId);

  // Insert an unclaimed (auto-registered style) device straight into the DB.
  const Database = (await import('better-sqlite3')).default;
  const tdb = new Database(tmpDb);
  tdb.prepare(`INSERT INTO devices (id, user_id, name, mqtt_prefix, relay, online)
               VALUES ('dev-pump-unclaimed', NULL, 'Pump unclaimed', 'farm/pumpunclaimed', 'OFF', 1)`).run();
  tdb.close();

  r = await api('GET', '/devices');
  check('unclaimed device NOT in GET /devices', r.status === 200 && !r.json.devices.some((d) => d.id === 'dev-pump-unclaimed'));
  r = await api('GET', '/devices/dev-pump-unclaimed/status');
  check('unclaimed device status → 404 not_found', r.status === 404 && r.json?.error === 'not_found');
  r = await api('POST', '/devices/claim', { device_id: 'dev-pump-unclaimed', name: 'Pump Annex' });
  check('claim unclaimed device → 200 with new name', r.status === 200 && r.json?.id === 'dev-pump-unclaimed' && r.json?.name === 'Pump Annex');
  r = await api('GET', '/devices');
  check('claimed device IS in GET /devices', r.status === 200 && r.json.devices.some((d) => d.id === 'dev-pump-unclaimed'));

  // ---- WebSocket hello ---------------------------------------------------------
  const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
  const hello = await waitForWs(ws, (m) => m.type === 'hello', 5000);
  check('WS hello received with devices', !!hello && Array.isArray(hello.devices) && hello.devices[0]?.id === deviceId);

  // ---- command ON → reading -----------------------------------------------------
  const readingPromise = waitForWs(ws, (m) => m.type === 'reading' && m.device_id === deviceId, 8000);
  const stateOnPromise = waitForWs(ws, (m) => m.type === 'device_state' && m.device?.relay === 'ON', 8000);
  r = await api('POST', `/devices/${deviceId}/command`, { action: 'ON' });
  check('command ON → 202 {accepted:true}', r.status === 202 && r.json?.accepted === true);
  check('device_state broadcast for relay ON', !!(await stateOnPromise));
  const reading = await readingPromise;
  check('reading within ~8s of ON (current ~8.5A, power=A*230/1000, water_flow)',
    !!reading && Math.abs(reading.current_a - 8.5) < 1.5
    && Math.abs(reading.power_kw - (reading.current_a * 230) / 1000) < 0.01
    && reading.water_flow === true,
    reading ? `${reading.current_a}A ${reading.power_kw}kW` : 'timeout');

  // ---- status ---------------------------------------------------------------------
  r = await api('GET', `/devices/${deviceId}/status`);
  check('status: relay ON, live current, today totals, last_session running',
    r.status === 200 && r.json?.relay === 'ON' && typeof r.json?.current_a === 'number'
    && r.json?.today?.sessions >= 1 && r.json?.last_session?.end_reason === 'running');

  // ---- schedules CRUD ----------------------------------------------------------------
  const inOneMinute = new Date(Date.now() + 61000);
  const tunis = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Tunis', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(inOneMinute);
  r = await api('POST', `/devices/${deviceId}/schedules`, { time_local: tunis, action: 'OFF', days_mask: 127 });
  const schedule = r.json;
  check('create schedule → 201 Schedule', r.status === 201 && schedule?.time_local === tunis && schedule?.days_mask === 127 && schedule?.enabled === true);
  r = await api('GET', `/devices/${deviceId}/schedules`);
  check('list schedules sorted', r.status === 200 && r.json?.schedules?.some((s) => s.id === schedule.id));
  r = await api('PATCH', `/devices/${deviceId}/schedules/${schedule.id}`, { days_mask: 31 });
  check('patch schedule', r.status === 200 && r.json?.days_mask === 31);
  r = await api('PATCH', `/devices/${deviceId}/schedules/${schedule.id}`, { days_mask: 127 });

  // ---- timers ---------------------------------------------------------------------------
  r = await api('POST', `/devices/${deviceId}/timers`, { action: 'OFF', delay_min: 60 });
  const timer = r.json;
  check('create timer → 201 with run_at', r.status === 201 && !!timer?.run_at && timer?.action === 'OFF');
  r = await api('GET', `/devices/${deviceId}/timers`);
  check('list timers (enabled only)', r.status === 200 && r.json?.timers?.length === 1);
  r = await api('DELETE', `/devices/${deviceId}/timers/${timer.id}`);
  check('cancel timer → 204', r.status === 204);
  r = await api('GET', `/devices/${deviceId}/timers`);
  check('timer list empty after cancel', r.status === 200 && r.json?.timers?.length === 0);

  // ---- pulse ------------------------------------------------------------------------------
  r = await api('POST', `/devices/${deviceId}/pulse`, { on_min: 5, off_min: 5, cycles: 2 });
  const pulse = r.json;
  check('start pulse → 201 PulseProgram', r.status === 201 && pulse?.on_min === 5 && pulse?.cycles === 2 && pulse?.enabled === true);
  r = await api('GET', `/devices/${deviceId}/pulse`);
  check('get active pulse', r.status === 200 && r.json?.pulse?.id === pulse.id);
  r = await api('POST', `/devices/${deviceId}/pulse/stop`);
  check('stop pulse → 204', r.status === 204);
  r = await api('GET', `/devices/${deviceId}/pulse`);
  check('pulse null after stop', r.status === 200 && r.json?.pulse === null);

  // ---- schedule fires (created 1 minute in the future, action OFF) ---------------------------
  console.log(`… waiting ~75s for schedule (${tunis} Africa/Tunis) to fire and turn the pump OFF`);
  const firedOff = await waitForWs(ws, (m) => m.type === 'device_state' && m.device?.relay === 'OFF', 90000);
  check('schedule fired: pump turned OFF at scheduled minute', !!firedOff);
  r = await api('GET', `/alerts`);
  check('schedule_executed alert created (pref on by default)',
    r.status === 200 && r.json?.alerts?.some((a) => a.type === 'schedule_executed'));

  // ---- sessions ----------------------------------------------------------------
  r = await api('GET', `/devices/${deviceId}/sessions`);
  const sess = r.json?.sessions?.[0];
  check('session closed with energy/avg/min/max/water/cost, end_reason set',
    r.status === 200 && sess && sess.ended_at && sess.energy_wh > 0
    && sess.avg_a > 7 && sess.avg_a < 10 && sess.min_a <= sess.avg_a && sess.max_a >= sess.avg_a
    && sess.water_m3 > 0 && sess.cost_tnd !== null
    && ['manual', 'schedule'].includes(sess.end_reason),
    sess ? `${sess.energy_wh}Wh ${sess.avg_a}A ${sess.water_m3}m3 ${sess.cost_tnd}TND ${sess.end_reason}` : '');

  // ---- readings -------------------------------------------------------------------
  r = await api('GET', `/devices/${deviceId}/readings?resolution=raw`);
  check('readings raw', r.status === 200 && r.json?.readings?.length > 0 && typeof r.json.readings[0].current_a === 'number');
  r = await api('GET', `/devices/${deviceId}/readings?resolution=hour`);
  check('readings hourly average', r.status === 200 && Array.isArray(r.json?.readings));

  // ---- alerts ------------------------------------------------------------------------
  const alertPromise = waitForWs(ws, (m) => m.type === 'alert', 100);
  r = await api('GET', '/alerts');
  const alertId = r.json?.alerts?.[0]?.id;
  check('GET /alerts → list with device_name', r.status === 200 && !!alertId && typeof r.json.alerts[0].device_name === 'string');
  r = await api('POST', `/alerts/${alertId}/read`);
  check('mark alert read → 204', r.status === 204);
  r = await api('POST', '/alerts/read-all');
  check('mark all read → 204', r.status === 204);
  await alertPromise;

  // ---- notification prefs ---------------------------------------------------------------
  r = await api('GET', '/settings/notifications');
  check('get notif prefs (6 booleans)', r.status === 200 && Object.keys(r.json || {}).length === 6 && r.json?.offline === true);
  r = await api('PATCH', '/settings/notifications', { offline: false });
  check('patch notif prefs', r.status === 200 && r.json?.offline === false && r.json?.online === true);
  await api('PATCH', '/settings/notifications', { offline: true });

  // ---- push + provision --------------------------------------------------------------------
  r = await api('POST', '/push/register', { fcm_token: 'fake-fcm-token-123', platform: 'android' });
  check('push register → 204', r.status === 204);
  r = await api('POST', '/provision/token');
  const prov = r.json;
  check('provision token → 201 with 15-min expiry', r.status === 201 && !!prov?.token && new Date(prov.expires_at) > new Date());
  r = await api('POST', '/provision/confirm', { token: prov?.token, device_id: deviceId });
  check('provision confirm → 200 {ok:true}', r.status === 200 && r.json?.ok === true);
  r = await api('POST', '/provision/confirm', { token: prov?.token, device_id: deviceId });
  check('provision token single-use → 400 invalid_token', r.status === 400 && r.json?.error === 'invalid_token');

  // ---- auth password + logout ------------------------------------------------------------------
  r = await api('POST', '/auth/password', { current_password: 'tritonis2026', new_password: 'short' });
  check('weak password → 400 weak_password', r.status === 400 && r.json?.error === 'weak_password');
  r = await api('POST', '/auth/password', { current_password: 'nope', new_password: 'long-enough-1' });
  check('wrong current → 400 wrong_password', r.status === 400 && r.json?.error === 'wrong_password');
  r = await api('POST', '/auth/logout');
  check('logout → 204', r.status === 204);

  // ---- optional dry-run scenario -------------------------------------------------------------------
  if (DRY_RUN) {
    console.log('… dry-run scenario: expecting water_flow=false at ~20s, auto OFF + dry_run alert at ~30s');
    await api('POST', `/devices/${deviceId}/command`, { action: 'ON' });
    const dryAlert = await waitForWs(ws, (m) => m.type === 'alert' && m.alert?.type === 'dry_run', 45000);
    check('SIM_DRY_RUN: dry_run alert + auto OFF', !!dryAlert);
    r = await api('GET', `/devices/${deviceId}/sessions`);
    check('dry-run session end_reason=dry_run', r.json?.sessions?.[0]?.end_reason === 'dry_run');
  }

  ws.close();
}

// ---- runner -------------------------------------------------------------------
const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tritonis-smoke-')), 'test.db');
const child = spawn(process.execPath, ['src/index.js'], {
  cwd: path.dirname(new URL(import.meta.url).pathname) + '/..',
  env: { ...process.env, PORT: String(PORT), DB_PATH: tmpDb, ...(DRY_RUN ? { SIM_DRY_RUN: '1' } : {}) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  return false;
}

let failures = 0;
try {
  if (!(await waitForServer())) {
    console.error('server did not start. Log:\n' + serverLog);
    process.exit(1);
  }
  await main();
} catch (err) {
  console.error('smoke test crashed:', err);
  failures += 1;
} finally {
  child.kill('SIGTERM');
}

failures += results.filter((r) => !r.ok).length;
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
if (failures > 0) {
  console.log('SMOKE: FAIL');
  console.error('--- server log tail ---\n' + serverLog.split('\n').slice(-30).join('\n'));
  process.exit(1);
}
console.log('SMOKE: PASS');
process.exit(0);
