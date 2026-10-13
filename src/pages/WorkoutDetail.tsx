import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db } from '../db/db';
import { editWorkout, hasActiveWorkout, repeatWorkout, saveWorkoutAsRoutine } from '../lib/actions';
import { toast, useExerciseMap, useSettings } from '../lib/hooks';
import { countWorkoutPRs, workoutSetCount, workoutVolume } from '../lib/stats';
import { fmtLongDuration, fmtVolume } from '../lib/units';
import { ActionMenu } from '../components/Sheet';
import { IconBack, IconCopy, IconDots, IconEdit, IconList, IconPlay, IconTrash, IconTrophy } from '../components/Icons';
import { fmtDate } from './History';
import { formatSet, setLabel } from './WorkoutLogger';

export default function WorkoutDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const exMap = useExerciseMap();
  const { unit } = useSettings();
  const [menu, setMenu] = useState(false);
  const w = useLiveQuery(() => db.workouts.get(Number(id)), [id]);
  const earlier = useLiveQuery(
    async () => (w ? db.workouts.where('startTime').below(w.startTime).toArray() : []),
    [w?.startTime],
  );
  const prs = useMemo(() => (w && earlier && exMap.size ? countWorkoutPRs(w, earlier, exMap) : 0), [w, earlier, exMap]);
  const justFinished = params.get('done') === '1';

  if (w === undefined) return null;
  if (!w) {
    return (
      <div className="page">
        <p>Workout not found.</p>
        <Link to="/history">Back to history</Link>
      </div>
    );
  }

  const ensureNoActive = async () => {
    if (await hasActiveWorkout()) {
      if (!confirm('You have a workout in progress. Discard it?')) return false;
    }
    return true;
  };

  const sessionNumber = (earlier?.length ?? 0) + 1;

  return (
    <div className="page">
      <div className="page-header">
        <button className="icon-btn" onClick={() => (justFinished ? navigate('/') : navigate(-1))} aria-label="Back">
          <IconBack />
        </button>
        <div className="title" />
        <button className="icon-btn" onClick={() => setMenu(true)} aria-label="Workout options">
          <IconDots />
        </button>
      </div>

      {justFinished && (
        <div className="card center" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
          <div style={{ fontSize: 36 }}>🎉</div>
          <h2>Workout complete!</h2>
          <p className="subtle small" style={{ margin: '6px 0 0' }}>
            That’s workout #{sessionNumber}
            {prs > 0 ? ` · ${prs} new personal record${prs > 1 ? 's' : ''}` : ''}.
          </p>
        </div>
      )}

      <h1>{w.title}</h1>
      <div className="small subtle" style={{ marginTop: 4 }}>
        {fmtDate(w.startTime, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} ·{' '}
        {new Date(w.startTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
      </div>
      {w.description && <p style={{ whiteSpace: 'pre-wrap' }}>{w.description}</p>}

      <div className="stat-grid" style={{ marginTop: 14 }}>
        <div className="stat">
          <div className="v">{fmtLongDuration(w.endTime - w.startTime)}</div>
          <div className="l">Time</div>
        </div>
        <div className="stat">
          <div className="v" style={{ fontSize: 17 }}>
            {fmtVolume(workoutVolume(w, exMap), unit)}
          </div>
          <div className="l">Volume</div>
        </div>
        <div className="stat">
          <div className="v">
            {prs > 0 ? (
              <span className="row" style={{ gap: 4 }}>
                <IconTrophy size={18} style={{ color: 'var(--warmup)' }} />
                {prs}
              </span>
            ) : (
              workoutSetCount(w)
            )}
          </div>
          <div className="l">{prs > 0 ? 'Records' : 'Sets'}</div>
        </div>
      </div>

      {w.exercises.map((e, i) => {
        const ex = exMap.get(e.exerciseId);
        return (
          <div key={i} className="card" style={{ marginTop: 12 }}>
            <Link to={`/exercises/${e.exerciseId}`} style={{ fontWeight: 600 }}>
              {ex?.name ?? e.exerciseId}
            </Link>
            {e.supersetId != null && <span className="badge" style={{ marginLeft: 8 }}>Superset</span>}
            {e.notes && <p className="small subtle" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{e.notes}</p>}
            <div style={{ marginTop: 8 }}>
              {e.sets.map((s, j) => (
                <div key={j} className="row small" style={{ padding: '3px 0' }}>
                  <span className={'set-num ' + s.type} style={{ width: 28, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>
                    {setLabel(e.sets, j)}
                  </span>
                  <span style={{ fontWeight: 500 }}>{formatSet(s, ex?.type ?? 'weight_reps', unit)}</span>
                  {s.rpe != null && <span className="faint">@ RPE {s.rpe}</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {menu && (
        <ActionMenu
          onClose={() => setMenu(false)}
          title={w.title}
          items={[
            {
              label: 'Repeat this workout',
              icon: <IconPlay size={20} />,
              onClick: async () => {
                if (!(await ensureNoActive())) return;
                await repeatWorkout(w);
                navigate('/workout');
              },
            },
            {
              label: 'Edit workout',
              icon: <IconEdit size={20} />,
              onClick: async () => {
                if (!(await ensureNoActive())) return;
                await editWorkout(w);
                navigate('/workout');
              },
            },
            {
              label: 'Save as routine',
              icon: <IconCopy size={20} />,
              onClick: async () => {
                const name = prompt('Routine name', w.title);
                if (!name) return;
                const rid = await saveWorkoutAsRoutine(w, name.trim());
                toast('Routine saved');
                navigate(`/routines/${rid}`);
              },
            },
            { label: 'View history', icon: <IconList size={20} />, onClick: () => navigate('/history') },
            {
              label: 'Delete workout',
              icon: <IconTrash size={20} />,
              danger: true,
              onClick: async () => {
                if (!confirm('Delete this workout? This cannot be undone.')) return;
                await db.workouts.delete(w.id!);
                navigate('/history', { replace: true });
              },
            },
          ]}
        />
      )}
    </div>
  );
}
