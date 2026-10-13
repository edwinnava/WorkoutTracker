import type {
  DraftExercise,
  Exercise,
  DraftSet,
  ExerciseType,
  Routine,
  RoutineExercise,
  RoutineSet,
  Settings,
  SetType,
  Unit,
  Workout,
  WorkoutSet,
} from '../db/types';
import { fmtDistance, fmtDuration, fmtNum, fmtWeight, fromDisplayWeight, toDisplayWeight } from './units';
import { incrementFor } from './increments';

export interface SetSuggestion {
  type: SetType;
  weightKg?: number | null;
  reps?: number | null;
  durationSec?: number | null;
  distanceKm?: number | null;
}

export interface OverloadResult {
  sets: SetSuggestion[];
  note?: string;
}

interface OverloadOptions {
  unit: Unit;
  /** Weight jump for this exercise, in the display unit. */
  increment: number;
}

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? v[Math.floor((v.length - 1) / 2)] : 0;
};
const working = (sets: WorkoutSet[]) => sets.filter((s) => s.type !== 'warmup');
const topKg = (sets: WorkoutSet[]) => Math.max(0, ...working(sets).map((s) => s.weightKg ?? 0));
const totalReps = (sets: WorkoutSet[]) => working(sets).reduce((n, s) => n + (s.reps ?? 0), 0);

/**
 * Rep range to progress within. Uses the routine's range when it has one;
 * otherwise it's based on the reps you actually do: the median of your working
 * sets over recent sessions (e.g. a 5-rep lifter gets 5–7, a 10-rep lifter 10–12, a 15-rep lifter 15–18).
 */
export function repRange(history: WorkoutSet[][], targets?: RoutineSet[]): { min: number; max: number; auto: boolean } {
  const t = (targets ?? []).find((x) => x.type !== 'warmup' && x.reps != null);
  if (t?.reps != null) return { min: t.reps, max: Math.max(t.reps, t.repsMax ?? t.reps), auto: false };
  const reps = history.slice(0, 5).flatMap((s) => working(s).map((x) => x.reps ?? 0)).filter((r) => r > 0);
  const typical = Math.max(1, median(reps));
  return { min: typical, max: typical + Math.max(2, Math.floor(typical / 4)), auto: true };
}

/** Same top weight for the last 3 sessions without doing more total reps. */
export function isStalled(history: WorkoutSet[][], range: { max: number }): boolean {
  if (history.length < 3) return false;
  const [s0, s1, s2] = history;
  const w0 = topKg(s0);
  if (w0 <= 0) return false;
  const same = (w: number) => Math.abs(w - w0) < 0.05;
  if (!same(topKg(s1)) || !same(topKg(s2))) return false;
  if (working(s0).length > 0 && working(s0).every((s) => (s.reps ?? 0) >= range.max)) return false;
  return totalReps(s0) <= totalReps(s2);
}

/** Estimated one-rep max (Epley). */
const e1rm = (kg: number, reps: number) => kg * (1 + reps / 30);

/** Biggest single jump when you blew past the rep range, as a share of the last weight. */
const MAX_JUMP = 0.15;

/**
 * How many weight jumps to add when every working set hit the top of the range.
 * Normally 1. When every set beat the top by 2+ reps, the weight was too light:
 * jump toward what your reps say you can lift for the bottom of the range
 * (from your weakest set), capped at +15% so it stays safe.
 */
export function jumpCount(work: WorkoutSet[], range: { min: number; max: number }, increment: number, unit: Unit): number {
  const minReps = Math.min(...work.map((s) => s.reps ?? 0));
  if (increment <= 0 || minReps < range.max + 2) return 1;
  const top = Math.max(...work.map((s) => s.weightKg ?? 0));
  if (top <= 0) return 1;
  const est = Math.min(...work.filter((s) => (s.weightKg ?? 0) > 0).map((s) => e1rm(s.weightKg!, s.reps ?? 0)));
  const target = Math.min(est / (1 + range.min / 30), top * (1 + MAX_JUMP));
  const gain = toDisplayWeight(target - top, unit);
  return Math.max(1, Math.floor(gain / increment + 1e-9));
}

function addDisplay(kg: number, deltaDisplay: number, unit: Unit) {
  const d = Math.round((toDisplayWeight(kg, unit) + deltaDisplay) * 100) / 100;
  return fromDisplayWeight(Math.max(0, d), unit);
}

function scaleRounded(kg: number, factor: number, step: number, unit: Unit) {
  const d = toDisplayWeight(kg, unit) * factor;
  const s = step > 0 ? step : 1;
  return fromDisplayWeight(Math.round(d / s) * s, unit);
}

/**
 * Double progression on the last session, newest first in `history`:
 * - every working set reached the top of the rep range → add weight, back to the bottom of the range
 * - otherwise → same weight, one more rep per set (within the range)
 * - stuck at the same weight for 3 sessions → deload ~10% and build back up
 */
export function progressiveOverload(
  type: ExerciseType,
  history: WorkoutSet[][],
  targetSets: RoutineSet[] | undefined,
  opts: OverloadOptions,
): OverloadResult {
  const lastSets = history[0] ?? [];
  const count = targetSets?.length || lastSets.length;
  if (count === 0) return { sets: [] };
  if (lastSets.length === 0) return { sets: (targetSets ?? []).map((t) => ({ ...t })) };

  const work = working(lastSets);
  const lastWorking = work[work.length - 1] ?? lastSets[lastSets.length - 1];
  const range = repRange(history, targetSets);
  const { unit, increment } = opts;

  const weighted = type === 'weight_reps' || type === 'weighted_bodyweight';
  const assisted = type === 'assisted_bodyweight';
  const repsBased = weighted || assisted || type === 'reps_only';
  const allHitTop = repsBased && work.length > 0 && work.every((s) => (s.reps ?? 0) >= range.max);
  const deload = weighted && !allHitTop && isStalled(history, range);
  // Epley only makes sense for the full load on the bar, not added/assisted bodyweight.
  const jumps = allHitTop && type === 'weight_reps' ? jumpCount(work, range, increment, unit) : 1;
  const jump = increment * jumps;

  const sets: SetSuggestion[] = [];
  for (let i = 0; i < count; i++) {
    const setType: SetType = targetSets?.[i]?.type ?? lastSets[i]?.type ?? 'normal';
    const prev = lastSets[i] && lastSets[i].type === setType ? lastSets[i] : setType === 'warmup' ? lastSets[i] : lastWorking;
    if (!prev) {
      sets.push({ ...(targetSets?.[i] ?? { type: setType }) });
      continue;
    }
    if (setType === 'warmup' || !repsBased) {
      sets.push({ type: setType, weightKg: prev.weightKg, reps: prev.reps, durationSec: prev.durationSec, distanceKm: prev.distanceKm });
      continue;
    }
    const prevReps = prev.reps ?? 0;
    const prevKg = prev.weightKg ?? 0;
    if (deload) {
      sets.push({ type: setType, weightKg: scaleRounded(prevKg, 0.9, increment, unit), reps: range.min });
    } else if (allHitTop && (weighted || assisted)) {
      sets.push({ type: setType, weightKg: addDisplay(prevKg, assisted ? -increment : jump, unit), reps: range.min });
    } else if (type === 'reps_only') {
      sets.push({ type: setType, reps: prevReps + 1 });
    } else {
      sets.push({ type: setType, weightKg: prev.weightKg, reps: Math.min(Math.max(prevReps + 1, range.min), range.max) });
    }
  }

  const rangeText = range.min === range.max ? `${range.min} reps` : `${range.min}–${range.max} reps`;
  let note: string | undefined;
  if (deload) note = 'No progress in 3 sessions → deload ~10% and build back up';
  else if (jumps > 1) {
    const fewest = Math.min(...work.map((x) => x.reps ?? 0));
    note = `${fewest}+ reps is well past ${range.max} → +${fmtNum(jump)} ${unit} to get back in range`;
  } else if (allHitTop && (weighted || assisted)) note = `Hit ${range.max}+ reps on every set → ${assisted ? '−' : '+'}${fmtNum(increment)} ${unit}`;
  else if (type === 'reps_only') note = 'Aim for 1 more rep per set';
  else if (repsBased) note = `Aim for 1 more rep per set (${rangeText}${range.auto ? ', based on your recent sets' : ''})`;
  return { sets, note };
}

export function emptyDraftSet(type: SetType = 'normal'): DraftSet {
  return { type, weight: '', reps: '', duration: '', distance: '', done: false };
}

export function suggestionToDraftSet(s: SetSuggestion, unit: Unit): DraftSet {
  return {
    ...emptyDraftSet(s.type),
    sugWeight: s.weightKg != null && s.weightKg !== 0 ? fmtWeight(s.weightKg, unit) : undefined,
    sugReps: s.reps != null ? String(s.reps) : undefined,
    sugDuration: s.durationSec != null ? fmtDuration(s.durationSec) : undefined,
    sugDistance: s.distanceKm != null ? fmtDistance(s.distanceKm, unit) : undefined,
  };
}

export function lastSetsFor(lastWorkout: Workout | undefined, exerciseId: string): WorkoutSet[] {
  if (!lastWorkout) return [];
  return lastWorkout.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets);
}

let keyCounter = 0;
export function draftKey() {
  keyCounter++;
  return `${Date.now().toString(36)}-${keyCounter}`;
}

export function buildDraftExercise(opts: {
  exerciseId: string;
  exercise?: Exercise;
  routineExercise?: RoutineExercise;
  /** Sets from previous sessions of this exercise, newest first. */
  history: WorkoutSet[][];
  settings: Settings;
  unit: Unit;
}): DraftExercise {
  const { exerciseId, exercise, routineExercise, history, settings, unit } = opts;
  const type = exercise?.type ?? 'weight_reps';
  const result = progressiveOverload(type, history, routineExercise?.sets, {
    unit,
    increment: incrementFor(exercise, { ...settings, unit }),
  });
  let sets = result.sets.map((s) => suggestionToDraftSet(s, unit));
  if (sets.length === 0) sets = [emptyDraftSet()];
  return {
    key: draftKey(),
    exerciseId,
    notes: routineExercise?.notes ?? '',
    restSec: routineExercise?.restSec ?? settings.defaultRestSec,
    supersetId: routineExercise?.supersetId ?? null,
    suggestionNote: history.length ? result.note : undefined,
    sets,
  };
}

/* ---------- Today's suggested routine ---------- */

export interface TodaySuggestion {
  /** picked = chosen on the plan screen; rest/picked-rest = rest day (scheduled or chosen). */
  kind: 'scheduled' | 'rest' | 'rotation' | 'picked' | 'picked-rest' | 'none';
  routine?: Routine;
}

function sameDay(a: number, b: number) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** Routine a workout was done from: by routine id, or by title (imported Hevy workouts). */
export function routineIdForWorkout(w: Workout, routines: Routine[]): string | undefined {
  if (w.routineId && routines.some((r) => r.id === w.routineId)) return w.routineId;
  const t = w.title.trim().toLowerCase();
  return routines.find((r) => r.name.trim().toLowerCase() === t)?.id;
}

function lastDoneRoutineId(routines: Routine[], workoutsNewestFirst: Workout[]): string | undefined {
  for (const w of workoutsNewestFirst) {
    const id = routineIdForWorkout(w, routines);
    if (id) return id;
  }
  return undefined;
}

/** The pick from the plan screen, if it still applies. */
export function activePick(settings: Settings, workoutsNewestFirst: Workout[], now = Date.now()) {
  const pick = settings.nextPick;
  if (!pick) return null;
  if (pick.routineId === 'rest') return sameDay(pick.at, now) ? pick : null;
  // A routine pick lasts until you finish a workout after picking it.
  if (workoutsNewestFirst.some((w) => w.endTime >= pick.at)) return null;
  return pick;
}

/**
 * Today's workout, in order of priority:
 * 1. what you picked on the plan screen (until you finish a workout)
 * 2. the routine scheduled for this weekday (or a scheduled rest day)
 * 3. the next routine in rotation after the one you did most recently
 *    (matched by routine id or by workout title, so imported Hevy history works too)
 */
export function suggestToday(
  routines: Routine[],
  workoutsNewestFirst: Workout[],
  settings: Settings,
  now = new Date(),
): TodaySuggestion {
  const sorted = [...routines].sort((a, b) => a.order - b.order);
  const pick = activePick(settings, workoutsNewestFirst, now.getTime());
  if (pick?.routineId === 'rest') return { kind: 'picked-rest' };
  if (pick) {
    const r = sorted.find((x) => x.id === pick.routineId);
    if (r) return { kind: 'picked', routine: r };
  }
  const planned = settings.schedule[now.getDay()];
  if (planned === 'rest') return { kind: 'rest' };
  if (planned) {
    const r = sorted.find((x) => x.id === planned);
    if (r) return { kind: 'scheduled', routine: r };
  }
  if (sorted.length === 0) return { kind: 'none' };
  return { kind: 'rotation', routine: nextInRotation(sorted, workoutsNewestFirst) };
}

export function nextInRotation(sortedRoutines: Routine[], workoutsNewestFirst: Workout[]): Routine {
  const last = lastDoneRoutineId(sortedRoutines, workoutsNewestFirst);
  if (!last) return sortedRoutines[0];
  const idx = sortedRoutines.findIndex((r) => r.id === last);
  return sortedRoutines[(idx + 1) % sortedRoutines.length];
}

/** Routines in the order they'll come up, starting with `first`. */
export function upcomingOrder(sortedRoutines: Routine[], first?: Routine): Routine[] {
  if (!first) return sortedRoutines;
  const i = sortedRoutines.findIndex((r) => r.id === first.id);
  if (i < 0) return sortedRoutines;
  return [...sortedRoutines.slice(i), ...sortedRoutines.slice(0, i)];
}

/** When each routine was last done (ms), keyed by routine id. */
export function lastDoneByRoutine(routines: Routine[], workoutsNewestFirst: Workout[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const w of workoutsNewestFirst) {
    const id = routineIdForWorkout(w, routines);
    if (id && !out.has(id)) out.set(id, w.startTime);
  }
  return out;
}
