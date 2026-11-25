import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import type { FoodEntry } from '../db/types';
import { toast, useSettings } from '../lib/hooks';
import { entryTotals, logFood, lookupBarcode, recentFoods, sumEntries, type FoodDraft } from '../lib/food';
import { calcMacros } from '../lib/macros';
import { startOfDay } from '../lib/stats';
import { fmtNum } from '../lib/units';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { ClaudeFoodSheet } from '../components/ClaudeFoodSheet';
import { FoodEditor } from '../components/FoodEditor';
import { IconBack, IconCamera, IconChevron, IconEdit, IconPlus, IconScan, IconSearch } from '../components/Icons';
import { Sheet } from '../components/Sheet';

const DAY = 86400000;

function dayLabel(day: number) {
  const today = startOfDay(Date.now());
  if (day === today) return 'Today';
  if (day === startOfDay(today - DAY / 2)) return 'Yesterday';
  return new Date(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

const amount = (e: Pick<FoodEntry, 'unit' | 'qty'>) => (e.unit === 'g100' ? `${fmtNum(e.qty, 0)} g` : `${fmtNum(e.qty, 2)} serving${e.qty === 1 ? '' : 's'}`);

type Editing = { mode: 'new'; food: FoodDraft | null; title: string; note?: string } | { mode: 'edit'; entry: FoodEntry };

/** Daily food log against the macro targets: scan, pick a recent food, type one in, or use a photo via Claude. */
export default function Food() {
  const settings = useSettings();
  const [day, setDay] = useState(() => startOfDay(Date.now()));
  const entries = useLiveQuery(() => db.foods.where('day').equals(day).sortBy('at'), [day]);
  const all = useLiveQuery(() => db.foods.toArray(), []);
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [looking, setLooking] = useState(false);
  const [claude, setClaude] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [query, setQuery] = useState('');

  const targets = useMemo(() => (settings.macros ? calcMacros(settings.macros) : null), [settings.macros]);
  const eaten = sumEntries(entries ?? []);
  const recents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recentFoods(all ?? []).filter((f) => !q || f.name.toLowerCase().includes(q) || f.brand?.toLowerCase().includes(q));
  }, [all, query]);

  const onCode = useCallback(async (code: string) => {
    setScanning(false);
    setLooking(true);
    const res = await lookupBarcode(code);
    setLooking(false);
    if (res.status === 'found') return setEditing({ mode: 'new', food: res.food, title: res.food.brand ?? 'Scanned food' });
    const blank: FoodDraft = { name: res.status === 'no-nutrition' ? res.name : '', barcode: code, per: { kcal: 0, protein: 0, carbs: 0, fat: 0 }, unit: 'serving', qty: 1 };
    const note =
      res.status === 'offline'
        ? 'Couldn’t reach the food database. Check your connection, or enter the label’s numbers for one serving and it’ll be remembered for next time.'
        : res.status === 'missing'
          ? 'This barcode isn’t in the food database yet. Enter the label’s numbers for one serving and it’ll be remembered for next time.'
          : 'The database has this product but no nutrition for it. Enter the label’s numbers for one serving and it’ll be remembered for next time.';
    setEditing({ mode: 'new', food: blank, title: 'Not found', note });
  }, []);

  const pct = (v: number, t: number) => `${Math.min(100, t > 0 ? (v / t) * 100 : 0)}%`;
  const left = targets ? targets.calories - eaten.kcal : 0;
  const today = startOfDay(Date.now());

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="title">Food</h1>
        <div className="day-nav">
          <button className="icon-btn" onClick={() => setDay(startOfDay(day - DAY / 2))} aria-label="Previous day">
            <IconBack size={18} />
          </button>
          <span>{dayLabel(day)}</span>
          <button className="icon-btn" onClick={() => setDay(startOfDay(day + DAY * 1.5))} disabled={day >= today} aria-label="Next day">
            <IconChevron size={18} />
          </button>
        </div>
      </div>

      <div className="card food-summary">
        <div className="row" style={{ alignItems: 'baseline' }}>
          <div className="macro-kcal">
            {Math.round(eaten.kcal).toLocaleString()} <span>{targets ? `/ ${targets.calories.toLocaleString()} kcal` : 'kcal'}</span>
          </div>
        </div>
        {targets ? (
          <>
            <div className="bar-row" style={{ margin: '14px 0 4px' }}>
              <div className="track">
                <div className="fill" style={{ width: pct(eaten.kcal, targets.calories) }} />
              </div>
            </div>
            <div className="small subtle">{left >= 0 ? `${Math.round(left).toLocaleString()} kcal left` : `${Math.round(-left).toLocaleString()} kcal over`}</div>
            <div className="food-macros">
              {(
                [
                  ['Protein', eaten.protein, targets.protein],
                  ['Carbs', eaten.carbs, targets.carbs],
                  ['Fat', eaten.fat, targets.fat],
                ] as const
              ).map(([label, v, t]) => (
                <div key={label}>
                  <div className="l">{label}</div>
                  <div className="v">
                    {Math.round(v)}
                    <span> / {t} g</span>
                  </div>
                  <div className="track">
                    <div className="fill" style={{ width: pct(v, t) }} />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="small subtle" style={{ marginTop: 6 }}>
              {Math.round(eaten.protein)} g protein · {Math.round(eaten.carbs)} g carbs · {Math.round(eaten.fat)} g fat
            </div>
            <Link to="/macros" className="link" style={{ display: 'inline-block', marginTop: 12 }}>
              Set daily targets
            </Link>
          </>
        )}
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" style={{ flex: 1 }} onClick={() => setScanning(true)}>
          <IconScan size={18} /> Scan barcode
        </button>
        <button className="btn" style={{ flex: 1 }} onClick={() => setAdding(true)}>
          <IconPlus size={18} /> Add food
        </button>
      </div>

      <div className="section-title">{dayLabel(day)}</div>
      {entries && entries.length === 0 && <p className="subtle small" style={{ margin: '0 2px' }}>Nothing logged yet.</p>}
      {entries && entries.length > 0 && (
        <div className="list">
          {entries.map((e) => {
            const t = entryTotals(e);
            return (
              <button key={e.id} className="list-item" onClick={() => setEditing({ mode: 'edit', entry: e })}>
                <div className="main">
                  <div className="ellipsis">{e.name}</div>
                  <div className="small subtle ellipsis">
                    {amount(e)} · {Math.round(t.protein)}P {Math.round(t.carbs)}C {Math.round(t.fat)}F
                  </div>
                </div>
                <div className="food-kcal">{Math.round(t.kcal)}</div>
              </button>
            );
          })}
        </div>
      )}

      {looking && (
        <Sheet title="Looking it up…" onClose={() => setLooking(false)}>
          <p className="subtle small" style={{ marginTop: 0 }}>
            Checking the food database.
          </p>
        </Sheet>
      )}

      {scanning && <BarcodeScanner onCode={onCode} onClose={() => setScanning(false)} />}

      {adding && (
        <Sheet title="Add food" onClose={() => setAdding(false)} full>
          <div className="list">
            <button
              className="list-item"
              onClick={() => {
                setAdding(false);
                setEditing({ mode: 'new', food: null, title: 'New food' });
              }}
            >
              <IconEdit size={20} />
              <div className="main">
                Type it in
                <div className="small subtle">Enter the calories and macros yourself</div>
              </div>
            </button>
            <button
              className="list-item"
              onClick={() => {
                setAdding(false);
                setClaude(true);
              }}
            >
              <IconCamera size={20} />
              <div className="main">
                Photo with Claude
                <div className="small subtle">Send a photo to the Claude app, paste the answer back</div>
              </div>
            </button>
          </div>
          <div className="section-title" style={{ marginTop: 26 }}>
            Foods you’ve logged
          </div>
          {(all?.length ?? 0) > 0 && (
            <div className="search" style={{ marginBottom: 10 }}>
              <IconSearch size={18} />
              <input className="input" placeholder="Search your foods" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          )}
          {recents.length === 0 ? (
            <p className="small subtle">{all?.length ? 'No matches.' : 'Foods you log will show up here so you can add them again in one tap.'}</p>
          ) : (
            <div className="list">
              {recents.map((f) => {
                const { id: _id, day: _day, at: _at, ...food } = f;
                return (
                  <button
                    key={f.id}
                    className="list-item"
                    onClick={() => {
                      setAdding(false);
                      setEditing({ mode: 'new', food, title: f.brand ?? 'Add food' });
                    }}
                  >
                    <div className="main">
                      <div className="ellipsis">{f.name}</div>
                      <div className="small subtle ellipsis">
                        {f.brand ? `${f.brand} · ` : ''}
                        {amount(f)} · {Math.round(entryTotals(f).kcal)} kcal
                      </div>
                    </div>
                    <IconPlus size={18} />
                  </button>
                );
              })}
            </div>
          )}
        </Sheet>
      )}

      {claude && (
        <ClaudeFoodSheet
          onClose={() => setClaude(false)}
          onAdd={async (foods) => {
            for (const f of foods) await logFood(f, day);
            toast(`Added ${foods.length} item${foods.length === 1 ? '' : 's'}`);
          }}
        />
      )}

      {editing?.mode === 'new' && (
        <FoodEditor
          key="new"
          food={editing.food}
          title={editing.title}
          note={editing.note}
          onClose={() => setEditing(null)}
          onSave={async (food) => {
            await logFood(food, day);
            toast('Added to log');
          }}
        />
      )}
      {editing?.mode === 'edit' && (
        <FoodEditor
          key={editing.entry.id}
          food={editing.entry}
          title={editing.entry.brand ?? 'Edit food'}
          saveLabel="Save"
          onClose={() => setEditing(null)}
          onSave={(food) => db.foods.update(editing.entry.id, { name: food.name, per: food.per, qty: food.qty })}
          onDelete={() => db.foods.delete(editing.entry.id)}
        />
      )}
    </div>
  );
}
