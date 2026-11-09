import type { BodyArea, Exercise, MuscleGroup, RoutineExercise, Workout } from '../db/types';

/*
 * The "coach": reads workout feedback, finds under-trained muscles and builds
 * a recommended workout. Everything here is plain arithmetic on your history,
 * so it works offline and needs no server.
 */

const DAY = 86400000;

export const AREA_LABELS: Record<BodyArea, string> = {
  shoulder: 'Shoulder',
  elbow: 'Elbow',
  wrist: 'Wrist',
  neck: 'Neck',
  upper_back: 'Upper back',
  lower_back: 'Lower back',
  hip: 'Hip',
  knee: 'Knee',
  ankle: 'Ankle',
};

/** Muscles whose exercises load each area. */
const AREA_MUSCLES: Record<BodyArea, MuscleGroup[]> = {
  shoulder: ['shoulders'],
  elbow: ['triceps', 'biceps', 'forearms'],
  wrist: ['forearms', 'biceps'],
  neck: ['neck', 'traps'],
  upper_back: ['upper_back', 'traps', 'lats'],
  lower_back: ['lower_back'],
  hip: ['glutes', 'adductors', 'abductors'],
  knee: ['quadriceps'],
  ankle: ['calves'],
};

/** How long a flagged area keeps suggestions cautious. */
export const CAUTION_DAYS = 10;

export function affectsArea(ex: Pick<Exercise, 'muscle' | 'secondary'> | undefined, area: BodyArea): boolean {
  if (!ex) return false;
  const muscles = AREA_MUSCLES[area];
  return muscles.includes(ex.muscle) || (ex.secondary ?? []).some((m) => muscles.includes(m));
}

/**
 * True when this workout shouldn't count toward progress for `ex`:
 * something was bothering you that this exercise loads, or you marked the
 * whole workout as light without naming an area.
 */
export function isOffSession(w: Pick<Workout, 'feedback'>, ex: Pick<Exercise, 'muscle' | 'secondary'> | undefined): boolean {
  const f = w.feedback;
  if (!f) return false;
  const areas = f.areas ?? [];
  if (areas.length) return areas.some((a) => affectsArea(ex, a));
  return !!f.light;
}

/** Areas flagged in the last `CAUTION_DAYS`, most recent first. */
export function recentAreas(workouts: Workout[], now = Date.now()): { area: BodyArea; at: number }[] {
  const seen = new Map<BodyArea, number>();
  for (const w of workouts) {
    if (w.startTime < now - CAUTION_DAYS * DAY || w.startTime > now) continue;
    for (const a of w.feedback?.areas ?? []) seen.set(a, Math.max(seen.get(a) ?? 0, w.startTime));
  }
  return [...seen.entries()].map(([area, at]) => ({ area, at })).sort((a, b) => b.at - a.at);
}

/** The flagged area this exercise loads, if any. */
export function cautionFor(ex: Pick<Exercise, 'muscle' | 'secondary'> | undefined, areas: { area: BodyArea }[]): BodyArea | undefined {
  return areas.find((a) => affectsArea(ex, a.area))?.area;
}

/* ---------- Muscle balance ---------- */

/** Muscles the coach tracks, with a sensible weekly set target for each (big muscles first). */
export const TRACKED: { muscle: MuscleGroup; target: number }[] = [
  { muscle: 'quadriceps', target: 10 },
  { muscle: 'hamstrings', target: 8 },
  { muscle: 'glutes', target: 6 },
  { muscle: 'chest', target: 10 },
  { muscle: 'lats', target: 10 },
  { muscle: 'upper_back', target: 6 },
  { muscle: 'shoulders', target: 8 },
  { muscle: 'biceps', target: 6 },
  { muscle: 'triceps', target: 6 },
  { muscle: 'calves', target: 6 },
  { muscle: 'abdominals', target: 6 },
];

export interface MuscleStat {
  muscle: MuscleGroup;
  target: number;
  /** Average sets per week over the window (direct work = 1, assisting = ½). */
  weekly: number;
  /** Days since the muscle was last worked at all, or null if never. */
  daysSince: number | null;
  /** 0 = on target, 1 = not trained at all. */
  deficit: number;
}

export function muscleStats(workouts: Workout[], exMap: Map<string, Exercise>, now = Date.now(), windowDays = 28): MuscleStat[] {
  const since = now - windowDays * DAY;
  const sets = new Map<MuscleGroup, number>();
  const last = new Map<MuscleGroup, number>();
  let oldest = now;
  for (const w of workouts) {
    if (w.startTime > now) continue;
    for (const e of w.exercises) {
      const ex = exMap.get(e.exerciseId);
      if (!ex) continue;
      const n = e.sets.filter((s) => s.type !== 'warmup').length;
      if (n === 0) continue;
      for (const [m, weight] of [[ex.muscle, 1] as const, ...(ex.secondary ?? []).map((x) => [x, 0.5] as const)]) {
        last.set(m, Math.max(last.get(m) ?? 0, w.startTime));
        if (w.startTime >= since) sets.set(m, (sets.get(m) ?? 0) + n * weight);
      }
    }
    if (w.startTime >= since) oldest = Math.min(oldest, w.startTime);
  }
  // Don't punish a short history: average over the weeks you've actually been logging.
  const weeks = Math.min(windowDays / 7, Math.max(1, Math.ceil((now - oldest) / (7 * DAY))));
  return TRACKED.map(({ muscle, target }) => {
    const weekly = (sets.get(muscle) ?? 0) / weeks;
    const l = last.get(muscle);
    return {
      muscle,
      target,
      weekly,
      daysSince: l != null ? Math.floor((now - l) / DAY) : null,
      deficit: Math.max(0, 1 - weekly / target),
    };
  });
}

/* ---------- Recommended workout ---------- */

/** Well-known exercises worth suggesting even if you've never logged them. */
const STAPLES = new Set(
  [
    'Squat (Barbell)', 'Leg Press (Machine)', 'Bulgarian Split Squat', 'Leg Extension (Machine)', 'Hack Squat (Machine)', 'Lunge (Dumbbell)', 'Goblet Squat',
    'Romanian Deadlift (Barbell)', 'Romanian Deadlift (Dumbbell)', 'Seated Leg Curl (Machine)', 'Lying Leg Curl (Machine)',
    'Hip Thrust (Barbell)', 'Hip Thrust (Machine)', 'Glute Kickback (Machine)', 'Cable Pull Through',
    'Bench Press (Barbell)', 'Bench Press (Dumbbell)', 'Incline Bench Press (Dumbbell)', 'Chest Press (Machine)', 'Cable Fly Crossovers', 'Chest Fly (Machine)', 'Butterfly (Pec Deck)',
    'Lat Pulldown (Cable)', 'Pull Up', 'Pull Up (Assisted)', 'Chin Up', 'Straight Arm Lat Pulldown (Cable)',
    'Bent Over Row (Barbell)', 'Seated Cable Row - V Grip (Cable)', 'Dumbbell Row', 'T Bar Row', 'Chest Supported Incline Row (Dumbbell)', 'Seated Row (Machine)',
    'Overhead Press (Barbell)', 'Overhead Press (Dumbbell)', 'Seated Overhead Press (Dumbbell)', 'Shoulder Press (Machine Plates)', 'Lateral Raise (Dumbbell)', 'Lateral Raise (Cable)', 'Face Pull', 'Rear Delt Reverse Fly (Machine)',
    'Bicep Curl (Dumbbell)', 'Bicep Curl (Barbell)', 'Hammer Curl (Dumbbell)', 'Preacher Curl (Machine)', 'EZ Bar Biceps Curl', 'Bicep Curl (Cable)',
    'Triceps Pushdown', 'Triceps Rope Pushdown', 'Skullcrusher (Barbell)', 'Overhead Triceps Extension (Cable)', 'Triceps Dip',
    'Standing Calf Raise (Machine)', 'Seated Calf Raise', 'Calf Press (Machine)',
    'Cable Crunch', 'Hanging Leg Raise', 'Crunch (Machine)', 'Ab Wheel', 'Plank',
  ].map((n) => n.toLowerCase()),
);

const BIG: MuscleGroup[] = ['quadriceps', 'hamstrings', 'glutes', 'chest', 'lats', 'upper_back', 'shoulders'];
const isCompound = (e: Exercise) => (e.secondary?.length ?? 0) > 0;
const STRENGTH_TYPES = ['weight_reps', 'weighted_bodyweight', 'assisted_bodyweight', 'reps_only'];

/** Small deterministic random generator so a recommendation stays the same until you shuffle. */
function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Usage {
  /** exercise id → last time it was done */
  last: Map<string, number>;
  /** equipment types you've used at least once */
  equipment: Set<string>;
}

function usage(workouts: Workout[], exMap: Map<string, Exercise>): Usage {
  const last = new Map<string, number>();
  const equipment = new Set<string>();
  for (const w of workouts) {
    for (const e of w.exercises) {
      last.set(e.exerciseId, Math.max(last.get(e.exerciseId) ?? 0, w.startTime));
      const eq = exMap.get(e.exerciseId)?.equipment;
      if (eq) equipment.add(eq);
    }
  }
  return { last, equipment };
}

/**
 * Ranks candidate exercises for variety: things you know but haven't done
 * lately come first, with the odd well-known exercise you've never tried.
 */
function rank(cands: Exercise[], u: Usage, now: number, rand: () => number, preferCompound: boolean | null): Exercise[] {
  return cands
    .map((e) => {
      const l = u.last.get(e.id);
      const days = l != null ? (now - l) / DAY : null;
      let score = rand() * 2;
      if (days == null) score += STAPLES.has(e.name.toLowerCase()) ? 2.2 : -3;
      else score += 3 + Math.min(days, 21) / 7 - (days < 8 ? 3 : 0);
      if (preferCompound != null && isCompound(e) === preferCompound) score += 2.5;
      if (e.type === 'weight_reps') score += 0.5;
      return { e, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.e);
}

function usable(e: Exercise, u: Usage, caution: { area: BodyArea }[]): boolean {
  if (!STRENGTH_TYPES.includes(e.type)) return false;
  if (cautionFor(e, caution)) return false;
  // Stick to the kind of equipment you actually use (anything goes until there's history).
  if (u.equipment.size > 0 && e.equipment !== 'none' && !u.equipment.has(e.equipment)) return false;
  return true;
}

function targetSets(e: Exercise, restSec: number): RoutineExercise {
  const [reps, repsMax] = isCompound(e) ? [8, 12] : [10, 15];
  return { exerciseId: e.id, restSec, sets: [0, 1, 2].map(() => ({ type: 'normal' as const, reps, repsMax })) };
}

export interface Recommendation {
  exercises: RoutineExercise[];
  /** Why each muscle was picked, in workout order. */
  focus: { muscle: MuscleGroup; reason: string }[];
  /** Exercises you've never logged. */
  newIds: string[];
  /** Flagged areas the workout steers around. */
  avoiding: BodyArea[];
}

function reasonFor(s: MuscleStat): string {
  if (s.daysSince == null) return 'Not trained yet';
  const sets = Math.round(s.weekly * 2) / 2;
  if (s.deficit >= 0.25) return `About ${sets} sets a week — aim for ${s.target}`;
  if (s.daysSince >= 5) return `Not trained in ${s.daysSince} days`;
  return 'Rested and ready';
}

/**
 * Builds a workout around the muscles that most need attention: the ones
 * furthest below their weekly target that have had at least ~2 days of rest.
 * `seed` changes the exercise picks (the Shuffle button).
 */
export function recommendWorkout(
  workouts: Workout[],
  exercises: Exercise[],
  opts: { now?: number; seed?: number; restSec?: number; size?: number } = {},
): Recommendation | null {
  const now = opts.now ?? Date.now();
  const size = opts.size ?? 6;
  const exMap = new Map(exercises.map((e) => [e.id, e]));
  const rand = rng((opts.seed ?? 0) + Math.floor(now / DAY));
  const u = usage(workouts, exMap);
  const caution = recentAreas(workouts, now);
  const stats = muscleStats(workouts, exMap, now);

  // When each muscle was last trained directly (for recovery).
  const lastDirect = new Map<MuscleGroup, number>();
  for (const w of workouts) for (const e of w.exercises) {
    const m = exMap.get(e.exerciseId)?.muscle;
    if (m) lastDirect.set(m, Math.max(lastDirect.get(m) ?? 0, w.startTime));
  }

  const scored = stats
    .filter((s) => now - (lastDirect.get(s.muscle) ?? 0) >= 1.6 * DAY)
    .map((s) => ({ s, score: s.deficit * 2 + Math.min(s.daysSince ?? 10, 10) / 10 + rand() * 0.15 }))
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;

  const picked: { e: Exercise; s: MuscleStat }[] = [];
  const used = new Set<string>();
  const pick = (s: MuscleStat, preferCompound: boolean | null) => {
    const cands = exercises.filter((e) => e.muscle === s.muscle && !used.has(e.id) && usable(e, u, caution));
    const best = rank(cands, u, now, rand, preferCompound)[0];
    if (!best) return false;
    used.add(best.id);
    picked.push({ e: best, s });
    return true;
  };

  const muscles = scored.slice(0, size - 1).map((x) => x.s);
  for (const s of muscles) pick(s, BIG.includes(s.muscle) ? true : null);
  // Spend what's left on a second, different kind of exercise for the weakest muscles.
  for (const s of muscles) {
    if (picked.length >= size) break;
    const first = picked.find((p) => p.s === s);
    if (first) pick(s, !isCompound(first.e));
  }
  if (picked.length === 0) return null;

  const order = (m: MuscleGroup) => TRACKED.findIndex((t) => t.muscle === m);
  picked.sort((a, b) => order(a.s.muscle) - order(b.s.muscle) || Number(isCompound(b.e)) - Number(isCompound(a.e)));

  const focusStats = [...new Set(picked.map((p) => p.s))];
  return {
    exercises: picked.map((p) => targetSets(p.e, opts.restSec ?? 90)),
    focus: focusStats.map((s) => ({ muscle: s.muscle, reason: reasonFor(s) })),
    newIds: picked.filter((p) => !u.last.has(p.e.id)).map((p) => p.e.id),
    avoiding: caution.map((c) => c.area).filter((a) => stats.some((s) => AREA_MUSCLES[a].includes(s.muscle))),
  };
}

/**
 * A fresh take on a routine: each exercise is swapped for a similar one
 * (same muscle, same kind of movement) that you haven't done lately.
 * Exercises with no good alternative stay as they are.
 */
export function mixUpRoutine(
  routineExercises: RoutineExercise[],
  workouts: Workout[],
  exercises: Exercise[],
  opts: { now?: number; seed?: number } = {},
): RoutineExercise[] {
  const now = opts.now ?? Date.now();
  const exMap = new Map(exercises.map((e) => [e.id, e]));
  const rand = rng((opts.seed ?? 0) + Math.floor(now / DAY) + 7);
  const u = usage(workouts, exMap);
  const caution = recentAreas(workouts, now);
  const used = new Set(routineExercises.map((r) => r.exerciseId));
  return routineExercises.map((re) => {
    const base = exMap.get(re.exerciseId);
    if (!base || !STRENGTH_TYPES.includes(base.type)) return re;
    const cands = exercises.filter(
      (e) => e.muscle === base.muscle && isCompound(e) === isCompound(base) && !used.has(e.id) && usable(e, u, caution),
    );
    // Treat the current exercise as "just done" so alternatives win.
    const best = rank(cands, u, now, rand, null).find((e) => u.last.has(e.id) || STAPLES.has(e.name.toLowerCase()));
    if (!best) return re;
    used.add(best.id);
    return { ...re, exerciseId: best.id, sets: re.sets.map((s) => ({ ...s, weightKg: null })) };
  });
}
