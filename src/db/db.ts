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
  }
}

export const db = new WorkoutDB();

export const DEFAULT_SETTINGS: Settings = {
  unit: 'lbs',
  defaultRestSec: 90,
  increment: 5,
  repRangeMin: 8,
  repRangeMax: 12,
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
