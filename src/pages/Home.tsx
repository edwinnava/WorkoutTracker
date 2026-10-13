import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../db/db';
import type { Routine } from '../db/types';
import { hasActiveWorkout, startWorkout } from '../lib/actions';
import { useExerciseMap, useSettings, useWorkouts } from '../lib/hooks';
import { startOfDay, startOfWeek, weekStreak, workoutVolume } from '../lib/stats';
import { suggestToday } from '../lib/suggest';
import { fmtLongDuration, fmtVolume } from '../lib/units';
import { IconCalendar, IconPlay, IconPlus, IconSparkle } from '../components/Icons';
import { WorkoutCard } from './History';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function confirmAndStart(navigate: (to: string) => void, routine?: Routine) {
  if (await hasActiveWorkout()) {
    if (!confirm('You already have a workout in progress. Discard it and start a new one?')) {
      navigate('/workout');
      return;
    }
  }
  await startWorkout(routine);
  navigate('/workout');
}

export default function Home() {
  const navigate = useNavigate();
  const settings = useSettings();
  const workouts = useWorkouts();
  const routines = useLiveQuery(() => db.routines.orderBy('order').toArray(), []);
  const exMap = useExerciseMap();

  const today = useMemo(
    () => (routines && workouts ? suggestToday(routines, workouts, settings) : null),
    [routines, workouts, settings],
  );

  const doneToday = workouts?.some((w) => w.startTime >= startOfDay(Date.now()));
  const weekStart = startOfWeek(Date.now());
  const thisWeek = (workouts ?? []).filter((w) => w.startTime >= weekStart);
  const weekVolume = thisWeek.reduce((v, w) => v + workoutVolume(w, exMap), 0);
  const weekTime = thisWeek.reduce((t, w) => t + (w.endTime - w.startTime), 0);
  const streak = weekStreak(workouts ?? []);

  // Monday-first week strip
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const t = weekStart + i * 86400000;
    const d = new Date(t);
    const dayIdx = d.getDay();
    const plan = settings.schedule[dayIdx];
    const routine = routines?.find((r) => r.id === plan);
    const done = (workouts ?? []).some((w) => startOfDay(w.startTime) === startOfDay(t));
    return { label: DAYS[dayIdx][0], plan: plan === 'rest' ? 'Rest' : routine?.name ?? '', done, today: startOfDay(t) === startOfDay(Date.now()) };
  });

  const routine = today?.routine;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page">
      <div className="page-header">
        <div className="title">
          <div className="small subtle">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <h1>{greeting}</h1>
        </div>
      </div>

      <div className="card">
        <div className="row small" style={{ color: 'var(--accent)', fontWeight: 600 }}>
          <IconSparkle size={16} /> TODAY’S WORKOUT
        </div>
        {today?.kind === 'rest' ? (
          <>
            <h2 style={{ marginTop: 8 }}>Rest day</h2>
            <p className="subtle">Recovery is part of the plan. Feel like training anyway?</p>
          </>
        ) : routine ? (
          <>
            <h2 style={{ marginTop: 8 }}>{routine.name}</h2>
            <p className="small subtle" style={{ margin: '4px 0 0' }}>
              {today?.kind === 'scheduled' ? 'Scheduled for today' : 'Next in your rotation'} · {routine.exercises.length} exercises
            </p>
            <p className="small" style={{ margin: '8px 0 0' }}>
              {routine.exercises
                .slice(0, 5)
                .map((e) => exMap.get(e.exerciseId)?.name ?? '')
                .filter(Boolean)
                .join(', ')}
              {routine.exercises.length > 5 ? '…' : ''}
            </p>
          </>
        ) : (
          <>
            <h2 style={{ marginTop: 8 }}>No plan yet</h2>
            <p className="subtle small">Create a routine or add a ready-made program and you’ll get a suggested workout every day.</p>
          </>
        )}
        {doneToday && <p className="small" style={{ color: 'var(--success)', margin: '8px 0 0' }}>✓ You already trained today</p>}
        <div className="row" style={{ marginTop: 14 }}>
          {routine && today?.kind !== 'rest' ? (
            <button className="btn primary block" onClick={() => confirmAndStart(navigate, routine)}>
              <IconPlay size={16} /> Start {routine.name}
            </button>
          ) : (
            <Link to="/routines" className="btn primary block">
              <IconCalendar size={18} /> {routines?.length ? 'Plan your week' : 'Browse programs'}
            </Link>
          )}
        </div>
        <button className="btn block" style={{ marginTop: 8 }} onClick={() => confirmAndStart(navigate)}>
          <IconPlus size={18} /> Start Empty Workout
        </button>
      </div>

      <div className="section-title">This week</div>
      <div className="week">
        {weekDays.map((d, i) => (
          <div key={i} className={'day' + (d.today ? ' today' : '') + (d.done ? ' done' : '')}>
            <div className="d">{d.label}</div>
            <div className="n subtle">{d.done ? '✓' : d.plan || '·'}</div>
          </div>
        ))}
      </div>
      <div className="stat-grid" style={{ marginTop: 8 }}>
        <div className="stat">
          <div className="v">{thisWeek.length}</div>
          <div className="l">Workouts</div>
        </div>
        <div className="stat">
          <div className="v">{fmtLongDuration(weekTime)}</div>
          <div className="l">Time</div>
        </div>
        <div className="stat">
          <div className="v">{streak}</div>
          <div className="l">Week streak</div>
        </div>
      </div>
      <div className="small subtle" style={{ marginTop: 6 }}>
        Volume this week: {fmtVolume(weekVolume, settings.unit)}
      </div>

      <div className="section-title row">
        <span>Recent workouts</span>
        <div className="spacer" />
        <Link to="/history" className="small" style={{ textTransform: 'none', letterSpacing: 0 }}>
          See all
        </Link>
      </div>
      {workouts && workouts.length === 0 && (
        <div className="card center">
          <p className="subtle">No workouts yet.</p>
          <Link to="/profile" className="btn sm">
            Import from Hevy
          </Link>
        </div>
      )}
      {workouts?.slice(0, 3).map((w) => <WorkoutCard key={w.id} w={w} exMap={exMap} unit={settings.unit} />)}
    </div>
  );
}
