import { describe, expect, it } from 'vitest';
import { CLAUDE_PROMPT, entryTotals, parseClaudeFoods, parseOffProduct, recentFoods, sumEntries } from '../food';
import type { FoodEntry } from '../../db/types';

const entry = (over: Partial<FoodEntry>): FoodEntry => ({ id: 'a', day: 0, at: 0, name: 'Oats', per: { kcal: 380, protein: 13, carbs: 60, fat: 7 }, unit: 'g100', qty: 50, ...over });

describe('totals', () => {
  it('scales per-100 g foods by grams and per-serving foods by servings', () => {
    expect(entryTotals(entry({}))).toEqual({ kcal: 190, protein: 6.5, carbs: 30, fat: 3.5 });
    expect(entryTotals(entry({ unit: 'serving', qty: 2 })).kcal).toBe(760);
  });
  it('adds a day up', () => {
    expect(sumEntries([entry({}), entry({ unit: 'serving', qty: 1 })])).toMatchObject({ kcal: 570, protein: 19.5 });
  });
});

describe('parseOffProduct', () => {
  const nutella = {
    product_name: 'Nutella',
    brands: 'Ferrero, Nutella',
    serving_quantity: '15',
    nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9 },
  };
  it('reads per-100 g values and defaults the amount to one serving', () => {
    expect(parseOffProduct(nutella, '3017620422003')).toEqual({
      name: 'Nutella',
      brand: 'Ferrero',
      barcode: '3017620422003',
      per: { kcal: 539, protein: 6.3, carbs: 57.5, fat: 30.9 },
      unit: 'g100',
      qty: 15,
      servingGrams: 15,
    });
  });
  it('falls back to kJ and to per-serving values', () => {
    expect(parseOffProduct({ product_name: 'X', nutriments: { 'energy-kj_100g': 418.4 } }, '1')!.per.kcal).toBeCloseTo(100);
    const s = parseOffProduct({ product_name: 'Bar', nutriments: { 'energy-kcal_serving': 200, proteins_serving: 20 } }, '2')!;
    expect(s).toMatchObject({ unit: 'serving', qty: 1, per: { kcal: 200, protein: 20, carbs: 0, fat: 0 } });
  });
  it('gives up when there is no energy value', () => {
    expect(parseOffProduct({ product_name: 'Mystery', nutriments: {} }, '3')).toBeNull();
    expect(parseOffProduct(null, '4')).toBeNull();
  });
});

describe('parseClaudeFoods', () => {
  it('reads FOOD lines from a chatty reply', () => {
    const reply = `That looks like a burrito bowl. I assumed about a cup of rice.

**FOOD: Chicken burrito bowl with rice and beans | 720 kcal | 45 g protein | 80 g carbs | 22 g fat**
- FOOD: Tortilla chips, small handful | 140 kcal | 2 g | 18 g | 7.5 g`;
    expect(parseClaudeFoods(reply)).toEqual([
      { name: 'Chicken burrito bowl with rice and beans', per: { kcal: 720, protein: 45, carbs: 80, fat: 22 }, unit: 'serving', qty: 1 },
      { name: 'Tortilla chips, small handful', per: { kcal: 140, protein: 2, carbs: 18, fat: 7.5 }, unit: 'serving', qty: 1 },
    ]);
  });
  it('ignores the prompt itself and malformed lines', () => {
    expect(parseClaudeFoods(CLAUDE_PROMPT).map((f) => f.name)).toEqual(['Grilled chicken breast, about 6 oz']);
    expect(parseClaudeFoods('FOOD: Soup | lots | 3 g | 4 g | 5 g\nNo foods here')).toEqual([]);
  });
});

describe('recentFoods', () => {
  it('keeps the latest entry for each distinct food', () => {
    const list = [entry({ id: '1', at: 1, qty: 40 }), entry({ id: '2', at: 5, qty: 80 }), entry({ id: '3', at: 3, name: 'Milk' }), entry({ id: '4', at: 2, barcode: '9', name: 'Bar' }), entry({ id: '5', at: 9, barcode: '9', name: 'Bar (new name)' })];
    expect(recentFoods(list).map((e) => e.id)).toEqual(['5', '2', '3']);
  });
});
