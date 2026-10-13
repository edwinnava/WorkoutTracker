# Workout Tracker

A Hevy-style workout tracker (no social features) for one user, Edwin, who uses it on **Android** as an installed PWA.
Live at https://edwinnava.github.io/WorkoutTracker/

## Working with the owner

- **Auto-publish is authorized.** After a change passes `npm run typecheck`, `npm test`, `npm run build` **and** a browser check of the affected screens, commit to the working branch and also push it to `main` (`git push origin <branch>:main`). Pushing to `main` deploys via GitHub Actions in about a minute. Confirm the run succeeded, then tell the user it's live and to close and reopen the app (sometimes twice) to get the update.
- The user isn't a developer. Explain things in plain language and give step-by-step instructions for anything they need to do in GitHub or Firebase.

## Stack

React 19 + TypeScript + Vite, react-router (HashRouter), Dexie (IndexedDB) for local data, Firebase Auth (Google) + Firestore for sync, PapaParse for CSV, vite-plugin-pwa. No CSS framework; styles are in `src/styles.css` (dark theme, Hevy-like).

## Commands

```bash
npm run dev        # dev server
npm test           # vitest unit tests
npm run typecheck  # tsc -b
npm run build      # production build to dist/
npx vite preview --port 4173   # serve the build for browser checks
```

## Layout

- `src/db/`: Dexie schema (`db.ts`) and all types (`types.ts`). `Settings` lives in the `settings` table under key `'settings'`, and `getSettings()` merges `DEFAULT_SETTINGS`. **When adding a settings field, add it to both the type and `DEFAULT_SETTINGS`** (and to the settings literal in `src/sync/__tests__/engine.test.ts`).
- `src/data/exercises.ts`: built-in library (~220 exercises, named exactly like Hevy so CSV imports match). `secondary` muscles mark compound lifts. `src/data/programs.ts`: ready-made programs.
- `src/lib/suggest.ts`: progressive overload (double progression, auto rep range from history, stall → ~10% deload) and today's-workout logic (plan pick → weekday schedule → rotation). `src/lib/increments.ts`: per-exercise weight jumps.
- `src/lib/hevy.ts`: Hevy CSV parse/export. `src/lib/dataio.ts`: import into the DB, JSON backup/restore.
- `src/lib/actions.ts`: start/finish/edit workouts, the draft (active workout) ↔ saved workout conversion, and `routineForToday` (today-only edits from the Today card).
- `src/sync/`: `engine.ts` is backend-agnostic two-way sync (Dexie hooks → localStorage outbox → remote; remote listeners → local, tombstones for deletes). `firebase.ts` is the Firestore/Auth adapter. `state.ts` holds account state for the UI and lazy-loads Firebase.
- `src/pages/`: Home (Today card with editable plan), WorkoutLogger, History, WorkoutDetail, Routines, RoutineEditor, Exercises, ExerciseDetail, Profile (settings, account, import/export).
- `src/components/`: shared UI (Sheet/ActionMenu, ExercisePicker with similar-exercise alternatives, ReorderSheet, PlanSheet, TodayPlan, Charts, AccountCard).

## Data rules (important)

- Weights are stored in **kg** and distances in **km**, and converted for display (`src/lib/units.ts`). The in-progress workout (`active` table) stores the strings the user typed, in the user's unit.
- Workout ids are random safe integers (`newWorkoutId`) so ids from different devices never collide. Don't reintroduce auto-increment.
- Use `bulkDelete`, never `Table.clear()`, for user-initiated deletes: `clear()` bypasses Dexie hooks, so sync would never learn about the deletion. `SyncEngine.clearLocal` (sign-out) intentionally bypasses sync.
- Only custom exercises sync. Built-ins are re-seeded on every start (`ensureSeed`).
- Firestore layout is `users/{uid}/{workouts|routines|exercises|settings}/{id}` = `{ data, deleted, updatedAt }`. The security rules are in `firestore.rules`. Firebase project: `edwin-s-workout-trainer`, with web config in `src/firebase-config.ts` (not secret).
- Adding a Dexie schema change means a new `this.version(n)` with an upgrade function. Never edit an existing version.

## Testing notes

- Unit tests live in `src/**/__tests__` (they use `fake-indexeddb`). The sync engine has an in-memory fake remote.
- For UI changes, verify in a real browser with Playwright against `vite preview`. Chromium is at `/opt/pw-browsers/chromium`. Install `playwright` in a scratch dir, not in this repo. Use a 390×844 viewport.
- The real Google sign-in can't be tested in the cloud sandbox, because `apis.google.com` is blocked and so is `github.io`. To test sync end to end, run the Firebase emulators (`npx firebase-tools emulators:start --only auth,firestore --project demo-workout`, needs Java) and build with `VITE_FIREBASE_EMULATOR=1` plus dummy `VITE_FIREBASE_*` values. Emulator builds expose `window.__emulatorGoogleSignIn(uid, email)`.
- When a Firebase config is present and the user isn't signed in, a "sign in to back up" card appears above the Today card. Scope selectors to the card containing "TODAY’S WORKOUT".
- Shell gotcha: `pkill -f "vite preview"` matches its own shell and kills the command. Use `pkill -f "[v]ite preview"`.

## Deploy setup (already done)

GitHub Pages source is GitHub Actions (`.github/workflows/deploy.yml`, runs on push to `main`). The `github-pages` environment allows `main`. `edwinnava.github.io` is an authorized domain in Firebase Auth.
