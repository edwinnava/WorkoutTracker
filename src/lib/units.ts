import type { Unit } from '../db/types';

export const LBS_PER_KG = 2.20462262185;
export const KM_PER_MILE = 1.609344;

export function toDisplayWeight(kg: number, unit: Unit): number {
  return unit === 'kg' ? kg : kg * LBS_PER_KG;
}

export function fromDisplayWeight(value: number, unit: Unit): number {
  return unit === 'kg' ? value : value / LBS_PER_KG;
}

export function toDisplayDistance(km: number, unit: Unit): number {
  return unit === 'kg' ? km : km / KM_PER_MILE;
}

export function fromDisplayDistance(value: number, unit: Unit): number {
  return unit === 'kg' ? value : value * KM_PER_MILE;
}

export function distanceUnit(unit: Unit) {
  return unit === 'kg' ? 'km' : 'mi';
}

/** Rounds to at most 2 decimals and strips trailing zeros. */
export function fmtNum(n: number, maxDecimals = 2): string {
  const f = 10 ** maxDecimals;
  return String(Math.round(n * f) / f);
}

export function fmtWeight(kg: number | null | undefined, unit: Unit): string {
  if (kg == null) return '';
  return fmtNum(toDisplayWeight(kg, unit), 1);
}

export function fmtDistance(km: number | null | undefined, unit: Unit): string {
  if (km == null) return '';
  return fmtNum(toDisplayDistance(km, unit), 2);
}

export function parseNum(s: string | undefined | null): number | null {
  if (s == null) return null;
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Accepts "90", "1:30", "1:02:03". Returns seconds. */
export function parseDuration(s: string | undefined | null): number | null {
  if (s == null) return null;
  const t = s.trim();
  if (t === '') return null;
  const parts = t.split(':').map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** Human duration like "1h 5min" for workout lengths. */
export function fmtLongDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

export function fmtVolume(kg: number, unit: Unit): string {
  const v = Math.round(toDisplayWeight(kg, unit));
  return `${v.toLocaleString()} ${unit}`;
}
