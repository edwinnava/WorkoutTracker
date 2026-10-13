import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db, newId, saveSettings } from '../db/db';
import type { Routine } from '../db/types';
import { PROGRAMS, type Program } from '../data/programs';
import { toast, useExerciseMap, useSettings } from '../lib/hooks';
import { ActionMenu, Sheet } from '../components/Sheet';
import { IconCopy, IconDots, IconDown, IconEdit, IconPlay, IconPlus, IconTrash, IconUp } from '../components/Icons';
import { confirmAndStart } from './Home';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

export default function Routines() {
  const navigate = useNavigate();
  const routines = useLiveQuery(() => db.routines.orderBy('order').toArray(), []);
  const exMap = useExerciseMap();
  const settings = useSettings();
  const [menu, setMenu] = useState<Routine | null>(null);
  const [program, setProgram] = useState<Program | null>(null);

  const reorder = async (r: Routine, dir: -1 | 1) => {
    if (!routines) return;
    const i = routines.findIndex((x) => x.id === r.id);
    const j = i + dir;
    if (j < 0 || j >= routines.length) return;
    const list = [...routines];
    [list[i], list[j]] = [list[j], list[i]];
    await db.routines.bulkPut(list.map((x, k) => ({ ...x, order: k })));
  };

  const setDay = (day: number, value: string) => {
    const schedule = [...settings.schedule];
    schedule[day] = value === '' ? null : value;
    saveSettings({ schedule });
  };

  const addProgram = async (p: Program, applySchedule: boolean) => {
    const start = routines?.length ?? 0;
    const created: Routine[] = p.routines.map((r, i) => ({
      id: newId('r-'),
      name: r.name,
      order: start + i,
      createdAt: Date.now(),
      exercises: r.exercises,
    }));
    await db.routines.bulkAdd(created);
    if (applySchedule) {
      await saveSettings({ schedule: p.schedule.map((s) => (s === 'rest' ? 'rest' : created[s].id)) });
    }
    setProgram(null);
    toast(`Added ${p.name}`);
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="title">Routines</h1>
        <Link to="/routines/new" className="btn primary sm">
          <IconPlus size={18} /> New
        </Link>
      </div>

      {routines?.length === 0 && (
        <div className="card center">
          <p className="subtle" style={{ marginTop: 0 }}>
            Routines are your workout templates. Create your own, save one from a past workout, or start with a program below.
          </p>
        </div>
      )}

      {routines?.map((r) => (
        <div key={r.id} className="card">
          <div className="row">
            <Link to={`/routines/${r.id}`} className="ellipsis" style={{ flex: 1, color: 'inherit' }}>
              <h3>{r.name}</h3>
            </Link>
            <button className="icon-btn" onClick={() => setMenu(r)} aria-label="Routine options">
              <IconDots />
            </button>
          </div>
          <p className="small subtle" style={{ margin: '4px 0 12px' }}>
            {r.exercises.map((e) => exMap.get(e.exerciseId)?.name ?? '').filter(Boolean).join(', ') || 'No exercises'}
          </p>
          <button className="btn primary block" onClick={() => confirmAndStart(navigate, r)}>
            <IconPlay size={16} /> Start Routine
          </button>
        </div>
      ))}

      <div className="section-title">Weekly schedule</div>
      <p className="small subtle" style={{ marginTop: -4 }}>
        Pick what to train each day. Days left on “Auto” suggest the next routine in your rotation.
      </p>
      <div className="list">
        {ORDER.map((d) => (
          <div key={d} className="list-item">
            <div className="main" style={{ fontWeight: 500 }}>
              {DAY_NAMES[d]}
            </div>
            <select className="input" style={{ width: 'auto', maxWidth: 190 }} value={settings.schedule[d] ?? ''} onChange={(e) => setDay(d, e.target.value)}>
              <option value="">Auto</option>
              <option value="rest">Rest</option>
              {routines?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="section-title">Programs</div>
      {PROGRAMS.map((p) => (
        <button key={p.id} className="card clickable" style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={() => setProgram(p)}>
          <div className="row">
            <h3 style={{ flex: 1 }}>{p.name}</h3>
            <span className="badge accent">{p.daysPerWeek}× / week</span>
          </div>
          <p className="small subtle" style={{ margin: '6px 0 0' }}>
            {p.level} · {p.description}
          </p>
        </button>
      ))}

      {menu && (
        <ActionMenu
          title={menu.name}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Edit routine', icon: <IconEdit size={20} />, onClick: () => navigate(`/routines/${menu.id}`) },
            {
              label: 'Duplicate',
              icon: <IconCopy size={20} />,
              onClick: () => db.routines.add({ ...menu, id: newId('r-'), name: `${menu.name} (copy)`, order: routines?.length ?? 0, createdAt: Date.now() }),
            },
            { label: 'Move up', icon: <IconUp size={20} />, onClick: () => reorder(menu, -1) },
            { label: 'Move down', icon: <IconDown size={20} />, onClick: () => reorder(menu, 1) },
            {
              label: 'Delete routine',
              icon: <IconTrash size={20} />,
              danger: true,
              onClick: async () => {
                if (!confirm(`Delete “${menu.name}”? Past workouts are kept.`)) return;
                await db.routines.delete(menu.id);
                await saveSettings({ schedule: settings.schedule.map((s) => (s === menu.id ? null : s)) });
              },
            },
          ]}
        />
      )}

      {program && (
        <Sheet
          title={program.name}
          onClose={() => setProgram(null)}
          footer={
            <>
              <button className="btn primary block" onClick={() => addProgram(program, true)}>
                Add & set weekly schedule
              </button>
              <button className="btn block" style={{ marginTop: 8 }} onClick={() => addProgram(program, false)}>
                Add routines only
              </button>
            </>
          }
        >
          <p className="subtle small" style={{ marginTop: 0 }}>
            {program.description}
          </p>
          <p className="small">
            <strong>Schedule: </strong>
            {ORDER.map((d) => {
              const s = program.schedule[d];
              return `${DAY_NAMES[d].slice(0, 3)} ${s === 'rest' ? 'Rest' : program.routines[s].name}`;
            }).join(' · ')}
          </p>
          {program.routines.map((r) => (
            <div key={r.name} className="card tight">
              <h3>{r.name}</h3>
              {r.exercises.map((e) => (
                <div key={e.exerciseId} className="small row" style={{ marginTop: 4 }}>
                  <span className="ellipsis" style={{ flex: 1 }}>
                    {exMap.get(e.exerciseId)?.name ?? e.exerciseId}
                  </span>
                  <span className="subtle">
                    {e.sets.length} × {e.sets[0].reps}
                    {e.sets[0].repsMax && e.sets[0].repsMax !== e.sets[0].reps ? `–${e.sets[0].repsMax}` : ''}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </Sheet>
      )}
    </div>
  );
}
