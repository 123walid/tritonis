import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { RtEvent } from '../api/realtime';
import type { Alert, DeviceSummary } from '../api/types';

const ALERTS_CAP = 100;

export interface DevicesState {
  devices: Record<string, DeviceSummary>; // keyed by id — realtime updates write here
  alerts: Alert[];
  unreadCount: number;
  hydrate(devices: DeviceSummary[]): void;
  applyEvent(e: RtEvent): void; // device_state/reading/hello/alert
  setAlerts(a: Alert[]): void;
  markRead(id: string): void;
  markAllRead(): void;
}

function keyById(list: DeviceSummary[]): Record<string, DeviceSummary> {
  const out: Record<string, DeviceSummary> = {};
  for (const d of list) out[d.id] = d;
  return out;
}

export const useDevicesStore: UseBoundStore<StoreApi<DevicesState>> = create<DevicesState>(
  (set) => ({
    devices: {},
    alerts: [],
    unreadCount: 0,

    hydrate(devices) {
      set({ devices: keyById(devices) });
    },

    applyEvent(e) {
      switch (e.kind) {
        case 'hello':
          set({ devices: keyById(e.devices) });
          break;
        case 'device_state':
          set((s) => ({ devices: { ...s.devices, [e.device.id]: e.device } }));
          break;
        case 'reading':
          set((s) => {
            const d = s.devices[e.device_id];
            if (!d) return s;
            return {
              devices: {
                ...s.devices,
                [e.device_id]: {
                  ...d,
                  online: true,
                  current_a: e.current_a,
                  power_kw: e.power_kw,
                  water_flow: e.water_flow,
                  last_seen_at: e.ts,
                },
              },
            };
          });
          break;
        case 'alert':
          set((s) => ({
            alerts: [e.alert, ...s.alerts].slice(0, ALERTS_CAP),
            unreadCount: e.alert.read ? s.unreadCount : s.unreadCount + 1,
          }));
          break;
      }
    },

    setAlerts(a) {
      const alerts = a.slice(0, ALERTS_CAP);
      set({ alerts, unreadCount: alerts.filter((x) => !x.read).length });
    },

    markRead(id) {
      set((s) => {
        const target = s.alerts.find((a) => a.id === id);
        if (!target || target.read) return s;
        return {
          alerts: s.alerts.map((a) => (a.id === id ? { ...a, read: true } : a)),
          unreadCount: Math.max(0, s.unreadCount - 1),
        };
      });
    },

    markAllRead() {
      set((s) => ({
        alerts: s.alerts.map((a) => (a.read ? a : { ...a, read: true })),
        unreadCount: 0,
      }));
    },
  }),
);
