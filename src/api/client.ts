import { API_URL } from '../config';
import { getAuthToken, handleUnauthorized } from './auth-bridge';
import type {
  Alert,
  DeviceStatus,
  DeviceSummary,
  NotifPrefs,
  PulseProgram,
  Reading,
  RelayState,
  Schedule,
  Session,
  Timer,
} from './types';

const TIMEOUT_MS = 15000;

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Skip the 401 → forceLogout side effect (used by login itself). */
  skipAuthHandling?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, skipAuthHandling = false } = opts;
  const token = getAuthToken();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    const isTimeout = e instanceof Error && e.name === 'AbortError';
    throw new ApiError(0, isTimeout ? 'timeout' : 'network_error');
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 && !skipAuthHandling) {
    handleUnauthorized();
  }

  if (!res.ok) {
    let code = 'http_error';
    let message: string | undefined;
    try {
      const data = (await res.json()) as { error?: string; message?: string };
      if (data.error) code = data.error;
      message = data.message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function qs(params: Record<string, string | undefined>): string {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
    .join('&');
  return q ? `?${q}` : '';
}

// --- auth ---

export async function login(
  email: string,
  password: string,
): Promise<{ token: string; user: { id: string; email: string } }> {
  return request('/auth/login', { method: 'POST', body: { email, password }, skipAuthHandling: true });
}

/** Best-effort logout; never throws. */
export async function logout(): Promise<void> {
  try {
    await request<void>('/auth/logout', { method: 'POST' });
  } catch {
    /* ignore */
  }
}

export async function changePassword(current: string, next: string): Promise<void> {
  await request<void>('/auth/password', {
    method: 'POST',
    body: { current_password: current, new_password: next },
  });
}

// --- devices ---

export async function getDevices(): Promise<DeviceSummary[]> {
  const res = await request<{ devices: DeviceSummary[] }>('/devices');
  return res.devices;
}

export async function renameDevice(id: string, name: string): Promise<DeviceSummary> {
  return request<DeviceSummary>(`/devices/${id}`, { method: 'PATCH', body: { name } });
}

/** Throws ApiError with status 409 when the device is offline. */
export async function sendCommand(id: string, action: RelayState): Promise<void> {
  await request<void>(`/devices/${id}/command`, { method: 'POST', body: { action } });
}

export async function getDeviceStatus(id: string): Promise<DeviceStatus> {
  return request<DeviceStatus>(`/devices/${id}/status`);
}

export async function getSessions(id: string, from?: string, to?: string): Promise<Session[]> {
  const res = await request<{ sessions: Session[] }>(`/devices/${id}/sessions${qs({ from, to })}`);
  return res.sessions;
}

export async function getReadings(
  id: string,
  from: string,
  to: string,
  resolution: 'raw' | 'hour' | 'day',
): Promise<Reading[]> {
  const res = await request<{ readings: Reading[] }>(
    `/devices/${id}/readings${qs({ from, to, resolution })}`,
  );
  return res.readings;
}

// --- schedules ---

export async function getSchedules(id: string): Promise<Schedule[]> {
  const res = await request<{ schedules: Schedule[] }>(`/devices/${id}/schedules`);
  return res.schedules;
}

export async function createSchedule(
  id: string,
  s: Pick<Schedule, 'time_local' | 'action' | 'days_mask'> & Partial<Pick<Schedule, 'type' | 'enabled'>>,
): Promise<Schedule> {
  return request<Schedule>(`/devices/${id}/schedules`, { method: 'POST', body: s });
}

export async function updateSchedule(
  id: string,
  sid: string,
  patch: Partial<Pick<Schedule, 'time_local' | 'action' | 'days_mask' | 'enabled'>>,
): Promise<Schedule> {
  return request<Schedule>(`/devices/${id}/schedules/${sid}`, { method: 'PATCH', body: patch });
}

export async function deleteSchedule(id: string, sid: string): Promise<void> {
  await request<void>(`/devices/${id}/schedules/${sid}`, { method: 'DELETE' });
}

// --- timers ---

export async function getTimers(id: string): Promise<Timer[]> {
  const res = await request<{ timers: Timer[] }>(`/devices/${id}/timers`);
  return res.timers;
}

export async function createTimer(id: string, action: RelayState, delayMin: number): Promise<Timer> {
  return request<Timer>(`/devices/${id}/timers`, {
    method: 'POST',
    body: { action, delay_min: delayMin },
  });
}

export async function cancelTimer(id: string, tid: string): Promise<void> {
  await request<void>(`/devices/${id}/timers/${tid}`, { method: 'DELETE' });
}

// --- pulse ---

export async function getPulse(id: string): Promise<PulseProgram | null> {
  const res = await request<{ pulse: PulseProgram | null }>(`/devices/${id}/pulse`);
  return res.pulse;
}

export async function startPulse(
  id: string,
  p: { on_min: number; off_min: number; cycles?: number; start_at?: string },
): Promise<PulseProgram> {
  return request<PulseProgram>(`/devices/${id}/pulse`, { method: 'POST', body: p });
}

export async function stopPulse(id: string): Promise<void> {
  await request<void>(`/devices/${id}/pulse/stop`, { method: 'POST' });
}

// --- alerts ---

export async function getAlerts(): Promise<Alert[]> {
  const res = await request<{ alerts: Alert[] }>('/alerts');
  return res.alerts;
}

export async function markAlertRead(id: string): Promise<void> {
  await request<void>(`/alerts/${id}/read`, { method: 'POST' });
}

export async function markAllAlertsRead(): Promise<void> {
  await request<void>('/alerts/read-all', { method: 'POST' });
}

// --- settings / push ---

export async function getNotifPrefs(): Promise<NotifPrefs> {
  return request<NotifPrefs>('/settings/notifications');
}

export async function setNotifPrefs(patch: Partial<NotifPrefs>): Promise<NotifPrefs> {
  return request<NotifPrefs>('/settings/notifications', { method: 'PATCH', body: patch });
}

/** Registers the push token with the backend; never throws (logs). */
export async function registerPushToken(token: string, platform: 'android' | 'ios'): Promise<void> {
  try {
    await request<void>('/push/register', {
      method: 'POST',
      body: { fcm_token: token, platform },
    });
  } catch (e) {
    console.warn('[api] registerPushToken failed', e);
  }
}

/**
 * Claims a device for the current account.
 * Throws ApiError code 'device_not_found' (404) or 'already_claimed' (403).
 */
export async function claimDevice(deviceId: string, name?: string): Promise<DeviceSummary> {
  return request<DeviceSummary>('/devices/claim', {
    method: 'POST',
    body: { device_id: deviceId, ...(name ? { name } : {}) },
  });
}

export async function getProvisionToken(): Promise<{ token: string; expires_at: string }> {
  return request<{ token: string; expires_at: string }>('/provision/token', { method: 'POST' });
}

/**
 * Confirms provisioning of a device with a provision token.
 * Throws ApiError code 'invalid_token' | 'token_expired' (400) or 'not_found' (404).
 */
export async function confirmProvision(
  token: string,
  deviceId: string,
  name?: string,
): Promise<void> {
  await request<{ ok: true }>('/provision/confirm', {
    method: 'POST',
    body: { token, device_id: deviceId, ...(name ? { name } : {}) },
  });
}
