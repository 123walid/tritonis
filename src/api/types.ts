// Backend contract types — SPEC §1. JSON field names are contractual (snake_case).

export type RelayState = 'ON' | 'OFF';

export interface DeviceSummary {
  id: string;
  name: string;
  online: boolean;
  relay: RelayState;
  current_a: number | null; // null when off/unknown
  power_kw: number | null;
  water_flow: boolean | null; // null = sensor n/a
  last_seen_at: string | null; // ISO 8601 UTC
}

export interface Session {
  id: string;
  device_id: string;
  started_at: string;
  ended_at: string | null;
  duration_s: number;
  energy_wh: number;
  avg_a: number | null;
  min_a: number | null;
  max_a: number | null;
  water_m3: number | null;
  cost_tnd: number | null;
  tariff_period: 'off_peak' | 'standard' | 'peak' | 'mixed';
  end_reason:
    | 'manual'
    | 'schedule'
    | 'timer'
    | 'pulse'
    | 'dry_run'
    | 'high_load'
    | 'running'
    | null;
}

export interface Timer {
  id: string;
  device_id: string;
  action: RelayState;
  run_at: string;
  enabled: boolean;
}

export interface PulseProgram {
  id: string;
  device_id: string;
  on_min: number;
  off_min: number;
  cycles: number | null; // null = until end_at
  start_at: string | null;
  end_at: string | null;
  enabled: boolean;
  phase: RelayState;
  cycles_done: number;
}

export interface DeviceStatus extends DeviceSummary {
  today: {
    energy_kwh: number;
    cost_tnd: number;
    water_m3: number;
    runtime_min: number;
    sessions: number;
  };
  last_session: Session | null;
  active_timer: Timer | null;
  active_pulse: PulseProgram | null;
}

export interface Schedule {
  id: string;
  device_id: string;
  time_local: string; // 'HH:MM' 24h, Africa/Tunis
  action: RelayState;
  days_mask: number; // bit0=Mon … bit6=Sun; 127 = everyday
  type: 'manual' | 'tariff_optimized';
  enabled: boolean;
}

export interface Reading {
  ts: string;
  current_a: number;
  power_kw: number;
  water_flow: boolean;
}

export type AlertType =
  | 'offline'
  | 'online'
  | 'dry_run'
  | 'high_load'
  | 'unexpected_stop'
  | 'schedule_executed'
  | 'power_failure';

export interface Alert {
  id: string;
  device_id: string;
  device_name: string;
  type: AlertType;
  message: string;
  created_at: string;
  read: boolean;
}

export interface NotifPrefs {
  offline: boolean;
  online: boolean;
  dry_run: boolean;
  high_load: boolean;
  unexpected_stop: boolean;
  schedule_executed: boolean;
}
