import type { Exercise, MuscleGroup, Settings, Unit } from '../db/types';
import { fromDisplayWeight, toDisplayWeight } from './units';

const LOWER_BODY: MuscleGroup[] = ['quadriceps', 'hamstrings', 'glutes', 'lower_back', 'adductors', 'abductors'];

/** Smallest realistic dumbbell/kettlebell jump. */
function dumbbellStep(unit: Unit) {
  return unit === 'kg' ? 2 : 5;
}

/**
 * Default weight jump (in the display unit) for an exercise, derived from the
 * main-lift increment setting:
 * - lower-body barbell/machine compounds (squat, deadlift, leg press): 2×
 * - other compounds (bench, rows, presses, pulldowns): 1×
 * - isolation exercises (curls, raises, extensions): ½×
 * - dumbbells/kettlebells never go below the smallest real dumbbell jump.
 * Compound = the exercise works secondary muscles too.
 */
export function autoIncrement(ex: Pick<Exercise, 'muscle' | 'equipment' | 'secondary'> | undefined, base: number, unit: Unit): number {
  if (!ex) return base;
  const compound = (ex.secondary?.length ?? 0) > 0;
  let inc: number;
  if (compound && LOWER_BODY.includes(ex.muscle) && (ex.equipment === 'barbell' || ex.equipment === 'machine')) inc = base * 2;
  else if (compound) inc = base;
  else inc = base / 2;
  if (ex.equipment === 'dumbbell' || ex.equipment === 'kettlebell') inc = Math.max(inc, dumbbellStep(unit));
  return inc;
}

/** Weight jump for an exercise in the display unit (user override wins). */
export function incrementFor(ex: Exercise | undefined, settings: Pick<Settings, 'increment' | 'increments' | 'unit'>): number {
  const override = ex ? settings.increments?.[ex.id] : undefined;
  if (override != null) return Math.round(toDisplayWeight(override, settings.unit) * 100) / 100;
  return autoIncrement(ex, settings.increment, settings.unit);
}

export function incrementOptions(unit: Unit): number[] {
  return unit === 'kg' ? [0.5, 1, 1.25, 2, 2.5, 5, 10] : [1, 2.5, 5, 10, 15, 20];
}

export function toOverrideKg(display: number, unit: Unit) {
  return fromDisplayWeight(display, unit);
}
