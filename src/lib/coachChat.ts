import { db, getSettings, newId, saveSettings } from '../db/db';
import type { BodyArea, Exercise, Routine, Settings, Workout, WorkoutFeedback } from '../db/types';
import { MUSCLE_LABELS } from '../data/exercises';
import { AREA_LABELS, muscleStats, recentAreas } from './coach';
import { incrementFor } from './increments';
import { fmtNum, fmtWeight, fromDisplayWeight } from './units';

/*
 * The coach chat: an AI model with tools that read and change the app's data.
 * The model runs on the user's own PC (LM Studio or anything else that speaks
 * the OpenAI-style /v1/chat/completions API with tool calling). Requests go
 * straight from the browser to that server; its address is kept in
 * localStorage on this device only (never synced).
 */

const SERVER_STORE = 'coachServer';
const CHAT_STORE = 'coachChat';
/** A stored chat older than this starts fresh, so the coach isn't working from stale numbers. */
const CHAT_MAX_AGE_MS = 6 * 3600000;
const DAY = 86400000;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export interface CoachServer {
  /** Base address of the PC's model server, e.g. https://my-pc.tail1234.ts.net */
  url: string;
  /** Model id as the server lists it. */
  model: string;
}

/** Tidies what the user typed into a base address (no trailing slash or /v1). */
export function normalizeUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

export function getServer(): CoachServer | null {
  try {
    const s = JSON.parse(localStorage.getItem(SERVER_STORE) ?? 'null') as CoachServer | null;
    return s?.url && s.model ? s : null;
  } catch {
    return null;
  }
}
export const setServer = (s: CoachServer | null) => (s ? localStorage.setItem(SERVER_STORE, JSON.stringify(s)) : localStorage.removeItem(SERVER_STORE));

/** Why the phone can't reach the PC, in terms the user can act on. */
function unreachable(url: string): string {
  if (location.protocol === 'https:' && /^http:\/\//i.test(url)) return 'The address must start with https://. Phones block secure apps from plain http addresses — use the https address from Tailscale.';
  return 'Couldn’t reach your PC. Check that it’s on, LM Studio’s server is running with CORS turned on, and Tailscale is connected on both the PC and this phone.';
}

/** Asks the PC which models it has. Doubles as the connection test. */
export async function listModels(rawUrl: string): Promise<string[]> {
  const url = normalizeUrl(rawUrl);
  let res: Response;
  try {
    res = await fetch(`${url}/v1/models`, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw new Error(unreachable(url));
  }
  if (!res.ok) throw new Error(`Your PC answered with an error (${res.status}). Check the address.`);
  const body = (await res.json().catch(() => null)) as { data?: { id?: unknown }[] } | null;
  const ids = (body?.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string' && !/embed/i.test(id));
  if (!ids.length) throw new Error('Connected, but no chat models were found. Download one in LM Studio first.');
  return ids;
}

/** One message in the OpenAI-style chat format the PC's server speaks. */
type ApiMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** How to reverse a change the coach made. */
export type Undo =
  | { kind: 'routine'; id: string; prev: Routine | null }
  | { kind: 'settings'; prev: Partial<Settings> }
  | { kind: 'feedback'; workoutId: number; prev: WorkoutFeedback | null };

/** What the chat screen shows. */
export type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'action'; text: string; undo?: Undo; undone?: boolean }
  | { kind: 'error'; text: string };

export interface ChatState {
  /** Snapshot of the user's training, built when the chat started (kept fixed so the prompt stays cacheable). */
  snapshot: string;
  messages: ApiMessage[];
  items: ChatItem[];
  updatedAt: number;
}

export function loadChat(): ChatState | null {
  try {
    const s = JSON.parse(localStorage.getItem(CHAT_STORE) ?? 'null') as ChatState | null;
    return s && Date.now() - s.updatedAt < CHAT_MAX_AGE_MS ? s : null;
  } catch {
    return null;
  }
}

export function saveChat(s: ChatState | null) {
  if (!s) return localStorage.removeItem(CHAT_STORE);
  try {
    localStorage.setItem(CHAT_STORE, JSON.stringify(s));
  } catch {
    /* storage full: the chat just won't survive a reload */
  }
}

/* ---------- What the coach knows up front ---------- */

const SYSTEM = `You are the strength coach built into a personal workout-tracker app, running on the user's own computer. You are talking with the app's only user, in a chat screen on their phone. They lift for general strength and muscle and are not a developer.

You can see their training data and you can change things in the app with your tools. They asked for a coach that updates the app for them, so when they ask for a change or agree to one you suggested, make it with a tool straight away rather than describing how they could do it themselves. When a change is your own idea and it is a big one (rewriting a routine, moving their schedule), say what you would change and why in a sentence or two and check they want it first. Small adjustments they clearly asked for need no confirmation. Every change shows up in the chat with an Undo button, so after making one, say plainly what you changed in a line or two.

How the app works, so your advice fits it:
- Each exercise in a routine has a rep range. The app suggests weights by double progression: one more rep per set until every set reaches the top of the range, then the weight goes up by that exercise's "weight jump" and reps drop back to the bottom. If someone goes well past the top it jumps further. Three sessions stuck at the same weight triggers a roughly 10% deload.
- After a workout they can mark it as "went light" or flag a body area that was bothering them. Flagged sessions are left out of progression, and for 10 days exercises loading a flagged area hold their weight.
- The app picks today's workout from: a routine they picked for today, else the weekly schedule, else the next routine in rotation.

The first message of the chat carries a snapshot of their data taken when the chat began. For anything not in it, or after you have changed something, use the read tools instead of guessing. Exercise ids must come from the snapshot or from search_exercises; never invent one. Weights are in the unit the snapshot states.

Base what you say on their actual numbers and name them ("your bench has gone 155, 160, 165 over three weeks"). If the data cannot answer a question, say so. You are not a doctor: for pain, suggest easing off and getting it looked at if it persists, and use add_workout_feedback so the app eases off too.

Write for a phone: short replies, plain language, no headings or tables. Short paragraphs, with "- " bullets for lists and **bold** only for the few numbers or names that matter.`;

function fmtSets(sets: Workout['exercises'][number]['sets'], unit: Settings['unit']): string {
  return sets
    .filter((s) => s.type !== 'warmup')
    .map((s) => (s.weightKg != null ? `${fmtWeight(s.weightKg, unit)}x${s.reps ?? '?'}` : s.reps != null ? `${s.reps} reps` : s.durationSec != null ? `${s.durationSec}s` : '?'))
    .join(', ');
}

function describeRoutine(r: Routine, exMap: Map<string, Exercise>): string {
  const lines = r.exercises.map((e) => {
    const working = e.sets.filter((s) => s.type !== 'warmup');
    const t = working.find((s) => s.reps != null);
    const range = t?.reps != null ? (t.repsMax && t.repsMax !== t.reps ? `${t.reps}-${t.repsMax}` : `${t.reps}`) : 'no rep target';
    return `  - ${exMap.get(e.exerciseId)?.name ?? e.exerciseId} [${e.exerciseId}]: ${working.length} sets, ${range} reps`;
  });
  return `${r.name} [routine id: ${r.id}]\n${lines.join('\n') || '  (empty)'}`;
}

function describeWorkout(w: Workout, exMap: Map<string, Exercise>, unit: Settings['unit']): string {
  const f = w.feedback;
  const tags = [f?.light ? 'went light' : '', ...(f?.areas ?? []).map((a) => `${AREA_LABELS[a].toLowerCase()} bothering`), f?.note ? `note: "${f.note}"` : ''].filter(Boolean);
  const head = `${new Date(w.startTime).toDateString()} — ${w.title} [workout id: ${w.id}], ${Math.round((w.endTime - w.startTime) / 60000)} min${tags.length ? ` (${tags.join('; ')})` : ''}`;
  const lines = w.exercises.map((e) => `  - ${exMap.get(e.exerciseId)?.name ?? e.exerciseId}: ${fmtSets(e.sets, unit)}${e.notes ? ` (note: "${e.notes}")` : ''}`);
  return `${head}\n${lines.join('\n')}`;
}

/** Plain-text picture of the user's training for the start of a chat. */
export async function buildSnapshot(now = Date.now()): Promise<string> {
  const [settings, routines, exercises, workouts] = await Promise.all([
    getSettings(),
    db.routines.orderBy('order').toArray(),
    db.exercises.toArray(),
    db.workouts.orderBy('startTime').reverse().toArray(),
  ]);
  const exMap = new Map(exercises.map((e) => [e.id, e]));
  const unit = settings.unit;
  const name = (id: string | null) => (id === 'rest' ? 'Rest' : id ? (routines.find((r) => r.id === id)?.name ?? 'unknown') : 'Auto (rotation)');
  const stats = muscleStats(workouts, exMap, now);
  const caution = recentAreas(workouts, now);

  // Trend for every exercise in a routine: top set of the last few sessions.
  const inRoutines = [...new Set(routines.flatMap((r) => r.exercises.map((e) => e.exerciseId)))];
  const trends = inRoutines.map((id) => {
    const sessions = workouts.filter((w) => w.exerciseIds.includes(id)).slice(0, 5);
    const ex = exMap.get(id);
    const tops = sessions
      .map((w) => {
        const sets = w.exercises.filter((e) => e.exerciseId === id).flatMap((e) => e.sets).filter((s) => s.type !== 'warmup');
        const top = sets.reduce((a, s) => ((s.weightKg ?? 0) > (a?.weightKg ?? -1) ? s : a), sets[0]);
        const d = new Date(w.startTime);
        return top ? `${d.getMonth() + 1}/${d.getDate()}: ${fmtSets(sets, unit)}` : '';
      })
      .filter(Boolean);
    return `- ${ex?.name ?? id} [${id}] (weight jump ${fmtNum(incrementFor(ex, settings))} ${unit}): ${tops.length ? tops.join(' | ') : 'never logged'}`;
  });

  return [
    `Today is ${new Date(now).toDateString()}. Weights are in ${unit}. ${workouts.length} workouts logged in total.`,
    `ROUTINES\n${routines.map((r) => describeRoutine(r, exMap)).join('\n') || '(none yet)'}`,
    `WEEKLY SCHEDULE\n${DAYS.map((d, i) => `${d}: ${name(settings.schedule[i])}`).join(', ')}`,
    `MUSCLE BALANCE (working sets per week over the last 4 weeks, vs the app's target)\n${stats.map((s) => `- ${MUSCLE_LABELS[s.muscle]}: ${Math.round(s.weekly * 2) / 2} of ${s.target}${s.daysSince != null ? `, last trained ${s.daysSince} days ago` : ', never trained'}`).join('\n')}`,
    `AREAS FLAGGED IN THE LAST 10 DAYS\n${caution.map((c) => `- ${AREA_LABELS[c.area]} (${Math.floor((now - c.at) / DAY)} days ago)`).join('\n') || '(none)'}`,
    `RECENT SESSIONS PER EXERCISE (newest first, working sets as weight x reps)\n${trends.join('\n') || '(no routines)'}`,
    `LAST ${Math.min(workouts.length, 8)} WORKOUTS (newest first)\n${workouts.slice(0, 8).map((w) => describeWorkout(w, exMap, unit)).join('\n') || '(none yet)'}`,
  ].join('\n\n');
}

/* ---------- Tools ---------- */

const str = { type: 'string' } as const;
interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] } };
}
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]): ToolDef => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

const TOOLS: ToolDef[] = [
  tool('search_exercises', "Search the app's exercise library by name to get exercise ids. Returns up to 15 matches with muscle, equipment and whether the user has logged it before.", { query: { ...str, description: 'Part of the exercise name, e.g. "incline press" or "leg curl"' } }, ['query']),
  tool('get_exercise_history', 'Every working set from the most recent sessions of one exercise, newest first.', { exercise_id: str, sessions: { type: 'integer', description: 'How many sessions (default 8, max 30)' } }, ['exercise_id']),
  tool('get_recent_workouts', 'Full detail of recent workouts, newest first, including feedback and notes. Use for anything older or more detailed than the snapshot.', { count: { type: 'integer', description: 'How many workouts (default 10, max 40)' } }, []),
  tool('get_routines', "The user's routines and weekly schedule as they are right now. Use after changing something or if the snapshot may be out of date.", {}, []),
  tool(
    'save_routine',
    'Create a routine, or replace an existing one when routine_id is given. Replacing overwrites the whole exercise list, so include every exercise that should remain.',
    {
      routine_id: { ...str, description: 'Id of the routine to replace. Omit to create a new one.' },
      name: str,
      exercises: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            exercise_id: str,
            sets: { type: 'integer', description: 'Working sets, 1-10' },
            reps_min: { type: 'integer', description: 'Bottom of the rep range' },
            reps_max: { type: 'integer', description: 'Top of the rep range' },
            rest_seconds: { type: 'integer', description: 'Rest between sets. Omit for the user default.' },
          },
          required: ['exercise_id', 'sets', 'reps_min', 'reps_max'],
        },
      },
    },
    ['name', 'exercises'],
  ),
  tool(
    'set_weekly_schedule',
    'Set which routine is planned for one or more weekdays. Only the days you include change.',
    { days: { type: 'object', description: 'Keys are sun, mon, tue, wed, thu, fri, sat. Each value is a routine id, "rest", or "auto" (no fixed plan: the app rotates through the routines).', properties: Object.fromEntries(DAYS.map((d) => [d, str])) } },
    ['days'],
  ),
  tool('set_weight_jump', "Set how much weight the app adds to one exercise when it progresses, in the user's unit. Use for machines with fixed steps (e.g. an 11 lb cable stack).", { exercise_id: str, amount: { type: ['number', 'null'], description: 'The jump, or null to go back to automatic' } }, ['exercise_id', 'amount']),
  tool('plan_today', "Choose what the app offers as today's workout: a routine id, or \"rest\".", { routine_id: str }, ['routine_id']),
  tool(
    'add_workout_feedback',
    "Record how a finished workout went, so the app's suggestions adjust: went_light keeps it out of progression, and areas makes the app hold weights on exercises that load them for 10 days.",
    {
      workout_id: { type: 'integer' },
      went_light: { type: 'boolean' },
      areas: { type: 'array', items: { type: 'string', enum: Object.keys(AREA_LABELS) }, description: 'Body areas that were bothering them. Replaces the current list.' },
      note: str,
    },
    ['workout_id'],
  ),
];

interface ToolOutcome {
  content: string;
  isError?: boolean;
  /** Shown in the chat when the tool changed something. */
  action?: { text: string; undo?: Undo };
}

const fail = (content: string): ToolOutcome => ({ content, isError: true });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);

/** Runs one tool call. Inputs come from the model unvalidated, so everything is checked here. */
export async function runTool(name: string, input: unknown): Promise<ToolOutcome> {
  if (!isObj(input)) return fail('Input must be an object.');
  const settings = await getSettings();
  const unit = settings.unit;

  switch (name) {
    case 'search_exercises': {
      if (typeof input.query !== 'string' || !input.query.trim()) return fail('query is required.');
      const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
      const all = await db.exercises.toArray();
      const hits = all.filter((e) => terms.every((t) => e.name.toLowerCase().includes(t))).slice(0, 15);
      if (!hits.length) return { content: 'No exercises match. Try fewer or different words.' };
      const done = await Promise.all(hits.map((e) => db.workouts.where('exerciseIds').equals(e.id).count()));
      return { content: hits.map((e, i) => `${e.name} [${e.id}] — ${MUSCLE_LABELS[e.muscle]}, ${e.equipment}, ${done[i] ? `logged in ${done[i]} workouts` : 'never logged'}`).join('\n') };
    }
    case 'get_exercise_history': {
      const ex = typeof input.exercise_id === 'string' ? await db.exercises.get(input.exercise_id) : undefined;
      if (!ex) return fail('Unknown exercise_id. Use search_exercises to find it.');
      const n = input.sessions === undefined ? 8 : int(input.sessions, 1, 30);
      if (n == null) return fail('sessions must be a whole number from 1 to 30.');
      const list = (await db.workouts.where('exerciseIds').equals(ex.id).toArray()).sort((a, b) => b.startTime - a.startTime).slice(0, n);
      if (!list.length) return { content: `${ex.name} has never been logged.` };
      return {
        content: `${ex.name}, weights in ${unit}:\n${list
          .map((w) => {
            const f = w.feedback;
            const flag = f?.light || f?.areas?.length ? ' (flagged: light / something bothering)' : '';
            return `${new Date(w.startTime).toDateString()}${flag}: ${fmtSets(w.exercises.filter((e) => e.exerciseId === ex.id).flatMap((e) => e.sets), unit)}`;
          })
          .join('\n')}`,
      };
    }
    case 'get_recent_workouts': {
      const n = input.count === undefined ? 10 : int(input.count, 1, 40);
      if (n == null) return fail('count must be a whole number from 1 to 40.');
      const [list, exercises] = await Promise.all([db.workouts.orderBy('startTime').reverse().limit(n).toArray(), db.exercises.toArray()]);
      const exMap = new Map(exercises.map((e) => [e.id, e]));
      return { content: list.map((w) => describeWorkout(w, exMap, unit)).join('\n') || 'No workouts logged yet.' };
    }
    case 'get_routines': {
      const [routines, exercises] = await Promise.all([db.routines.orderBy('order').toArray(), db.exercises.toArray()]);
      const exMap = new Map(exercises.map((e) => [e.id, e]));
      const sched = DAYS.map((d, i) => `${d}: ${settings.schedule[i] ?? 'auto'}`).join(', ');
      return { content: `${routines.map((r) => describeRoutine(r, exMap)).join('\n') || '(no routines)'}\n\nSchedule (routine ids): ${sched}` };
    }
    case 'save_routine': {
      if (typeof input.name !== 'string' || !input.name.trim()) return fail('name is required.');
      if (!Array.isArray(input.exercises) || input.exercises.length === 0 || input.exercises.length > 20) return fail('exercises must list 1 to 20 exercises.');
      const prev = input.routine_id === undefined ? null : typeof input.routine_id === 'string' ? ((await db.routines.get(input.routine_id)) ?? null) : null;
      if (input.routine_id !== undefined && !prev) return fail('Unknown routine_id. Omit it to create a new routine.');
      const exercises: Routine['exercises'] = [];
      for (const [i, raw] of input.exercises.entries()) {
        if (!isObj(raw)) return fail(`exercises[${i}] must be an object.`);
        const ex = typeof raw.exercise_id === 'string' ? await db.exercises.get(raw.exercise_id) : undefined;
        if (!ex) return fail(`exercises[${i}]: unknown exercise_id ${JSON.stringify(raw.exercise_id)}. Use search_exercises to find the id.`);
        const sets = int(raw.sets, 1, 10);
        const min = int(raw.reps_min, 1, 100);
        const max = int(raw.reps_max, 1, 100);
        if (sets == null || min == null || max == null || max < min) return fail(`exercises[${i}] (${ex.name}): sets must be 1-10 and reps_min <= reps_max, both 1-100.`);
        const rest = raw.rest_seconds === undefined ? null : int(raw.rest_seconds, 0, 900);
        if (raw.rest_seconds !== undefined && rest == null) return fail(`exercises[${i}]: rest_seconds must be 0-900.`);
        // Keep the old entry's notes/superset when the exercise is staying in the routine.
        const old = prev?.exercises.find((e) => e.exerciseId === ex.id);
        exercises.push({
          exerciseId: ex.id,
          ...(old?.notes ? { notes: old.notes } : {}),
          restSec: rest ?? old?.restSec ?? settings.defaultRestSec,
          sets: Array.from({ length: sets }, () => ({ type: 'normal' as const, reps: min, repsMax: max })),
        });
      }
      const routine: Routine = prev
        ? { ...prev, name: input.name.trim(), exercises }
        : { id: newId('r-'), name: input.name.trim(), order: await db.routines.count(), createdAt: Date.now(), exercises };
      await db.routines.put(routine);
      return {
        content: `Saved. Routine id: ${routine.id}`,
        action: { text: prev ? `Updated routine “${routine.name}”` : `Created routine “${routine.name}”`, undo: { kind: 'routine', id: routine.id, prev } },
      };
    }
    case 'set_weekly_schedule': {
      if (!isObj(input.days) || Object.keys(input.days).length === 0) return fail('days must set at least one weekday.');
      const routines = await db.routines.toArray();
      const schedule = [...settings.schedule];
      const said: string[] = [];
      for (const [day, value] of Object.entries(input.days)) {
        const i = DAYS.indexOf(day as (typeof DAYS)[number]);
        if (i < 0) return fail(`Unknown day "${day}". Use sun, mon, tue, wed, thu, fri, sat.`);
        const r = routines.find((x) => x.id === value);
        if (value !== 'rest' && value !== 'auto' && !r) return fail(`${day}: "${String(value)}" is not a routine id, "rest" or "auto".`);
        schedule[i] = value === 'auto' ? null : (value as string);
        said.push(`${day[0].toUpperCase()}${day.slice(1)} → ${r?.name ?? (value === 'rest' ? 'Rest' : 'Auto')}`);
      }
      await saveSettings({ schedule });
      return { content: 'Schedule saved.', action: { text: `Schedule: ${said.join(', ')}`, undo: { kind: 'settings', prev: { schedule: settings.schedule } } } };
    }
    case 'set_weight_jump': {
      const ex = typeof input.exercise_id === 'string' ? await db.exercises.get(input.exercise_id) : undefined;
      if (!ex) return fail('Unknown exercise_id. Use search_exercises to find it.');
      const amount = input.amount;
      if (amount !== null && (typeof amount !== 'number' || !(amount > 0) || amount > 200)) return fail('amount must be a positive number, or null for automatic.');
      const increments = { ...settings.increments };
      if (amount === null) delete increments[ex.id];
      else increments[ex.id] = fromDisplayWeight(amount, unit);
      await saveSettings({ increments });
      return {
        content: 'Saved.',
        action: { text: amount === null ? `${ex.name}: weight jump back to automatic` : `${ex.name}: weight jump set to ${fmtNum(amount)} ${unit}`, undo: { kind: 'settings', prev: { increments: settings.increments } } },
      };
    }
    case 'plan_today': {
      const r = typeof input.routine_id === 'string' && input.routine_id !== 'rest' ? await db.routines.get(input.routine_id) : undefined;
      if (input.routine_id !== 'rest' && !r) return fail('routine_id must be a routine id or "rest".');
      await saveSettings({ nextPick: { routineId: r?.id ?? 'rest', at: Date.now() }, todayPlan: null });
      return { content: 'Saved.', action: { text: r ? `Today’s workout set to “${r.name}”` : 'Today set as a rest day', undo: { kind: 'settings', prev: { nextPick: settings.nextPick, todayPlan: settings.todayPlan } } } };
    }
    case 'add_workout_feedback': {
      const w = typeof input.workout_id === 'number' ? await db.workouts.get(input.workout_id) : undefined;
      if (!w) return fail('Unknown workout_id. Workout ids are in the snapshot and in get_recent_workouts.');
      if (input.went_light !== undefined && typeof input.went_light !== 'boolean') return fail('went_light must be true or false.');
      if (input.note !== undefined && typeof input.note !== 'string') return fail('note must be text.');
      const valid = Object.keys(AREA_LABELS);
      if (input.areas !== undefined && (!Array.isArray(input.areas) || input.areas.some((a) => !valid.includes(a as string)))) return fail(`areas must be a list from: ${valid.join(', ')}.`);
      const next: WorkoutFeedback = { ...w.feedback };
      if (input.went_light !== undefined) next.light = input.went_light || undefined;
      if (input.areas !== undefined) next.areas = (input.areas as BodyArea[]).length ? (input.areas as BodyArea[]) : undefined;
      if (input.note !== undefined) next.note = (input.note as string).trim() || undefined;
      const feedback = next.light || next.areas || next.note ? next : undefined;
      await db.workouts.update(w.id!, { feedback });
      const tags = [next.light ? 'went light' : '', ...(next.areas ?? []).map((a) => AREA_LABELS[a].toLowerCase())].filter(Boolean);
      return {
        content: 'Saved.',
        action: { text: `Feedback on ${w.title} (${new Date(w.startTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}): ${tags.join(', ') || 'note saved'}`, undo: { kind: 'feedback', workoutId: w.id!, prev: w.feedback ?? null } },
      };
    }
    default:
      return fail(`Unknown tool ${name}.`);
  }
}

export async function applyUndo(u: Undo): Promise<void> {
  if (u.kind === 'routine') {
    if (u.prev) await db.routines.put(u.prev);
    else await db.routines.delete(u.id);
  } else if (u.kind === 'settings') await saveSettings(u.prev);
  else await db.workouts.update(u.workoutId, { feedback: u.prev ?? undefined });
}

/* ---------- Talking to the model ---------- */

export async function newChat(): Promise<ChatState> {
  return { snapshot: await buildSnapshot(), messages: [], items: [], updatedAt: Date.now() };
}

/** Some local models write their reasoning inline; it isn't for the user. */
export function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/, '')
    .trim();
}

interface Turn {
  content: string;
  toolCalls: ToolCall[];
  finish: string | null;
}

/** Reads a streamed chat completion, reporting text as it arrives. */
async function readStream(res: Response, onText: (soFar: string) => void): Promise<Turn> {
  const turn: Turn = { content: '', toolCalls: [], finish: null };
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const handle = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let chunk: { error?: { message?: string }; choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[] };
    try {
      chunk = JSON.parse(data);
    } catch {
      return; // a keep-alive or partial line: nothing to use
    }
    if (chunk.error) throw new Error(`The model reported a problem: ${chunk.error.message ?? 'unknown error'}`);
    const choice = chunk.choices?.[0];
    if (!choice) return;
    if (choice.delta?.content) {
      turn.content += choice.delta.content;
      onText(turn.content);
    }
    for (const tc of choice.delta?.tool_calls ?? []) {
      const i = tc.index ?? turn.toolCalls.length - 1;
      const cur = (turn.toolCalls[i] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.function.name += tc.function.name;
      if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
    }
    if (choice.finish_reason) turn.finish = choice.finish_reason;
  };
  for (;;) {
    const { done, value } = await reader.read();
    buf += decoder.decode(value, { stream: !done });
    const lines = buf.split(/\r?\n/);
    buf = done ? '' : lines.pop()!;
    lines.forEach(handle);
    if (done) break;
  }
  turn.toolCalls = turn.toolCalls.filter(Boolean).map((t, i) => ({ ...t, id: t.id || `call_${i}` }));
  return turn;
}

/**
 * Sends the user's message and runs the model's tool calls until it has
 * finished replying. `onChange` fires as text streams in and as actions happen.
 * Returns the new state; on failure the state carries an error item and the
 * conversation is rolled back to before this message so it can be retried.
 */
export async function sendMessage(state: ChatState, text: string, onChange: (s: ChatState) => void, signal?: AbortSignal): Promise<ChatState> {
  const server = getServer();
  const before = state.messages;
  // The snapshot rides in the first user message so the start of the conversation never changes.
  const content = before.length === 0 ? `<training_snapshot>\n${state.snapshot}\n</training_snapshot>\n\n${text}` : text;
  let messages: ApiMessage[] = [...before, { role: 'user', content }];
  let items: ChatItem[] = [...state.items.filter((i) => i.kind !== 'error'), { kind: 'user', text }];
  const emit = (extra: ChatItem[] = []) => onChange({ ...state, messages, items: [...items, ...extra], updatedAt: Date.now() });
  emit();

  try {
    if (!server) throw new Error('Set up the connection to your PC first (the key icon).');
    let finished = false;
    for (let step = 0; step < 10 && !finished; step++) {
      let res: Response;
      try {
        res = await fetch(`${server.url}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: server.model, stream: true, temperature: 0.4, messages: [{ role: 'system', content: SYSTEM }, ...messages], tools: TOOLS }),
          signal,
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        throw new Error(unreachable(server.url));
      }
      if (!res.ok || !res.body) {
        const detail = await res.text().then((t) => (JSON.parse(t) as { error?: { message?: string } | string }).error).catch(() => null);
        const msg = typeof detail === 'string' ? detail : detail?.message;
        if (msg && /context|token/i.test(msg)) throw new Error('The conversation is too long for the model’s memory. Start a new chat, or raise the model’s context length in LM Studio (16,000 or more).');
        throw new Error(`Your PC answered with an error (${res.status})${msg ? `: ${msg}` : ''}.`);
      }

      const turn = await readStream(res, (soFar) => {
        const shown = stripThinking(soFar);
        if (shown) emit([{ kind: 'assistant', text: shown }]);
      });
      const said = stripThinking(turn.content);
      if (said) items = [...items, { kind: 'assistant', text: said }];
      if (turn.finish === 'length' && turn.toolCalls.length) throw new Error('The reply was cut off before a change could be made. Try asking for less at once.');

      messages = [...messages, { role: 'assistant', content: turn.content || null, ...(turn.toolCalls.length ? { tool_calls: turn.toolCalls } : {}) }];
      if (!turn.toolCalls.length) {
        if (!said) throw new Error('The model sent back an empty reply. Try again, or try a different model in LM Studio.');
        finished = true;
        break;
      }

      for (const call of turn.toolCalls) {
        let out: ToolOutcome;
        try {
          out = await runTool(call.function.name, JSON.parse(call.function.arguments || '{}'));
        } catch (e) {
          out = fail(e instanceof SyntaxError ? 'The arguments were not valid JSON. Send the tool call again with valid JSON.' : `Tool failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (out.action) items = [...items, { kind: 'action', ...out.action }];
        messages = [...messages, { role: 'tool', tool_call_id: call.id, content: out.isError ? `ERROR: ${out.content}` : out.content }];
      }
      emit();
    }
    if (!finished) items = [...items, { kind: 'error', text: 'The model kept going without finishing. Check the changes above, then ask again if something is missing.' }];
  } catch (err) {
    if (!signal?.aborted) items = [...items, { kind: 'error', text: err instanceof Error ? err.message : 'Something went wrong.' }];
    // Drop the half-finished exchange unless tools already changed things the model should know about.
    if (!items.slice(state.items.length).some((i) => i.kind === 'action')) {
      messages = before;
      // Nothing was kept, so take the question back out too (the screen puts it back in the box to retry).
      items = [...state.items.filter((i) => i.kind !== 'error'), ...items.filter((i) => i.kind === 'error')];
    } else if (messages.at(-1)?.role === 'assistant' && (messages.at(-1) as { tool_calls?: unknown }).tool_calls) {
      messages = messages.slice(0, -1); // never leave tool calls without their results
    }
  }
  const done = { ...state, messages, items, updatedAt: Date.now() };
  onChange(done);
  return done;
}
