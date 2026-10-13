import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../db/db';
import type { ActiveWorkout, DraftExercise, DraftSet, ExerciseType, SetType, Unit, WorkoutSet } from '../db/types';
import { discardWorkout, draftSetToSet, finishWorkout, makeDraftExercise, replaceInRoutine } from '../lib/actions';
import { toast, useExerciseMap, useNow } from '../lib/hooks';
import { usesDistance, usesDuration, usesReps, usesWeight } from '../lib/stats';
import { emptyDraftSet, lastSetsFor } from '../lib/suggest';
import { distanceUnit, fmtDistance, fmtDuration, fmtLongDuration, fmtVolume, fmtWeight } from '../lib/units';
import { ExercisePicker } from '../components/ExercisePicker';
import { ActionMenu, Sheet } from '../components/Sheet';
import { ReorderSheet } from '../components/ReorderSheet';
import { PlateCalculator } from '../components/PlateCalculator';
import { usesPlates } from '../lib/plates';
import {
  IconCheck,
  IconDots,
  IconDown,
  IconLink,
  IconNote,
  IconPlate,
  IconPlus,
  IconSparkle,
  IconSwap,
  IconTimer,
  IconTrash,
  IconUp,
  IconX,
} from '../components/Icons';

const REST_OPTIONS = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];

export function setLabel(sets: { type: SetType }[], i: number): string {
  const t = sets[i].type;
  if (t === 'warmup') return 'W';
  if (t === 'failure') return 'F';
  if (t === 'dropset') return 'D';
  let n = 0;
  for (let j = 0; j <= i; j++) if (sets[j].type !== 'warmup') n++;
  return String(n);
}

export function formatSet(s: WorkoutSet, type: ExerciseType, unit: Unit): string {
  const parts: string[] = [];
  if (usesWeight(type) && s.weightKg != null) {
    const sign = type === 'weighted_bodyweight' ? '+' : type === 'assisted_bodyweight' ? '-' : '';
    parts.push(`${sign}${fmtWeight(s.weightKg, unit)}${unit}`);
  }
  if (usesReps(type) && s.reps != null) parts.push(parts.length ? `× ${s.reps}` : `${s.reps} reps`);
  if (usesDistance(type) && s.distanceKm != null) parts.push(`${fmtDistance(s.distanceKm, unit)}${distanceUnit(unit)}`);
  if (usesDuration(type) && s.durationSec != null) parts.push(fmtDuration(s.durationSec));
  return parts.join(' ') || '–';
}

function weightHeader(type: ExerciseType, unit: Unit) {
  if (type === 'weighted_bodyweight') return `+${unit}`;
  if (type === 'assisted_bodyweight') return `-${unit}`;
  return unit;
}

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.25, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.2);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch {
    /* audio unavailable */
  }
  navigator.vibrate?.([200, 100, 200]);
}

function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    const req = () => nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {});
    req();
    const onVis = () => document.visibilityState === 'visible' && req();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => {});
    };
  }, []);
}

export default function WorkoutLogger() {
  const navigate = useNavigate();
  const [w, setW] = useState<ActiveWorkout | null>(null);
  const loaded = useRef(false);
  const exMap = useExerciseMap();
  const now = useNow(1000);
  const [picker, setPicker] = useState<null | { replaceKey?: string }>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [restFor, setRestFor] = useState<string | null>(null);
  const [setMenu, setSetMenu] = useState<{ key: string; idx: number } | null>(null);
  const [details, setDetails] = useState(false);
  const [reordering, setReordering] = useState(false);
  // Weight cell being edited (shows the plate calculator button) and the set the calculator is open for.
  const [focusW, setFocusW] = useState<{ key: string; idx: number } | null>(null);
  const [plateFor, setPlateFor] = useState<{ key: string; idx: number } | null>(null);
  const [prev, setPrev] = useState<Record<string, WorkoutSet[]>>({});
  const beeped = useRef<number | null>(null);
  useWakeLock();

  useEffect(() => {
    db.active.get('current').then((a) => {
      if (!a) navigate('/', { replace: true });
      else setW(a);
      loaded.current = true;
    });
  }, [navigate]);

  useEffect(() => {
    if (w && loaded.current) db.active.put(w);
  }, [w]);

  const update = useCallback((fn: (a: ActiveWorkout) => ActiveWorkout) => setW((a) => (a ? fn(a) : a)), []);
  const updateEx = useCallback(
    (key: string, fn: (e: DraftExercise) => DraftExercise) =>
      update((a) => ({ ...a, exercises: a.exercises.map((e) => (e.key === key ? fn(e) : e)) })),
    [update],
  );
  const updateSet = useCallback(
    (key: string, idx: number, patch: Partial<DraftSet>) =>
      updateEx(key, (e) => ({ ...e, sets: e.sets.map((s, i) => (i === idx ? { ...s, ...patch } : s)) })),
    [updateEx],
  );

  // "Previous" column: sets from the last time each exercise was performed.
  const exIds = useMemo(() => [...new Set(w?.exercises.map((e) => e.exerciseId) ?? [])].join(','), [w?.exercises]);
  useEffect(() => {
    if (!w) return;
    let cancelled = false;
    const ids = exIds ? exIds.split(',') : [];
    Promise.all(
      ids.map(async (id) => {
        const list = await db.workouts.where('exerciseIds').equals(id).toArray();
        const last = list
          .filter((x) => x.id !== w.editingId && x.startTime < w.startTime)
          .sort((a, b) => b.startTime - a.startTime)[0];
        return [id, lastSetsFor(last, id)] as const;
      }),
    ).then((entries) => !cancelled && setPrev(Object.fromEntries(entries)));
    return () => {
      cancelled = true;
    };
  }, [exIds, w?.editingId]);

  // Rest timer completion
  const restLeft = w?.restEndsAt ? Math.ceil((w.restEndsAt - now) / 1000) : null;
  useEffect(() => {
    if (w?.restEndsAt && restLeft != null && restLeft <= 0 && beeped.current !== w.restEndsAt) {
      beeped.current = w.restEndsAt;
      beep();
      update((a) => ({ ...a, restEndsAt: null }));
    }
  }, [restLeft, w?.restEndsAt, update]);

  if (!w) return null;
  const unit = w.unit;
  const editing = w.editingId != null;

  let volume = 0;
  let doneSets = 0;
  for (const e of w.exercises) {
    const type = exMap.get(e.exerciseId)?.type ?? 'weight_reps';
    for (const s of e.sets) {
      if (!s.done) continue;
      doneSets++;
      if (type !== 'assisted_bodyweight') {
        const set = draftSetToSet(s, unit);
        volume += (set.weightKg ?? 0) * (set.reps ?? 0);
      }
    }
  }

  const addExercises = async (ids: string[]) => {
    const drafts = await Promise.all(ids.map((id) => makeDraftExercise(id)));
    update((a) => ({ ...a, exercises: [...a.exercises, ...drafts] }));
  };

  const replaceExercise = async (key: string, id: string) => {
    const old = w.exercises.find((e) => e.key === key);
    if (!old || old.exerciseId === id) return;
    // Keep the same number and kinds of sets; weights/reps are suggested from the new exercise's history.
    const d = await makeDraftExercise(id, { exerciseId: id, restSec: old.restSec, sets: old.sets.map((s) => ({ type: s.type })) });
    update((a) => ({
      ...a,
      exercises: a.exercises.map((e) => (e.key === key ? { ...d, key, notes: e.notes, restSec: e.restSec, supersetId: e.supersetId } : e)),
    }));
    // Offer to make the swap permanent in the routine (e.g. your gym doesn't have that machine).
    if (w.routineId && !editing) {
      const routine = await db.routines.get(w.routineId);
      if (routine?.exercises.some((e) => e.exerciseId === old.exerciseId)) {
        const from = exMap.get(old.exerciseId)?.name ?? 'this exercise';
        const to = exMap.get(id)?.name ?? 'the new one';
        if (confirm(`Swapped for today.\n\nAlso replace “${from}” with “${to}” in your “${routine.name}” routine for next time?`)) {
          await replaceInRoutine(routine.id, old.exerciseId, id);
          toast(`Updated “${routine.name}”`);
        }
      }
    }
  };

  const toggleDone = (ex: DraftExercise, idx: number) => {
    const s = ex.sets[idx];
    const type = exMap.get(ex.exerciseId)?.type ?? 'weight_reps';
    if (s.done) return updateSet(ex.key, idx, { done: false });
    const filled: Partial<DraftSet> = {
      weight: s.weight || s.sugWeight || '',
      reps: s.reps || s.sugReps || '',
      duration: s.duration || s.sugDuration || '',
      distance: s.distance || s.sugDistance || '',
      done: true,
    };
    if (usesReps(type) && !filled.reps) return toast('Enter reps first');
    if (type === 'weight_reps' && !filled.weight) filled.weight = '0';
    if (usesDuration(type) && !usesDistance(type) && !filled.duration) return toast('Enter a time first');
    if (type === 'distance_duration' && !filled.duration && !filled.distance) return toast('Enter distance or time first');
    updateSet(ex.key, idx, filled);
    // Rest timer: in a superset, only start after the last exercise of the group.
    const exIdx = w.exercises.findIndex((e) => e.key === ex.key);
    const next = w.exercises[exIdx + 1];
    const inSupersetMiddle = ex.supersetId != null && next && next.supersetId === ex.supersetId;
    if (ex.restSec > 0 && !inSupersetMiddle && !editing) {
      update((a) => ({ ...a, restEndsAt: Date.now() + ex.restSec * 1000, restTotal: ex.restSec }));
    }
  };

  const copyPrevious = (ex: DraftExercise, idx: number, p: WorkoutSet) => {
    updateSet(ex.key, idx, {
      weight: p.weightKg != null ? fmtWeight(p.weightKg, unit) : '',
      reps: p.reps != null ? String(p.reps) : '',
      duration: p.durationSec != null ? fmtDuration(p.durationSec) : '',
      distance: p.distanceKm != null ? fmtDistance(p.distanceKm, unit) : '',
    });
  };

  const addSet = (ex: DraftExercise) =>
    updateEx(ex.key, (e) => {
      const last = e.sets[e.sets.length - 1];
      const ns: DraftSet = last
        ? {
            ...emptyDraftSet(last.type === 'warmup' ? 'normal' : last.type),
            sugWeight: last.weight || last.sugWeight,
            sugReps: last.reps || last.sugReps,
            sugDuration: last.duration || last.sugDuration,
            sugDistance: last.distance || last.sugDistance,
          }
        : emptyDraftSet();
      return { ...e, sets: [...e.sets, ns] };
    });

  const toggleSuperset = (key: string) =>
    update((a) => {
      const i = a.exercises.findIndex((e) => e.key === key);
      const cur = a.exercises[i];
      const next = a.exercises[i + 1];
      if (cur.supersetId != null) {
        return { ...a, exercises: a.exercises.map((e) => (e.key === key ? { ...e, supersetId: null } : e)) };
      }
      if (!next) {
        toast('Add another exercise below to superset with');
        return a;
      }
      const id = next.supersetId ?? Math.max(-1, ...a.exercises.map((e) => e.supersetId ?? -1)) + 1;
      return {
        ...a,
        exercises: a.exercises.map((e, k) => (k === i || k === i + 1 ? { ...e, supersetId: id } : e)),
      };
    });

  const finish = async () => {
    if (doneSets === 0) {
      toast('Complete at least one set (tap ✓)');
      return;
    }
    const pending = w.exercises.some((e) => e.sets.some((s) => !s.done));
    if (pending && !confirm('Some sets are not checked off and will be discarded. Finish workout?')) return;
    const id = await finishWorkout(w);
    navigate(`/history/${id}${editing ? '' : '?done=1'}`, { replace: true });
  };

  const discard = async () => {
    if (!confirm(editing ? 'Discard changes?' : 'Discard this workout? Nothing will be saved.')) return;
    await discardWorkout();
    navigate(editing ? `/history/${w.editingId}` : '/', { replace: true });
  };

  const menuEx = w.exercises.find((e) => e.key === menuFor);
  const supersetLetters = new Map<number, string>();
  w.exercises.forEach((e) => {
    if (e.supersetId != null && !supersetLetters.has(e.supersetId)) supersetLetters.set(e.supersetId, String.fromCharCode(65 + supersetLetters.size));
  });

  return (
    <div className="page no-tabs" style={{ paddingTop: 0, paddingBottom: w.restEndsAt ? 110 : 40 }}>
      <div className="logger-header">
        <div className="row">
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Minimize">
            <IconDown />
          </button>
          <div className="spacer" />
          {w.exercises.length > 1 && (
            <button className="icon-btn" onClick={() => setReordering(true)} aria-label="Reorder exercises" style={{ fontSize: 20 }}>
              ⇅
            </button>
          )}
          <button className="icon-btn" onClick={() => setDetails(true)} aria-label="Workout details">
            <IconTimer size={20} />
          </button>
          <button className="btn primary sm" onClick={finish}>
            {editing ? 'Save' : 'Finish'}
          </button>
        </div>
        <input className="title-input" value={w.title} onChange={(e) => update((a) => ({ ...a, title: e.target.value }))} style={{ marginTop: 6 }} />
        <div className="logger-stats">
          <div>
            <div className="l">Duration</div>
            <div className="v" style={{ color: 'var(--accent)' }}>
              {editing ? fmtLongDuration((w.editingEndTime ?? w.startTime) - w.startTime) : fmtDuration((now - w.startTime) / 1000)}
            </div>
          </div>
          <div>
            <div className="l">Volume</div>
            <div className="v">{fmtVolume(volume, unit)}</div>
          </div>
          <div>
            <div className="l">Sets</div>
            <div className="v">{doneSets}</div>
          </div>
        </div>
      </div>

      {w.exercises.length === 0 && (
        <div className="empty">
          <h3>Get started</h3>
          <p>Add an exercise to start your workout</p>
        </div>
      )}

      {w.exercises.map((ex) => {
        const info = exMap.get(ex.exerciseId);
        const type = info?.type ?? 'weight_reps';
        const prevSets = prev[ex.exerciseId] ?? [];
        const plates = type === 'weight_reps' && usesPlates(info?.equipment);
        const cols = 3 + [usesWeight(type), usesDistance(type), usesReps(type), usesDuration(type)].filter(Boolean).length;
        return (
          <div className="ex-block" key={ex.key}>
            <div className="ex-head">
              {ex.supersetId != null && <span className="superset-tag">{supersetLetters.get(ex.supersetId)}</span>}
              <button className="name ellipsis" onClick={() => navigate(`/exercises/${ex.exerciseId}`)}>
                {info?.name ?? 'Unknown exercise'}
              </button>
              <button className="icon-btn accent" onClick={() => setPicker({ replaceKey: ex.key })} aria-label="Replace exercise" title="Replace exercise">
                <IconSwap size={20} />
              </button>
              <button className="icon-btn" onClick={() => setMenuFor(ex.key)} aria-label="Exercise options">
                <IconDots />
              </button>
            </div>
            <textarea
              className="notes-input"
              rows={1}
              placeholder="Add notes here…"
              value={ex.notes}
              onChange={(e) => updateEx(ex.key, (x) => ({ ...x, notes: e.target.value }))}
            />
            <div className="ex-meta">
              <button className="btn ghost sm" style={{ padding: '2px 0' }} onClick={() => setRestFor(ex.key)}>
                <IconTimer size={16} /> Rest: {ex.restSec ? fmtDuration(ex.restSec) : 'Off'}
              </button>
              {ex.suggestionNote && (
                <span className="suggest-note">
                  <IconSparkle size={14} /> {ex.suggestionNote}
                </span>
              )}
            </div>
            <table className="sets">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>Set</th>
                  <th>Previous</th>
                  {usesWeight(type) && <th>{weightHeader(type, unit)}</th>}
                  {usesDistance(type) && <th>{distanceUnit(unit)}</th>}
                  {usesReps(type) && <th>Reps</th>}
                  {usesDuration(type) && <th>Time</th>}
                  <th style={{ width: 40 }}>
                    <IconCheck size={16} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {ex.sets.map((s, i) => {
                  const p = prevSets[i];
                  const showPlates = plates && focusW?.key === ex.key && focusW.idx === i;
                  return (
                    <Fragment key={i}>
                    <tr className={s.done ? 'done' : ''}>
                      <td>
                        <button className={'set-num ' + s.type} onClick={() => setSetMenu({ key: ex.key, idx: i })}>
                          {setLabel(ex.sets, i)}
                        </button>
                      </td>
                      <td>
                        <button className="prev" onClick={() => p && copyPrevious(ex, i, p)} disabled={!p}>
                          {p ? formatSet(p, type, unit) : '–'}
                        </button>
                      </td>
                      {usesWeight(type) && (
                        <td>
                          <input
                            className="cell-input"
                            inputMode="decimal"
                            placeholder={s.sugWeight ?? '0'}
                            value={s.weight}
                            onChange={(e) => updateSet(ex.key, i, { weight: e.target.value })}
                            onFocus={() => setFocusW({ key: ex.key, idx: i })}
                            onBlur={() => setFocusW((f) => (f?.key === ex.key && f.idx === i ? null : f))}
                          />
                        </td>
                      )}
                      {usesDistance(type) && (
                        <td>
                          <input
                            className="cell-input"
                            inputMode="decimal"
                            placeholder={s.sugDistance ?? '0'}
                            value={s.distance}
                            onChange={(e) => updateSet(ex.key, i, { distance: e.target.value })}
                          />
                        </td>
                      )}
                      {usesReps(type) && (
                        <td>
                          <input
                            className="cell-input"
                            inputMode="numeric"
                            placeholder={s.sugReps ?? '0'}
                            value={s.reps}
                            onChange={(e) => updateSet(ex.key, i, { reps: e.target.value.replace(/[^0-9]/g, '') })}
                          />
                        </td>
                      )}
                      {usesDuration(type) && (
                        <td>
                          <input
                            className="cell-input"
                            inputMode="numeric"
                            placeholder={s.sugDuration ?? '0:00'}
                            value={s.duration}
                            onChange={(e) => updateSet(ex.key, i, { duration: e.target.value })}
                          />
                        </td>
                      )}
                      <td>
                        <button className={'check' + (s.done ? ' on' : '')} onClick={() => toggleDone(ex, i)} aria-label="Complete set">
                          <IconCheck size={18} />
                        </button>
                      </td>
                    </tr>
                    {showPlates && (
                      <tr className="plate-row">
                        <td colSpan={cols}>
                          <button
                            className="btn sm plate-btn"
                            // Keep the input focused so this button doesn't vanish before the tap registers.
                            onPointerDown={(e) => e.preventDefault()}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              (document.activeElement as HTMLElement | null)?.blur();
                              setPlateFor({ key: ex.key, idx: i });
                            }}
                          >
                            <IconPlate size={16} /> Plate calculator
                          </button>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            <button className="btn block sm" style={{ marginTop: 8 }} onClick={() => addSet(ex)}>
              <IconPlus size={16} /> Add Set
            </button>
          </div>
        );
      })}

      <button className="btn primary block" style={{ marginTop: 24 }} onClick={() => setPicker({})}>
        <IconPlus size={18} /> Add Exercise
      </button>
      {w.exercises.length > 1 && (
        <button className="btn block" style={{ marginTop: 10 }} onClick={() => setReordering(true)}>
          ⇅ Reorder Exercises
        </button>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn danger block" onClick={discard}>
          {editing ? 'Discard Changes' : 'Discard Workout'}
        </button>
      </div>

      {w.restEndsAt && restLeft != null && restLeft > 0 && (
        <div className="rest-bar">
          <div className="rest-progress" style={{ width: `${(restLeft / (w.restTotal || 1)) * 100}%` }} />
          <div>
            <IconTimer />
            <span className="time">{fmtDuration(restLeft)}</span>
            <span className="small subtle">Rest</span>
            <div className="spacer" />
            <button className="btn sm" onClick={() => update((a) => ({ ...a, restEndsAt: (a.restEndsAt ?? 0) - 15000 }))}>
              −15
            </button>
            <button className="btn sm" onClick={() => update((a) => ({ ...a, restEndsAt: (a.restEndsAt ?? 0) + 15000, restTotal: (a.restTotal ?? 0) + 15 }))}>
              +15
            </button>
            <button className="btn primary sm" onClick={() => update((a) => ({ ...a, restEndsAt: null }))}>
              Skip
            </button>
          </div>
        </div>
      )}

      {picker && (
        <ExercisePicker
          single={!!picker.replaceKey}
          title={picker.replaceKey ? 'Replace Exercise' : 'Add Exercise'}
          similarTo={picker.replaceKey ? w.exercises.find((e) => e.key === picker.replaceKey)?.exerciseId : undefined}
          onClose={() => setPicker(null)}
          onPick={(ids) => (picker.replaceKey ? replaceExercise(picker.replaceKey, ids[0]) : addExercises(ids))}
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
              icon: <IconLink size={20} />,
              onClick: () => toggleSuperset(menuEx.key),
            },
            { label: 'Reorder exercises', icon: <IconUp size={20} />, onClick: () => setReordering(true) },
            {
              label: 'Fill suggestions into empty sets',
              icon: <IconSparkle size={20} />,
              onClick: () =>
                updateEx(menuEx.key, (e) => ({
                  ...e,
                  sets: e.sets.map((s) => ({
                    ...s,
                    weight: s.weight || s.sugWeight || '',
                    reps: s.reps || s.sugReps || '',
                    duration: s.duration || s.sugDuration || '',
                    distance: s.distance || s.sugDistance || '',
                  })),
                })),
            },
            {
              label: 'Skip / remove for today',
              icon: <IconTrash size={20} />,
              danger: true,
              onClick: () => update((a) => ({ ...a, exercises: a.exercises.filter((e) => e.key !== menuEx.key) })),
            },
          ]}
        />
      )}

      {setMenu && (
        <ActionMenu
          title="Set type"
          onClose={() => setSetMenu(null)}
          items={[
            ...(['normal', 'warmup', 'failure', 'dropset'] as SetType[]).map((t) => ({
              label: { normal: 'Normal set', warmup: 'Warm-up set (W)', failure: 'Failure set (F)', dropset: 'Drop set (D)' }[t],
              onClick: () => updateSet(setMenu.key, setMenu.idx, { type: t }),
            })),
            {
              label: 'Delete set',
              icon: <IconX size={20} />,
              danger: true,
              onClick: () => updateEx(setMenu.key, (e) => ({ ...e, sets: e.sets.filter((_, i) => i !== setMenu.idx) })),
            },
          ]}
        />
      )}

      {restFor && (
        <ActionMenu
          title="Rest timer"
          onClose={() => setRestFor(null)}
          items={REST_OPTIONS.map((sec) => ({
            label: sec === 0 ? 'Off' : fmtDuration(sec),
            onClick: () => updateEx(restFor, (e) => ({ ...e, restSec: sec })),
          }))}
        />
      )}

      {reordering && (
        <ReorderSheet
          items={w.exercises.map((e) => {
            const done = e.sets.filter((x) => x.done).length;
            return { key: e.key, label: exMap.get(e.exerciseId)?.name ?? 'Exercise', sub: `${e.sets.length} sets${done ? ` · ${done} done` : ''}` };
          })}
          onClose={() => setReordering(false)}
          onSave={(keys) =>
            update((a) => ({ ...a, exercises: keys.map((k) => a.exercises.find((e) => e.key === k)!).filter(Boolean) }))
          }
        />
      )}

      {plateFor &&
        (() => {
          const pe = w.exercises.find((e) => e.key === plateFor.key);
          const ps = pe?.sets[plateFor.idx];
          if (!pe || !ps) return null;
          return (
            <PlateCalculator
              initial={ps.weight || ps.sugWeight || ''}
              unit={unit}
              barbell={exMap.get(pe.exerciseId)?.equipment === 'barbell'}
              onClose={() => setPlateFor(null)}
              onUse={(weight) => updateSet(plateFor.key, plateFor.idx, { weight })}
            />
          );
        })()}

      {details && <DetailsSheet w={w} onClose={() => setDetails(false)} onChange={(patch) => update((a) => ({ ...a, ...patch }))} />}
    </div>
  );
}

function toLocalInput(t: number) {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function DetailsSheet({ w, onClose, onChange }: { w: ActiveWorkout; onClose: () => void; onChange: (p: Partial<ActiveWorkout>) => void }) {
  const editing = w.editingId != null;
  const durMin = Math.round(((w.editingEndTime ?? Date.now()) - w.startTime) / 60000);
  return (
    <Sheet title="Workout details" onClose={onClose}>
      <label className="field">
        <span>Start time</span>
        <input
          className="input"
          type="datetime-local"
          value={toLocalInput(w.startTime)}
          onChange={(e) => {
            const t = new Date(e.target.value).getTime();
            if (Number.isNaN(t)) return;
            onChange(editing ? { startTime: t, editingEndTime: t + durMin * 60000 } : { startTime: t });
          }}
        />
      </label>
      {editing && (
        <label className="field">
          <span>Duration (minutes)</span>
          <input
            className="input"
            inputMode="numeric"
            value={durMin}
            onChange={(e) => {
              const m = Number(e.target.value.replace(/\D/g, ''));
              onChange({ editingEndTime: w.startTime + m * 60000 });
            }}
          />
        </label>
      )}
      <label className="field">
        <span>Description</span>
        <textarea className="input" value={w.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="How did it go?" />
      </label>
      <p className="small subtle">
        <IconNote size={14} /> Empty fields use the greyed-out suggestion when you tick a set. Tap a value in “Previous” to copy it.
      </p>
    </Sheet>
  );
}

