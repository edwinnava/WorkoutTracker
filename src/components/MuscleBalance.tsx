import { useMemo, useState } from 'react';
import type { Exercise, Workout } from '../db/types';
import { MUSCLE_LABELS } from '../data/exercises';
import { muscleStats } from '../lib/coach';

/** Weekly sets per muscle against a target, weakest first. */
export function MuscleBalance({ workouts, exMap }: { workouts: Workout[]; exMap: Map<string, Exercise> }) {
  const [all, setAll] = useState(false);
  const stats = useMemo(() => [...muscleStats(workouts, exMap)].sort((a, b) => b.deficit - a.deficit), [workouts, exMap]);
  const shown = all ? stats : stats.slice(0, 5);
  return (
    <div className="card">
      {shown.map((s) => {
        const pct = Math.min(1, s.weekly / s.target);
        const level = pct >= 0.75 ? 'good' : pct >= 0.4 ? 'mid' : 'low';
        return (
          <div key={s.muscle} className="bar-row">
            <div className="lbl">{MUSCLE_LABELS[s.muscle]}</div>
            <div className="track">
              <div className={'fill ' + level} style={{ width: `${Math.max(pct * 100, 3)}%` }} />
            </div>
            <div className="num">
              {Math.round(s.weekly * 2) / 2}
              <span className="faint">/{s.target}</span>
            </div>
          </div>
        );
      })}
      <div className="row" style={{ marginTop: 10 }}>
        <span className="tiny subtle" style={{ flex: 1 }}>
          Sets per week, averaged over 4 weeks, against a target.
        </span>
        <button className="btn ghost sm" style={{ padding: '2px 0' }} onClick={() => setAll((v) => !v)}>
          {all ? 'Show less' : 'Show all'}
        </button>
      </div>
    </div>
  );
}
