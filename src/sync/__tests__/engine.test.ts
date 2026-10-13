import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ensureSeed, WorkoutDB } from '../../db/db';
import type { Workout } from '../../db/types';
import { SyncEngine, type KV, type Remote, type RemoteDoc, type SyncTable } from '../engine';

/** In-memory stand-in for Firestore. */
class FakeCloud {
  clock = 0;
  docs = new Map<string, RemoteDoc>();
  listeners = new Set<{ table: SyncTable; since: number; cb: (d: RemoteDoc[]) => void }>();
  remote(): Remote {
    return {
      write: (table, id, data) => {
        const doc = { id, data: data ? structuredClone(data) : null, updatedAt: ++this.clock };
        this.docs.set(`${table}/${id}`, doc);
        for (const l of this.listeners) if (l.table === table) queueMicrotask(() => l.cb([doc]));
      },
      fetchAll: async (table) => [...this.docs.entries()].filter(([k]) => k.startsWith(table + '/')).map(([, d]) => d),
      listen: (table, since, cb) => {
        const l = { table, since, cb };
        this.listeners.add(l);
        const initial = [...this.docs.entries()].filter(([k, d]) => k.startsWith(table + '/') && d.updatedAt > since).map(([, d]) => d);
        if (initial.length) queueMicrotask(() => cb(initial));
        return () => this.listeners.delete(l);
      },
    };
  }
  live(table: string) {
    return [...this.docs.entries()].filter(([k, d]) => k.startsWith(table + '/') && d.data).map(([, d]) => d.data!);
  }
}

function memKV(): KV {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) };
}

async function device() {
  const db = new WorkoutDB('dev-' + Math.random());
  const engine = new SyncEngine(db, memKV());
  await ensureSeed(db);
  return { db, engine };
}

const settle = () => new Promise((r) => setTimeout(r, 30));
const workout = (title: string, startTime = Date.now()): Workout => ({
  title,
  startTime,
  endTime: startTime + 3600_000,
  exercises: [{ exerciseId: 'bench-press-barbell', sets: [{ type: 'normal', weightKg: 100, reps: 5 }] }],
  exerciseIds: ['bench-press-barbell'],
});

describe('SyncEngine', () => {
  it('uploads existing local data on first sign-in and keeps built-in exercises local', async () => {
    const cloud = new FakeCloud();
    const a = await device();
    await a.db.workouts.add(workout('Push'));
    await a.db.exercises.add({ id: 'custom-x', name: 'My Lift', muscle: 'chest', equipment: 'other', type: 'weight_reps', custom: true });
    await a.db.routines.put({ id: 'r1', name: 'Push', order: 0, exercises: [], createdAt: 0 });
    await a.engine.start(cloud.remote(), 'u1');
    await settle();
    expect(cloud.live('workouts').map((w) => w.title)).toEqual(['Push']);
    expect(cloud.live('exercises').map((e) => e.name)).toEqual(['My Lift']);
    expect(cloud.live('routines')).toHaveLength(1);
  });

  it('syncs creates, edits and deletes between two devices', async () => {
    const cloud = new FakeCloud();
    const a = await device();
    const b = await device();
    await a.engine.start(cloud.remote(), 'u1');
    await b.engine.start(cloud.remote(), 'u1');

    const id = await a.db.workouts.add(workout('Legs'));
    await settle();
    expect((await b.db.workouts.get(id))?.title).toBe('Legs');

    await b.db.workouts.update(id, { title: 'Leg Day' });
    await settle();
    expect((await a.db.workouts.get(id))?.title).toBe('Leg Day');

    await a.db.workouts.delete(id);
    await settle();
    expect(await b.db.workouts.get(id)).toBeUndefined();
    expect(cloud.docs.get(`workouts/${id}`)?.data).toBeNull();
  });

  it('does not echo remote changes back to the cloud', async () => {
    const cloud = new FakeCloud();
    const a = await device();
    const b = await device();
    await a.engine.start(cloud.remote(), 'u1');
    await b.engine.start(cloud.remote(), 'u1');
    await a.db.routines.put({ id: 'r1', name: 'Pull', order: 0, exercises: [], createdAt: 0 });
    await settle();
    const clockAfter = cloud.clock;
    await settle();
    expect(cloud.clock).toBe(clockAfter);
    expect((await b.db.routines.get('r1'))?.name).toBe('Pull');
  });

  it('syncs settings', async () => {
    const cloud = new FakeCloud();
    const a = await device();
    const b = await device();
    await a.engine.start(cloud.remote(), 'u1');
    await b.engine.start(cloud.remote(), 'u1');
    await a.db.settings.put({ key: 'settings', unit: 'kg', defaultRestSec: 60, increment: 2.5, increments: {}, nextPick: null, schedule: [null, null, null, null, null, null, null] });
    await settle();
    expect((await b.db.settings.get('settings'))?.unit).toBe('kg');
  });

  it('de-duplicates the same Hevy import done on two devices', async () => {
    const cloud = new FakeCloud();
    const a = await device();
    const b = await device();
    const t = new Date(2026, 0, 5, 18).getTime();
    await a.db.workouts.add({ ...workout('Push', t), source: 'hevy' });
    await b.db.workouts.add({ ...workout('Push', t), source: 'hevy' });
    await b.db.workouts.add(workout('Only on B'));
    await a.engine.start(cloud.remote(), 'u1');
    await settle();
    await b.engine.start(cloud.remote(), 'u1');
    await settle();
    expect(cloud.live('workouts').map((w) => w.title).sort()).toEqual(['Only on B', 'Push']);
    expect((await b.db.workouts.toArray()).map((w) => w.title).sort()).toEqual(['Only on B', 'Push']);
    expect(await a.db.workouts.count()).toBe(2);
  });

  it('queues changes made while signed out of the remote and uploads them on restart', async () => {
    const cloud = new FakeCloud();
    const a = await device();
    await a.engine.start(cloud.remote(), 'u1');
    a.engine.stop(); // e.g. app closed / offline before Firebase is ready
    await a.db.workouts.add(workout('Offline workout'));
    expect(a.engine.hasPendingUploads()).toBe(true);
    await a.engine.start(cloud.remote(), 'u1');
    await settle();
    expect(cloud.live('workouts').map((w) => w.title)).toEqual(['Offline workout']);
    expect(a.engine.hasPendingUploads()).toBe(false);
  });

  it('clears synced data but keeps the exercise library on sign-out', async () => {
    const cloud = new FakeCloud();
    const a = await device();
    await a.engine.start(cloud.remote(), 'u1');
    await a.db.workouts.add(workout('X'));
    await settle();
    a.engine.stop();
    await a.engine.clearLocal();
    expect(await a.db.workouts.count()).toBe(0);
    expect(await a.db.exercises.count()).toBeGreaterThan(200);
    expect(cloud.live('workouts')).toHaveLength(1); // still safe in the cloud
    expect(a.engine.linkedUid).toBeNull();
  });
});
