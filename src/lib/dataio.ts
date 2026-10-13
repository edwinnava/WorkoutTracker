import type { Table } from 'dexie';
import { db, ensureSeed, getSettings, type WorkoutDB } from '../db/db';

/** Deletes every row through the normal delete path so cloud sync sees the deletions (clear() bypasses hooks). */
async function deleteAll(table: Table) {
  await table.bulkDelete(await table.toCollection().primaryKeys());
}
import type { Exercise, Routine, Settings, Workout } from '../db/types';
import { parseHevyCsv, planImport, toHevyCsv, workoutKey } from './hevy';

export interface ImportSummary {
  imported: number;
  duplicates: number;
  newExercises: string[];
  skippedRows: number;
}

export async function importHevyCsv(text: string, database: WorkoutDB = db): Promise<ImportSummary> {
  const parsed = parseHevyCsv(text);
  return database.transaction('rw', database.workouts, database.exercises, async () => {
    const [exercises, workouts] = await Promise.all([database.exercises.toArray(), database.workouts.toArray()]);
    const keys = new Set(workouts.map((w) => workoutKey(w.startTime, w.title)));
    const plan = planImport(parsed.workouts, exercises, keys);
    if (plan.newExercises.length) await database.exercises.bulkAdd(plan.newExercises);
    if (plan.workouts.length) await database.workouts.bulkAdd(plan.workouts as Workout[]);
    return {
      imported: plan.workouts.length,
      duplicates: plan.duplicates,
      newExercises: plan.newExercises.map((e) => e.name),
      skippedRows: parsed.skippedRows,
    };
  });
}

export async function exportHevyCsv(): Promise<string> {
  const [workouts, exercises, settings] = await Promise.all([db.workouts.toArray(), db.exercises.toArray(), getSettings()]);
  return toHevyCsv(workouts, new Map(exercises.map((e) => [e.id, e])), settings.unit);
}

interface Backup {
  app: 'workout-tracker';
  version: 1;
  exportedAt: string;
  settings: Settings;
  exercises: Exercise[];
  workouts: Workout[];
  routines: Routine[];
}

export async function exportBackup(): Promise<string> {
  const backup: Backup = {
    app: 'workout-tracker',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: await getSettings(),
    exercises: await db.exercises.filter((e) => !!e.custom).toArray(),
    workouts: await db.workouts.toArray(),
    routines: await db.routines.toArray(),
  };
  return JSON.stringify(backup);
}

export async function restoreBackup(text: string) {
  const data = JSON.parse(text) as Backup;
  if (data.app !== 'workout-tracker') throw new Error('Not a Workout Tracker backup file.');
  await db.transaction('rw', [db.exercises, db.workouts, db.routines, db.settings], async () => {
    await Promise.all([deleteAll(db.workouts), deleteAll(db.routines), deleteAll(db.exercises), deleteAll(db.settings)]);
    await ensureSeed();
    await db.exercises.bulkPut(data.exercises);
    await db.workouts.bulkAdd(data.workouts.map(({ id: _id, ...w }) => w as Workout));
    await db.routines.bulkPut(data.routines);
    await db.settings.put({ ...data.settings, key: 'settings' });
  });
}

export async function deleteAllData() {
  await db.transaction('rw', [db.exercises, db.workouts, db.routines, db.settings, db.active], async () => {
    await Promise.all([deleteAll(db.workouts), deleteAll(db.routines), deleteAll(db.exercises), deleteAll(db.settings), db.active.clear()]);
    await ensureSeed();
  });
}

export function downloadFile(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
