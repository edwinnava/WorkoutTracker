import { useMemo, useRef, useState } from 'react';
import { saveSettings } from '../db/db';
import type { MuscleGroup, Unit } from '../db/types';
import { MUSCLE_LABELS } from '../data/exercises';
import { deleteAllData, downloadFile, exportBackup, exportHevyCsv, importHevyCsv, restoreBackup, type ImportSummary } from '../lib/dataio';
import { toast, useExerciseMap, useSettings, useWorkouts } from '../lib/hooks';
import { startOfWeek, weekStreak, workoutVolume } from '../lib/stats';
import { fmtLongDuration, fmtNum, fmtVolume } from '../lib/units';
import { BarChart } from '../components/Charts';
import { IconDownload, IconTrash, IconUpload } from '../components/Icons';
import { Sheet } from '../components/Sheet';
import { AccountCard } from '../components/AccountCard';
import { useAccount } from '../sync/state';

export default function Profile() {
  const settings = useSettings();
  const account = useAccount();
  const workouts = useWorkouts();
  const exMap = useExerciseMap();
  const fileRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [chart, setChart] = useState<'workouts' | 'duration' | 'volume'>('workouts');

  const all = workouts ?? [];
  const totalTime = all.reduce((t, w) => t + (w.endTime - w.startTime), 0);
  const totalVolume = all.reduce((v, w) => v + workoutVolume(w, exMap), 0);

  const weeks = useMemo(() => {
    const thisWeek = startOfWeek(Date.now());
    return Array.from({ length: 12 }, (_, i) => {
      const start = startOfWeek(thisWeek - (11 - i) * 7 * 86400000 + 3600000 * 12);
      const end = start + 7 * 86400000;
      const ws = all.filter((w) => w.startTime >= start && w.startTime < end);
      return {
        label: new Date(start).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
        workouts: ws.length,
        duration: ws.reduce((t, w) => t + (w.endTime - w.startTime), 0) / 3600000,
        volume: ws.reduce((v, w) => v + workoutVolume(w, exMap), 0) * (settings.unit === 'lbs' ? 2.20462262185 : 1),
      };
    });
  }, [all, exMap, settings.unit]);

  const muscles = useMemo(() => {
    const since = Date.now() - 30 * 86400000;
    const counts = new Map<MuscleGroup, number>();
    for (const w of all) {
      if (w.startTime < since) break;
      for (const e of w.exercises) {
        const m = exMap.get(e.exerciseId)?.muscle ?? 'other';
        counts.set(m, (counts.get(m) ?? 0) + e.sets.filter((s) => s.type !== 'warmup').length);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [all, exMap]);
  const maxMuscle = Math.max(1, ...muscles.map((m) => m[1]));

  const onImport = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      setSummary(await importHevyCsv(text));
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onRestore = async (file: File) => {
    if (!confirm('Restoring replaces ALL current data with the backup. Continue?')) return;
    try {
      await restoreBackup(await file.text());
      toast('Backup restored');
    } catch (e) {
      alert((e as Error).message);
    } finally {
      if (backupRef.current) backupRef.current.value = '';
    }
  };

  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="title">Profile</h1>
      </div>
      <AccountCard />
      <div style={{ height: 16 }} />

      <div className="stat-grid">
        <div className="stat">
          <div className="v">{all.length}</div>
          <div className="l">Workouts</div>
        </div>
        <div className="stat">
          <div className="v">{fmtNum(totalTime / 3600000, 0)}h</div>
          <div className="l">Total time</div>
        </div>
        <div className="stat">
          <div className="v">{weekStreak(all)}</div>
          <div className="l">Week streak</div>
        </div>
      </div>
      <div className="small subtle" style={{ marginTop: 6 }}>
        Lifetime volume: {fmtVolume(totalVolume, settings.unit)}
        {all.length > 0 && ` · avg ${fmtLongDuration(totalTime / all.length)} per workout`}
      </div>

      <div className="section-title">Last 12 weeks</div>
      <div className="card">
        <BarChart
          bars={weeks.map((w) => ({ label: w.label, value: w[chart] }))}
          format={(v) => (chart === 'duration' ? `${fmtNum(v, 1)}h` : chart === 'volume' ? (v >= 1000 ? `${fmtNum(v / 1000, 0)}k` : String(Math.round(v))) : String(Math.round(v)))}
        />
        <div className="seg" style={{ marginTop: 8 }}>
          {(['workouts', 'duration', 'volume'] as const).map((c) => (
            <button key={c} className={chart === c ? 'on' : ''} onClick={() => setChart(c)}>
              {c[0].toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {muscles.length > 0 && (
        <>
          <div className="section-title">Sets per muscle · last 30 days</div>
          <div className="card">
            {muscles.map(([m, n]) => (
              <div key={m} className="bar-row">
                <span className="lbl">{MUSCLE_LABELS[m]}</span>
                <div className="track">
                  <div className="fill" style={{ width: `${(n / maxMuscle) * 100}%` }} />
                </div>
                <span className="num">{n}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-title">Settings</div>
      <div className="list">
        <div className="list-item">
          <div className="main">Weight unit</div>
          <div className="seg" style={{ width: 130 }}>
            {(['lbs', 'kg'] as Unit[]).map((u) => (
              <button
                key={u}
                className={settings.unit === u ? 'on' : ''}
                onClick={() => saveSettings({ unit: u, increment: u === settings.unit ? settings.increment : u === 'kg' ? 2.5 : 5 })}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
        <div className="list-item">
          <div className="main">Default rest timer</div>
          <select className="input" style={{ width: 110 }} value={settings.defaultRestSec} onChange={(e) => saveSettings({ defaultRestSec: Number(e.target.value) })}>
            {[0, 30, 45, 60, 90, 120, 150, 180, 240, 300].map((s) => (
              <option key={s} value={s}>
                {s === 0 ? 'Off' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}
              </option>
            ))}
          </select>
        </div>
        <div className="list-item">
          <div className="main">
            Weight increment
            <div className="tiny subtle">Added when you hit the top of your rep range</div>
          </div>
          <select className="input" style={{ width: 110 }} value={settings.increment} onChange={(e) => saveSettings({ increment: Number(e.target.value) })}>
            {(settings.unit === 'kg' ? [1, 1.25, 2.5, 5] : [2.5, 5, 10]).map((v) => (
              <option key={v} value={v}>
                {v} {settings.unit}
              </option>
            ))}
          </select>
        </div>
        <div className="list-item">
          <div className="main">
            Default rep range
            <div className="tiny subtle">Used for suggestions when a routine has none</div>
          </div>
          <input
            className="input"
            style={{ width: 52, textAlign: 'center' }}
            inputMode="numeric"
            value={settings.repRangeMin}
            onChange={(e) => saveSettings({ repRangeMin: Number(e.target.value.replace(/\D/g, '')) || 1 })}
          />
          <span className="subtle">–</span>
          <input
            className="input"
            style={{ width: 52, textAlign: 'center' }}
            inputMode="numeric"
            value={settings.repRangeMax}
            onChange={(e) => saveSettings({ repRangeMax: Number(e.target.value.replace(/\D/g, '')) || 1 })}
          />
        </div>
      </div>

      <div className="section-title">Import from Hevy</div>
      <div className="card">
        <p className="small subtle" style={{ marginTop: 0 }}>
          In the Hevy app go to <strong>Profile → Settings (⚙) → Export &amp; Import Data → Export Workouts</strong>, save the CSV file,
          then pick it here. Exercises are matched by name; anything unknown becomes a custom exercise. Re-importing the same file skips
          workouts you already have.
        </p>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
        <button className="btn primary block" disabled={busy} onClick={() => fileRef.current?.click()}>
          <IconUpload size={18} /> {busy ? 'Importing…' : 'Choose Hevy CSV file'}
        </button>
      </div>

      <div className="section-title">Your data</div>
      <div className="list">
        <button className="list-item" onClick={async () => downloadFile(`workouts-${stamp}.csv`, await exportHevyCsv(), 'text/csv')}>
          <IconDownload size={20} />
          <div className="main">
            Export workouts (CSV)
            <div className="tiny subtle">Same format as Hevy’s export</div>
          </div>
        </button>
        <button className="list-item" onClick={async () => downloadFile(`workout-tracker-backup-${stamp}.json`, await exportBackup(), 'application/json')}>
          <IconDownload size={20} />
          <div className="main">
            Download full backup
            <div className="tiny subtle">Workouts, routines, custom exercises &amp; settings</div>
          </div>
        </button>
        <input ref={backupRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && onRestore(e.target.files[0])} />
        <button className="list-item" onClick={() => backupRef.current?.click()}>
          <IconUpload size={20} />
          <div className="main">Restore from backup</div>
        </button>
        <button
          className="list-item"
          style={{ color: 'var(--danger)' }}
          onClick={async () => {
            const where = account.user ? ' from this device AND your account' : '';
            if (!confirm(`Delete ALL workouts, routines and custom exercises${where}? This cannot be undone.`)) return;
            if (!confirm('Are you absolutely sure?')) return;
            await deleteAllData();
            toast('All data deleted');
          }}
        >
          <IconTrash size={20} />
          <div className="main">Delete all data</div>
        </button>
      </div>
      <p className="tiny faint center" style={{ marginTop: 24 }}>
        {account.user
          ? 'Your data is saved to your account automatically and kept on this device for offline use.'
          : 'All data is stored on this device only. Sign in or download a backup regularly.'}
      </p>

      {summary && (
        <Sheet title="Import complete" onClose={() => setSummary(null)} footer={<button className="btn primary block" onClick={() => setSummary(null)}>Done</button>}>
          <div className="stat-grid">
            <div className="stat">
              <div className="v">{summary.imported}</div>
              <div className="l">Imported</div>
            </div>
            <div className="stat">
              <div className="v">{summary.duplicates}</div>
              <div className="l">Already had</div>
            </div>
            <div className="stat">
              <div className="v">{summary.newExercises.length}</div>
              <div className="l">New exercises</div>
            </div>
          </div>
          {summary.newExercises.length > 0 && (
            <>
              <p className="small subtle">
                These weren’t in the library, so they were added as custom exercises. You can set their muscle group from the Exercises tab.
              </p>
              <p className="small">{summary.newExercises.join(', ')}</p>
            </>
          )}
          {summary.skippedRows > 0 && <p className="small subtle">{summary.skippedRows} row(s) were skipped because they were missing a date or exercise name.</p>}
        </Sheet>
      )}
    </div>
  );
}
