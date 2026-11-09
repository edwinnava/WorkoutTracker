import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import type { Exercise, RoutineExercise, Settings, Workout } from '../db/types';
import { MUSCLE_LABELS } from '../data/exercises';
import { makeDraftExercise } from '../lib/actions';
import { AREA_LABELS, recommendWorkout } from '../lib/coach';
import { IconPlay, IconShuffle } from './Icons';
import { planSummary } from './TodayPlan';

/**
 * A workout built for today from your weak points (see lib/coach.ts):
 * why each muscle was picked, the exercises, and a Shuffle for different picks.
 */
export function RecommendedPlan({
  workouts,
  exercises,
  exMap,
  settings,
  onStart,
}: {
  workouts: Workout[];
  exercises: Exercise[];
  exMap: Map<string, Exercise>;
  settings: Settings;
  onStart: (name: string, exercises: RoutineExercise[]) => void;
}) {
  const [seed, setSeed] = useState(0);
  const rec = useMemo(
    () => recommendWorkout(workouts, exercises, { seed, restSec: settings.defaultRestSec }),
    [workouts, exercises, seed, settings.defaultRestSec],
  );
  const previews = useLiveQuery(
    () => Promise.all((rec?.exercises ?? []).map((re) => makeDraftExercise(re.exerciseId, re))),
    [JSON.stringify(rec?.exercises), settings],
  );

  if (!rec) {
    return (
      <p className="subtle small" style={{ margin: '12px 0 0' }}>
        Everything you train has been worked in the last day or two. Rest up, or start an empty workout below.
      </p>
    );
  }

  const top = rec.focus.slice(0, 2).map((f) => MUSCLE_LABELS[f.muscle]);
  const name = `${top.join(' & ')} Focus`;

  return (
    <>
      <h2 style={{ marginTop: 12 }}>{name}</h2>
      <p className="small subtle" style={{ margin: '4px 0 0' }}>
        Built from your last 4 weeks · {rec.exercises.length} exercises
      </p>

      <div className="why">
        {rec.focus.map((f) => (
          <div key={f.muscle} className="why-row">
            <strong>{MUSCLE_LABELS[f.muscle]}</strong>
            <span className="subtle">{f.reason}</span>
          </div>
        ))}
        {rec.avoiding.length > 0 && (
          <div className="why-row warn">
            <strong>Going easy</strong>
            <span>Leaving out {rec.avoiding.map((a) => AREA_LABELS[a].toLowerCase()).join(' and ')} work — you said it was bothering you</span>
          </div>
        )}
      </div>

      <div className="list inset" style={{ marginTop: 12 }}>
        {rec.exercises.map((re, i) => {
          const ex = exMap.get(re.exerciseId);
          return (
            <div key={re.exerciseId} className="list-item">
              <div className="main">
                <div className="row" style={{ gap: 6 }}>
                  <span className="ellipsis" style={{ fontWeight: 600 }}>
                    {ex?.name ?? re.exerciseId}
                  </span>
                  {rec.newIds.includes(re.exerciseId) && <span className="badge accent">New</span>}
                </div>
                <div className="small subtle">{planSummary(re, ex, previews?.[i], settings.unit)}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn" onClick={() => setSeed((s) => s + 1)} aria-label="Shuffle exercises">
          <IconShuffle size={18} /> Shuffle
        </button>
        <button className="btn primary" style={{ flex: 1 }} onClick={() => onStart(name, rec.exercises)}>
          <IconPlay size={16} /> Start workout
        </button>
      </div>
    </>
  );
}
