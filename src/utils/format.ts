// Display formatting — SPEC §2. All times rendered in Africa/Tunis, locale-aware via i18n lang.
import { currentLocale } from '../i18n';

export const TZ = 'Africa/Tunis';

function parts(iso: string, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const dtf = new Intl.DateTimeFormat(currentLocale(), { timeZone: TZ, ...opts });
  const out: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(iso))) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  return out;
}

/** 'HH:MM' in Africa/Tunis (24h). */
export function fmtTime(iso: string): string {
  const p = parts(iso, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${p.hour}:${p.minute}`;
}

/** 'dd MMM, HH:MM' in Africa/Tunis, localized month names. */
export function fmtDateTime(iso: string): string {
  const p = parts(iso, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${p.day} ${p.month}, ${p.hour}:${p.minute}`;
}

/** 'dd MMM yyyy' in Africa/Tunis, localized month names. */
export function fmtDate(iso: string): string {
  const p = parts(iso, { day: '2-digit', month: 'short', year: 'numeric' });
  return `${p.day} ${p.month} ${p.year}`;
}

const DASH = '—';

/** '8.4 A' / '—' */
export function fmtA(n: number | null): string {
  return n === null ? DASH : `${n.toFixed(1)} A`;
}

/** '2.31 kW' / '—' */
export function fmtKw(n: number | null): string {
  return n === null ? DASH : `${n.toFixed(2)} kW`;
}

/** '12.4 kWh' / '—' */
export function fmtKwh(n: number | null): string {
  return n === null ? DASH : `${n.toFixed(1)} kWh`;
}

/** '1.73 TND' (2 decimals) / '—' */
export function fmtTnd(n: number | null): string {
  return n === null ? DASH : `${n.toFixed(2)} TND`;
}

/** '3.2 m³' / '—' */
export function fmtM3(n: number | null): string {
  return n === null ? DASH : `${n.toFixed(1)} m³`;
}

/** '1 h 25 min' / '1 h' / '42 min' */
export function fmtMin(n: number): string {
  const total = Math.max(0, Math.round(n));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

/** Localized short weekday (Mon/Lun…) in Africa/Tunis. */
export function weekdayShort(dateIso: string): string {
  return new Intl.DateTimeFormat(currentLocale(), {
    weekday: 'short',
    timeZone: TZ,
  }).format(new Date(dateIso));
}
