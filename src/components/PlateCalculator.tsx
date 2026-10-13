import { useState } from 'react';
import { saveSettings } from '../db/db';
import type { Unit } from '../db/types';
import { useSettings } from '../lib/hooks';
import { ALL_PLATES, BAR_OPTIONS, calcPlates, groupPlates } from '../lib/plates';
import { fmtNum, parseNum } from '../lib/units';
import { Sheet } from './Sheet';

/**
 * Shows which plates to load on each side for a weight, with toggles for the plates you own.
 * `barbell` = false (plate-loaded machines) starts with no bar weight.
 */
export function PlateCalculator({
  initial,
  unit,
  barbell,
  onClose,
  onUse,
}: {
  initial: string;
  unit: Unit;
  barbell: boolean;
  onClose: () => void;
  onUse?: (weight: string) => void;
}) {
  const settings = useSettings();
  const [target, setTarget] = useState(initial);
  const [bar, setBar] = useState<number | null>(barbell ? null : 0);
  const owned = settings.plates[unit] ?? [];
  const barWeight = bar ?? settings.barWeight[unit] ?? 0;
  const t = parseNum(target);
  const res = t != null ? calcPlates(t, barWeight, owned) : null;

  const togglePlate = (p: number) => {
    const next = owned.includes(p) ? owned.filter((x) => x !== p) : [...owned, p].sort((a, b) => b - a);
    saveSettings({ plates: { ...settings.plates, [unit]: next } });
  };
  const pickBar = (b: number) => {
    setBar(b);
    if (barbell) saveSettings({ barWeight: { ...settings.barWeight, [unit]: b } });
  };
  const maxPlate = Math.max(...ALL_PLATES[unit]);

  return (
    <Sheet title="Plate calculator" onClose={onClose}>
      <label className="field">
        <span>Total weight ({unit})</span>
        <input
          className="input plate-target"
          inputMode="decimal"
          value={target}
          placeholder="0"
          onChange={(e) => setTarget(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
      </label>

      <div className="plate-result">
        {t == null ? (
          <div className="subtle">Enter a weight</div>
        ) : t < barWeight ? (
          <div className="subtle">Less than the bar ({fmtNum(barWeight)} {unit})</div>
        ) : res && res.perSide.length === 0 && res.exact ? (
          <div>Just the bar — no plates needed</div>
        ) : res ? (
          <>
            <div className="plate-viz" aria-hidden>
              <div className="plate-sleeve" />
              {res.perSide.map((p, i) => (
                <div
                  key={i}
                  className="plate"
                  style={{ height: `${36 + 64 * Math.sqrt(p / maxPlate)}%` }}
                  title={`${fmtNum(p)} ${unit}`}
                >
                  {fmtNum(p)}
                </div>
              ))}
            </div>
            <div className="small subtle" style={{ marginTop: 10 }}>
              Each side
            </div>
            <div className="plate-list">
              {groupPlates(res.perSide).map(([p, n]) => (
                <span key={p} className="badge accent plate-badge">
                  {n} × {fmtNum(p)} {unit}
                </span>
              ))}
            </div>
            {!res.exact && (
              <div className="small" style={{ color: 'var(--warmup)', marginTop: 10 }}>
                Can’t make exactly {fmtNum(t)} {unit} with your plates. Closest: {fmtNum(res.total)} {unit}
              </div>
            )}
          </>
        ) : null}
      </div>

      <div className="section-title" style={{ marginTop: 18 }}>
        Bar
      </div>
      <div className="chips" style={{ flexWrap: 'wrap' }}>
        {BAR_OPTIONS[unit].map((b) => (
          <button key={b} className={'chip' + (barWeight === b ? ' active' : '')} onClick={() => pickBar(b)}>
            {b === 0 ? 'No bar' : `${fmtNum(b)} ${unit}`}
          </button>
        ))}
      </div>

      <div className="section-title">Plates I have</div>
      <div className="chips" style={{ flexWrap: 'wrap' }}>
        {ALL_PLATES[unit].map((p) => (
          <button key={p} className={'chip' + (owned.includes(p) ? ' active' : '')} onClick={() => togglePlate(p)} aria-pressed={owned.includes(p)}>
            {fmtNum(p)} {unit}
          </button>
        ))}
      </div>
      <p className="small subtle">Tap a plate to turn it on or off. Your choices are saved.</p>

      {onUse && res && res.total > 0 && (!res.exact || target !== initial) && (
        <button
          className="btn primary block"
          style={{ marginTop: 8 }}
          onClick={() => {
            onUse(fmtNum(res.total));
            onClose();
          }}
        >
          Use {fmtNum(res.total)} {unit} for this set
        </button>
      )}
    </Sheet>
  );
}
