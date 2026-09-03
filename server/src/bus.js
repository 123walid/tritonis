// In-process event bus: simulator/scheduler emit, ws.js broadcasts.
import { EventEmitter } from 'node:events';

export const bus = new EventEmitter();
bus.setMaxListeners(50);

// Events:
//  'device_state'  (DeviceSummary)          — relay/online/water_flow changes
//  'reading'       ({device_id, ts, current_a, power_kw, water_flow})
//  'alert'         (Alert)
