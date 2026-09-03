// Active device driver selection (env DEVICE_DRIVER):
//   sim  (default) — in-process ESP32 simulator (simulator.js)
//   mqtt           — real ESP32 pump controllers via MQTT broker (mqtt-bridge.js)
//
// Both drivers expose the same surface: command(deviceId, action, source),
// startDriver(), stopDriver(). Query helpers (getLive/getRelay/isOnline/
// deviceSummary/listSummaries) are driver-agnostic and live in ingest.js.
export const DRIVER_NAME = (process.env.DEVICE_DRIVER || 'sim').toLowerCase();

if (DRIVER_NAME !== 'sim' && DRIVER_NAME !== 'mqtt') {
  throw new Error(`[driver] unknown DEVICE_DRIVER="${DRIVER_NAME}" (expected sim|mqtt)`);
}

// Dynamic import so the mqtt package is only loaded when actually needed.
const impl = DRIVER_NAME === 'mqtt'
  ? await import('./mqtt-bridge.js')
  : await import('./simulator.js');

export const command = impl.command;
export const startDriver = impl.startDriver;
export const stopDriver = impl.stopDriver;

export {
  getLive, getRelay, isOnline, deviceSummary, listSummaries,
} from './ingest.js';
