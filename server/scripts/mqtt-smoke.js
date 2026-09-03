// End-to-end smoke test of the MQTT device driver (DEVICE_DRIVER=mqtt).
//   node scripts/mqtt-smoke.js
//
// Starts an embedded aedes broker on a test port, boots the real server with
// DEVICE_DRIVER=mqtt + MQTT_URL pointing at it, then plays a fake ESP32 on the
// broker (birth online, switch state, current/power, PUMP_START/STOP,
// DRY_RUN_DETECTED) and asserts via the SPEC §1 REST/WS contract:
// device online, command publish reaches the broker, readings appear, session
// opens/closes, dry_run alert created. Prints PASS/FAIL per check; exits
// non-zero on any failure.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import mqtt from 'mqtt';
import { Aedes } from 'aedes';

const HTTP_PORT = 4200;
const MQTT_PORT = 41883;
const BASE = `http://127.0.0.1:${HTTP_PORT}/api/v1`;
const WS_URL = `ws://127.0.0.1:${HTTP_PORT}/ws`;
const BROKER_URL = `mqtt://127.0.0.1:${MQTT_PORT}`;
const PREFIX = 'farm/pump'; // seeded device dev-pump-1 mqtt_prefix

const results = [];
let token = null;
const deviceId = 'dev-pump-1';

function check(name, cond, extra = '') {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, p, body) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 204 etc. */ }
  return { status: res.status, json };
}

function waitForWs(ws, predicate, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
    const onMsg = (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (predicate(msg)) { cleanup(); resolve(msg); }
    };
    const cleanup = () => { clearTimeout(timer); ws.off('message', onMsg); };
    ws.on('message', onMsg);
  });
}

// Publish helper on the fake-ESP32 client (qos 1 so the broker ACKs).
function pub(client, suffix, payload, retain = true) {
  return new Promise((resolve, reject) => {
    client.publish(`${PREFIX}/${suffix}`, payload, { qos: 1, retain }, (err) => (err ? reject(err) : resolve()));
  });
}

async function main(esp) {
  // ---- auth ------------------------------------------------------------
  let r = await api('POST', '/auth/login', { email: 'farmer@tritonis.tn', password: 'tritonis2026' });
  check('login seeded user → 200 {token,user}', r.status === 200 && !!r.json?.token);
  token = r.json?.token;

  // ---- fake ESP32 comes online --------------------------------------------
  await pub(esp, 'status', 'online');
  await pub(esp, 'switch/water_pump/state', 'OFF');
  await sleep(400); // let the bridge ingest

  r = await api('GET', '/devices');
  const dev = r.json?.devices?.[0];
  check('device online after MQTT birth message',
    r.status === 200 && dev?.id === deviceId && dev.online === true && !!dev.last_seen_at);

  // unknown prefix is auto-registered as UNCLAIMED → stays hidden from GET /devices
  await new Promise((res2) => esp.publish('farm/unknown/status', 'online', { qos: 1 }, res2));
  await sleep(200);
  r = await api('GET', '/devices');
  check('unknown prefix auto-registered unclaimed (still 1 owned device)', r.status === 200 && r.json?.devices?.length === 1);
  r = await api('GET', '/devices/dev-unknown/status');
  check('unclaimed auto-registered device → 404 not_found', r.status === 404 && r.json?.error === 'not_found');

  // ---- WS hello -------------------------------------------------------------
  const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
  const hello = await waitForWs(ws, (m) => m.type === 'hello', 5000);
  check('WS hello received with online device', !!hello && hello.devices?.[0]?.online === true);

  // ---- command ON → publish reaches the broker ------------------------------
  const cmdReceived = new Promise((resolve) => {
    esp.subscribe(`${PREFIX}/switch/water_pump/command`, (err) => { if (err) resolve(null); });
    const onMsg = (t, payload) => {
      if (t === `${PREFIX}/switch/water_pump/command`) { esp.off('message', onMsg); resolve(payload.toString()); }
    };
    esp.on('message', onMsg);
    setTimeout(() => resolve(null), 5000);
  });
  r = await api('POST', `/devices/${deviceId}/command`, { action: 'ON' });
  check('command ON → 202 {accepted:true}', r.status === 202 && r.json?.accepted === true);
  const cmdPayload = await cmdReceived;
  check('command reached broker on switch/water_pump/command', cmdPayload === 'ON', String(cmdPayload));

  // ---- device reports relay ON → session opens -------------------------------
  const stateOnPromise = waitForWs(ws, (m) => m.type === 'device_state' && m.device?.relay === 'ON', 5000);
  await pub(esp, 'switch/water_pump/state', 'ON');
  await pub(esp, 'events', 'PUMP_START', false);
  check('device_state broadcast for relay ON (from device state topic)', !!(await stateOnPromise));

  // ---- readings from sensor telemetry ------------------------------------------
  const readingPromise = waitForWs(ws, (m) => m.type === 'reading' && m.device_id === deviceId, 8000);
  const t0 = Date.now();
  while (Date.now() - t0 < 4500) { // ~2s throttle → expect ~2 stored readings
    // current last: each message can trigger a reading from latest known values
    await pub(esp, 'sensor/pump_power/state', '1.93', false);
    await pub(esp, 'binary_sensor/water_flow_detected/state', 'ON', false);
    await pub(esp, 'sensor/pump_current/state', '8.4', false);
    await sleep(600);
  }
  const reading = await readingPromise;
  check('reading broadcast (current 8.4A, power 1.93kW, water_flow)',
    !!reading && Math.abs(reading.current_a - 8.4) < 0.01
    && Math.abs(reading.power_kw - 1.93) < 0.01 && reading.water_flow === true,
    reading ? `${reading.current_a}A ${reading.power_kw}kW flow=${reading.water_flow}` : 'timeout');

  r = await api('GET', `/devices/${deviceId}/status`);
  check('status: relay ON, live current, session running',
    r.status === 200 && r.json?.relay === 'ON' && Math.abs(r.json?.current_a - 8.4) < 0.01
    && r.json?.last_session?.end_reason === 'running');

  r = await api('GET', `/devices/${deviceId}/readings?resolution=raw`);
  check('readings stored in DB', r.status === 200 && r.json?.readings?.length >= 1, `${r.json?.readings?.length} rows`);

  // ---- device reports DRY_RUN_DETECTED -------------------------------------------
  const dryAlertPromise = waitForWs(ws, (m) => m.type === 'alert' && m.alert?.type === 'dry_run', 8000);
  const stateOffPromise = waitForWs(ws, (m) => m.type === 'device_state' && m.device?.relay === 'OFF', 8000);
  await pub(esp, 'alarms', 'DRY_RUN_DETECTED', false);
  check('dry_run alert broadcast on WS', !!(await dryAlertPromise));
  check('pump stopped after dry-run alarm (device_state OFF)', !!(await stateOffPromise));
  // the device firmware also drops its own relay
  await pub(esp, 'switch/water_pump/state', 'OFF');
  await pub(esp, 'events', 'PUMP_STOP', false);
  await sleep(300);

  r = await api('GET', `/devices/${deviceId}/sessions`);
  const sess = r.json?.sessions?.[0];
  check('session closed with end_reason=dry_run + energy/cost',
    r.status === 200 && sess && sess.ended_at && sess.end_reason === 'dry_run'
    && sess.energy_wh > 0 && sess.avg_a > 8 && sess.avg_a < 9 && sess.cost_tnd !== null,
    sess ? `${sess.energy_wh}Wh ${sess.avg_a}A ${sess.end_reason}` : '');

  r = await api('GET', '/alerts');
  check('dry_run alert in GET /alerts',
    r.status === 200 && r.json?.alerts?.some((a) => a.type === 'dry_run' && a.device_id === deviceId));

  // ---- LWT offline → 409 -----------------------------------------------------------
  const offlineAlertPromise = waitForWs(ws, (m) => m.type === 'alert' && m.alert?.type === 'offline', 8000);
  await pub(esp, 'status', 'offline'); // what the broker delivers from the LWT
  check('offline alert after status=offline (LWT)', !!(await offlineAlertPromise));
  r = await api('GET', '/devices');
  check('device marked offline', r.json?.devices?.[0]?.online === false);
  r = await api('POST', `/devices/${deviceId}/command`, { action: 'ON' });
  check('command while offline → 409 device_offline', r.status === 409 && r.json?.error === 'device_offline');

  // back online for a clean finish
  await pub(esp, 'status', 'online');
  await sleep(300);
  r = await api('GET', '/devices');
  check('device back online after status=online', r.json?.devices?.[0]?.online === true);

  // ---- auto-register from a NEW prefix + claim flow ----------------------------
  const esp2 = mqtt.connect(BROKER_URL, { clientId: 'esp32-fake-pump-2' });
  await new Promise((res2, rej) => { esp2.once('connect', res2); esp2.once('error', rej); });
  const pub2 = (suffix, payload) => new Promise((res2, rej) => {
    esp2.publish(`farm/pump2/${suffix}`, payload, { qos: 1 }, (err) => (err ? rej(err) : res2()));
  });
  await pub2('status', 'online');
  await pub2('sensor/pump_current/state', '5.0');
  await sleep(500); // let the bridge auto-register

  r = await api('POST', '/devices/claim', { device_id: 'dev-pump2', name: 'Pump 2' });
  check('new prefix farm/pump2 auto-registered (claim → 200)',
    r.status === 200 && r.json?.id === 'dev-pump2' && r.json?.name === 'Pump 2',
    JSON.stringify(r.json));
  // re-publish as unclaimed-style check is racy with the claim above; instead
  // verify a second NEW prefix is hidden until claimed:
  await new Promise((res2, rej) => esp.publish('farm/pump3/sensor/pump_current/state', '4.2', { qos: 1 }, (e) => (e ? rej(e) : res2())));
  await sleep(500);
  r = await api('GET', '/devices');
  check('auto-registered dev-pump3 NOT in GET /devices before claim',
    r.status === 200 && !r.json.devices.some((d) => d.id === 'dev-pump3'));
  r = await api('POST', '/devices/claim', { device_id: 'dev-pump3' });
  check('claim dev-pump3 → 200', r.status === 200 && r.json?.id === 'dev-pump3' && r.json?.name === 'Pump pump3');
  r = await api('GET', '/devices');
  check('dev-pump3 IS in GET /devices after claim',
    r.status === 200 && r.json.devices.some((d) => d.id === 'dev-pump3'));
  esp2.end(true);

  ws.close();
}

// ---- runner -------------------------------------------------------------------
const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tritonis-mqtt-smoke-')), 'test.db');
const serverDir = path.dirname(new URL(import.meta.url).pathname) + '/..';

let broker = null;
let tcpServer = null;
let esp = null;
let child = null;
let serverLog = '';

async function waitForServer(timeoutMs = 20000) {
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
  broker = await Aedes.createBroker();
  tcpServer = net.createServer(broker.handle);
  await new Promise((res2) => tcpServer.listen(MQTT_PORT, res2));

  child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(HTTP_PORT),
      DB_PATH: tmpDb,
      DEVICE_DRIVER: 'mqtt',
      MQTT_URL: BROKER_URL,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { serverLog += d; });
  child.stderr.on('data', (d) => { serverLog += d; });

  if (!(await waitForServer())) {
    console.error('server did not start. Log:\n' + serverLog);
    process.exit(1);
  }

  // Fake ESP32 client. Will message = what a real device LWT looks like.
  esp = mqtt.connect(BROKER_URL, {
    clientId: 'esp32-fake-pump',
    will: { topic: `${PREFIX}/status`, payload: 'offline', qos: 1, retain: true },
  });
  await new Promise((res2, rej) => { esp.once('connect', res2); esp.once('error', rej); });

  // Give the server's bridge a moment to connect + subscribe before publishing.
  await sleep(1000);

  await main(esp);
} catch (err) {
  console.error('mqtt smoke test crashed:', err);
  failures += 1;
} finally {
  if (esp) esp.end(true);
  if (child) child.kill('SIGTERM');
  if (tcpServer) tcpServer.close();
  if (broker) broker.close();
}

failures += results.filter((r) => !r.ok).length;
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
if (failures > 0) {
  console.log('MQTT-SMOKE: FAIL');
  console.error('--- server log tail ---\n' + serverLog.split('\n').slice(-40).join('\n'));
  process.exit(1);
}
console.log('MQTT-SMOKE: PASS');
process.exit(0);
