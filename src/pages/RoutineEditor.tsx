import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db, getSettings, newId } from '../db/db';
import type { Routine, RoutineExercise, RoutineSet, SetType } from '../db/types';
import { useExerciseMap, useSettings } from '../lib/hooks';
import { usesDistance, usesDuration, usesReps, usesWeight } from '../lib/stats';
import { distanceUnit, fmtDistance, fmtDuration, fmtWeight, fromDisplayDistance, fromDisplayWeight, parseDuration, parseNum } from '../lib/units';
import { ExercisePicker } from '../components/ExercisePicker';
import { ActionMenu } from '../components/Sheet';
import { IconBack, IconDots, IconDown, IconPlus, IconSwap, IconTimer, IconTrash, IconUp, IconX } from '../components/Icons';
import { setLabel } from './WorkoutLogger';

const REST_OPTIONS = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];

/** Number fields edited as strings so partial input (e.g. "62.") isn't lost. */
interface EditSet {
  type: SetType;
  weight: string;
  reps: string;
  repsMax: string;
  duration: string;
  distance: string;
}
interface EditEx {
  key: string;
  exerciseId: string;
  notes: string;
  restSec: number;
  supersetId?: number | null;
  sets: EditSet[];
}

let k = 0;
const key = () => `e${++k}`;

export default function RoutineEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const settings = useSettings();
  const unit = settings.unit;
  const exMap = useExerciseMap();
  const isNew = id === 'new';
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [exercises, setExercises] = useState<EditEx[]>([]);
  const [existing, setExisting] = useState<Routine | null>(null);
  const [picker, setPicker] = useState<null | { replaceKey?: string }>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [restFor, setRestFor] = useState<string | null>(null);
  const [setMenu, setSetMenu] = useState<{ key: string; idx: number } | null>(null);
  const [loaded, setLoaded] = useState(isNew);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      const r = await db.routines.get(id!);
      const s = await getSettings();
      if (!r) return navigate('/routines', { replace: true });
      setExisting(r);
      setName(r.name);
      setNotes(r.notes ?? '');
      setExercises(
        r.exercises.map((e) => ({
          key: key(),
          exerciseId: e.exerciseId,
          notes: e.notes ?? '',
          restSec: e.restSec ?? s.defaultRestSec,
          supersetId: e.supersetId ?? null,
          sets: e.sets.map((x) => ({
            type: x.type,
            weight: x.weightKg != null ? fmtWeight(x.weightKg, s.unit) : '',
            reps: x.reps != null ? String(x.reps) : '',
            repsMax: x.repsMax != null && x.repsMax !== x.reps ? String(x.repsMax) : '',
            duration: x.durationSec != null ? fmtDuration(x.durationSec) : '',
            distance: x.distanceKm != null ? fmtDistance(x.distanceKm, s.unit) : '',
          })),
        })),
      );
      setLoaded(true);
    })();
  }, [id, isNew, navigate]);

  const updateEx = (k: string, fn: (e: EditEx) => EditEx) => setExercises((list) => list.map((e) => (e.key === k ? fn(e) : e)));
  const updateSet = (k: string, i: number, patch: Partial<EditSet>) =>
    updateEx(k, (e) => ({ ...e, sets: e.sets.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const blankSet = (): EditSet => ({ type: 'normal', weight: '', reps: '', repsMax: '', duration: '', distance: '' });

  const addExercises = (ids: string[]) =>
    setExercises((list) => [
      ...list,
      ...ids.map((exerciseId) => ({ key: key(), exerciseId, notes: '', restSec: settings.defaultRestSec, sets: [blankSet(), blankSet(), blankSet()] })),
    ]);

  const move = (k: string, dir: -1 | 1) =>
    setExercises((list) => {
      const i = list.findIndex((e) => e.key === k);
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const save = async () => {
    const routineExercises: RoutineExercise[] = exercises.map((e) => ({
      exerciseId: e.exerciseId,
      ...(e.notes.trim() ? { notes: e.notes.trim() } : {}),
      restSec: e.restSec,
      supersetId: e.supersetId ?? null,
      sets: e.sets.map((s): RoutineSet => {
        const w = parseNum(s.weight);
        const reps = parseNum(s.reps);
        const max = parseNum(s.repsMax);
        const dist = parseNum(s.distance);
        return {
          type: s.type,
          weightKg: w != null ? fromDisplayWeight(w, unit) : null,
          reps: reps != null ? Math.round(reps) : null,
          repsMax: max != null && reps != null && max > reps ? Math.round(max) : null,
          durationSec: parseDuration(s.duration),
          distanceKm: dist != null ? fromDisplayDistance(dist, unit) : null,
        };
      }),
    }));
    const order = existing?.order ?? (await db.routines.count());
    const r: Routine = {
      id: existing?.id ?? newId('r-'),
      name: name.trim() || 'Untitled Routine',
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      order,
      createdAt: existing?.createdAt ?? Date.now(),
      exercises: routineExercises,
    };
    await db.routines.put(r);
    navigate('/routines', { replace: true });
  };

  if (!loaded) return null;
  const menuEx = exercises.find((e) => e.key === menuFor);

  return (
    <div className="page no-tabs">
      <div className="page-header">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Back">
          <IconBack />
        </button>
        <h2 className="title">{isNew ? 'Create Routine' : 'Edit Routine'}</h2>
        <button className="btn primary sm" onClick={save}>
          Save
        </button>
      </div>
      <input className="title-input" placeholder="Routine title" value={name} onChange={(e) => setName(e.target.value)} autoFocus={isNew} />
      <textarea className="notes-input" rows={1} placeholder="Routine notes" value={notes} onChange={(e) => setNotes(e.target.value)} />

      {exercises.length === 0 && (
        <div className="empty">
          <p>Add exercises to build your routine.</p>
        </div>
      )}

      {exercises.map((ex) => {
        const info = exMap.get(ex.exerciseId);
        const type = info?.type ?? 'weight_reps';
        return (
          <div className="ex-block" key={ex.key}>
            <div className="ex-head">
              {ex.supersetId != null && <span className="superset-tag">SS</span>}
              <span className="name ellipsis">{info?.name ?? 'Unknown exercise'}</span>
              <button className="icon-btn" onClick={() => setMenuFor(ex.key)} aria-label="Exercise options">
                <IconDots />
              </button>
            </div>
            <textarea className="notes-input" rows={1} placeholder="Add notes here…" value={ex.notes} onChange={(e) => updateEx(ex.key, (x) => ({ ...x, notes: e.target.value }))} />
            <button className="btn ghost sm" style={{ padding: '2px 0' }} onClick={() => setRestFor(ex.key)}>
              <IconTimer size={16} /> Rest: {ex.restSec ? fmtDuration(ex.restSec) : 'Off'}
            </button>
            <table className="sets">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>Set</th>
                  {usesWeight(type) && <th>{unit}</th>}
                  {usesDistance(type) && <th>{distanceUnit(unit)}</th>}
                  {usesReps(type) && <th>Reps</th>}
                  {usesReps(type) && <th>Max reps</th>}
                  {usesDuration(type) && <th>Time</th>}
                  <th style={{ width: 30 }} />
                </tr>
              </thead>
              <tbody>
                {ex.sets.map((s, i) => (
                  <tr key={i}>
                    <td>
                      <button className={'set-num ' + s.type} onClick={() => setSetMenu({ key: ex.key, idx: i })}>
                        {setLabel(ex.sets, i)}
                      </button>
                    </td>
                    {usesWeight(type) && (
                      <td>
                        <input className="cell-input" inputMode="decimal" placeholder="–" value={s.weight} onChange={(e) => updateSet(ex.key, i, { weight: e.target.value })} />
                      </td>
                    )}
                    {usesDistance(type) && (
                      <td>
                        <input className="cell-input" inputMode="decimal" placeholder="–" value={s.distance} onChange={(e) => updateSet(ex.key, i, { distance: e.target.value })} />
                      </td>
                    )}
                    {usesReps(type) && (
                      <td>
                        <input className="cell-input" inputMode="numeric" placeholder="auto" value={s.reps} onChange={(e) => updateSet(ex.key, i, { reps: e.target.value.replace(/\D/g, '') })} />
                      </td>
                    )}
                    {usesReps(type) && (
                      <td>
                        <input className="cell-input" inputMode="numeric" placeholder="–" value={s.repsMax} onChange={(e) => updateSet(ex.key, i, { repsMax: e.target.value.replace(/\D/g, '') })} />
                      </td>
                    )}
                    {usesDuration(type) && (
                      <td>
                        <input className="cell-input" inputMode="numeric" placeholder="0:00" value={s.duration} onChange={(e) => updateSet(ex.key, i, { duration: e.target.value })} />
                      </td>
                    )}
                    <td>
                      <button className="del-set" onClick={() => updateEx(ex.key, (x) => ({ ...x, sets: x.sets.filter((_, j) => j !== i) }))} aria-label="Remove set">
                        <IconX size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              className="btn block sm"
              style={{ marginTop: 8 }}
              onClick={() => updateEx(ex.key, (x) => ({ ...x, sets: [...x.sets, { ...(x.sets[x.sets.length - 1] ?? blankSet()), type: 'normal' }] }))}
            >
              <IconPlus size={16} /> Add Set
            </button>
          </div>
        );
      })}

      <p className="small subtle" style={{ marginTop: 16 }}>
        Tip: set a rep range (e.g. Reps 8, Max reps 12). When you hit the max on every set, the next workout suggests more weight.
        Leave reps empty to base the range on the reps you actually do.
      </p>
      <button className="btn primary block" style={{ marginTop: 8 }} onClick={() => setPicker({})}>
        <IconPlus size={18} /> Add Exercise
      </button>

      {picker && (
        <ExercisePicker
          single={!!picker.replaceKey}
          title={picker.replaceKey ? 'Replace Exercise' : 'Add Exercise'}
          similarTo={picker.replaceKey ? exercises.find((e) => e.key === picker.replaceKey)?.exerciseId : undefined}
          onClose={() => setPicker(null)}
          onPick={(ids) =>
            picker.replaceKey ? updateEx(picker.replaceKey, (e) => ({ ...e, exerciseId: ids[0] })) : addExercises(ids)
          }
        />
      )}
      {menuEx && (
        <ActionMenu
          title={exMap.get(menuEx.exerciseId)?.name}
          onClose={() => setMenuFor(null)}
          items={[
            { label: 'Replace exercise', icon: <IconSwap size={20} />, onClick: () => setPicker({ replaceKey: menuEx.key }) },
            {
              label: menuEx.supersetId != null ? 'Remove from superset' : 'Superset with next exercise',
              onClick: () =>
                setExercises((list) => {
                  const i = list.findIndex((e) => e.key === menuEx.key);
                  if (list[i].supersetId != null) return list.map((e, j) => (j === i ? { ...e, supersetId: null } : e));
                  if (!list[i + 1]) return list;
                  const sid = list[i + 1].supersetId ?? Math.max(-1, ...list.map((e) => e.supersetId ?? -1)) + 1;
                  return list.map((e, j) => (j === i || j === i + 1 ? { ...e, supersetId: sid } : e));
                }),
            },
            { label: 'Move up', icon: <IconUp size={20} />, onClick: () => move(menuEx.key, -1) },
            { label: 'Move down', icon: <IconDown size={20} />, onClick: () => move(menuEx.key, 1) },
            { label: 'Remove exercise', icon: <IconTrash size={20} />, danger: true, onClick: () => setExercises((l) => l.filter((e) => e.key !== menuEx.key)) },
          ]}
        />
      )}
      {restFor && (
        <ActionMenu
          title="Rest timer"
          onClose={() => setRestFor(null)}
          items={REST_OPTIONS.map((sec) => ({ label: sec === 0 ? 'Off' : fmtDuration(sec), onClick: () => updateEx(restFor, (e) => ({ ...e, restSec: sec })) }))}
        />
      )}
      {setMenu && (
        <ActionMenu
          title="Set type"
          onClose={() => setSetMenu(null)}
          items={(['normal', 'warmup', 'failure', 'dropset'] as SetType[]).map((t) => ({
            label: { normal: 'Normal set', warmup: 'Warm-up set (W)', failure: 'Failure set (F)', dropset: 'Drop set (D)' }[t],
            onClick: () => updateSet(setMenu.key, setMenu.idx, { type: t }),
          }))}
        />
      )}
    </div>
  );
}
