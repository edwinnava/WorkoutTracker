/**
 * Firebase web app config (Firebase console → Project settings → Your apps → Web app → SDK setup → Config).
 * These values are not secrets: access is protected by Google sign-in and the
 * Firestore security rules in firestore.rules. While apiKey is empty the app runs
 * without accounts (data stays on the device).
 * Any value can be overridden with a VITE_FIREBASE_* environment variable (see .env.example).
 */
const PROJECT = {
  apiKey: 'AIzaSyBauEOE2ms7UQUoBLwstsb4W34TDub_0VU',
  authDomain: 'edwin-s-workout-trainer.firebaseapp.com',
  projectId: 'edwin-s-workout-trainer',
  storageBucket: 'edwin-s-workout-trainer.firebasestorage.app',
  messagingSenderId: '802467407872',
  appId: '1:802467407872:web:f97a24fab44ca65eabd0e5',
};

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || PROJECT.apiKey,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || PROJECT.authDomain,
  projectId: env.VITE_FIREBASE_PROJECT_ID || PROJECT.projectId,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || PROJECT.storageBucket,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || PROJECT.messagingSenderId,
  appId: env.VITE_FIREBASE_APP_ID || PROJECT.appId,
};

/** Set VITE_FIREBASE_EMULATOR=1 to use local Auth/Firestore emulators (development and tests only). */
export const useEmulator = env.VITE_FIREBASE_EMULATOR === '1';

export const firebaseConfigured = !!firebaseConfig.apiKey && !!firebaseConfig.projectId;
