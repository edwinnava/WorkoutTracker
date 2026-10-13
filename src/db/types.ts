export type MuscleGroup =
  | 'abdominals' | 'abductors' | 'adductors' | 'biceps' | 'calves' | 'cardio'
  | 'chest' | 'forearms' | 'full_body' | 'glutes' | 'hamstrings' | 'lats'
  | 'lower_back' | 'neck' | 'quadriceps' | 'shoulders' | 'traps' | 'triceps'
  | 'upper_back' | 'other';

export type Equipment =
  | 'none' | 'barbell' | 'dumbbell' | 'kettlebell' | 'machine' | 'plate'
  | 'resistance_band' | 'suspension' | 'cable' | 'other';

/** Determines which columns are logged for a set. */
export type ExerciseType =
  | 'weight_reps'
  | 'reps_only'
  | 'weighted_bodyweight'
  | 'assisted_bodyweight'
  | 'duration'
  | 'distance_duration';

export type SetType = 'normal' | 'warmup' | 'failure' | 'dropset';

export interface Exercise {
  id: string;
  name: string;
  muscle: MuscleGroup;
  secondary?: MuscleGroup[];
  equipment: Equipment;
  type: ExerciseType;
  custom?: boolean;
}

export interface WorkoutSet {
  type: SetType;
  weightKg?: number | null;
  reps?: number | null;
  distanceKm?: number | null;
  durationSec?: number | null;
  rpe?: number | null;
}

export interface WorkoutExercise {
  exerciseId: string;
  notes?: string;
  supersetId?: number | null;
  sets: WorkoutSet[];
}

export interface Workout {
  id?: number;
  title: string;
  description?: string;
  startTime: number; // epoch ms
  endTime: number; // epoch ms
  exercises: WorkoutExercise[];
  /** Derived, indexed (multiEntry) for per-exercise history lookups. */
  exerciseIds: string[];
  routineId?: string;
  source?: 'app' | 'hevy';
}

export interface RoutineSet {
  type: SetType;
  weightKg?: number | null;
  reps?: number | null;
  /** Upper end of a rep range (e.g. 8–12). Drives the progressive overload suggestion. */
  repsMax?: number | null;
  durationSec?: number | null;
  distanceKm?: number | null;
}

export interface RoutineExercise {
  exerciseId: string;
  notes?: string;
  restSec?: number;
  supersetId?: number | null;
  sets: RoutineSet[];
}

export interface Routine {
  id: string;
  name: string;
  notes?: string;
  order: number;
  exercises: RoutineExercise[];
  createdAt: number;
}

export type Unit = 'kg' | 'lbs';

export interface Settings {
  unit: Unit;
  defaultRestSec: number;
  /** Weight jump for main lifts when progressing, in the user's unit. Other exercises scale from it. */
  increment: number;
  /** Per-exercise weight jump overrides, in kg (exerciseId → kg). */
  increments: Record<string, number>;
  /**
   * Workout picked on the plan screen. A routine id stays "next" until a workout is
   * finished after `at`; 'rest' means rest on the day it was picked.
   */
  nextPick: { routineId: string; at: number } | null;
  /** Index 0 = Sunday … 6 = Saturday. Value is a routine id, 'rest', or null (no plan). */
  schedule: (string | null)[];
}

/* ---------- In-progress workout (draft) ---------- */

/** Draft values are kept as the strings the user typed, in the draft's unit. */
export interface DraftSet {
  type: SetType;
  weight: string;
  reps: string;
  duration: string;
  distance: string;
  done: boolean;
  /** Placeholder suggestions (shown greyed out; used if the set is checked while empty). */
  sugWeight?: string;
  sugReps?: string;
  sugDuration?: string;
  sugDistance?: string;
}

export interface DraftExercise {
  key: string;
  exerciseId: string;
  notes: string;
  restSec: number;
  supersetId?: number | null;
  /** Short explanation of the suggestion, e.g. "Hit 12 reps on all sets → +5 lbs". */
  suggestionNote?: string;
  sets: DraftSet[];
}

export interface ActiveWorkout {
  id: 'current';
  title: string;
  description: string;
  startTime: number;
  unit: Unit;
  routineId?: string;
  /** When editing an already-saved workout. */
  editingId?: number;
  editingEndTime?: number;
  restEndsAt?: number | null;
  restTotal?: number;
  exercises: DraftExercise[];
}
