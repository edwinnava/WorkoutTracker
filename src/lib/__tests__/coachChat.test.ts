import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ensureSeed, getSettings, saveSettings } from '../../db/db';
import { applyUndo, buildSnapshot, runTool } from '../coachChat';
import { LBS_PER_KG } from '../units';

const NOW = Date.now();

beforeEach(async () => {
  await Promise.all([db.workouts.clear(), db.routines.clear(), db.settings.clear()]);
  await ensureSeed();
  await db.routines.put({
    id: 'push',
    name: 'Push',
    order: 0,
    createdAt: 1,
    exercises: [{ exerciseId: 'bench-press-barbell', notes: 'pause at the bottom', restSec: 150, sets: [{ type: 'normal', reps: 6, repsMax: 10 }] }],
  });
  await db.workouts.put({
    id: 77,
    title: 'Push',
    startTime: NOW - 86400000,
    endTime: NOW - 86400000 + 3600000,
    routineId: 'push',
    exerciseIds: ['bench-press-barbell'],
    exercises: [{ exerciseId: 'bench-press-barbell', sets: [{ type: 'normal', weightKg: 165 / LBS_PER_KG, reps: 8 }] }],
  });
});

describe('coach tools', () => {
  it('finds exercises and reads history in the user’s unit', async () => {
    const found = await runTool('search_exercises', { query: 'bench press barbell' });
    expect(found.content).toContain('[bench-press-barbell]');
    expect(found.content).toContain('logged in 1 workouts');
    expect((await runTool('get_exercise_history', { exercise_id: 'bench-press-barbell' })).content).toContain('165x8');
  });

  it('replaces a routine, keeps notes, and can undo', async () => {
    const out = await runTool('save_routine', {
      routine_id: 'push',
      name: 'Push',
      exercises: [
        { exercise_id: 'bench-press-barbell', sets: 4, reps_min: 5, reps_max: 8 },
        { exercise_id: 'triceps-pushdown', sets: 3, reps_min: 10, reps_max: 15, rest_seconds: 60 },
      ],
    });
    expect(out.isError).toBeFalsy();
    const r = (await db.routines.get('push'))!;
    expect(r.exercises.map((e) => [e.exerciseId, e.sets.length, e.sets[0].reps, e.sets[0].repsMax, e.restSec])).toEqual([
      ['bench-press-barbell', 4, 5, 8, 150],
      ['triceps-pushdown', 3, 10, 15, 60],
    ]);
    expect(r.exercises[0].notes).toBe('pause at the bottom');
    await applyUndo(out.action!.undo!);
    expect((await db.routines.get('push'))!.exercises).toHaveLength(1);
  });

  it('creates a routine and undo removes it', async () => {
    const out = await runTool('save_routine', { name: 'Arms', exercises: [{ exercise_id: 'triceps-pushdown', sets: 3, reps_min: 10, reps_max: 15 }] });
    expect(await db.routines.count()).toBe(2);
    await applyUndo(out.action!.undo!);
    expect(await db.routines.count()).toBe(1);
  });

  it('rejects made-up ids and bad numbers without changing anything', async () => {
    const before = await db.routines.get('push');
    for (const input of [
      { routine_id: 'push', name: 'Push', exercises: [{ exercise_id: 'not-a-real-lift', sets: 3, reps_min: 8, reps_max: 12 }] },
      { routine_id: 'push', name: 'Push', exercises: [{ exercise_id: 'bench-press-barbell', sets: 3, reps_min: 12, reps_max: 8 }] },
      { routine_id: 'nope', name: 'Push', exercises: [{ exercise_id: 'bench-press-barbell', sets: 3, reps_min: 8, reps_max: 12 }] },
      { routine_id: 'push', name: 'Push', exercises: [] },
      { routine_id: 'push', name: 'Push' }, // truncated input
    ]) {
      expect((await runTool('save_routine', input)).isError).toBe(true);
    }
    expect(await db.routines.get('push')).toEqual(before);
    expect((await runTool('set_weight_jump', { exercise_id: 'bench-press-barbell', amount: -5 })).isError).toBe(true);
    expect((await runTool('set_weekly_schedule', { days: { mon: 'ghost' } })).isError).toBe(true);
    expect((await runTool('no_such_tool', {})).isError).toBe(true);
  });

  it('sets a weight jump in the user’s unit and undoes it', async () => {
    const out = await runTool('set_weight_jump', { exercise_id: 'bench-press-barbell', amount: 11 });
    expect((await getSettings()).increments['bench-press-barbell'] * LBS_PER_KG).toBeCloseTo(11);
    expect(out.action!.text).toContain('11 lbs');
    await applyUndo(out.action!.undo!);
    expect((await getSettings()).increments['bench-press-barbell']).toBeUndefined();
  });

  it('changes only the scheduled days it is given', async () => {
    await saveSettings({ schedule: ['rest', null, null, null, null, null, null] });
    await runTool('set_weekly_schedule', { days: { mon: 'push', wed: 'rest', sun: 'auto' } });
    expect((await getSettings()).schedule).toEqual([null, 'push', null, 'rest', null, null, null]);
  });

  it('records feedback on a workout and undoes it', async () => {
    const out = await runTool('add_workout_feedback', { workout_id: 77, went_light: true, areas: ['shoulder'] });
    expect((await db.workouts.get(77))!.feedback).toEqual({ light: true, areas: ['shoulder'] });
    expect((await runTool('add_workout_feedback', { workout_id: 77, areas: ['toe'] })).isError).toBe(true);
    await applyUndo(out.action!.undo!);
    expect((await db.workouts.get(77))!.feedback).toBeUndefined();
  });

  it('picks today’s workout', async () => {
    await runTool('plan_today', { routine_id: 'push' });
    expect((await getSettings()).nextPick?.routineId).toBe('push');
  });
});

describe('snapshot', () => {
  it('describes routines, schedule and recent workouts with ids', async () => {
    const s = await buildSnapshot(NOW);
    expect(s).toContain('Push [routine id: push]');
    expect(s).toContain('Bench Press (Barbell) [bench-press-barbell]: 1 sets, 6-10 reps');
    expect(s).toContain('[workout id: 77]');
    expect(s).toContain('165x8');
    expect(s).toContain('Weights are in lbs');
  });
});
