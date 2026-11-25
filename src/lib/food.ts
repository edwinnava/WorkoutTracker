import { db, newId } from '../db/db';
import type { FoodEntry, Nutrition } from '../db/types';
import { startOfDay } from './stats';

/* Food log: totals, barcode lookups (Open Food Facts) and the hand-off to the Claude app for photos. */

const ZERO: Nutrition = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

/** What an entry adds up to for the amount eaten. */
export function entryTotals(e: Pick<FoodEntry, 'per' | 'unit' | 'qty'>): Nutrition {
  const k = e.unit === 'g100' ? e.qty / 100 : e.qty;
  return { kcal: e.per.kcal * k, protein: e.per.protein * k, carbs: e.per.carbs * k, fat: e.per.fat * k };
}

export function sumEntries(entries: FoodEntry[]): Nutrition {
  return entries.reduce((sum, e) => {
    const t = entryTotals(e);
    return { kcal: sum.kcal + t.kcal, protein: sum.protein + t.protein, carbs: sum.carbs + t.carbs, fat: sum.fat + t.fat };
  }, ZERO);
}

/** A food ready to be logged: everything but the id, day and time. */
export type FoodDraft = Omit<FoodEntry, 'id' | 'day' | 'at'>;

export async function logFood(draft: FoodDraft, day = startOfDay(Date.now())): Promise<string> {
  const id = newId('f-');
  // Entries for another day are stamped at midday so they sort sensibly.
  const at = day === startOfDay(Date.now()) ? Date.now() : day + 12 * 3600000;
  await db.foods.put({ ...draft, id, day, at });
  return id;
}

/** Foods you've logged before, most recent first, one per distinct food. */
export function recentFoods(entries: FoodEntry[], limit = 30): FoodEntry[] {
  const seen = new Set<string>();
  const out: FoodEntry[] = [];
  for (const e of [...entries].sort((a, b) => b.at - a.at)) {
    const key = e.barcode ?? `${e.name.trim().toLowerCase()}|${e.unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/* ---------- Barcodes (Open Food Facts) ---------- */

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? (v.trim() === '' ? NaN : Number(v)) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
};

/** Turns an Open Food Facts product into a loggable food, or null if it has no usable nutrition. */
export function parseOffProduct(product: unknown, barcode: string): FoodDraft | null {
  if (typeof product !== 'object' || product === null) return null;
  const p = product as Record<string, unknown>;
  const n = (typeof p.nutriments === 'object' && p.nutriments !== null ? p.nutriments : {}) as Record<string, unknown>;
  const read = (suffix: '100g' | 'serving'): Nutrition | null => {
    // Some products only list energy in kJ.
    const kj = num(n[`energy-kj_${suffix}`]) ?? num(n[`energy_${suffix}`]);
    const kcal = num(n[`energy-kcal_${suffix}`]) ?? (kj != null ? kj / 4.184 : null);
    if (kcal == null) return null;
    return { kcal, protein: num(n[`proteins_${suffix}`]) ?? 0, carbs: num(n[`carbohydrates_${suffix}`]) ?? 0, fat: num(n[`fat_${suffix}`]) ?? 0 };
  };
  const name = [p.product_name, p.product_name_en, p.generic_name].find((x): x is string => typeof x === 'string' && x.trim() !== '')?.trim() ?? 'Scanned product';
  const brand = typeof p.brands === 'string' && p.brands.trim() ? p.brands.split(',')[0].trim() : undefined;
  const servingGrams = num(p.serving_quantity) || undefined;
  const base = { name, ...(brand ? { brand } : {}), barcode };
  const per100 = read('100g');
  if (per100) return { ...base, per: per100, unit: 'g100', qty: servingGrams ?? 100, ...(servingGrams ? { servingGrams } : {}) };
  const perServing = read('serving');
  if (perServing) return { ...base, per: perServing, unit: 'serving', qty: 1, ...(servingGrams ? { servingGrams } : {}) };
  return null;
}

export type LookupResult = { status: 'found'; food: FoodDraft } | { status: 'missing' } | { status: 'no-nutrition'; name: string } | { status: 'offline' };

/** Looks a barcode up, first in what you've logged before, then in Open Food Facts. */
export async function lookupBarcode(barcode: string): Promise<LookupResult> {
  const mine = (await db.foods.filter((e) => e.barcode === barcode).toArray()).sort((a, b) => b.at - a.at)[0];
  if (mine) {
    const { id: _id, day: _day, at: _at, ...food } = mine;
    return { status: 'found', food };
  }
  let body: { status?: number; product?: unknown };
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,product_name_en,generic_name,brands,serving_quantity,nutriments`, {
      signal: AbortSignal.timeout(12000),
    });
    if (res.status === 404) return { status: 'missing' };
    if (!res.ok) return { status: 'offline' };
    body = await res.json();
  } catch {
    return { status: 'offline' };
  }
  if (body.status !== 1 || !body.product) return { status: 'missing' };
  const food = parseOffProduct(body.product, barcode);
  if (food) return { status: 'found', food };
  const name = (body.product as { product_name?: unknown }).product_name;
  return { status: 'no-nutrition', name: typeof name === 'string' && name ? name : 'This product' };
}

/* ---------- Photos, via the Claude app ---------- */

/** Sent to the Claude app along with the photo. The FOOD: lines are what `parseClaudeFoods` reads back. */
export const CLAUDE_PROMPT = `Estimate the calories and macros of the food in this photo for my food log. Be realistic about portion sizes.

Finish your reply with one line per food item in exactly this format, with numbers only (no ranges):
FOOD: name and portion | calories kcal | protein g | carbs g | fat g

Example:
FOOD: Grilled chicken breast, about 6 oz | 280 kcal | 52 g | 0 g | 6 g`;

/** Reads the FOOD: lines out of Claude's reply. */
export function parseClaudeFoods(text: string): FoodDraft[] {
  const out: FoodDraft[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/FOOD:\s*(.+)$/i);
    if (!m) continue;
    const parts = m[1].split('|').map((s) => s.replace(/[*`]/g, '').trim());
    if (parts.length < 5) continue;
    const nums = parts.slice(1, 5).map((s) => num((s.match(/\d+(?:[.,]\d+)?/)?.[0] ?? '').replace(',', '.')));
    if (!parts[0] || nums.some((x) => x == null)) continue;
    if (/^name and portion$/i.test(parts[0])) continue; // the format line echoed back
    const [kcal, protein, carbs, fat] = nums as number[];
    out.push({ name: parts[0], per: { kcal, protein, carbs, fat }, unit: 'serving', qty: 1 });
  }
  return out;
}
