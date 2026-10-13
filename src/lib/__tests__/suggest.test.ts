import { describe, expect, it } from 'vitest';
import { activePick, isStalled, progressiveOverload, repRange, suggestToday } from '../suggest';
import { autoIncrement, incrementFor } from '../increments';
import type { Routine, Settings, Workout, WorkoutSet } from '../../db/types';
import { DEFAULT_SETTINGS } from '../../db/db';
import { BUILT_IN_EXERCISES } from '../../data/exercises';
import { LBS_PER_KG } from '../units';

const lbs = (n: number) => n / LBS_PER_KG;
const toLbs = (kg?: number | null) => Math.round((kg ?? 0) * LBS_PER_KG * 100) / 100;
const opts = { unit: 'lbs' as const, increment: 5 };
const set = (w: number, reps: number, type: WorkoutSet['type'] = 'normal'): WorkoutSet => ({ type, weightKg: lbs(w), reps });
const ex = (name: string) => BUILT_IN_EXERCISES.find((e) => e.name === name)!;

describe('repRange', () => {
  it('uses the routine range when set', () => {
    expect(repRange([], [{ type: 'normal', reps: 8, repsMax: 12 }])).toMatchObject({ min: 8, max: 12, auto: false });
    expect(repRange([], [{ type: 'normal', reps: 5 }])).toMatchObject({ min: 5, max: 5 });
  });
  it('is based on the reps you actually do when there is no routine range', () => {
    const heavy = [[set(225, 5), set(225, 5), set(225, 4)], [set(220, 5), set(220, 5)]];
    expect(repRange(heavy)).toMatchObject({ min: 5, max: 7, auto: true });
    const volume = [[set(100, 10), set(100, 10), set(100, 9)]];
    expect(repRange(volume)).toMatchObject({ min: 10, max: 12 });
  });
});

describe('progressiveOverload', () => {
  it('does not push a 5-rep lifter to 8 reps', () => {
    const r = progressiveOverload('weight_reps', [[set(225, 5), set(225, 5), set(225, 5)]], undefined, opts);
    expect(r.sets.map((s) => s.reps)).toEqual([6, 6, 6]);
    expect(toLbs(r.sets[0].weightKg)).toBe(225);
  });
  it('adds weight when every working set hit the top of the range', () => {
    const r = progressiveOverload('weight_reps', [[set(95, 10, 'warmup'), set(135, 12), set(135, 12)]], [
      { type: 'warmup' },
      { type: 'normal', reps: 8, repsMax: 12 },
      { type: 'normal', reps: 8, repsMax: 12 },
    ], opts);
    expect(toLbs(r.sets[0].weightKg)).toBe(95);
    expect(toLbs(r.sets[1].weightKg)).toBe(140);
    expect(r.sets[1].reps).toBe(8);
    expect(r.note).toMatch(/\+5 lbs/);
  });
  it('uses the per-exercise jump it is given', () => {
    const r = progressiveOverload('weight_reps', [[set(20, 15), set(20, 15)]], [{ type: 'normal', reps: 12, repsMax: 15 }, { type: 'normal', reps: 12, repsMax: 15 }], { unit: 'lbs', increment: 2.5 });
    expect(toLbs(r.sets[0].weightKg)).toBe(22.5);
  });
  it('adds a rep when the top of the range was not reached', () => {
    const r = progressiveOverload('weight_reps', [[set(135, 12), set(135, 9)]], [{ type: 'normal', reps: 8, repsMax: 12 }, { type: 'normal', reps: 8, repsMax: 12 }], opts);
    expect(r.sets.map((s) => s.reps)).toEqual([12, 10]);
  });
  it('deloads ~10% after 3 sessions stuck at the same weight', () => {
    const stuck = [[set(225, 5), set(225, 4)], [set(225, 5), set(225, 5)], [set(225, 5), set(225, 5)]];
    expect(isStalled(stuck, { max: 7 })).toBe(true);
    const r = progressiveOverload('weight_reps', stuck, undefined, opts);
    expect(toLbs(r.sets[0].weightKg)).toBe(205);
    expect(r.note).toMatch(/deload/i);
  });
  it('does not deload while reps are still going up', () => {
    const progressing = [[set(225, 6), set(225, 6)], [set(225, 5), set(225, 5)], [set(225, 5), set(225, 4)]];
    expect(isStalled(progressing, { max: 7 })).toBe(false);
  });
  it('falls back to routine targets with no history', () => {
    const r = progressiveOverload('weight_reps', [], [{ type: 'normal', reps: 8, repsMax: 12, weightKg: 50 }], opts);
    expect(r.sets[0]).toMatchObject({ reps: 8, weightKg: 50 });
  });
  it('reduces assistance for assisted exercises', () => {
    const r = progressiveOverload('assisted_bodyweight', [[set(50, 12)]], [{ type: 'normal', reps: 8, repsMax: 12 }], opts);
    expect(toLbs(r.sets[0].weightKg)).toBe(45);
  });
});

describe('increments', () => {
  it('scales the jump by exercise', () => {
    expect(autoIncrement(ex('Squat (Barbell)'), 5, 'lbs')).toBe(10);
    expect(autoIncrement(ex('Bench Press (Barbell)'), 5, 'lbs')).toBe(5);
    expect(autoIncrement(ex('Triceps Pushdown'), 5, 'lbs')).toBe(2.5);
    expect(autoIncrement(ex('Lateral Raise (Dumbbell)'), 5, 'lbs')).toBe(5); // smallest dumbbell jump
    expect(autoIncrement(ex('Lateral Raise (Dumbbell)'), 2.5, 'kg')).toBe(2);
  });
  it('respects per-exercise overrides', () => {
    const e = ex('Triceps Pushdown');
    expect(incrementFor(e, { unit: 'lbs', increment: 5, increments: { [e.id]: lbs(10) } })).toBe(10);
  });
});

describe('suggestToday', () => {
  const routines: Routine[] = ['Push', 'Pull', 'Legs'].map((name, i) => ({ id: name.toLowerCase(), name, order: i, exercises: [], createdAt: 0 }));
  const w = (title: string, routineId?: string, t = 0): Workout => ({ title, routineId, startTime: t, endTime: t, exercises: [], exerciseIds: [] });
  const monday = new Date(2026, 9, 12, 9);
  const base: Settings = { ...DEFAULT_SETTINGS };

  it('uses the schedule when set', () => {
    const s: Settings = { ...base, schedule: [null, 'legs', null, null, null, null, null] };
    expect(suggestToday(routines, [], s, monday)).toMatchObject({ kind: 'scheduled', routine: { id: 'legs' } });
  });
  it('reports rest days', () => {
    const s: Settings = { ...base, schedule: [null, 'rest', null, null, null, null, null] };
    expect(suggestToday(routines, [], s, monday).kind).toBe('rest');
  });
  it('rotates to the routine after the last one done (matching imported titles)', () => {
    expect(suggestToday(routines, [w('Pull')], base, monday).routine?.id).toBe('legs');
    expect(suggestToday(routines, [w('Whatever', 'legs')], base, monday).routine?.id).toBe('push');
    expect(suggestToday(routines, [], base, monday).routine?.id).toBe('push');
  });
  it('a picked workout wins until a workout is finished after picking it', () => {
    const pickedAt = monday.getTime() - 3600_000;
    const s: Settings = { ...base, schedule: [null, 'legs', null, null, null, null, null], nextPick: { routineId: 'pull', at: pickedAt } };
    expect(suggestToday(routines, [w('Push', 'push', pickedAt - 86400_000)], s, monday)).toMatchObject({ kind: 'picked', routine: { id: 'pull' } });
    // Finished Pull after picking → pick no longer applies, rotation/schedule takes over again
    const done = [w('Pull', 'pull', pickedAt + 60_000)];
    expect(activePick(s, done, monday.getTime())).toBeNull();
    expect(suggestToday(routines, done, s, monday).kind).toBe('scheduled');
  });
  it('a picked rest day only applies on the day it was picked', () => {
    const s: Settings = { ...base, nextPick: { routineId: 'rest', at: monday.getTime() } };
    expect(suggestToday(routines, [], s, monday).kind).toBe('picked-rest');
    expect(suggestToday(routines, [], s, new Date(2026, 9, 13, 9)).kind).toBe('rotation');
  });
});
