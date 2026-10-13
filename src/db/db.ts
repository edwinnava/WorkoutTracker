import Dexie, { type Table } from 'dexie';
import type { ActiveWorkout, Exercise, Routine, Settings, Workout } from './types';
import { BUILT_IN_EXERCISES } from '../data/exercises';

interface SettingsRow extends Settings {
  key: 'settings';
}

export class WorkoutDB extends Dexie {
  exercises!: Table<Exercise, string>;
  workouts!: Table<Workout, number>;
  routines!: Table<Routine, string>;
  settings!: Table<SettingsRow, string>;
  active!: Table<ActiveWorkout, string>;

  constructor(name = 'workout-tracker') {
    super(name);
    this.version(1).stores({
      exercises: 'id, name, muscle, equipment',
      workouts: '++id, startTime, *exerciseIds, routineId',
      routines: 'id, order',
      settings: 'key',
      active: 'id',
    });
    // v2: workout ids become large random numbers so ids from different devices never collide when syncing.
    this.version(2)
      .stores({})
      .upgrade(async (tx) => {
        const table = tx.table<Workout, number>('workouts');
        const all = await table.toArray();
        await table.clear();
        await table.bulkAdd(all.map((w) => ({ ...w, id: newWorkoutId() })));
      });
    this.workouts.hook('creating', function (primKey, obj) {
      if (primKey == null) {
        obj.id = newWorkoutId();
        return obj.id;
      }
    });
  }
}

/** Random integer id that is unique across devices (safe-integer range). */
export function newWorkoutId(): number {
  return Math.floor(Math.random() * 2 ** 52) + 1;
}

export const db = new WorkoutDB();

export const DEFAULT_SETTINGS: Settings = {
  unit: 'lbs',
  defaultRestSec: 90,
  increment: 5,
  increments: {},
  nextPick: null,
  schedule: [null, null, null, null, null, null, null],
};

/** Adds/refreshes built-in exercises. Safe to call on every startup. */
export async function ensureSeed(database: WorkoutDB = db) {
  await database.exercises.bulkPut(BUILT_IN_EXERCISES);
}

export async function getSettings(database: WorkoutDB = db): Promise<Settings> {
  const row = await database.settings.get('settings');
  if (!row) return { ...DEFAULT_SETTINGS };
  const { key: _key, ...rest } = row;
  return { ...DEFAULT_SETTINGS, ...rest };
}

export async function saveSettings(patch: Partial<Settings>, database: WorkoutDB = db) {
  const current = await getSettings(database);
  await database.settings.put({ ...current, ...patch, key: 'settings' });
}

export function withExerciseIds(w: Omit<Workout, 'exerciseIds'> & { exerciseIds?: string[] }): Workout {
  return { ...w, exerciseIds: [...new Set(w.exercises.map((e) => e.exerciseId))] };
}

export function newId(prefix = ''): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix + rand;
}
