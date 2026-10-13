import { describe, expect, it } from 'vitest';
import { calcPlates, groupPlates } from '../plates';

const lbs = [45, 35, 25, 10, 5, 2.5];

describe('calcPlates', () => {
  it('loads 135 as one 45 per side', () => {
    expect(calcPlates(135, 45, lbs)).toEqual({ perSide: [45], total: 135, exact: true });
  });
  it('uses the fewest plates, largest first', () => {
    expect(calcPlates(225, 45, lbs).perSide).toEqual([45, 45]);
    expect(calcPlates(185, 45, lbs).perSide).toEqual([45, 25]);
    expect(calcPlates(160, 45, lbs).perSide).toEqual([45, 10, 2.5]);
  });
  it('only uses the plates you have', () => {
    expect(calcPlates(135, 45, [25, 10]).perSide).toEqual([25, 10, 10]);
  });
  it('falls back to the closest lighter weight', () => {
    const r = calcPlates(137, 45, lbs);
    expect(r).toMatchObject({ total: 135, exact: false });
  });
  it('handles just the bar and no bar', () => {
    expect(calcPlates(45, 45, lbs)).toEqual({ perSide: [], total: 45, exact: true });
    expect(calcPlates(90, 0, lbs).perSide).toEqual([45]);
  });
  it('works with small kg plates', () => {
    expect(calcPlates(62.5, 20, [20, 10, 5, 2.5, 1.25]).perSide).toEqual([20, 1.25]);
  });
});

describe('groupPlates', () => {
  it('counts each size', () => {
    expect(groupPlates([45, 45, 10])).toEqual([[45, 2], [10, 1]]);
  });
});
