import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { saveSettings } from '../db/db';
import type { Exercise, Routine, RoutineExercise, Settings } from '../db/types';
import { exerciseHistory, replaceInRoutine, routineForToday } from '../lib/actions';
import { toast } from '../lib/hooks';
import { usesReps, usesWeight } from '../lib/stats';
import { buildDraftExercise } from '../lib/suggest';
import { startOfDay } from '../lib/stats';
import { ExercisePicker } from './ExercisePicker';
import { IconDown, IconPlus, IconSparkle, IconSwap, IconTrash, IconUp, IconX } from './Icons';
import { Sheet } from './Sheet';
import { ReorderSheet } from './ReorderSheet';

/** One-line preview of what's suggested for an exercise, e.g. "3 sets · 190 lbs × 6". */
function summary(re: RoutineExercise, ex: Exercise | undefined, draft: ReturnType<typeof buildDraftExercise> | undefined, unit: string) {
  const working = re.sets.filter((s) => s.type !== 'warmup').length;
  const warm = re.sets.length - working;
  const head = `${working} set${working === 1 ? '' : 's'}${warm ? ` + ${warm} warm-up` : ''}`;
  const type = ex?.type ?? 'weight_reps';
  const firstWorking = draft?.sets.find((s) => s.type !== 'warmup') ?? draft?.sets[0];
  const parts: string[] = [];
  if (firstWorking?.sugWeight && usesWeight(type)) parts.push(`${firstWorking.sugWeight} ${unit}`);
  if (firstWorking?.sugReps && usesReps(type)) parts.push(`${firstWorking.sugReps} reps`);
  if (parts.length === 0) {
    const t = re.sets.find((s) => s.type !== 'warmup' && s.reps != null);
    if (t?.reps != null) parts.push(t.repsMax && t.repsMax !== t.reps ? `${t.reps}–${t.repsMax} reps` : `${t.reps} reps`);
  }
  return parts.length ? `${head} · ${parts.join(' × ')}` : head;
}

/**
 * Today's suggested routine laid out in full, with suggested weights.
 * Exercises can be swapped, removed, added, reordered or given more/fewer sets
 * before starting. Changes apply to today only (stored in settings.todayPlan)
 * unless you choose to save a swap to the routine.
 */
export function TodayPlan({ routine, settings, exMap }: { routine: Routine; settings: Settings; exMap: Map<string, Exercise> }) {
  const effective = routineForToday(routine, settings.todayPlan);
  const exercises = effective.exercises;
  const edited = effective !== routine;
  const [picker, setPicker] = useState<null | { replaceIdx?: number }>(null);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [reordering, setReordering] = useState(false);

  const previews = useLiveQuery(
    () =>
      Promise.all(
        exercises.map(async (re) =>
          buildDraftExercise({
            exerciseId: re.exerciseId,
            exercise: exMap.get(re.exerciseId),
            routineExercise: re,
            history: await exerciseHistory(re.exerciseId),
            settings,
            unit: settings.unit,
          }),
        ),
      ),
    [JSON.stringify(exercises), exMap, settings],
  );

  const save = (list: RoutineExercise[]) =>
    saveSettings({ todayPlan: { routineId: routine.id, day: startOfDay(Date.now()), exercises: list } });

  const replace = async (idx: number, toId: string) => {
    const old = exercises[idx];
    if (!old || old.exerciseId === toId) return;
    await save(exercises.map((e, i) => (i === idx ? { ...e, exerciseId: toId, sets: e.sets.map((s) => ({ ...s, weightKg: null })) } : e)));
    if (routine.exercises.some((e) => e.exerciseId === old.exerciseId)) {
      const from = exMap.get(old.exerciseId)?.name ?? 'this exercise';
      const to = exMap.get(toId)?.name ?? 'the new one';
      if (confirm(`Swapped for today.\n\nAlso replace “${from}” with “${to}” in your “${routine.name}” routine for next time?`)) {
        await replaceInRoutine(routine.id, old.exerciseId, toId);
        toast(`Updated “${routine.name}”`);
      }
    }
  };

  const add = async (ids: string[]) => {
    await save([
      ...exercises,
      ...ids.map((exerciseId) => ({ exerciseId, restSec: settings.defaultRestSec, sets: [{ type: 'normal' as const }, { type: 'normal' as const }, { type: 'normal' as const }] })),
    ]);
  };

  const editing = editIdx != null ? exercises[editIdx] : undefined;
  const editingEx = editing ? exMap.get(editing.exerciseId) : undefined;

  return (
    <div style={{ marginTop: 10 }}>
      <div className="list" style={{ background: 'var(--bg)' }}>
        {exercises.map((re, i) => {
          const ex = exMap.get(re.exerciseId);
          const draft = previews?.[i];
          return (
            <div key={`${re.exerciseId}-${i}`} className="list-item" style={{ padding: '10px 6px 10px 12px', gap: 6 }}>
              <button className="main" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left' }} onClick={() => setEditIdx(i)}>
                <div className="ellipsis" style={{ fontWeight: 600 }}>
                  {ex?.name ?? re.exerciseId}
                </div>
                <div className="small subtle">{summary(re, ex, draft, settings.unit)}</div>
                {draft?.suggestionNote?.includes('→') && (
                  <div className="tiny" style={{ color: 'var(--accent)', marginTop: 2 }}>
                    <IconSparkle size={11} /> {draft.suggestionNote}
                  </div>
                )}
              </button>
              <button className="icon-btn accent" onClick={() => setPicker({ replaceIdx: i })} aria-label={`Replace ${ex?.name ?? 'exercise'}`}>
                <IconSwap size={19} />
              </button>
              <button className="icon-btn" style={{ color: 'var(--faint)' }} onClick={() => save(exercises.filter((_, j) => j !== i))} aria-label={`Skip ${ex?.name ?? 'exercise'} today`}>
                <IconX size={18} />
              </button>
            </div>
          );
        })}
        {exercises.length === 0 && <div className="list-item small subtle">No exercises — add some below.</div>}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn ghost sm" style={{ paddingLeft: 0 }} onClick={() => setPicker({})}>
          <IconPlus size={16} /> Add exercise
        </button>
        {exercises.length > 1 && (
          <button className="btn ghost sm" onClick={() => setReordering(true)}>
            ⇅ Reorder
          </button>
        )}
        <div className="spacer" />
        {edited && (
          <button className="btn ghost sm" style={{ paddingRight: 0, color: 'var(--muted)' }} onClick={() => saveSettings({ todayPlan: null })}>
            Reset to routine
          </button>
        )}
      </div>
      {edited && <div className="tiny subtle">Edited for today — your “{routine.name}” routine is unchanged.</div>}

      {reordering && (
        <ReorderSheet
          items={exercises.map((re, i) => ({ key: String(i), label: exMap.get(re.exerciseId)?.name ?? re.exerciseId, sub: summary(re, exMap.get(re.exerciseId), previews?.[i], settings.unit) }))}
          onClose={() => setReordering(false)}
          onSave={(keys) => {
            const next = keys.map((k) => exercises[Number(k)]);
            if (next.some((e, i) => e !== exercises[i])) save(next);
          }}
        />
      )}

      {picker && (
        <ExercisePicker
          single={picker.replaceIdx != null}
          title={picker.replaceIdx != null ? 'Replace Exercise' : 'Add Exercise'}
          similarTo={picker.replaceIdx != null ? exercises[picker.replaceIdx]?.exerciseId : undefined}
          onClose={() => setPicker(null)}
          onPick={(ids) => (picker.replaceIdx != null ? replace(picker.replaceIdx, ids[0]) : add(ids))}
        />
      )}

      {editing && editIdx != null && (
        <Sheet title={editingEx?.name ?? 'Exercise'} onClose={() => setEditIdx(null)}>
          <div className="list">
            <div className="list-item">
              <div className="main">Working sets</div>
              <button
                className="btn sm"
                aria-label="Fewer sets"
                onClick={() => {
                  const sets = [...editing.sets];
                  const lastWorking = sets.map((s) => s.type).lastIndexOf('normal');
                  if (sets.filter((s) => s.type !== 'warmup').length <= 1) return;
                  sets.splice(lastWorking >= 0 ? lastWorking : sets.length - 1, 1);
                  save(exercises.map((e, j) => (j === editIdx ? { ...e, sets } : e)));
                }}
              >
                −
              </button>
              <strong style={{ minWidth: 24, textAlign: 'center' }}>{editing.sets.filter((s) => s.type !== 'warmup').length}</strong>
              <button
                className="btn sm"
                aria-label="More sets"
                onClick={() => {
                  const last = editing.sets.filter((s) => s.type !== 'warmup').at(-1) ?? { type: 'normal' as const };
                  save(exercises.map((e, j) => (j === editIdx ? { ...e, sets: [...e.sets, { ...last }] } : e)));
                }}
              >
                +
              </button>
            </div>
          </div>
          <div className="menu" style={{ padding: '8px 0 0' }}>
            <button
              onClick={() => {
                const i = editIdx;
                setEditIdx(null);
                setPicker({ replaceIdx: i });
              }}
            >
              <IconSwap size={20} /> Replace exercise
            </button>
            {editIdx > 0 && (
              <button
                onClick={() => {
                  const list = [...exercises];
                  [list[editIdx - 1], list[editIdx]] = [list[editIdx], list[editIdx - 1]];
                  save(list);
                  setEditIdx(editIdx - 1);
                }}
              >
                <IconUp size={20} /> Move up
              </button>
            )}
            {editIdx < exercises.length - 1 && (
              <button
                onClick={() => {
                  const list = [...exercises];
                  [list[editIdx + 1], list[editIdx]] = [list[editIdx], list[editIdx + 1]];
                  save(list);
                  setEditIdx(editIdx + 1);
                }}
              >
                <IconDown size={20} /> Move down
              </button>
            )}
            <button
              className="danger"
              onClick={() => {
                save(exercises.filter((_, j) => j !== editIdx));
                setEditIdx(null);
              }}
            >
              <IconTrash size={20} /> Skip for today
            </button>
          </div>
          <p className="tiny subtle">Changes apply to today only. To change the routine itself, edit it in Routines.</p>
        </Sheet>
      )}
    </div>
  );
}

