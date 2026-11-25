import { useState } from 'react';
import type { Nutrition } from '../db/types';
import { entryTotals, type FoodDraft } from '../lib/food';
import { fmtNum, parseNum } from '../lib/units';
import { Sheet } from './Sheet';

const FIELDS: { key: keyof Nutrition; label: string }[] = [
  { key: 'kcal', label: 'Calories' },
  { key: 'protein', label: 'Protein (g)' },
  { key: 'carbs', label: 'Carbs (g)' },
  { key: 'fat', label: 'Fat (g)' },
];

/**
 * Confirm or edit a food before it's logged: how much you ate, and (for foods
 * you enter yourself or want to correct) its nutrition.
 */
export function FoodEditor({
  food,
  title,
  saveLabel = 'Add to log',
  note,
  onSave,
  onDelete,
  onClose,
}: {
  /** Null starts a blank food to fill in by hand. */
  food: FoodDraft | null;
  title: string;
  saveLabel?: string;
  note?: string;
  onSave: (food: FoodDraft) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  // Nothing to show yet (typing a food in, or a barcode with no data): start on the nutrition fields.
  const blank = food === null || (food.per.kcal === 0 && food.per.protein === 0 && food.per.carbs === 0 && food.per.fat === 0);
  const unit = food?.unit ?? 'serving';
  const [name, setName] = useState(food?.name ?? '');
  const [qty, setQty] = useState(food ? fmtNum(food.qty, 2) : '1');
  const [per, setPer] = useState<Record<keyof Nutrition, string>>({
    kcal: blank ? '' : fmtNum(food.per.kcal, 0),
    protein: blank ? '' : fmtNum(food.per.protein, 1),
    carbs: blank ? '' : fmtNum(food.per.carbs, 1),
    fat: blank ? '' : fmtNum(food.per.fat, 1),
  });
  const [editing, setEditing] = useState(blank);

  const q = parseNum(qty);
  const kcal = parseNum(per.kcal);
  const parsed: Nutrition = { kcal: kcal ?? 0, protein: parseNum(per.protein) ?? 0, carbs: parseNum(per.carbs) ?? 0, fat: parseNum(per.fat) ?? 0 };
  const valid = name.trim() !== '' && q != null && q > 0 && kcal != null;
  const totals = entryTotals({ per: parsed, unit, qty: q ?? 0 });
  const basis = unit === 'g100' ? 'per 100 g' : 'per serving';

  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <button
          className="btn primary block"
          disabled={!valid}
          onClick={() => {
            onSave({ ...(food ?? {}), name: name.trim(), per: parsed, unit, qty: q! });
            onClose();
          }}
        >
          {saveLabel}
        </button>
      }
    >
      {note && (
        <p className="small subtle" style={{ marginTop: 0 }}>
          {note}
        </p>
      )}
      <label className="field">
        <span>Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Greek yogurt" />
      </label>
      <label className="field">
        <span>{unit === 'g100' ? 'Amount (grams)' : 'Servings'}</span>
        <input className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ''))} onFocus={(e) => e.target.select()} />
      </label>
      {unit === 'g100' && food?.servingGrams && (
        <div className="chips wrap" style={{ margin: '-4px 0 14px' }}>
          {[0.5, 1, 2].map((n) => (
            <button key={n} className="chip" onClick={() => setQty(fmtNum(food.servingGrams! * n, 1))}>
              {n === 0.5 ? '½' : n} serving{n === 2 ? 's' : ''} · {fmtNum(food.servingGrams! * n, 0)} g
            </button>
          ))}
        </div>
      )}

      <div className="food-totals">
        <div>
          <div className="v">{Math.round(totals.kcal)}</div>
          <div className="l">kcal</div>
        </div>
        <div>
          <div className="v">{fmtNum(totals.protein, 0)}g</div>
          <div className="l">Protein</div>
        </div>
        <div>
          <div className="v">{fmtNum(totals.carbs, 0)}g</div>
          <div className="l">Carbs</div>
        </div>
        <div>
          <div className="v">{fmtNum(totals.fat, 0)}g</div>
          <div className="l">Fat</div>
        </div>
      </div>

      {editing ? (
        <>
          <div className="section-title" style={{ marginTop: 22 }}>
            Nutrition {basis}
          </div>
          <div className="field-grid" style={{ marginTop: 0 }}>
            {FIELDS.map((f) => (
              <label key={f.key} className="field">
                <span>{f.label}</span>
                <input className="input" inputMode="decimal" value={per[f.key]} placeholder="0" onChange={(e) => setPer({ ...per, [f.key]: e.target.value.replace(/[^0-9.]/g, '') })} />
              </label>
            ))}
          </div>
        </>
      ) : (
        <button className="btn ghost block" style={{ marginTop: 8 }} onClick={() => setEditing(true)}>
          Numbers look wrong? Edit nutrition
        </button>
      )}
      {onDelete && (
        <button
          className="btn danger block"
          style={{ marginTop: 4 }}
          onClick={() => {
            onDelete();
            onClose();
          }}
        >
          Remove from log
        </button>
      )}
    </Sheet>
  );
}
