import type { Exercise, ExerciseType, Workout, WorkoutSet } from '../db/types';

/** Epley estimated one-rep max. */
export function estimate1RM(weightKg: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

export function isWorkingSet(s: WorkoutSet) {
  return s.type !== 'warmup';
}

export function usesWeight(type: ExerciseType) {
  return type === 'weight_reps' || type === 'weighted_bodyweight' || type === 'assisted_bodyweight';
}

export function usesReps(type: ExerciseType) {
  return type === 'weight_reps' || type === 'reps_only' || type === 'weighted_bodyweight' || type === 'assisted_bodyweight';
}

export function usesDuration(type: ExerciseType) {
  return type === 'duration' || type === 'distance_duration';
}

export function usesDistance(type: ExerciseType) {
  return type === 'distance_duration';
}

export function setVolume(s: WorkoutSet, type?: ExerciseType): number {
  if (type === 'assisted_bodyweight') return 0;
  return (s.weightKg ?? 0) * (s.reps ?? 0);
}

export function workoutVolume(w: Workout, exMap?: Map<string, Exercise>): number {
  let v = 0;
  for (const e of w.exercises) {
    const type = exMap?.get(e.exerciseId)?.type;
    for (const s of e.sets) v += setVolume(s, type);
  }
  return v;
}

export function workoutSetCount(w: Workout): number {
  return w.exercises.reduce((n, e) => n + e.sets.length, 0);
}

export interface ExerciseSession {
  workoutId?: number;
  workoutTitle: string;
  date: number;
  sets: WorkoutSet[];
  bestSet?: WorkoutSet;
  heaviestKg: number;
  best1RM: number;
  volumeKg: number;
  maxReps: number;
  maxDurationSec: number;
  maxDistanceKm: number;
}

export function sessionsForExercise(workouts: Workout[], exerciseId: string, type?: ExerciseType): ExerciseSession[] {
  const out: ExerciseSession[] = [];
  for (const w of workouts) {
    const sets = w.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets);
    if (sets.length === 0) continue;
    const working = sets.filter(isWorkingSet);
    const pool = working.length ? working : sets;
    let bestSet: WorkoutSet | undefined;
    let best1RM = 0;
    let heaviestKg = 0;
    let volumeKg = 0;
    let maxReps = 0;
    let maxDurationSec = 0;
    let maxDistanceKm = 0;
    for (const s of pool) {
      const e1 = estimate1RM(s.weightKg ?? 0, s.reps ?? 0);
      if (e1 > best1RM || (!bestSet && (s.reps ?? 0) > 0)) {
        best1RM = Math.max(best1RM, e1);
        bestSet = s;
      }
      heaviestKg = Math.max(heaviestKg, s.weightKg ?? 0);
      volumeKg += setVolume(s, type);
      maxReps = Math.max(maxReps, s.reps ?? 0);
      maxDurationSec = Math.max(maxDurationSec, s.durationSec ?? 0);
      maxDistanceKm = Math.max(maxDistanceKm, s.distanceKm ?? 0);
    }
    if (!bestSet) bestSet = pool[0];
    out.push({
      workoutId: w.id,
      workoutTitle: w.title,
      date: w.startTime,
      sets,
      bestSet,
      heaviestKg,
      best1RM,
      volumeKg,
      maxReps,
      maxDurationSec,
      maxDistanceKm,
    });
  }
  return out.sort((a, b) => b.date - a.date);
}

export interface PersonalRecords {
  heaviestKg: number;
  best1RM: number;
  bestSetVolumeKg: number;
  bestSessionVolumeKg: number;
  maxReps: number;
  maxDurationSec: number;
  maxDistanceKm: number;
}

export function personalRecords(sessions: ExerciseSession[]): PersonalRecords {
  const pr: PersonalRecords = {
    heaviestKg: 0,
    best1RM: 0,
    bestSetVolumeKg: 0,
    bestSessionVolumeKg: 0,
    maxReps: 0,
    maxDurationSec: 0,
    maxDistanceKm: 0,
  };
  for (const s of sessions) {
    pr.heaviestKg = Math.max(pr.heaviestKg, s.heaviestKg);
    pr.best1RM = Math.max(pr.best1RM, s.best1RM);
    pr.bestSessionVolumeKg = Math.max(pr.bestSessionVolumeKg, s.volumeKg);
    pr.maxReps = Math.max(pr.maxReps, s.maxReps);
    pr.maxDurationSec = Math.max(pr.maxDurationSec, s.maxDurationSec);
    pr.maxDistanceKm = Math.max(pr.maxDistanceKm, s.maxDistanceKm);
    for (const set of s.sets) {
      if (set.type === 'warmup') continue;
      pr.bestSetVolumeKg = Math.max(pr.bestSetVolumeKg, (set.weightKg ?? 0) * (set.reps ?? 0));
    }
  }
  return pr;
}

/**
 * Counts PRs set in a workout compared with all earlier workouts.
 * A PR is a new heaviest weight, best estimated 1RM, or most reps (bodyweight).
 */
export function countWorkoutPRs(workout: Workout, earlier: Workout[], exMap: Map<string, Exercise>): number {
  let prs = 0;
  for (const ex of workout.exercises) {
    const type = exMap.get(ex.exerciseId)?.type ?? 'weight_reps';
    const prev = personalRecords(sessionsForExercise(earlier, ex.exerciseId, type));
    const cur = personalRecords(sessionsForExercise([workout], ex.exerciseId, type));
    if (prev.best1RM === 0 && prev.maxReps === 0 && prev.maxDurationSec === 0) continue; // first time isn't a PR
    if (type === 'weight_reps' || type === 'weighted_bodyweight') {
      if (cur.heaviestKg > prev.heaviestKg) prs++;
      if (cur.best1RM > prev.best1RM) prs++;
    } else if (type === 'reps_only') {
      if (cur.maxReps > prev.maxReps) prs++;
    } else if (type === 'duration' || type === 'distance_duration') {
      if (cur.maxDurationSec > prev.maxDurationSec) prs++;
      if (cur.maxDistanceKm > prev.maxDistanceKm) prs++;
    }
  }
  return prs;
}

/** Start of the week (Monday 00:00 local) containing `t`. */
export function startOfWeek(t: number): number {
  const d = new Date(t);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Consecutive weeks (ending this week or last week) with at least one workout. */
export function weekStreak(workouts: Workout[], now = Date.now()): number {
  const weeks = new Set(workouts.map((w) => startOfWeek(w.startTime)));
  let cursor = startOfWeek(now);
  if (!weeks.has(cursor)) cursor = startOfWeek(cursor - 86400000);
  let streak = 0;
  while (weeks.has(cursor)) {
    streak++;
    cursor = startOfWeek(cursor - 86400000);
  }
  return streak;
}
