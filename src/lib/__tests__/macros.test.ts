import { describe, expect, it } from 'vitest';
import { activityFromWorkouts, calcMacros } from '../macros';
import type { MacroProfile } from '../../db/types';

const base: MacroProfile = { sex: 'male', age: 30, heightCm: 180, weightKg: 80, activity: 'moderate', goal: 'maintain' };

describe('calcMacros', () => {
  it('uses Mifflin-St Jeor and the activity factor', () => {
    const r = calcMacros(base);
    expect(r.bmr).toBe(1780); // 800 + 1125 - 150 + 5
    expect(r.tdee).toBe(2759);
    expect(r.calories).toBe(2760);
    expect(calcMacros({ ...base, sex: 'female' }).bmr).toBe(1614);
  });
  it('splits calories into macros that add back up', () => {
    const r = calcMacros(base);
    expect(r.protein).toBe(159); // 0.9 g per lb at 176 lbs
    expect(r.fat).toBe(77);
    expect(Math.abs(r.protein * 4 + r.fat * 9 + r.carbs * 4 - r.calories)).toBeLessThanOrEqual(4);
  });
  it('moves calories with the goal and raises protein when cutting', () => {
    const cut = calcMacros({ ...base, goal: 'cut' });
    expect(cut.calories).toBe(2260);
    expect(cut.protein).toBe(176);
    expect(calcMacros({ ...base, goal: 'bulk' }).calories).toBe(3260);
  });
  it('never goes below a basic minimum', () => {
    const r = calcMacros({ sex: 'female', age: 60, heightCm: 150, weightKg: 45, activity: 'sedentary', goal: 'cut' });
    expect(r).toMatchObject({ calories: 1200, floored: true });
    expect(r.carbs).toBeGreaterThanOrEqual(0);
  });
});

describe('activityFromWorkouts', () => {
  it('maps weekly training to a level', () => {
    expect(activityFromWorkouts(0)).toBe('sedentary');
    expect(activityFromWorkouts(2)).toBe('light');
    expect(activityFromWorkouts(4)).toBe('moderate');
    expect(activityFromWorkouts(6)).toBe('very');
  });
});
