import { useEffect, useState } from 'react';
import { db } from '../db/db';
import type { BodyArea, Workout, WorkoutFeedback } from '../db/types';
import { AREA_LABELS, CAUTION_DAYS } from '../lib/coach';
import { IconEdit, IconFlag } from './Icons';

const AREAS = Object.keys(AREA_LABELS) as BodyArea[];

function clean(f: WorkoutFeedback): WorkoutFeedback | undefined {
  const out: WorkoutFeedback = {};
  if (f.light) out.light = true;
  if (f.areas?.length) out.areas = f.areas;
  if (f.note?.trim()) out.note = f.note.trim();
  return Object.keys(out).length ? out : undefined;
}

/** Short labels for a workout's feedback, e.g. ["Went light", "Shoulder"]. */
export function feedbackTags(f: WorkoutFeedback | undefined): string[] {
  if (!f) return [];
  return [...(f.light ? ['Went light'] : []), ...(f.areas ?? []).map((a) => AREA_LABELS[a])];
}

/** What the app will do with this feedback, in plain words. */
function effect(f: WorkoutFeedback): string | null {
  const areas = (f.areas ?? []).map((a) => AREA_LABELS[a].toLowerCase());
  if (areas.length) {
    const list = areas.length > 1 ? `${areas.slice(0, -1).join(', ')} and ${areas.at(-1)}` : areas[0];
    return `Got it. For the next ${CAUTION_DAYS} days, exercises that load your ${list} keep the same weight instead of going up, and recommended workouts leave them out. This workout’s sets for them won’t count against your progress.`;
  }
  if (f.light) return 'Got it. This workout won’t be used to judge your progress — next time picks up from your last normal session.';
  return null;
}

/**
 * Feedback on a finished workout: "went light", what was bothering you, and a note.
 * Saved as you tap; suggestions read it (see lib/coach.ts).
 */
export function FeedbackCard({ w, startOpen }: { w: Workout; startOpen?: boolean }) {
  const [open, setOpen] = useState(!!startOpen);
  const f = w.feedback ?? {};
  const [note, setNote] = useState(f.note ?? '');
  useEffect(() => setNote(w.feedback?.note ?? ''), [w.feedback?.note]);

  const save = (patch: Partial<WorkoutFeedback>) => db.workouts.update(w.id!, { feedback: clean({ ...f, note, ...patch }) });
  const tags = feedbackTags(w.feedback);

  if (!open) {
    return (
      <button className="card clickable feedback-summary" onClick={() => setOpen(true)}>
        <IconFlag size={18} />
        <div className="main">
          {tags.length || f.note ? (
            <>
              <div style={{ fontWeight: 600 }}>{tags.length ? tags.join(' · ') : 'Note'}</div>
              {f.note && <div className="small subtle ellipsis">{f.note}</div>}
            </>
          ) : (
            <>
              <div style={{ fontWeight: 600 }}>Add feedback</div>
              <div className="small subtle">Went light? Something bothering you?</div>
            </>
          )}
        </div>
        <IconEdit size={18} />
      </button>
    );
  }

  const msg = effect(f);
  return (
    <div className="card feedback">
      <h3>How did it go?</h3>
      <p className="small subtle" style={{ margin: '2px 0 12px' }}>
        Optional. Your next suggestions take this into account.
      </p>
      <button className={'toggle-row' + (f.light ? ' on' : '')} onClick={() => save({ light: !f.light })} aria-pressed={!!f.light}>
        <span className="box" />
        <span>
          <strong>I went lighter than usual on purpose</strong>
          <span className="small subtle" style={{ display: 'block' }}>Off day, short on time, taking it easy…</span>
        </span>
      </button>
      <div className="small subtle" style={{ margin: '14px 0 8px' }}>
        Was anything bothering you?
      </div>
      <div className="chips wrap">
        {AREAS.map((a) => {
          const on = f.areas?.includes(a) ?? false;
          return (
            <button
              key={a}
              className={'chip' + (on ? ' active' : '')}
              aria-pressed={on}
              onClick={() => save({ areas: on ? (f.areas ?? []).filter((x) => x !== a) : [...(f.areas ?? []), a] })}
            >
              {AREA_LABELS[a]}
            </button>
          );
        })}
      </div>
      <textarea
        className="input"
        style={{ marginTop: 14, minHeight: 60 }}
        placeholder="Notes for yourself (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => save({ note })}
      />
      {msg && <p className="small feedback-effect">{msg}</p>}
      <p className="tiny subtle" style={{ margin: '8px 0 0' }}>
        This isn’t medical advice. If something hurts, stop and get it checked.
      </p>
    </div>
  );
}
