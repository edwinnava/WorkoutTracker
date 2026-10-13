import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getRedirectResult,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  browserPopupRedirectResolver,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
} from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDocs,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  waitForPendingWrites,
  where,
  type Firestore,
} from 'firebase/firestore';
import { ensureSeed } from '../db/db';
import { firebaseConfig, useEmulator } from '../firebase-config';
import type { Remote, RemoteDoc, SyncTable } from './engine';
import { setAccountState, syncEngine } from './state';

/*
 * Firestore layout: users/{uid}/{workouts|routines|exercises|settings}/{id}
 *   { data: <record> | null, deleted: boolean, updatedAt: serverTimestamp }
 * Deletes are tombstones so other devices learn about them.
 */

let auth: Auth;
let fs: Firestore;

function firestoreRemote(uid: string): Remote {
  const coll = (table: SyncTable) => collection(fs, 'users', uid, table);
  const toDoc = (id: string, d: Record<string, unknown>): RemoteDoc | null => {
    const ts = d.updatedAt as Timestamp | null;
    if (!ts) return null;
    return { id, data: d.deleted ? null : (d.data as Record<string, unknown>), updatedAt: ts.toMillis() };
  };
  return {
    write(table, id, data) {
      setDoc(doc(coll(table), id), { data, deleted: data === null, updatedAt: serverTimestamp() }).catch((e) =>
        setAccountState({ status: 'error', error: e.message }),
      );
    },
    async fetchAll(table) {
      const snap = await getDocs(coll(table));
      return snap.docs.map((d) => toDoc(d.id, d.data())).filter((d): d is RemoteDoc => !!d);
    },
    listen(table, since, onDocs, onError) {
      const q = query(coll(table), where('updatedAt', '>', Timestamp.fromMillis(since)));
      return onSnapshot(
        q,
        (snap) => {
          const docs = snap
            .docChanges()
            .filter((c) => c.type !== 'removed' && !c.doc.metadata.hasPendingWrites)
            .map((c) => toDoc(c.doc.id, c.doc.data()))
            .filter((d): d is RemoteDoc => !!d);
          if (docs.length) onDocs(docs);
        },
        onError,
      );
    },
  };
}

export async function init() {
  const app = initializeApp(firebaseConfig);
  auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  fs = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  if (useEmulator) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(fs, '127.0.0.1', 8080);
    // Test hook (emulator builds only): sign in with a fake Google account without the popup.
    (window as unknown as Record<string, unknown>).__emulatorGoogleSignIn = (sub: string, email: string) =>
      signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub, email, email_verified: true, name: 'Test User' })));
  }
  getRedirectResult(auth).catch((e) => setAccountState({ error: e.message }));

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      syncEngine.stop();
      setAccountState({ ready: true, user: null });
      return;
    }
    setAccountState({
      ready: true,
      user: { name: user.displayName ?? 'You', email: user.email ?? '', photoURL: user.photoURL ?? undefined },
    });
    try {
      await syncEngine.start(firestoreRemote(user.uid), user.uid);
      await ensureSeed();
    } catch {
      /* status already set to error by the engine */
    }
  });
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
      return;
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
    throw e;
  }
}

/** Signs out after making sure everything is uploaded, then removes the account's data from this device. */
export async function signOutAndClear(): Promise<boolean> {
  await syncEngine.flush();
  const uploaded = await Promise.race([
    waitForPendingWrites(fs).then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), 8000)),
  ]);
  if (!uploaded || syncEngine.hasPendingUploads()) {
    const ok = confirm(
      "Some changes haven't been uploaded yet (are you offline?). If you sign out now they will be lost. Sign out anyway?",
    );
    if (!ok) return false;
  }
  syncEngine.stop();
  await signOut(auth);
  await syncEngine.clearLocal();
  return true;
}
