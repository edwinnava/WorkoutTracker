import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db, DEFAULT_SETTINGS } from '../db/db';
import type { Exercise, Settings, Workout } from '../db/types';

export function useSettings(): Settings {
  const row = useLiveQuery(() => db.settings.get('settings'), []);
  return useMemo(() => {
    if (!row) return DEFAULT_SETTINGS;
    const { key: _key, ...rest } = row;
    return { ...DEFAULT_SETTINGS, ...rest };
  }, [row]);
}

export function useExercises(): Exercise[] | undefined {
  return useLiveQuery(() => db.exercises.orderBy('name').toArray(), []);
}

export function useExerciseMap(): Map<string, Exercise> {
  const list = useExercises();
  return useMemo(() => new Map((list ?? []).map((e) => [e.id, e])), [list]);
}

/** All workouts, newest first. */
export function useWorkouts(): Workout[] | undefined {
  return useLiveQuery(() => db.workouts.orderBy('startTime').reverse().toArray(), []);
}

export function useActive() {
  return useLiveQuery(() => db.active.get('current'), []);
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

let toastListener: ((msg: string) => void) | null = null;
export function toast(msg: string) {
  toastListener?.(msg);
}
export function useToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    toastListener = (m) => {
      setMsg(m);
      clearTimeout(t);
      t = setTimeout(() => setMsg(null), 2600);
    };
    return () => {
      toastListener = null;
      clearTimeout(t);
    };
  }, []);
  return msg;
}
