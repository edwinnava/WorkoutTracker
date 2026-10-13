# Workout Tracker

A Hevy-style workout tracker without the social features. It's an installable web app (PWA) that works offline. Sign in with Google to save your data to your account automatically and sync it across devices.

## Features

- **Workout logging**: sets with weight and reps (plus time and distance for cardio), warm-up, failure and drop sets, a "Previous" column, rest timer with sound and vibration, supersets, notes, and live duration, volume and set counts. An in-progress workout survives closing the app.
- **Suggested weights and reps**: double progression. When you hit the top of your rep range on every working set, the next session suggests adding weight. Otherwise it suggests one more rep. The rep range comes from your routine, or from the reps you actually do (a 5-rep lifter gets 5–7). Weight jumps scale by exercise: 2× for squats, deadlifts and leg presses, ½× for isolation work, never below one dumbbell size, and you can override any exercise's jump on its page. Three sessions stuck at the same weight trigger a ~10% deload suggestion. Suggestions appear as grey placeholders, and ticking a set with empty fields logs the suggestion.
- **Today's workout and plan**: assign routines to weekdays, or leave days on *Auto* to rotate to the routine after the one you last did. Rotation also matches imported Hevy workouts by title. **See plan** shows the week and lets you choose your next workout or take a rest day, which helps after a skipped day or an injury.
- **Swapping exercises**: the ⇄ button on any exercise in a workout lists alternatives for the same muscles, and offers to make the swap permanent in the routine.
- **Routines and programs**: build your own routines with rep ranges and rest times, save any past workout as a routine, or add a ready-made program (Push/Pull/Legs, Upper/Lower, Full Body 3x, Strength 5×5) in one tap.
- **Exercise library**: 220 exercises using Hevy's names, searchable and filterable by muscle and equipment, plus custom exercises.
- **Progress**: per-exercise charts (heaviest weight, estimated 1RM, volume, reps), personal records, PR detection when you finish a workout, weekly charts, and sets per muscle group.
- **Hevy import**: Hevy → Profile → Settings → Export & Import Data → **Export Workouts**, then in this app go to Profile → *Choose Hevy CSV file*. Both lbs and kg exports work. Unknown exercises become custom exercises, and re-importing skips duplicates.
- **Google account and sync**: sign in with Google and every change saves to your account (Firebase) automatically. It works offline at the gym and uploads when you're back online. Data already on the device is added to your account at first sign-in, and the same Hevy import done on two devices isn't duplicated.
- **Your data**: export as CSV in Hevy's format, or as a full JSON backup with restore.

## Setting up Google sign-in (one time, about 10 minutes)

1. Go to [console.firebase.google.com](https://console.firebase.google.com), click **Create a project**, and give it any name. Google Analytics isn't needed.
2. **Authentication**: Build → Authentication → Get started → Sign-in method → **Google** → Enable → Save.
3. **Authorized domains**: in Authentication → Settings → Authorized domains, add the domain the app runs on, e.g. `edwinnava.github.io`.
4. **Database**: Build → Firestore Database → Create database → choose a location → start in **production mode**.
5. **Security rules**: in Firestore → Rules, replace the contents with [`firestore.rules`](firestore.rules) and click **Publish**. This makes each person's data readable only by them.
6. **App config**: Project settings (⚙) → Your apps → Web (`</>`) → register an app (no hosting needed) → copy the `firebaseConfig` values into `PROJECT` in [`src/firebase-config.ts`](src/firebase-config.ts) and commit.

These config values are not secret. Google sign-in and the security rules protect the data. Until they're filled in, the app runs without accounts.

Firestore layout: `users/{uid}/{workouts|routines|exercises|settings}/{id}`, where each document is `{ data, deleted, updatedAt }`. Deletes are kept as tombstones so other devices pick them up. The in-progress workout stays on the device until you finish it.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (Hevy CSV parsing, suggestions, sync engine)
npm run build    # production build in dist/
```

Stack: React, TypeScript, Vite, Dexie (IndexedDB), Firebase Auth and Firestore, PapaParse, and vite-plugin-pwa.

To test sync locally without a real project, run the [Firebase emulators](https://firebase.google.com/docs/emulator-suite) (`npx firebase-tools emulators:start --only auth,firestore --project demo-workout`) and start the app with `VITE_FIREBASE_EMULATOR=1` plus dummy `VITE_FIREBASE_*` values.

## Using it on your phone

The included GitHub Actions workflow deploys to GitHub Pages on every push to `main`. Enable it once under **Settings → Pages → Source: GitHub Actions**. Open the site on your phone and choose **Add to Home Screen**. It then runs full-screen and offline like a native app.

If you're signed in, your data is in your account. If not, it only lives in that browser on that device, so download a backup from Profile now and then.
