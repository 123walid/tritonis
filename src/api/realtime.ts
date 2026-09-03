import { AppState } from 'react-native';
import { WS_URL } from '../config';
import { useAuthStore } from '../store/auth';
import type { Alert, DeviceSummary } from './types';

export type RtEvent =
  | { kind: 'hello'; devices: DeviceSummary[] }
  | { kind: 'device_state'; device: DeviceSummary }
  | {
      kind: 'reading';
      device_id: string;
      ts: string;
      current_a: number;
      power_kw: number;
      water_flow: boolean;
    }
  | { kind: 'alert'; alert: Alert };

type ServerMessage =
  | { type: 'hello'; devices: DeviceSummary[] }
  | { type: 'device_state'; device: DeviceSummary }
  | {
      type: 'reading';
      device_id: string;
      ts: string;
      current_a: number;
      power_kw: number;
      water_flow: boolean;
    }
  | { type: 'alert'; alert: Alert };

const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30000;
/** Close codes used by the server to signal an invalid/expired token. */
const AUTH_CLOSE_CODES = new Set([4401, 1008]);

/**
 * Connects to the backend WebSocket and forwards parsed events.
 * Reconnects with exponential backoff (1s → 30s cap), reconnects after
 * login/logout (reactive to the auth store) and pauses while the app is
 * backgrounded or the user is logged out. Returns a stop() function.
 */
export function startRealtime(onEvent: (e: RtEvent) => void): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let appActive = AppState.currentState !== 'background';

  const clearRetry = () => {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const closeSocket = () => {
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      ws = null;
    }
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    clearRetry();
    const delay = Math.min(BACKOFF_MIN_MS * 2 ** attempt, BACKOFF_MAX_MS);
    attempt += 1;
    retryTimer = setTimeout(connect, delay);
  };

  const connect = () => {
    if (stopped || !appActive) return;
    const token = useAuthStore.getState().token;
    if (!token || ws) return; // paused while logged out

    const socket = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
    ws = socket;

    socket.onopen = () => {
      attempt = 0;
    };

    socket.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'hello':
          onEvent({ kind: 'hello', devices: msg.devices });
          break;
        case 'device_state':
          onEvent({ kind: 'device_state', device: msg.device });
          break;
        case 'reading':
          onEvent({
            kind: 'reading',
            device_id: msg.device_id,
            ts: msg.ts,
            current_a: msg.current_a,
            power_kw: msg.power_kw,
            water_flow: msg.water_flow,
          });
          break;
        case 'alert':
          onEvent({ kind: 'alert', alert: msg.alert });
          break;
      }
    };

    socket.onclose = (ev) => {
      if (ws === socket) ws = null;
      if (stopped) return;
      if (AUTH_CLOSE_CODES.has(ev.code)) {
        useAuthStore.getState().forceLogout();
        return;
      }
      scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose follows and handles reconnect.
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    };
  };

  // React to login/logout: (re)connect when a token appears, pause when it goes.
  const unsubAuth = useAuthStore.subscribe((state, prev) => {
    if (stopped) return;
    if (state.token && !prev.token) {
      attempt = 0;
      connect();
    } else if (!state.token && prev.token) {
      clearRetry();
      closeSocket();
    }
  });

  // Pause in background, resume (immediately) when active again.
  const subAppState = AppState.addEventListener('change', (next) => {
    appActive = next !== 'background';
    if (stopped) return;
    if (appActive) {
      attempt = 0;
      connect();
    } else {
      clearRetry();
      closeSocket();
    }
  });

  connect();

  return () => {
    stopped = true;
    clearRetry();
    closeSocket();
    unsubAuth();
    subAppState.remove();
  };
}
