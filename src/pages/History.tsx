import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Exercise, Unit, Workout } from '../db/types';
import { useExerciseMap, useSettings, useWorkouts } from '../lib/hooks';
import { workoutSetCount, workoutVolume } from '../lib/stats';
import { fmtLongDuration, fmtVolume } from '../lib/units';
import { IconHistory, IconSearch } from '../components/Icons';

export function fmtDate(t: number, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) {
  return new Date(t).toLocaleDateString(undefined, opts);
}

export function WorkoutCard({ w, exMap, unit }: { w: Workout; exMap: Map<string, Exercise>; unit: Unit }) {
  return (
    <Link to={`/history/${w.id}`} className="card clickable" style={{ display: 'block', color: 'inherit' }}>
      <div className="row">
        <h3 className="ellipsis" style={{ flex: 1 }}>
          {w.title}
        </h3>
        {w.source === 'hevy' && <span className="badge">Hevy</span>}
      </div>
      <div className="small subtle" style={{ marginTop: 2 }}>
        {fmtDate(w.startTime)} · {new Date(w.startTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
      </div>
      <div className="kv" style={{ marginTop: 10 }}>
        <div>
          <div className="l">Time</div>
          <div className="v">{fmtLongDuration(w.endTime - w.startTime)}</div>
        </div>
        <div>
          <div className="l">Volume</div>
          <div className="v">{fmtVolume(workoutVolume(w, exMap), unit)}</div>
        </div>
        <div>
          <div className="l">Sets</div>
          <div className="v">{workoutSetCount(w)}</div>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        {w.exercises.slice(0, 4).map((e, i) => (
          <div key={i} className="small ellipsis">
            <span className="subtle">{e.sets.length} × </span>
            {exMap.get(e.exerciseId)?.name ?? e.exerciseId}
          </div>
        ))}
        {w.exercises.length > 4 && <div className="small faint">+{w.exercises.length - 4} more</div>}
      </div>
    </Link>
  );
}

export default function History() {
  const workouts = useWorkouts();
  const exMap = useExerciseMap();
  const settings = useSettings();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(40);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return workouts ?? [];
    return (workouts ?? []).filter(
      (w) => w.title.toLowerCase().includes(s) || w.exercises.some((e) => exMap.get(e.exerciseId)?.name.toLowerCase().includes(s)),
    );
  }, [workouts, q, exMap]);

  const groups = useMemo(() => {
    const out: { label: string; items: Workout[] }[] = [];
    for (const w of filtered.slice(0, limit)) {
      const label = fmtDate(w.startTime, { month: 'long', year: 'numeric' });
      const g = out[out.length - 1];
      if (g && g.label === label) g.items.push(w);
      else out.push({ label, items: [w] });
    }
    return out;
  }, [filtered, limit]);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="title">History</h1>
        <span className="subtle small">{workouts?.length ?? 0} workouts</span>
      </div>
      <div className="search">
        <IconSearch size={18} />
        <input className="input" placeholder="Search workouts or exercises" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {workouts && workouts.length === 0 && (
        <div className="empty">
          <IconHistory size={40} />
          <p>Your finished workouts will show up here.</p>
          <Link to="/profile" className="btn sm">
            Import from Hevy
          </Link>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.label}>
          <div className="section-title">
            {g.label} <span className="faint">· {g.items.length}</span>
          </div>
          {g.items.map((w) => (
            <WorkoutCard key={w.id} w={w} exMap={exMap} unit={settings.unit} />
          ))}
        </div>
      ))}
      {filtered.length > limit && (
        <button className="btn block" style={{ marginTop: 16 }} onClick={() => setLimit((l) => l + 40)}>
          Load more
        </button>
      )}
    </div>
  );
}
