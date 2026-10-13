import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { WorkoutDB } from '../../db/db';

describe('workout ids', () => {
  it('assigns random unique ids on add', async () => {
    const db = new WorkoutDB('ids-' + Math.random());
    const a = await db.workouts.add({ title: 'A', startTime: 1, endTime: 2, exercises: [], exerciseIds: [] });
    const b = await db.workouts.add({ title: 'B', startTime: 1, endTime: 2, exercises: [], exerciseIds: [] });
    expect(a).toBeGreaterThan(1000);
    expect(a).not.toBe(b);
    expect((await db.workouts.get(a))?.id).toBe(a);
  });

  it('migrates v1 auto-increment ids', async () => {
    const name = 'mig-' + Math.random();
    const v1 = new Dexie(name);
    v1.version(1).stores({ exercises: 'id', workouts: '++id, startTime, *exerciseIds, routineId', routines: 'id, order', settings: 'key', active: 'id' });
    await v1.table('workouts').add({ title: 'Old', startTime: 5, endTime: 6, exercises: [], exerciseIds: ['x'] });
    v1.close();
    const db = new WorkoutDB(name);
    const all = await db.workouts.toArray();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe('Old');
    expect(all[0].id).toBeGreaterThan(1000);
  });
});
