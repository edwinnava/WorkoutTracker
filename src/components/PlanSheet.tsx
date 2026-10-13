import { Link } from 'react-router-dom';
import { saveSettings } from '../db/db';
import type { Exercise, Routine, Settings, Workout } from '../db/types';
import { startOfDay, startOfWeek } from '../lib/stats';
import { lastDoneByRoutine, suggestToday, upcomingOrder } from '../lib/suggest';
import { toast } from '../lib/hooks';
import { IconCheck, IconPlay } from './Icons';
import { Sheet } from './Sheet';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function ago(t: number) {
  const days = Math.round((startOfDay(Date.now()) - startOfDay(t)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Shows the week's plan and lets you choose what to do next, e.g. after a
 * skipped day, an injury, or when the rotation got out of step.
 */
export function PlanSheet({
  routines,
  workouts,
  settings,
  exMap,
  onClose,
  onStart,
}: {
  routines: Routine[];
  workouts: Workout[];
  settings: Settings;
  exMap: Map<string, Exercise>;
  onClose: () => void;
  onStart: (r: Routine) => void;
}) {
  const sorted = [...routines].sort((a, b) => a.order - b.order);
  const today = suggestToday(sorted, workouts, settings);
  const picked = today.kind === 'picked' || today.kind === 'picked-rest';
  const order = upcomingOrder(sorted, today.routine);
  const lastDone = lastDoneByRoutine(sorted, workouts);
  const hasSchedule = settings.schedule.some((d) => d != null);

  const pick = async (routineId: string, label: string) => {
    await saveSettings({ nextPick: { routineId, at: Date.now() } });
    toast(label);
  };

  const weekStart = startOfWeek(Date.now());
  const week = Array.from({ length: 7 }, (_, i) => {
    const t = weekStart + i * 86400000 + 12 * 3600000;
    const day = new Date(t).getDay();
    const plan = settings.schedule[day];
    const isToday = startOfDay(t) === startOfDay(Date.now());
    const done = workouts.find((w) => startOfDay(w.startTime) === startOfDay(t));
    return { day, plan, isToday, done };
  });

  return (
    <Sheet title="Your plan" onClose={onClose} full>
      <div className="section-title" style={{ marginTop: 4 }}>
        Up next
      </div>
      <div className="card" style={{ borderColor: 'var(--accent)' }}>
        <div className="row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 className="ellipsis">{today.routine?.name ?? (today.kind.includes('rest') ? 'Rest day' : 'Nothing planned')}</h3>
            <div className="small subtle">
              {
                {
                  picked: 'You picked this',
                  'picked-rest': 'You chose to rest today',
                  scheduled: 'Scheduled for today',
                  rest: 'Scheduled rest day',
                  rotation: 'Next in your rotation',
                  none: 'Add a routine to get suggestions',
                }[today.kind]
              }
            </div>
          </div>
          {today.routine && (
            <button className="btn primary sm" onClick={() => onStart(today.routine!)}>
              <IconPlay size={14} /> Start
            </button>
          )}
        </div>
        {picked && (
          <button
            className="btn ghost sm"
            style={{ padding: '8px 0 0' }}
            onClick={async () => {
              await saveSettings({ nextPick: null });
              toast('Back to your regular plan');
            }}
          >
            Undo — go back to my regular plan
          </button>
        )}
      </div>

      {sorted.length > 0 && (
        <>
          <div className="section-title">Choose your next workout</div>
          <p className="small subtle" style={{ marginTop: -4 }}>
            Skipped a day or need to train around an injury? Pick what you’ll do next. Your rotation continues from whatever you
            finish.
          </p>
          <div className="list">
            {order.map((r) => {
              const isNext = today.routine?.id === r.id;
              const last = lastDone.get(r.id);
              return (
                <div key={r.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                  <div className="main">
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div className="tiny subtle">{last ? `Last done ${ago(last)}` : 'Not done yet'}</div>
                    <div className="small subtle" style={{ marginTop: 4 }}>
                      {r.exercises
                        .map((e) => exMap.get(e.exerciseId)?.name ?? '')
                        .filter(Boolean)
                        .slice(0, 4)
                        .join(', ')}
                      {r.exercises.length > 4 ? '…' : ''}
                    </div>
                  </div>
                  {isNext ? (
                    <span className="badge success" style={{ marginTop: 2 }}>
                      <IconCheck size={12} /> Next
                    </span>
                  ) : (
                    <button className="btn sm" onClick={() => pick(r.id, `${r.name} is up next`)}>
                      Make next
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {today.kind !== 'picked-rest' && today.kind !== 'rest' && (
            <button className="btn block" style={{ marginTop: 10 }} onClick={() => pick('rest', 'Rest day — see you tomorrow')}>
              Take a rest day today
            </button>
          )}
        </>
      )}

      {hasSchedule && (
        <>
          <div className="section-title">This week</div>
          <div className="list">
            {week.map(({ day, plan, isToday, done }) => {
              const r = sorted.find((x) => x.id === plan);
              return (
                <div key={day} className="list-item">
                  <div className="main">
                    <span style={{ fontWeight: isToday ? 700 : 500 }}>{DAY_NAMES[day]}</span>
                    {isToday && <span className="badge accent" style={{ marginLeft: 8 }}>Today</span>}
                  </div>
                  <span className={done ? '' : 'subtle'}>
                    {done ? `✓ ${done.title}` : plan === 'rest' ? 'Rest' : r?.name ?? 'Auto'}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <Link to="/routines" className="btn block" style={{ marginTop: 16 }} onClick={onClose}>
        Edit routines &amp; weekly schedule
      </Link>
    </Sheet>
  );
}
