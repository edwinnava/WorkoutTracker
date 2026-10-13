import { useSyncExternalStore } from 'react';
import { db } from '../db/db';
import { firebaseConfigured } from '../firebase-config';
import { browserKV, SyncEngine, type SyncStatus } from './engine';

export interface AccountUser {
  name: string;
  email: string;
  photoURL?: string;
}

export interface AccountState {
  configured: boolean;
  /** Firebase has loaded and restored any previous session. */
  ready: boolean;
  user: AccountUser | null;
  status: SyncStatus;
  online: boolean;
  error?: string;
}

/** Created at startup so local changes are tracked before Firebase finishes loading. */
export const syncEngine = new SyncEngine(db, browserKV);

let state: AccountState = {
  configured: firebaseConfigured,
  ready: !firebaseConfigured,
  user: null,
  status: 'idle',
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
};
const listeners = new Set<() => void>();

export function setAccountState(patch: Partial<AccountState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useAccount(): AccountState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

syncEngine.onStatus = (status, error) => setAccountState({ status, error });

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    setAccountState({ online: true });
    syncEngine.flush();
  });
  window.addEventListener('offline', () => setAccountState({ online: false }));
}

type FirebaseModule = typeof import('./firebase');
let mod: Promise<FirebaseModule> | null = null;

/** Loads Firebase lazily (keeps it out of the main bundle) and restores the session. */
export function initAccount() {
  if (!firebaseConfigured || mod) return;
  mod = import('./firebase');
  mod.then((m) => m.init()).catch((e) => setAccountState({ ready: true, status: 'error', error: String(e) }));
}

export async function signIn() {
  initAccount();
  const m = await mod!;
  return m.signInWithGoogle();
}

export async function signOut() {
  const m = await mod!;
  return m.signOutAndClear();
}
