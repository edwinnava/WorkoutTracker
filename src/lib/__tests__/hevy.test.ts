import { describe, expect, it } from 'vitest';
import { parseHevyCsv, parseHevyDate, planImport, toHevyCsv, workoutKey } from '../hevy';
import { BUILT_IN_EXERCISES } from '../../data/exercises';

const CSV = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_lbs","reps","distance_miles","duration_seconds","rpe"
"Push","8 Oct 2024, 17:59","8 Oct 2024, 19:02","Felt good","Bench Press (Barbell)",,"Pause reps",0,"warmup",95,10,,,
"Push","8 Oct 2024, 17:59","8 Oct 2024, 19:02","Felt good","Bench Press (Barbell)",,"Pause reps",1,"normal",185,8,,,8
"Push","8 Oct 2024, 17:59","8 Oct 2024, 19:02","Felt good","Bench Press (Barbell)",,"Pause reps",2,"failure",185,6,,,10
"Push","8 Oct 2024, 17:59","8 Oct 2024, 19:02","Felt good","Cable Lateral Raise Thing",0,,0,"normal",20,15,,,
"Push","8 Oct 2024, 17:59","8 Oct 2024, 19:02","Felt good","Plank",,,0,"normal",,,,60,
"Cardio","9 Oct 2024, 07:00","9 Oct 2024, 07:30",,"Running",,,0,"normal",,,3.1,1800,
`;

describe('parseHevyDate', () => {
  it('parses the Hevy format in local time', () => {
    const t = parseHevyDate('8 Oct 2024, 17:59')!;
    const d = new Date(t);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2024, 9, 8, 17, 59]);
  });
  it('parses US style with AM/PM', () => {
    const d = new Date(parseHevyDate('Oct 8, 2024, 5:59 PM')!);
    expect([d.getMonth(), d.getDate(), d.getHours()]).toEqual([9, 8, 17]);
    expect(new Date(parseHevyDate('Oct 8, 2024, 12:05 AM')!).getHours()).toBe(0);
  });
  it('parses ISO-ish', () => {
    expect(new Date(parseHevyDate('2024-10-08 17:59:00')!).getHours()).toBe(17);
  });
  it('returns null on junk', () => {
    expect(parseHevyDate('nope')).toBeNull();
    expect(parseHevyDate('')).toBeNull();
  });
});

describe('parseHevyCsv', () => {
  const res = parseHevyCsv(CSV);
  it('groups rows into workouts and exercises', () => {
    expect(res.weightUnit).toBe('lbs');
    expect(res.workouts).toHaveLength(2);
    const push = res.workouts[0];
    expect(push.title).toBe('Push');
    expect(push.description).toBe('Felt good');
    expect(push.exercises.map((e) => e.name)).toEqual(['Bench Press (Barbell)', 'Cable Lateral Raise Thing', 'Plank']);
    expect(push.exercises[0].sets.map((s) => s.type)).toEqual(['warmup', 'normal', 'failure']);
    expect(push.exercises[0].notes).toBe('Pause reps');
    expect(push.exercises[1].supersetId).toBe(0);
    expect(push.endTime - push.startTime).toBe(63 * 60000);
  });
  it('converts lbs to kg and miles to km', () => {
    const bench = res.workouts[0].exercises[0].sets[1];
    expect(bench.weightKg).toBeCloseTo(83.91, 1);
    expect(bench.reps).toBe(8);
    expect(bench.rpe).toBe(8);
    const run = res.workouts[1].exercises[0].sets[0];
    expect(run.distanceKm).toBeCloseTo(4.989, 2);
    expect(run.durationSec).toBe(1800);
  });
  it('handles kg exports', () => {
    const kg = parseHevyCsv(
      `title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe\nLegs,1 Jan 2025, 10:00,1 Jan 2025, 11:00,,Squat (Barbell),,,0,normal,100,5,,,\n`.replace(
        /1 Jan 2025, (\d\d:00)/g,
        '"1 Jan 2025, $1"',
      ),
    );
    expect(kg.weightUnit).toBe('kg');
    expect(kg.workouts[0].exercises[0].sets[0].weightKg).toBe(100);
  });
  it('splits the same exercise performed twice in one workout', () => {
    const csv = CSV.split('\n').slice(0, 3).join('\n') + '\n' +
      `"Push","8 Oct 2024, 17:59","8 Oct 2024, 19:02","","Bench Press (Barbell)",,,0,"normal",135,10,,,\n`;
    const r = parseHevyCsv(csv);
    expect(r.workouts[0].exercises).toHaveLength(2);
  });
  it('rejects non-Hevy files', () => {
    expect(() => parseHevyCsv('a,b\n1,2')).toThrow(/Hevy/);
  });
});

describe('planImport', () => {
  const { workouts } = parseHevyCsv(CSV);
  it('matches library exercises and creates custom ones', () => {
    const plan = planImport(workouts, BUILT_IN_EXERCISES, new Set());
    expect(plan.workouts).toHaveLength(2);
    expect(plan.workouts[0].exerciseIds).toContain('bench-press-barbell');
    expect(plan.workouts[0].exerciseIds).toContain('plank');
    expect(plan.newExercises.map((e) => e.name)).toEqual(['Cable Lateral Raise Thing']);
    expect(plan.newExercises[0].type).toBe('weight_reps');
    expect(plan.newExercises[0].custom).toBe(true);
  });
  it('skips duplicates on re-import', () => {
    const keys = new Set(workouts.map((w) => workoutKey(w.startTime, w.title)));
    const plan = planImport(workouts, BUILT_IN_EXERCISES, keys);
    expect(plan.workouts).toHaveLength(0);
    expect(plan.duplicates).toBe(2);
  });
});

describe('toHevyCsv', () => {
  it('round-trips through the parser', () => {
    const { workouts } = parseHevyCsv(CSV);
    const plan = planImport(workouts, BUILT_IN_EXERCISES, new Set());
    const exMap = new Map([...BUILT_IN_EXERCISES, ...plan.newExercises].map((e) => [e.id, e]));
    const csv = toHevyCsv(plan.workouts as never, exMap, 'lbs');
    const again = parseHevyCsv(csv);
    expect(again.workouts).toHaveLength(2);
    expect(again.workouts[0].exercises[0].sets[1].weightKg).toBeCloseTo(83.91, 1);
    expect(again.workouts[0].exercises.map((e) => e.name)).toEqual(workouts[0].exercises.map((e) => e.name));
  });
});
