import type { RoutineExercise } from '../db/types';
import { slugify } from './exercises';

export interface ProgramRoutine {
  name: string;
  exercises: RoutineExercise[];
}

export interface Program {
  id: string;
  name: string;
  level: 'Beginner' | 'Intermediate';
  daysPerWeek: number;
  description: string;
  routines: ProgramRoutine[];
  /** Weekday (0 = Sun) → index into routines, or 'rest'. */
  schedule: (number | 'rest')[];
}

/** [exercise name, sets, repsMin, repsMax, restSec] */
type Ex = [string, number, number, number, number?];

function r(name: string, list: Ex[]): ProgramRoutine {
  return {
    name,
    exercises: list.map(([ex, sets, min, max, rest = 90]) => ({
      exerciseId: slugify(ex),
      restSec: rest,
      sets: Array.from({ length: sets }, () => ({ type: 'normal' as const, reps: min, repsMax: max })),
    })),
  };
}

export const PROGRAMS: Program[] = [
  {
    id: 'ppl',
    name: 'Push / Pull / Legs',
    level: 'Intermediate',
    daysPerWeek: 6,
    description: 'Classic 6-day split hitting each muscle group twice per week.',
    routines: [
      r('Push', [
        ['Bench Press (Barbell)', 4, 6, 10, 150],
        ['Overhead Press (Dumbbell)', 3, 8, 12, 120],
        ['Incline Bench Press (Dumbbell)', 3, 8, 12],
        ['Lateral Raise (Dumbbell)', 3, 12, 15, 60],
        ['Triceps Rope Pushdown', 3, 10, 15, 60],
        ['Overhead Triceps Extension (Cable)', 3, 10, 15, 60],
      ]),
      r('Pull', [
        ['Deadlift (Barbell)', 3, 5, 8, 180],
        ['Pull Up', 3, 6, 12, 120],
        ['Seated Cable Row - V Grip (Cable)', 3, 8, 12],
        ['Face Pull', 3, 12, 15, 60],
        ['Hammer Curl (Dumbbell)', 3, 10, 12, 60],
        ['Bicep Curl (Barbell)', 3, 8, 12, 60],
      ]),
      r('Legs', [
        ['Squat (Barbell)', 4, 6, 10, 180],
        ['Romanian Deadlift (Barbell)', 3, 8, 12, 120],
        ['Leg Press (Machine)', 3, 10, 15],
        ['Lying Leg Curl (Machine)', 3, 10, 15, 60],
        ['Leg Extension (Machine)', 3, 12, 15, 60],
        ['Standing Calf Raise (Machine)', 4, 10, 15, 60],
      ]),
    ],
    schedule: ['rest', 0, 1, 2, 0, 1, 2],
  },
  {
    id: 'upper-lower',
    name: 'Upper / Lower',
    level: 'Intermediate',
    daysPerWeek: 4,
    description: '4-day split alternating upper and lower body days.',
    routines: [
      r('Upper A', [
        ['Bench Press (Barbell)', 4, 5, 8, 150],
        ['Bent Over Row (Barbell)', 4, 6, 10, 120],
        ['Overhead Press (Dumbbell)', 3, 8, 12],
        ['Lat Pulldown (Cable)', 3, 8, 12],
        ['Bicep Curl (Dumbbell)', 2, 10, 15, 60],
        ['Triceps Pushdown', 2, 10, 15, 60],
      ]),
      r('Lower A', [
        ['Squat (Barbell)', 4, 5, 8, 180],
        ['Romanian Deadlift (Barbell)', 3, 8, 10, 120],
        ['Bulgarian Split Squat', 3, 8, 12],
        ['Seated Leg Curl (Machine)', 3, 10, 15, 60],
        ['Standing Calf Raise (Machine)', 4, 10, 15, 60],
        ['Hanging Leg Raise', 3, 10, 15, 60],
      ]),
      r('Upper B', [
        ['Overhead Press (Barbell)', 4, 5, 8, 150],
        ['Pull Up', 4, 6, 10, 120],
        ['Incline Bench Press (Dumbbell)', 3, 8, 12],
        ['Seated Cable Row - V Grip (Cable)', 3, 8, 12],
        ['Lateral Raise (Dumbbell)', 3, 12, 15, 60],
        ['Hammer Curl (Dumbbell)', 2, 10, 15, 60],
      ]),
      r('Lower B', [
        ['Deadlift (Barbell)', 3, 3, 6, 180],
        ['Leg Press (Machine)', 3, 10, 15, 120],
        ['Walking Lunge (Dumbbell)', 3, 10, 12],
        ['Leg Extension (Machine)', 3, 12, 15, 60],
        ['Seated Calf Raise', 4, 12, 15, 60],
        ['Cable Crunch', 3, 10, 15, 60],
      ]),
    ],
    schedule: ['rest', 0, 1, 'rest', 2, 3, 'rest'],
  },
  {
    id: 'full-body',
    name: 'Full Body 3x',
    level: 'Beginner',
    daysPerWeek: 3,
    description: 'Three full-body sessions a week. Great for beginners or busy schedules.',
    routines: [
      r('Full Body A', [
        ['Squat (Barbell)', 3, 6, 10, 150],
        ['Bench Press (Barbell)', 3, 6, 10, 150],
        ['Bent Over Row (Barbell)', 3, 8, 12, 120],
        ['Lateral Raise (Dumbbell)', 2, 12, 15, 60],
        ['Hanging Leg Raise', 3, 10, 15, 60],
      ]),
      r('Full Body B', [
        ['Deadlift (Barbell)', 3, 5, 8, 180],
        ['Overhead Press (Barbell)', 3, 6, 10, 120],
        ['Lat Pulldown (Cable)', 3, 8, 12],
        ['Lunge (Dumbbell)', 2, 10, 12],
        ['Bicep Curl (Dumbbell)', 2, 10, 15, 60],
      ]),
      r('Full Body C', [
        ['Leg Press (Machine)', 3, 10, 15, 120],
        ['Incline Bench Press (Dumbbell)', 3, 8, 12],
        ['Seated Cable Row - V Grip (Cable)', 3, 8, 12],
        ['Romanian Deadlift (Dumbbell)', 3, 8, 12],
        ['Triceps Rope Pushdown', 2, 10, 15, 60],
      ]),
    ],
    schedule: ['rest', 0, 'rest', 1, 'rest', 2, 'rest'],
  },
  {
    id: 'strength-5x5',
    name: 'Strength 5×5',
    level: 'Beginner',
    daysPerWeek: 3,
    description: 'Simple barbell strength program. Add weight every time you complete all 5×5.',
    routines: [
      r('Workout A', [
        ['Squat (Barbell)', 5, 5, 5, 180],
        ['Bench Press (Barbell)', 5, 5, 5, 180],
        ['Bent Over Row (Barbell)', 5, 5, 5, 180],
      ]),
      r('Workout B', [
        ['Squat (Barbell)', 5, 5, 5, 180],
        ['Overhead Press (Barbell)', 5, 5, 5, 180],
        ['Deadlift (Barbell)', 1, 5, 5, 180],
      ]),
    ],
    schedule: ['rest', 0, 'rest', 1, 'rest', 0, 'rest'],
  },
];
