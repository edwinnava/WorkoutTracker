import type { MacroProfile } from '../db/types';
import { LBS_PER_KG } from './units';

/*
 * Daily calorie and macro targets from body stats, activity and goal.
 * Standard estimates (Mifflin-St Jeor resting energy x an activity factor);
 * they're a starting point to adjust from, not a prescription.
 */

export const ACTIVITY: { id: MacroProfile['activity']; label: string; hint: string; factor: number }[] = [
  { id: 'sedentary', label: 'Mostly sitting', hint: 'Desk job, little exercise', factor: 1.2 },
  { id: 'light', label: 'Lightly active', hint: 'Train 1–3 days a week', factor: 1.375 },
  { id: 'moderate', label: 'Active', hint: 'Train 3–5 days a week', factor: 1.55 },
  { id: 'very', label: 'Very active', hint: 'Train 6–7 days a week', factor: 1.725 },
  { id: 'extreme', label: 'Athlete', hint: 'Hard training plus a physical job', factor: 1.9 },
];

/** Goals as a daily calorie change. ~500 kcal a day is about 1 lb (0.45 kg) a week. */
export const GOALS: { id: MacroProfile['goal']; label: string; hint: string; delta: number }[] = [
  { id: 'cut', label: 'Lose fat', hint: 'About 1 lb a week', delta: -500 },
  { id: 'lean', label: 'Lose slowly', hint: 'About ½ lb a week', delta: -250 },
  { id: 'maintain', label: 'Maintain', hint: 'Stay the same weight', delta: 0 },
  { id: 'gain', label: 'Build muscle', hint: 'About ½ lb a week', delta: 250 },
  { id: 'bulk', label: 'Bulk', hint: 'About 1 lb a week', delta: 500 },
];

export interface MacroResult {
  /** Calories burned at rest. */
  bmr: number;
  /** Calories burned on a typical day (maintenance). */
  tdee: number;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  /** True when the goal would go below a sensible minimum and was raised to it. */
  floored: boolean;
}

/** Activity level that matches how often you've actually been training. */
export function activityFromWorkouts(perWeek: number): MacroProfile['activity'] {
  if (perWeek < 1) return 'sedentary';
  if (perWeek < 3) return 'light';
  if (perWeek < 5.5) return 'moderate';
  return 'very';
}

export function calcMacros(p: MacroProfile): MacroResult {
  const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'male' ? 5 : -161);
  const tdee = bmr * (ACTIVITY.find((a) => a.id === p.activity)?.factor ?? 1.2);
  const goal = GOALS.find((g) => g.id === p.goal) ?? GOALS[2];
  // Don't suggest eating less than a basic minimum, however aggressive the goal.
  const floor = p.sex === 'male' ? 1500 : 1200;
  const wanted = tdee + goal.delta;
  const calories = Math.round(Math.max(wanted, floor) / 10) * 10;

  const lbs = p.weightKg * LBS_PER_KG;
  // More protein when losing weight, to hold on to muscle.
  const protein = Math.round(lbs * (goal.delta < 0 ? 1 : 0.9));
  // A quarter of calories from fat, never under ~0.3 g per lb.
  const fat = Math.round(Math.max((calories * 0.25) / 9, lbs * 0.3));
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), calories, protein, fat, carbs, floored: wanted < floor };
}
