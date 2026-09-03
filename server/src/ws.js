// WebSocket endpoint: /ws?token=<jwt>
// Server → client messages: hello, device_state, reading, alert (SPEC §1).
// Connections are per-user: hello/broadcasts only cover devices the user owns.
import { WebSocketServer } from 'ws';
import { verifyToken } from './auth.js';
import { db } from './db.js';
import { bus } from './bus.js';
import { listSummaries } from './driver.js';

export function setupWs(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws') return socket.destroy();
    const user = verifyToken(url.searchParams.get('token') || '');
    if (!user) {
      // 401-equivalent close so the app triggers logout (SPEC §1).
      return wss.handleUpgrade(req, socket, head, (ws) => ws.close(4401, 'unauthorized'));
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.user = user;
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'hello', devices: listSummaries(ws.user.id) }));
  });

  const ownerOf = (deviceId) =>
    db.prepare('SELECT user_id FROM devices WHERE id = ?').get(deviceId)?.user_id ?? null;

  // Only deliver device-scoped messages to the device owner's connections.
  const broadcast = (msg, deviceId) => {
    const data = JSON.stringify(msg);
    const owner = ownerOf(deviceId);
    if (!owner) return; // unclaimed device: nobody to notify
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN && ws.user?.id === owner) ws.send(data);
    }
  };
  bus.on('device_state', (device) => broadcast({ type: 'device_state', device }, device?.id));
  bus.on('reading', (r) => broadcast({ type: 'reading', ...r }, r.device_id));
  bus.on('alert', (alert) => broadcast({ type: 'alert', alert }, alert.device_id));

  return wss;
}
