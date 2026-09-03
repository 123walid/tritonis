// STEG tariff engine. Config loaded from config/tariffs.json at boot (editable JSON).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tunisParts } from './util.js';

const CONFIG_PATH = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'config', 'tariffs.json');

let config = { currency: 'TND', periods: [] };

export function loadTariffs() {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  config = {
    currency: raw.currency || 'TND',
    periods: raw.periods.map((p) => ({
      name: p.name,
      fromMin: hhmmToMin(p.from),
      toMin: hhmmToMin(p.to),
      price: p.price_tnd_kwh,
    })),
  };
  return config;
}

function hhmmToMin(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

export function getTariffConfig() {
  return config;
}

// Tariff period name for an instant, in Africa/Tunis local time.
export function periodAt(date = new Date()) {
  const t = tunisParts(date).minutes;
  for (const p of config.periods) {
    if (p.fromMin <= p.toMin) {
      if (t >= p.fromMin && t < p.toMin) return p.name;
    } else if (t >= p.fromMin || t < p.toMin) { // wraps midnight (e.g. 23:00–08:00)
      return p.name;
    }
  }
  return 'standard';
}

export function priceFor(periodName) {
  return config.periods.find((p) => p.name === periodName)?.price ?? 0;
}

// Cost a session whose energy arrived in timestamped segments:
//   segments = [{ ts: epochMs, kwh: number }]
// Each segment is billed at the tariff period of its own timestamp, so a
// session spanning a boundary is split correctly → tariff_period 'mixed'.
export function costSegments(segments, fallbackDate = new Date()) {
  let cost = 0;
  const seen = new Set();
  for (const seg of segments) {
    if (!(seg.kwh > 0)) continue;
    const period = periodAt(new Date(seg.ts));
    cost += seg.kwh * priceFor(period);
    seen.add(period);
  }
  let period;
  if (seen.size === 0) period = periodAt(fallbackDate);
  else if (seen.size === 1) period = [...seen][0];
  else period = 'mixed';
  return { cost_tnd: round3(cost), tariff_period: period };
}

export const round3 = (n) => Math.round(n * 1000) / 1000;
