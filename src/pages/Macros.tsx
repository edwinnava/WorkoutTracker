import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSettings, saveSettings } from '../db/db';
import type { MacroProfile } from '../db/types';
import { useSettings, useWorkouts } from '../lib/hooks';
import { ACTIVITY, GOALS, activityFromWorkouts, calcMacros } from '../lib/macros';
import { fmtNum, LBS_PER_KG, parseNum } from '../lib/units';
import { IconBack } from '../components/Icons';

const CM_PER_IN = 2.54;

interface Draft {
  sex: MacroProfile['sex'];
  age: string;
  /** Feet when using lbs, centimetres when using kg. */
  height: string;
  inches: string;
  weight: string;
  activity: MacroProfile['activity'];
  goal: MacroProfile['goal'];
}

function toDraft(p: MacroProfile | null, imperial: boolean, activity: MacroProfile['activity']): Draft {
  if (!p) return { sex: 'male', age: '', height: '', inches: '', weight: '', activity, goal: 'maintain' };
  const totalIn = Math.round(p.heightCm / CM_PER_IN);
  return {
    sex: p.sex,
    age: String(p.age),
    height: imperial ? String(Math.floor(totalIn / 12)) : fmtNum(p.heightCm, 0),
    inches: imperial ? String(totalIn % 12) : '',
    weight: fmtNum(imperial ? p.weightKg * LBS_PER_KG : p.weightKg, 1),
    activity: p.activity,
    goal: p.goal,
  };
}

function toProfile(d: Draft, imperial: boolean): MacroProfile | null {
  const age = parseNum(d.age);
  const h = parseNum(d.height);
  const w = parseNum(d.weight);
  if (age == null || h == null || w == null) return null;
  const heightCm = imperial ? (h * 12 + (parseNum(d.inches) ?? 0)) * CM_PER_IN : h;
  const weightKg = imperial ? w / LBS_PER_KG : w;
  if (age < 13 || age > 100 || heightCm < 120 || heightCm > 230 || weightKg < 30 || weightKg > 300) return null;
  return { sex: d.sex, age: Math.round(age), heightCm, weightKg, activity: d.activity, goal: d.goal };
}

/** Daily calorie and macro targets. Inputs are saved as you go. */
export default function Macros() {
  const navigate = useNavigate();
  const settings = useSettings();
  const workouts = useWorkouts();
  const imperial = settings.unit === 'lbs';

  // How often you've actually trained lately, to suggest an activity level.
  const perWeek = useMemo(() => {
    const since = Date.now() - 28 * 86400000;
    return (workouts ?? []).filter((w) => w.startTime >= since).length / 4;
  }, [workouts]);

  // Fill the form once, after the saved details have actually loaded (undefined = still loading).
  const stored = useLiveQuery(() => getSettings().then((x) => ({ macros: x.macros, imperial: x.unit === 'lbs' })), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    if (!draft && workouts && stored) setDraft(toDraft(stored.macros, stored.imperial, activityFromWorkouts(perWeek)));
  }, [draft, workouts, stored, perWeek]);

  const profile = draft ? toProfile(draft, imperial) : null;
  const result = profile ? calcMacros(profile) : null;
  const saved = JSON.stringify(settings.macros);
  useEffect(() => {
    if (profile && JSON.stringify(profile) !== saved) saveSettings({ macros: profile });
  }, [profile, saved]);

  if (!draft) return null;
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const num = (key: 'age' | 'height' | 'inches' | 'weight', decimal = false) => ({
    className: 'input',
    inputMode: (decimal ? 'decimal' : 'numeric') as 'decimal' | 'numeric',
    value: draft[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set({ [key]: e.target.value.replace(decimal ? /[^0-9.]/g : /\D/g, '') }),
  });
  const kcal = result ? { p: result.protein * 4, c: result.carbs * 4, f: result.fat * 9 } : null;
  const total = kcal ? kcal.p + kcal.c + kcal.f : 1;
  const suggested = activityFromWorkouts(perWeek);

  return (
    <div className="page no-tabs">
      <div className="page-header">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Back">
          <IconBack />
        </button>
        <h1 className="title">Macros</h1>
      </div>

      <div className="card macro-result">
        {result && kcal ? (
          <>
            <div className="label">Daily target</div>
            <div className="macro-kcal">
              {result.calories.toLocaleString()} <span>kcal</span>
            </div>
            <div className="macro-bar" aria-hidden>
              <i className="p" style={{ flex: kcal.p }} />
              <i className="c" style={{ flex: kcal.c }} />
              <i className="f" style={{ flex: kcal.f }} />
            </div>
            <div className="macro-split">
              {(
                [
                  ['p', 'Protein', result.protein, kcal.p],
                  ['c', 'Carbs', result.carbs, kcal.c],
                  ['f', 'Fat', result.fat, kcal.f],
                ] as const
              ).map(([k, label, grams, cals]) => (
                <div key={k}>
                  <div className="g">
                    {grams}
                    <span>g</span>
                  </div>
                  <div className="l">
                    <i className={k} /> {label} · {Math.round((cals / total) * 100)}%
                  </div>
                </div>
              ))}
            </div>
            <div className="small subtle" style={{ marginTop: 16 }}>
              You burn about {result.tdee.toLocaleString()} kcal on a typical day ({result.bmr.toLocaleString()} at rest).
            </div>
            {result.floored && (
              <div className="small" style={{ color: 'var(--warmup)', marginTop: 8 }}>
                That goal would take you below a sensible minimum, so the target is held at {result.calories.toLocaleString()} kcal.
              </div>
            )}
          </>
        ) : (
          <>
            <div className="label">Daily target</div>
            <p className="subtle" style={{ margin: '6px 0 0' }}>
              Fill in your details below to see your calories and macros.
            </p>
          </>
        )}
      </div>

      <div className="section-title">About you</div>
      <div className="seg">
        {(['male', 'female'] as const).map((s) => (
          <button key={s} className={draft.sex === s ? 'on' : ''} onClick={() => set({ sex: s })}>
            {s === 'male' ? 'Male' : 'Female'}
          </button>
        ))}
      </div>
      <div className="field-grid">
        <label className="field">
          <span>Age</span>
          <input {...num('age')} placeholder="30" />
        </label>
        <label className="field">
          <span>Weight ({settings.unit})</span>
          <input {...num('weight', true)} placeholder={imperial ? '180' : '80'} />
        </label>
        {imperial ? (
          <>
            <label className="field">
              <span>Height (ft)</span>
              <input {...num('height')} placeholder="5" />
            </label>
            <label className="field">
              <span>Height (in)</span>
              <input {...num('inches')} placeholder="10" />
            </label>
          </>
        ) : (
          <label className="field">
            <span>Height (cm)</span>
            <input {...num('height')} placeholder="178" />
          </label>
        )}
      </div>

      <div className="section-title">Activity</div>
      <div className="list">
        {ACTIVITY.map((a) => (
          <button key={a.id} className={'list-item option' + (draft.activity === a.id ? ' on' : '')} onClick={() => set({ activity: a.id })} aria-pressed={draft.activity === a.id}>
            <span className="dot" />
            <div className="main">
              {a.label}
              <div className="small subtle">{a.hint}</div>
            </div>
            {a.id === suggested && (workouts?.length ?? 0) > 0 && <span className="badge accent">Matches your log</span>}
          </button>
        ))}
      </div>

      <div className="section-title">Goal</div>
      <div className="list">
        {GOALS.map((g) => (
          <button key={g.id} className={'list-item option' + (draft.goal === g.id ? ' on' : '')} onClick={() => set({ goal: g.id })} aria-pressed={draft.goal === g.id}>
            <span className="dot" />
            <div className="main">
              {g.label}
              <div className="small subtle">{g.hint}</div>
            </div>
          </button>
        ))}
      </div>

      <p className="tiny subtle" style={{ marginTop: 20 }}>
        These are standard estimates, not medical advice. Use them as a starting point: if your weight isn’t moving the way you want after two or three weeks, adjust
        calories by about 100–200 a day.
      </p>
    </div>
  );
}
