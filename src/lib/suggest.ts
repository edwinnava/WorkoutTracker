import type {
  DraftExercise,
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

/** Rounds a kg value so that it lands on a clean number in the display unit. */
function roundForUnit(kg: number, unit: Unit, step: number): number {
  const display = toDisplayWeight(kg, unit);
  const s = step > 0 ? Math.min(step, unit === 'kg' ? 1.25 : 2.5) : 0.5;
  return fromDisplayWeight(Math.round(display / s) * s, unit);
}

/**
 * Double progression: work within a rep range. When every working set from the
 * last session reached the top of the range, add weight and drop back to the bottom.
 * Otherwise keep the weight and aim for one more rep per set.
 */
export function progressiveOverload(
  type: ExerciseType,
  lastSets: WorkoutSet[],
  targetSets: RoutineSet[] | undefined,
  settings: Pick<Settings, 'increment' | 'repRangeMin' | 'repRangeMax' | 'unit'>,
): OverloadResult {
  const count = targetSets?.length || lastSets.length;
  if (count === 0) return { sets: [] };

  if (lastSets.length === 0) {
    return { sets: (targetSets ?? []).map((t) => ({ ...t })) };
  }

  const working = lastSets.filter((s) => s.type !== 'warmup');
  const lastWorking = working[working.length - 1] ?? lastSets[lastSets.length - 1];
  const workingTargets = (targetSets ?? []).filter((t) => t.type !== 'warmup');
  const repsMin = workingTargets[0]?.reps ?? settings.repRangeMin;
  const repsMax = workingTargets[0]?.repsMax ?? (workingTargets[0]?.reps ? workingTargets[0].reps : settings.repRangeMax);
  const incKg = fromDisplayWeight(settings.increment, settings.unit);

  const weighted = type === 'weight_reps' || type === 'weighted_bodyweight';
  const assisted = type === 'assisted_bodyweight';
  const repsBased = weighted || assisted || type === 'reps_only';

  const allHitTop = repsBased && working.length > 0 && working.every((s) => (s.reps ?? 0) >= repsMax);

  const sets: SetSuggestion[] = [];
  for (let i = 0; i < count; i++) {
    const setType: SetType = targetSets?.[i]?.type ?? lastSets[i]?.type ?? 'normal';
    const prev = lastSets[i] && lastSets[i].type === setType ? lastSets[i] : setType === 'warmup' ? lastSets[i] : lastWorking;
    if (!prev) {
      sets.push({ ...(targetSets?.[i] ?? { type: setType }) });
      continue;
    }
    if (setType === 'warmup' || !repsBased) {
      sets.push({
        type: setType,
        weightKg: prev.weightKg,
        reps: prev.reps,
        durationSec: prev.durationSec,
        distanceKm: prev.distanceKm,
      });
      continue;
    }
    const prevReps = prev.reps ?? 0;
    const prevKg = prev.weightKg ?? 0;
    if (allHitTop && (weighted || assisted)) {
      const next = assisted ? Math.max(0, prevKg - incKg) : prevKg + incKg;
      sets.push({ type: setType, weightKg: roundForUnit(next, settings.unit, settings.increment), reps: repsMin });
    } else if (type === 'reps_only') {
      sets.push({ type: setType, reps: prevReps + 1 });
    } else {
      sets.push({
        type: setType,
        weightKg: prev.weightKg,
        reps: Math.min(Math.max(prevReps + 1, repsMin), repsMax),
      });
    }
  }

  let note: string | undefined;
  if (allHitTop && (weighted || assisted)) {
    note = `Hit ${repsMax}+ reps on every set last time → ${assisted ? '−' : '+'}${fmtNum(settings.increment)} ${settings.unit}`;
  } else if (repsBased && type !== 'reps_only') {
    note = `Aim for 1 more rep per set (${repsMin}–${repsMax} range)`;
  } else if (type === 'reps_only') {
    note = 'Aim for 1 more rep per set';
  }
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
  type: ExerciseType;
  routineExercise?: RoutineExercise;
  lastSets: WorkoutSet[];
  settings: Settings;
  unit: Unit;
}): DraftExercise {
  const { exerciseId, type, routineExercise, lastSets, settings, unit } = opts;
  const targets = routineExercise?.sets;
  const result = progressiveOverload(type, lastSets, targets, settings);
  let sets = result.sets.map((s) => suggestionToDraftSet(s, unit));
  if (sets.length === 0) sets = [emptyDraftSet()];
  return {
    key: draftKey(),
    exerciseId,
    notes: routineExercise?.notes ?? '',
    restSec: routineExercise?.restSec ?? settings.defaultRestSec,
    supersetId: routineExercise?.supersetId ?? null,
    suggestionNote: lastSets.length ? result.note : undefined,
    sets,
  };
}

/* ---------- Today's suggested routine ---------- */

export interface TodaySuggestion {
  kind: 'scheduled' | 'rest' | 'rotation' | 'none';
  routine?: Routine;
}

function lastDoneRoutineId(routines: Routine[], workouts: Workout[]): string | undefined {
  // workouts expected newest first
  const byName = new Map(routines.map((r) => [r.name.trim().toLowerCase(), r.id]));
  for (const w of workouts) {
    if (w.routineId && routines.some((r) => r.id === w.routineId)) return w.routineId;
    const id = byName.get(w.title.trim().toLowerCase());
    if (id) return id;
  }
  return undefined;
}

/**
 * Today's workout: the routine scheduled for this weekday, otherwise the next
 * routine in rotation after the one you did most recently (matched by routine
 * id or by workout title, so imported Hevy history works too).
 */
export function suggestToday(
  routines: Routine[],
  workoutsNewestFirst: Workout[],
  settings: Settings,
  now = new Date(),
): TodaySuggestion {
  const sorted = [...routines].sort((a, b) => a.order - b.order);
  const planned = settings.schedule[now.getDay()];
  if (planned === 'rest') return { kind: 'rest' };
  if (planned) {
    const r = sorted.find((x) => x.id === planned);
    if (r) return { kind: 'scheduled', routine: r };
  }
  if (sorted.length === 0) return { kind: 'none' };
  const last = lastDoneRoutineId(sorted, workoutsNewestFirst);
  if (!last) return { kind: 'rotation', routine: sorted[0] };
  const idx = sorted.findIndex((r) => r.id === last);
  return { kind: 'rotation', routine: sorted[(idx + 1) % sorted.length] };
}
