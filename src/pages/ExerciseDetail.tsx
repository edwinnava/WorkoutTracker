import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '../db/db';
import { EQUIPMENT_LABELS, MUSCLE_LABELS, TYPE_LABELS } from '../data/exercises';
import { useSettings } from '../lib/hooks';
import { estimate1RM, personalRecords, sessionsForExercise, usesWeight } from '../lib/stats';
import { distanceUnit, fmtDistance, fmtDuration, fmtNum, fmtVolume, fmtWeight, toDisplayDistance, toDisplayWeight } from '../lib/units';
import { LineChart } from '../components/Charts';
import { ExerciseForm } from '../components/ExerciseForm';
import { IconBack, IconEdit, IconTrash } from '../components/Icons';
import { fmtDate } from './History';
import { formatSet, setLabel } from './WorkoutLogger';

type Metric = 'heaviest' | 'e1rm' | 'volume' | 'reps' | 'duration' | 'distance';

export default function ExerciseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { unit } = useSettings();
  const ex = useLiveQuery(() => db.exercises.get(id!), [id]);
  const workouts = useLiveQuery(() => db.workouts.where('exerciseIds').equals(id!).toArray(), [id]);
  const [tab, setTab] = useState<'summary' | 'history'>('summary');
  const [editing, setEditing] = useState(false);

  const type = ex?.type ?? 'weight_reps';
  const sessions = useMemo(() => sessionsForExercise(workouts ?? [], id!, type), [workouts, id, type]);
  const pr = useMemo(() => personalRecords(sessions), [sessions]);

  const metrics: { key: Metric; label: string }[] = usesWeight(type)
    ? [
        { key: 'heaviest', label: 'Heaviest' },
        { key: 'e1rm', label: 'Est. 1RM' },
        { key: 'volume', label: 'Volume' },
        { key: 'reps', label: 'Reps' },
      ]
    : type === 'reps_only'
      ? [{ key: 'reps', label: 'Most reps' }]
      : type === 'duration'
        ? [{ key: 'duration', label: 'Longest' }]
        : [
            { key: 'distance', label: 'Distance' },
            { key: 'duration', label: 'Duration' },
          ];
  const [metric, setMetric] = useState<Metric | null>(null);
  const m = metric && metrics.some((x) => x.key === metric) ? metric : metrics[0].key;

  const points = [...sessions].reverse().map((s) => ({
    x: s.date,
    y:
      m === 'heaviest'
        ? toDisplayWeight(s.heaviestKg, unit)
        : m === 'e1rm'
          ? toDisplayWeight(s.best1RM, unit)
          : m === 'volume'
            ? toDisplayWeight(s.volumeKg, unit)
            : m === 'reps'
              ? s.maxReps
              : m === 'duration'
                ? s.maxDurationSec
                : toDisplayDistance(s.maxDistanceKm, unit),
  }));
  const fmt =
    m === 'duration'
      ? (v: number) => fmtDuration(v)
      : m === 'reps'
        ? (v: number) => `${Math.round(v)}`
        : m === 'distance'
          ? (v: number) => `${fmtNum(v, 1)}${distanceUnit(unit)}`
          : (v: number) => `${fmtNum(v, 0)}${unit}`;

  if (ex === undefined) return null;
  if (!ex) {
    return (
      <div className="page">
        <p>Exercise not found.</p>
        <Link to="/exercises">Back</Link>
      </div>
    );
  }

  const remove = async () => {
    if ((workouts?.length ?? 0) > 0) {
      alert(`This exercise is used in ${workouts!.length} workout(s) and can't be deleted.`);
      return;
    }
    if (!confirm(`Delete “${ex.name}”?`)) return;
    await db.exercises.delete(ex.id);
    navigate('/exercises', { replace: true });
  };

  return (
    <div className="page">
      <div className="page-header">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Back">
          <IconBack />
        </button>
        <div className="title" />
        {ex.custom && (
          <>
            <button className="icon-btn" onClick={() => setEditing(true)} aria-label="Edit">
              <IconEdit />
            </button>
            <button className="icon-btn" onClick={remove} aria-label="Delete">
              <IconTrash />
            </button>
          </>
        )}
      </div>
      <h1>{ex.name}</h1>
      <div className="row wrap" style={{ marginTop: 8 }}>
        <span className="badge accent">{MUSCLE_LABELS[ex.muscle]}</span>
        {ex.secondary?.map((s) => (
          <span key={s} className="badge">
            {MUSCLE_LABELS[s]}
          </span>
        ))}
        <span className="badge">{EQUIPMENT_LABELS[ex.equipment]}</span>
        <span className="badge">{TYPE_LABELS[ex.type]}</span>
        {ex.custom && <span className="badge warn">Custom</span>}
      </div>

      <div className="seg" style={{ marginTop: 16 }}>
        <button className={tab === 'summary' ? 'on' : ''} onClick={() => setTab('summary')}>
          Summary
        </button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>
          History ({sessions.length})
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="empty">You haven’t logged this exercise yet.</div>
      ) : tab === 'summary' ? (
        <>
          <div className="card" style={{ marginTop: 12 }}>
            <LineChart points={points} format={fmt} />
            <div className="chips" style={{ marginTop: 8 }}>
              {metrics.map((x) => (
                <button key={x.key} className={'chip' + (m === x.key ? ' active' : '')} onClick={() => setMetric(x.key)}>
                  {x.label}
                </button>
              ))}
            </div>
          </div>
          <div className="section-title">Personal records</div>
          <div className="list">
            {usesWeight(type) && (
              <>
                <PRRow label="Heaviest weight" value={`${fmtWeight(pr.heaviestKg, unit)} ${unit}`} />
                <PRRow label="Best estimated 1RM" value={`${fmtWeight(pr.best1RM, unit)} ${unit}`} />
                <PRRow label="Best set volume" value={fmtVolume(pr.bestSetVolumeKg, unit)} />
                <PRRow label="Best session volume" value={fmtVolume(pr.bestSessionVolumeKg, unit)} />
              </>
            )}
            {pr.maxReps > 0 && <PRRow label="Most reps in a set" value={String(pr.maxReps)} />}
            {pr.maxDurationSec > 0 && <PRRow label="Longest duration" value={fmtDuration(pr.maxDurationSec)} />}
            {pr.maxDistanceKm > 0 && <PRRow label="Longest distance" value={`${fmtDistance(pr.maxDistanceKm, unit)} ${distanceUnit(unit)}`} />}
            <PRRow label="Times performed" value={String(sessions.length)} />
          </div>
        </>
      ) : (
        <div style={{ marginTop: 12 }}>
          {sessions.map((s, i) => (
            <Link key={i} to={`/history/${s.workoutId}`} className="card clickable" style={{ display: 'block', color: 'inherit' }}>
              <div className="row">
                <strong className="ellipsis" style={{ flex: 1 }}>
                  {s.workoutTitle}
                </strong>
                <span className="small subtle">{fmtDate(s.date)}</span>
              </div>
              <div style={{ marginTop: 6 }}>
                {s.sets.map((set, j) => (
                  <div key={j} className="small row" style={{ padding: '2px 0' }}>
                    <span className={'set-num ' + set.type} style={{ width: 24, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>
                      {setLabel(s.sets, j)}
                    </span>
                    {formatSet(set, type, unit)}
                    {usesWeight(type) && set.reps ? <span className="faint">· 1RM {fmtWeight(estimate1RM(set.weightKg ?? 0, set.reps), unit)}</span> : null}
                  </div>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
      {editing && <ExerciseForm existing={ex} onClose={() => setEditing(false)} />}
    </div>
  );
}

function PRRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="list-item">
      <div className="main subtle">{label}</div>
      <strong>{value}</strong>
    </div>
  );
}
