import Papa from 'papaparse';
import type { Exercise, ExerciseType, SetType, Workout, WorkoutExercise, WorkoutSet } from '../db/types';
import { slugify } from '../data/exercises';
import { KM_PER_MILE, LBS_PER_KG } from './units';

/**
 * Hevy's "Export Workouts" CSV has one row per set:
 *   title, start_time, end_time, description, exercise_title, superset_id,
 *   exercise_notes, set_index, set_type, weight_lbs|weight_kg, reps,
 *   distance_miles|distance_km, duration_seconds, rpe
 */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** Parses Hevy dates such as "8 Oct 2024, 17:59", "Oct 8, 2024, 5:59 PM", or ISO strings. Local time. */
export function parseHevyDate(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  let m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (mon !== undefined) {
      return new Date(+m[3], mon, +m[1], to24(+m[4], m[7]), +m[5], +(m[6] ?? 0)).getTime();
    }
  }
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase().slice(0, 3)];
    if (mon !== undefined) {
      return new Date(+m[3], mon, +m[2], to24(+m[4], m[7]), +m[5], +(m[6] ?? 0)).getTime();
    }
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)).getTime();
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function to24(h: number, ampm?: string) {
  if (!ampm) return h;
  const pm = ampm.toUpperCase() === 'PM';
  if (h === 12) return pm ? 12 : 0;
  return pm ? h + 12 : h;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function setType(v: unknown): SetType {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'warmup' || s === 'warm_up' || s === 'warm-up') return 'warmup';
  if (s === 'failure') return 'failure';
  if (s === 'dropset' || s === 'drop_set') return 'dropset';
  return 'normal';
}

export interface ParsedExercise {
  name: string;
  notes?: string;
  supersetId?: number | null;
  sets: WorkoutSet[];
}

export interface ParsedWorkout {
  title: string;
  description?: string;
  startTime: number;
  endTime: number;
  exercises: ParsedExercise[];
}

export interface ParseResult {
  workouts: ParsedWorkout[];
  rows: number;
  skippedRows: number;
  weightUnit: 'kg' | 'lbs' | 'unknown';
}

export function parseHevyCsv(text: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const fields = parsed.meta.fields ?? [];
  if (!fields.includes('exercise_title') || !fields.includes('start_time')) {
    throw new Error(
      'This doesn\'t look like a Hevy workout export. Expected columns like "title", "start_time", "exercise_title". ' +
        'In Hevy go to Profile → Settings → Export & Import Data → Export Workouts.',
    );
  }
  const weightUnit: ParseResult['weightUnit'] = fields.includes('weight_kg')
    ? 'kg'
    : fields.includes('weight_lbs')
      ? 'lbs'
      : 'unknown';

  const byKey = new Map<string, ParsedWorkout>();
  let skipped = 0;

  for (const row of parsed.data) {
    const start = parseHevyDate(row.start_time);
    const exName = (row.exercise_title ?? '').trim();
    if (start == null || !exName) {
      skipped++;
      continue;
    }
    const end = parseHevyDate(row.end_time) ?? start;
    const title = (row.title ?? '').trim() || 'Workout';
    const key = `${start}|${title}`;
    let w = byKey.get(key);
    if (!w) {
      w = {
        title,
        description: (row.description ?? '').trim() || undefined,
        startTime: start,
        endTime: Math.max(end, start),
        exercises: [],
      };
      byKey.set(key, w);
    }

    const supersetId = num(row.superset_id);
    const notes = (row.exercise_notes ?? '').trim() || undefined;
    const setIndex = num(row.set_index);
    // A new exercise block starts when the exercise changes or the set index resets to 0.
    let ex = w.exercises[w.exercises.length - 1];
    if (!ex || ex.name !== exName || setIndex === 0) {
      ex = { name: exName, notes, supersetId, sets: [] };
      w.exercises.push(ex);
    }

    const lbs = num(row.weight_lbs);
    const kg = num(row.weight_kg);
    const miles = num(row.distance_miles);
    const km = num(row.distance_km);
    ex.sets.push({
      type: setType(row.set_type),
      weightKg: kg ?? (lbs != null ? lbs / LBS_PER_KG : null),
      reps: num(row.reps),
      distanceKm: km ?? (miles != null ? miles * KM_PER_MILE : null),
      durationSec: num(row.duration_seconds),
      rpe: num(row.rpe),
    });
  }

  const workouts = [...byKey.values()].sort((a, b) => a.startTime - b.startTime);
  return { workouts, rows: parsed.data.length, skippedRows: skipped, weightUnit };
}

/** Guesses the logging type of an unknown exercise from the data recorded for it. */
export function inferType(sets: WorkoutSet[]): ExerciseType {
  const has = (f: (s: WorkoutSet) => unknown) => sets.some((s) => f(s) != null && f(s) !== 0);
  if (has((s) => s.distanceKm)) return 'distance_duration';
  if (has((s) => s.weightKg)) return 'weight_reps';
  if (has((s) => s.reps)) return 'reps_only';
  if (has((s) => s.durationSec)) return 'duration';
  return 'weight_reps';
}

export function normalizeName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface ImportPlan {
  workouts: Omit<Workout, 'id'>[];
  newExercises: Exercise[];
  duplicates: number;
}

/**
 * Turns parsed workouts into records ready to save. Matches exercises by name
 * (case-insensitive), creates custom exercises for unknown names, and skips
 * workouts that already exist (same start time and title).
 */
export function planImport(
  parsed: ParsedWorkout[],
  existingExercises: Exercise[],
  existingWorkoutKeys: Set<string>,
): ImportPlan {
  const byName = new Map(existingExercises.map((e) => [normalizeName(e.name), e]));
  const ids = new Set(existingExercises.map((e) => e.id));
  const newExercises: Exercise[] = [];
  const workouts: Omit<Workout, 'id'>[] = [];
  let duplicates = 0;

  for (const pw of parsed) {
    if (existingWorkoutKeys.has(workoutKey(pw.startTime, pw.title))) {
      duplicates++;
      continue;
    }
    const exercises: WorkoutExercise[] = pw.exercises.map((pe) => {
      let ex = byName.get(normalizeName(pe.name));
      if (!ex) {
        let id = 'custom-' + slugify(pe.name);
        while (ids.has(id)) id += '-1';
        ex = { id, name: pe.name.trim(), muscle: 'other', equipment: 'other', type: inferType(pe.sets), custom: true };
        ids.add(id);
        byName.set(normalizeName(pe.name), ex);
        newExercises.push(ex);
      }
      return {
        exerciseId: ex.id,
        sets: pe.sets,
        ...(pe.notes ? { notes: pe.notes } : {}),
        ...(pe.supersetId != null ? { supersetId: pe.supersetId } : {}),
      };
    });
    workouts.push({
      title: pw.title,
      description: pw.description,
      startTime: pw.startTime,
      endTime: pw.endTime,
      exercises,
      exerciseIds: [...new Set(exercises.map((e) => e.exerciseId))],
      source: 'hevy',
    });
  }
  return { workouts, newExercises, duplicates };
}

export function workoutKey(startTime: number, title: string) {
  return `${startTime}|${title.trim().toLowerCase()}`;
}

/* ---------- Export in Hevy's format (so data stays portable) ---------- */

function fmtHevyDate(t: number) {
  const d = new Date(t);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()} ${mon} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toHevyCsv(workouts: Workout[], exercises: Map<string, Exercise>, unit: 'kg' | 'lbs'): string {
  const rows: (string | number)[][] = [];
  const r2 = (n: number) => Math.round(n * 100) / 100;
  for (const w of [...workouts].sort((a, b) => b.startTime - a.startTime)) {
    for (const e of w.exercises) {
      e.sets.forEach((s, i) => {
        rows.push([
          w.title,
          fmtHevyDate(w.startTime),
          fmtHevyDate(w.endTime),
          w.description ?? '',
          exercises.get(e.exerciseId)?.name ?? e.exerciseId,
          e.supersetId ?? '',
          e.notes ?? '',
          i,
          s.type,
          s.weightKg == null ? '' : r2(unit === 'kg' ? s.weightKg : s.weightKg * LBS_PER_KG),
          s.reps ?? '',
          s.distanceKm == null ? '' : r2(unit === 'kg' ? s.distanceKm : s.distanceKm / KM_PER_MILE),
          s.durationSec ?? '',
          s.rpe ?? '',
        ]);
      });
    }
  }
  return Papa.unparse({
    fields: [
      'title', 'start_time', 'end_time', 'description', 'exercise_title', 'superset_id', 'exercise_notes',
      'set_index', 'set_type', unit === 'kg' ? 'weight_kg' : 'weight_lbs', 'reps',
      unit === 'kg' ? 'distance_km' : 'distance_miles', 'duration_seconds', 'rpe',
    ],
    data: rows,
  }, { quotes: true });
}
