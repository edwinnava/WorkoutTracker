import type { Equipment, Unit } from '../db/types';

/** Every plate size offered as a toggle, per unit (largest first). */
export const ALL_PLATES: Record<Unit, number[]> = {
  lbs: [55, 45, 35, 25, 15, 10, 5, 2.5, 1.25],
  kg: [25, 20, 15, 10, 5, 2.5, 2, 1.25, 1, 0.5],
};

export const DEFAULT_PLATES: Record<Unit, number[]> = {
  lbs: [45, 35, 25, 10, 5, 2.5],
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
};

export const BAR_OPTIONS: Record<Unit, number[]> = {
  lbs: [45, 35, 25, 15, 0],
  kg: [20, 15, 10, 0],
};

export const DEFAULT_BAR: Record<Unit, number> = { lbs: 45, kg: 20 };

/** Equipment that is loaded with plates (the calculator is offered for these). */
export function usesPlates(equipment: Equipment | undefined): boolean {
  return equipment === 'barbell' || equipment === 'machine' || equipment === 'plate' || equipment === 'other';
}

export interface PlateResult {
  /** Plates on ONE side of the bar, largest first. */
  perSide: number[];
  /** Total weight this loading gives (bar + both sides). */
  total: number;
  /** True when `total` equals the target. */
  exact: boolean;
}

// Work in hundredths so 2.5 / 1.25 plates are exact integers.
const S = 100;

/**
 * Plates per side to reach `target` on a bar weighing `bar`, using any number of each plate size.
 * When the target can't be hit exactly, returns the heaviest loading below it.
 * Among loadings of the same weight, uses the fewest plates.
 */
export function calcPlates(target: number, bar: number, plates: number[]): PlateResult {
  const sizes = [...new Set(plates.map((p) => Math.round(p * S)).filter((p) => p > 0))].sort((a, b) => b - a);
  const side = Math.floor(Math.round((target - bar) * S) / 2);
  if (side <= 0 || sizes.length === 0) return { perSide: [], total: bar, exact: Math.abs(target - bar) < 1e-9 };

  // count[w] = fewest plates summing to w (Infinity if impossible); pick[w] = plate used last.
  const count = new Array<number>(side + 1).fill(Infinity);
  const pick = new Array<number>(side + 1).fill(0);
  count[0] = 0;
  for (let w = 1; w <= side; w++) {
    for (const p of sizes) {
      if (p <= w && count[w - p] + 1 < count[w]) {
        count[w] = count[w - p] + 1;
        pick[w] = p;
      }
    }
  }
  let best = side;
  while (best > 0 && count[best] === Infinity) best--;
  const perSide: number[] = [];
  for (let w = best; w > 0; w -= pick[w]) perSide.push(pick[w] / S);
  perSide.sort((a, b) => b - a);
  const total = bar + (2 * best) / S;
  return { perSide, total, exact: Math.abs(total - target) < 1e-9 };
}

/** Groups a plate list into [size, count] pairs, e.g. [45, 45, 10] → [[45, 2], [10, 1]]. */
export function groupPlates(perSide: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of perSide) {
    const last = out[out.length - 1];
    if (last && last[0] === p) last[1]++;
    else out.push([p, 1]);
  }
  return out;
}
