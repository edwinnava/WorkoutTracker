# Workout Tracker

A Hevy-style workout tracker without the social features. It's an installable web app (PWA) that works offline and keeps all data on your device.

## Features

- **Workout logging**: sets with weight and reps (plus time and distance for cardio), warm-up, failure and drop sets, a "Previous" column, rest timer with sound and vibration, supersets, notes, and live duration, volume and set counts. An in-progress workout survives closing the app.
- **Suggested weights and reps**: double progression. When you hit the top of your rep range on every working set, the next session suggests adding weight (5 lbs or 2.5 kg, configurable). Otherwise it suggests one more rep. Suggestions appear as grey placeholders, and ticking a set with empty fields logs the suggestion.
- **Today's workout**: assign routines to weekdays, or leave days on *Auto* to rotate to the routine after the one you last did. Rotation also matches imported Hevy workouts by title.
- **Routines and programs**: build your own routines with rep ranges and rest times, save any past workout as a routine, or add a ready-made program (Push/Pull/Legs, Upper/Lower, Full Body 3x, Strength 5×5) in one tap.
- **Exercise library**: 220 exercises using Hevy's names, searchable and filterable by muscle and equipment, plus custom exercises.
- **Progress**: per-exercise charts (heaviest weight, estimated 1RM, volume, reps), personal records, PR detection when you finish a workout, weekly charts, and sets per muscle group.
- **Hevy import**: Hevy → Profile → Settings → Export & Import Data → **Export Workouts**, then in this app go to Profile → *Choose Hevy CSV file*. Both lbs and kg exports work. Unknown exercises become custom exercises, and re-importing skips duplicates.
- **Your data**: export as CSV in Hevy's format, or as a full JSON backup with restore.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (Hevy CSV parsing, suggestions)
npm run build    # production build in dist/
```

Stack: React, TypeScript, Vite, Dexie (IndexedDB), PapaParse, and vite-plugin-pwa.

## Using it on your phone

The included GitHub Actions workflow deploys to GitHub Pages on every push to `main`. Enable it once under **Settings → Pages → Source: GitHub Actions**. Open the site on your phone and choose **Add to Home Screen**. It then runs full-screen and offline like a native app.

Data lives in the browser's storage on that device, so download a backup from Profile now and then.
