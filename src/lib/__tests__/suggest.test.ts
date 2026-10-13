import { describe, expect, it } from 'vitest';
import { progressiveOverload, suggestToday } from '../suggest';
import type { Routine, Settings, Workout } from '../../db/types';
import { DEFAULT_SETTINGS } from '../../db/db';
import { LBS_PER_KG } from '../units';

const lbs = (n: number) => n / LBS_PER_KG;
const settings = { ...DEFAULT_SETTINGS, unit: 'lbs' as const, increment: 5, repRangeMin: 8, repRangeMax: 12 };

describe('progressiveOverload', () => {
  it('adds weight when every working set hit the top of the range', () => {
    const last = [
      { type: 'warmup' as const, weightKg: lbs(95), reps: 10 },
      { type: 'normal' as const, weightKg: lbs(135), reps: 12 },
      { type: 'normal' as const, weightKg: lbs(135), reps: 12 },
    ];
    const r = progressiveOverload('weight_reps', last, undefined, settings);
    expect(r.sets).toHaveLength(3);
    expect(r.sets[0].weightKg! * LBS_PER_KG).toBeCloseTo(95);
    expect(r.sets[1].weightKg! * LBS_PER_KG).toBeCloseTo(140);
    expect(r.sets[1].reps).toBe(8);
    expect(r.note).toMatch(/\+5 lbs/);
  });
  it('adds a rep when the top of the range was not reached', () => {
    const last = [
      { type: 'normal' as const, weightKg: lbs(135), reps: 12 },
      { type: 'normal' as const, weightKg: lbs(135), reps: 9 },
    ];
    const r = progressiveOverload('weight_reps', last, undefined, settings);
    expect(r.sets[0].weightKg! * LBS_PER_KG).toBeCloseTo(135);
    expect(r.sets[0].reps).toBe(12);
    expect(r.sets[1].reps).toBe(10);
  });
  it('uses the routine rep range and set count', () => {
    const last = [{ type: 'normal' as const, weightKg: 100, reps: 5 }];
    const targets = Array.from({ length: 3 }, () => ({ type: 'normal' as const, reps: 5, repsMax: 5 }));
    const r = progressiveOverload('weight_reps', last, targets, { ...settings, unit: 'kg', increment: 2.5 });
    expect(r.sets).toHaveLength(3);
    expect(r.sets.every((s) => s.weightKg === 102.5 && s.reps === 5)).toBe(true);
  });
  it('falls back to routine targets with no history', () => {
    const targets = [{ type: 'normal' as const, reps: 8, repsMax: 12, weightKg: 50 }];
    const r = progressiveOverload('weight_reps', [], targets, settings);
    expect(r.sets[0]).toMatchObject({ reps: 8, weightKg: 50 });
  });
  it('reduces assistance for assisted exercises', () => {
    const last = [{ type: 'normal' as const, weightKg: lbs(50), reps: 12 }];
    const r = progressiveOverload('assisted_bodyweight', last, undefined, settings);
    expect(r.sets[0].weightKg! * LBS_PER_KG).toBeCloseTo(45);
  });
});

describe('suggestToday', () => {
  const routines: Routine[] = ['Push', 'Pull', 'Legs'].map((name, i) => ({
    id: name.toLowerCase(),
    name,
    order: i,
    exercises: [],
    createdAt: 0,
  }));
  const w = (title: string, routineId?: string): Workout => ({
    title,
    routineId,
    startTime: 0,
    endTime: 0,
    exercises: [],
    exerciseIds: [],
  });
  const monday = new Date(2026, 9, 12);

  it('uses the schedule when set', () => {
    const s: Settings = { ...settings, schedule: [null, 'legs', null, null, null, null, null] };
    expect(suggestToday(routines, [], s, monday)).toMatchObject({ kind: 'scheduled', routine: { id: 'legs' } });
  });
  it('reports rest days', () => {
    const s: Settings = { ...settings, schedule: [null, 'rest', null, null, null, null, null] };
    expect(suggestToday(routines, [], s, monday).kind).toBe('rest');
  });
  it('rotates to the routine after the last one done (matching imported titles)', () => {
    expect(suggestToday(routines, [w('Pull')], settings, monday).routine?.id).toBe('legs');
    expect(suggestToday(routines, [w('Whatever', 'legs')], settings, monday).routine?.id).toBe('push');
    expect(suggestToday(routines, [], settings, monday).routine?.id).toBe('push');
  });
});
