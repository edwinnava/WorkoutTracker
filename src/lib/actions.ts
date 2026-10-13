import { db, getSettings, newId, withExerciseIds } from '../db/db';
import type { ActiveWorkout, DraftExercise, DraftSet, Routine, Workout, WorkoutSet } from '../db/types';
import { buildDraftExercise, draftKey, emptyDraftSet, lastSetsFor } from './suggest';
import {
  fmtDistance,
  fmtDuration,
  fmtWeight,
  fromDisplayDistance,
  fromDisplayWeight,
  parseDuration,
  parseNum,
} from './units';

export async function lastWorkoutWith(exerciseId: string, beforeTime?: number): Promise<Workout | undefined> {
  const list = await db.workouts.where('exerciseIds').equals(exerciseId).toArray();
  return list
    .filter((w) => beforeTime == null || w.startTime < beforeTime)
    .sort((a, b) => b.startTime - a.startTime)[0];
}

export async function makeDraftExercise(exerciseId: string, routineEx?: Routine['exercises'][number]): Promise<DraftExercise> {
  const [settings, ex, last] = await Promise.all([getSettings(), db.exercises.get(exerciseId), lastWorkoutWith(exerciseId)]);
  return buildDraftExercise({
    exerciseId,
    type: ex?.type ?? 'weight_reps',
    routineExercise: routineEx,
    lastSets: lastSetsFor(last, exerciseId),
    settings,
    unit: settings.unit,
  });
}

function defaultTitle(now = new Date()) {
  const h = now.getHours();
  const part = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
  return `${part} Workout`;
}

export async function hasActiveWorkout() {
  return !!(await db.active.get('current'));
}

export async function startWorkout(routine?: Routine): Promise<void> {
  const settings = await getSettings();
  const exercises = routine ? await Promise.all(routine.exercises.map((re) => makeDraftExercise(re.exerciseId, re))) : [];
  const active: ActiveWorkout = {
    id: 'current',
    title: routine?.name ?? defaultTitle(),
    description: '',
    startTime: Date.now(),
    unit: settings.unit,
    routineId: routine?.id || undefined,
    exercises,
  };
  await db.active.put(active);
}

/** Starts a new workout with the same exercises as a past one ("Repeat workout"). */
export async function repeatWorkout(w: Workout): Promise<void> {
  const routine: Routine = workoutToRoutine(w, w.title);
  await startWorkout({ ...routine, id: w.routineId ?? '' });
}

function setToDraft(s: WorkoutSet, unit: ActiveWorkout['unit']): DraftSet {
  return {
    ...emptyDraftSet(s.type),
    weight: s.weightKg != null ? fmtWeight(s.weightKg, unit) : '',
    reps: s.reps != null ? String(s.reps) : '',
    duration: s.durationSec != null ? fmtDuration(s.durationSec) : '',
    distance: s.distanceKm != null ? fmtDistance(s.distanceKm, unit) : '',
    done: true,
  };
}

/** Loads a saved workout into the editor. */
export async function editWorkout(w: Workout): Promise<void> {
  const settings = await getSettings();
  await db.active.put({
    id: 'current',
    title: w.title,
    description: w.description ?? '',
    startTime: w.startTime,
    unit: settings.unit,
    routineId: w.routineId,
    editingId: w.id,
    editingEndTime: w.endTime,
    exercises: w.exercises.map((e) => ({
      key: draftKey(),
      exerciseId: e.exerciseId,
      notes: e.notes ?? '',
      restSec: settings.defaultRestSec,
      supersetId: e.supersetId ?? null,
      sets: e.sets.map((s) => setToDraft(s, settings.unit)),
    })),
  });
}

/** Resolves a draft set to a saved set, using suggestion placeholders for empty fields. */
export function draftSetToSet(s: DraftSet, unit: ActiveWorkout['unit']): WorkoutSet {
  const w = parseNum(s.weight || s.sugWeight);
  const reps = parseNum(s.reps || s.sugReps);
  const dist = parseNum(s.distance || s.sugDistance);
  const dur = parseDuration(s.duration || s.sugDuration);
  return {
    type: s.type,
    weightKg: w != null ? fromDisplayWeight(w, unit) : null,
    reps: reps != null ? Math.round(reps) : null,
    distanceKm: dist != null ? fromDisplayDistance(dist, unit) : null,
    durationSec: dur,
  };
}

export function draftToWorkout(a: ActiveWorkout, endTime: number): Workout {
  const exercises = a.exercises
    .map((e) => ({
      exerciseId: e.exerciseId,
      ...(e.notes.trim() ? { notes: e.notes.trim() } : {}),
      ...(e.supersetId != null ? { supersetId: e.supersetId } : {}),
      sets: e.sets.filter((s) => s.done).map((s) => draftSetToSet(s, a.unit)),
    }))
    .filter((e) => e.sets.length > 0);
  return withExerciseIds({
    ...(a.editingId != null ? { id: a.editingId } : {}),
    title: a.title.trim() || 'Workout',
    ...(a.description.trim() ? { description: a.description.trim() } : {}),
    startTime: a.startTime,
    endTime,
    exercises,
    ...(a.routineId ? { routineId: a.routineId } : {}),
    source: 'app',
  });
}

export async function finishWorkout(a: ActiveWorkout, endTime?: number): Promise<number> {
  const w = draftToWorkout(a, endTime ?? a.editingEndTime ?? Date.now());
  return db.transaction('rw', db.workouts, db.active, async () => {
    const id = await db.workouts.put(w);
    await db.active.delete('current');
    return id;
  });
}

export async function discardWorkout() {
  await db.active.delete('current');
}

export function workoutToRoutine(w: Workout, name: string): Routine {
  return {
    id: newId('r-'),
    name,
    order: Date.now(),
    createdAt: Date.now(),
    exercises: w.exercises.map((e) => ({
      exerciseId: e.exerciseId,
      notes: e.notes,
      supersetId: e.supersetId ?? null,
      sets: e.sets.map((s) => ({
        type: s.type,
        weightKg: s.weightKg ?? null,
        reps: s.reps ?? null,
        durationSec: s.durationSec ?? null,
        distanceKm: s.distanceKm ?? null,
      })),
    })),
  };
}

export async function saveWorkoutAsRoutine(w: Workout, name: string): Promise<string> {
  const count = await db.routines.count();
  const r = { ...workoutToRoutine(w, name), order: count };
  await db.routines.put(r);
  return r.id;
}
