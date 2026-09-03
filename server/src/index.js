// Tritonis dev backend entry point.
//   node src/index.js          → boots on http://0.0.0.0:4000 (PORT env to override)
import http from 'node:http';
import express from 'express';
import cors from 'cors';

import { seed } from './db.js';
import { requireAuth } from './auth.js';
import { loadTariffs } from './tariffs.js';
import { startDriver, DRIVER_NAME } from './driver.js';
import { startScheduler } from './scheduler.js';
import { setupWs } from './ws.js';

import authRoutes from './routes/auth.js';
import deviceRoutes from './routes/devices.js';
import scheduleRoutes from './routes/schedules.js';
import timerRoutes from './routes/timers.js';
import pulseRoutes from './routes/pulse.js';
import alertRoutes from './routes/alerts.js';
import settingsRoutes from './routes/settings.js';

const PORT = parseInt(process.env.PORT || '4000', 10);

seed();
loadTariffs();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/v1/health', (_req, res) => res.json({ ok: true }));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/devices', requireAuth, deviceRoutes);
app.use('/api/v1/devices/:id/schedules', requireAuth, scheduleRoutes);
app.use('/api/v1/devices/:id/timers', requireAuth, timerRoutes);
app.use('/api/v1/devices/:id/pulse', requireAuth, pulseRoutes);
app.use('/api/v1/alerts', requireAuth, alertRoutes);
app.use('/api/v1', requireAuth, settingsRoutes); // /settings/*, /push/*, /provision/*

app.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'Unknown route' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[http] error:', err);
  res.status(500).json({ error: 'internal', message: 'Internal server error' });
});

const server = http.createServer(app);
setupWs(server);

startDriver();
console.log(`[tritonis] device driver: ${DRIVER_NAME}`);
startScheduler();

server.listen(PORT, () => {
  console.log(`[tritonis] API listening on http://0.0.0.0:${PORT}/api/v1 — WS on ws://0.0.0.0:${PORT}/ws`);
});
