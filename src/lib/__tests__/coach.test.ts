import { describe, expect, it } from 'vitest';
import { cautionFor, isOffSession, mixUpRoutine, muscleStats, recentAreas, recommendWorkout } from '../coach';
import { activeElapsedMs } from '../actions';
import { progressiveOverload } from '../suggest';
import { BUILT_IN_EXERCISES } from '../../data/exercises';
import type { Workout, WorkoutFeedback } from '../../db/types';

const DAY = 86400000;
const NOW = new Date('2026-06-15T18:00:00').getTime();
const id = (name: string) => BUILT_IN_EXERCISES.find((e) => e.name === name)!.id;
const ex = (name: string) => BUILT_IN_EXERCISES.find((e) => e.name === name)!;
const exMap = new Map(BUILT_IN_EXERCISES.map((e) => [e.id, e]));

function workout(daysAgo: number, names: string[], feedback?: WorkoutFeedback): Workout {
  const startTime = NOW - daysAgo * DAY;
  const exercises = names.map((n) => ({ exerciseId: id(n), sets: [1, 2, 3].map(() => ({ type: 'normal' as const, weightKg: 40, reps: 10 })) }));
  return { id: daysAgo, title: 'W', startTime, endTime: startTime + 3600000, exercises, exerciseIds: exercises.map((e) => e.exerciseId), feedback };
}

// Four weeks of upper-body-only training, twice a week.
const PUSH = ['Bench Press (Barbell)', 'Overhead Press (Barbell)', 'Triceps Pushdown', 'Lateral Raise (Dumbbell)'];
const PULL = ['Lat Pulldown (Cable)', 'Seated Cable Row - V Grip (Cable)', 'Bicep Curl (Dumbbell)', 'Leg Extension (Machine)'];
const upperOnly = [3, 10, 17, 24].flatMap((d) => [workout(d, PUSH), workout(d + 2, PULL)]);

describe('feedback', () => {
  it('ignores a session only for exercises that load the sore area', () => {
    const w = workout(1, PUSH, { light: true, areas: ['shoulder'] });
    expect(isOffSession(w, ex('Overhead Press (Barbell)'))).toBe(true);
    expect(isOffSession(w, ex('Bench Press (Barbell)'))).toBe(true); // shoulders assist
    expect(isOffSession(w, ex('Leg Extension (Machine)'))).toBe(false);
  });
  it('ignores the whole workout when it was light with no area named', () => {
    const w = workout(1, PUSH, { light: true });
    expect(isOffSession(w, ex('Leg Extension (Machine)'))).toBe(true);
    expect(isOffSession(workout(1, PUSH, { note: 'felt fine' }), ex('Leg Extension (Machine)'))).toBe(false);
  });
  it('stays cautious about a flagged area for a while, then forgets it', () => {
    const recent = recentAreas([workout(4, PUSH, { areas: ['shoulder'] })], NOW);
    expect(cautionFor(ex('Lateral Raise (Dumbbell)'), recent)).toBe('shoulder');
    expect(cautionFor(ex('Leg Extension (Machine)'), recent)).toBeUndefined();
    expect(recentAreas([workout(20, PUSH, { areas: ['shoulder'] })], NOW)).toEqual([]);
  });
  it('holds the weight instead of progressing when told to', () => {
    const last = [{ type: 'normal' as const, weightKg: 50, reps: 12 }, { type: 'normal' as const, weightKg: 50, reps: 12 }];
    const r = progressiveOverload('weight_reps', [last], [{ type: 'normal', reps: 8, repsMax: 12 }, { type: 'normal', reps: 8, repsMax: 12 }], { unit: 'kg', increment: 2.5, hold: 'shoulder' });
    expect(r.sets.map((s) => [s.weightKg, s.reps])).toEqual([[50, 12], [50, 12]]);
    expect(r.note).toMatch(/shoulder/);
  });
});

describe('muscleStats', () => {
  it('counts direct sets fully and assisting sets as half', () => {
    const s = muscleStats([workout(1, ['Bench Press (Barbell)'])], exMap, NOW);
    const get = (m: string) => s.find((x) => x.muscle === m)!;
    expect(get('chest').weekly).toBe(3);
    expect(get('triceps').weekly).toBe(1.5);
    expect(get('quadriceps')).toMatchObject({ weekly: 0, deficit: 1, daysSince: null });
  });
});

describe('recommendWorkout', () => {
  it('goes after what you have been skipping', () => {
    const rec = recommendWorkout(upperOnly, BUILT_IN_EXERCISES, { now: NOW })!;
    const muscles = rec.focus.map((f) => f.muscle);
    expect(muscles).toEqual(expect.arrayContaining(['hamstrings', 'glutes', 'calves']));
    expect(rec.exercises.length).toBeGreaterThanOrEqual(5);
    expect(new Set(rec.exercises.map((e) => e.exerciseId)).size).toBe(rec.exercises.length);
  });
  it('leaves out muscles trained yesterday', () => {
    const rec = recommendWorkout([workout(0.5, ['Squat (Barbell)', 'Leg Extension (Machine)']), ...upperOnly], BUILT_IN_EXERCISES, { now: NOW })!;
    expect(rec.focus.map((f) => f.muscle)).not.toContain('quadriceps');
  });
  it('steers around an area that was bothering you', () => {
    const hist = [workout(2, ['Leg Extension (Machine)'], { areas: ['shoulder'] }), ...upperOnly.map((w) => ({ ...w, exercises: w.exercises.slice(2) }))];
    for (let seed = 0; seed < 5; seed++) {
      const rec = recommendWorkout(hist, BUILT_IN_EXERCISES, { now: NOW, seed })!;
      for (const e of rec.exercises) expect(cautionFor(exMap.get(e.exerciseId), [{ area: 'shoulder' }])).toBeUndefined();
      expect(rec.avoiding).toContain('shoulder');
    }
  });
  it('is stable for a seed and changes when shuffled', () => {
    const a = recommendWorkout(upperOnly, BUILT_IN_EXERCISES, { now: NOW, seed: 1 })!;
    const b = recommendWorkout(upperOnly, BUILT_IN_EXERCISES, { now: NOW, seed: 1 })!;
    expect(a.exercises).toEqual(b.exercises);
    const picks = new Set([0, 1, 2, 3, 4, 5].map((seed) => JSON.stringify(recommendWorkout(upperOnly, BUILT_IN_EXERCISES, { now: NOW, seed })!.exercises.map((e) => e.exerciseId))));
    expect(picks.size).toBeGreaterThan(1);
  });
  it('works with no history at all', () => {
    const rec = recommendWorkout([], BUILT_IN_EXERCISES, { now: NOW })!;
    expect(rec.exercises.length).toBeGreaterThanOrEqual(5);
  });
});

describe('mixUpRoutine', () => {
  it('swaps exercises for similar ones on the same muscle', () => {
    const routine = PUSH.map((n) => ({ exerciseId: id(n), sets: [{ type: 'normal' as const, reps: 8, repsMax: 12, weightKg: 40 }] }));
    const mixed = mixUpRoutine(routine, upperOnly, BUILT_IN_EXERCISES, { now: NOW });
    expect(mixed).toHaveLength(routine.length);
    const changed = mixed.filter((m, i) => m.exerciseId !== routine[i].exerciseId);
    expect(changed.length).toBeGreaterThan(0);
    mixed.forEach((m, i) => expect(exMap.get(m.exerciseId)!.muscle).toBe(exMap.get(routine[i].exerciseId)!.muscle));
    for (const c of changed) expect(c.sets[0]).toMatchObject({ reps: 8, repsMax: 12, weightKg: null });
  });
});

describe('pause', () => {
  it('does not count paused time', () => {
    expect(activeElapsedMs({ startTime: 0, pausedMs: 0, pausedAt: null }, 60000)).toBe(60000);
    expect(activeElapsedMs({ startTime: 0, pausedMs: 10000, pausedAt: null }, 60000)).toBe(50000);
    expect(activeElapsedMs({ startTime: 0, pausedMs: 10000, pausedAt: 30000 }, 60000)).toBe(20000);
  });
});
