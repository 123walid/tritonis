// Schedule day-mask helpers — SPEC §2. bit0=Mon … bit6=Sun.
import { t } from '../i18n';

export const DAY_BITS = [1, 2, 4, 8, 16, 32, 64]; // Mon..Sun
export const DAY_ORDER = [0, 1, 2, 3, 4, 5, 6]; // Mon-first

const EVERYDAY = 127;
const WEEKDAYS = 1 + 2 + 4 + 8 + 16; // Mon–Fri = 31
const WEEKEND = 32 + 64; // Sat+Sun = 96

const DAY_KEYS = ['days.mon', 'days.tue', 'days.wed', 'days.thu', 'days.fri', 'days.sat', 'days.sun'];

/** e.g. 'Everyday' / 'Weekdays' / 'Weekend' / 'Mon · Wed' */
export function maskToLabel(mask: number): string {
  if (mask === EVERYDAY) return t('days.everyday');
  if (mask === WEEKDAYS) return t('days.weekdays');
  if (mask === WEEKEND) return t('days.weekend');
  return DAY_ORDER.filter((i) => mask & DAY_BITS[i])
    .map((i) => t(DAY_KEYS[i]))
    .join(' · ');
}

/** Toggle one day bit; never returns 0 (returns mask unchanged if it would empty it). */
export function toggleDay(mask: number, dayIdx: number): number {
  const next = mask ^ DAY_BITS[dayIdx];
  return next === 0 ? mask : next;
}
