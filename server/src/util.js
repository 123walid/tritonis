// Shared helpers: Africa/Tunis time, IDs, ISO timestamps.
import crypto from 'node:crypto';

export const TZ = 'Africa/Tunis';

export const nowIso = () => new Date().toISOString();

export const newId = () => crypto.randomUUID();

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
  weekday: 'short',
});

const WEEKDAY_BIT = { Mon: 1, Tue: 2, Wed: 4, Thu: 8, Fri: 16, Sat: 32, Sun: 64 };

// Local (Africa/Tunis) wall-clock parts for a given instant.
export function tunisParts(date = new Date()) {
  const out = {};
  for (const p of partsFmt.formatToParts(date)) out[p.type] = p.value;
  const hhmm = `${out.hour}:${out.minute}`;
  return {
    hhmm,                                    // 'HH:MM' 24h local
    minutes: parseInt(out.hour, 10) * 60 + parseInt(out.minute, 10),
    hour: parseInt(out.hour, 10),
    dateStr: `${out.year}-${out.month}-${out.day}`, // 'YYYY-MM-DD' local
    dayBit: WEEKDAY_BIT[out.weekday],        // bit0=Mon … bit6=Sun
  };
}

// 'YYYY-MM-DD' local date key for an instant (used for readings grouping / "today").
export function tunisDateKey(date = new Date()) {
  return tunisParts(date).dateStr;
}

export function tunisHourKey(date = new Date()) {
  const p = tunisParts(date);
  return `${p.dateStr} ${String(p.hour).padStart(2, '0')}`;
}
