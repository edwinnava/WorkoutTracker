import { useMemo, useState } from 'react';
import type { Equipment, Exercise, MuscleGroup } from '../db/types';
import { EQUIPMENT_LABELS, MUSCLE_LABELS } from '../data/exercises';
import { useExercises, useWorkouts } from '../lib/hooks';
import { IconCheck, IconPlus, IconSearch } from './Icons';
import { Sheet } from './Sheet';
import { ExerciseForm } from './ExerciseForm';

export function exerciseInitials(name: string) {
  return name
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function useFilteredExercises(query: string, muscle: MuscleGroup | 'all', equipment: Equipment | 'all') {
  const all = useExercises();
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    return (all ?? []).filter(
      (e) =>
        (muscle === 'all' || e.muscle === muscle || e.secondary?.includes(muscle)) &&
        (equipment === 'all' || e.equipment === equipment) &&
        terms.every((t) => e.name.toLowerCase().includes(t)),
    );
  }, [all, query, muscle, equipment]);
}

export function FilterChips({
  muscle,
  setMuscle,
  equipment,
  setEquipment,
}: {
  muscle: MuscleGroup | 'all';
  setMuscle: (m: MuscleGroup | 'all') => void;
  equipment: Equipment | 'all';
  setEquipment: (e: Equipment | 'all') => void;
}) {
  return (
    <div className="row" style={{ marginTop: 10, gap: 8 }}>
      <select className="input" value={muscle} onChange={(e) => setMuscle(e.target.value as MuscleGroup | 'all')}>
        <option value="all">All muscles</option>
        {Object.entries(MUSCLE_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <select className="input" value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment | 'all')}>
        <option value="all">All equipment</option>
        {Object.entries(EQUIPMENT_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ExerciseRow({ ex, selected, onClick, right }: { ex: Exercise; selected?: boolean; onClick: () => void; right?: React.ReactNode }) {
  return (
    <button className="list-item" onClick={onClick}>
      <div className={'ex-icon' + (selected ? ' sel' : '')}>{selected ? <IconCheck size={18} /> : exerciseInitials(ex.name)}</div>
      <div className="main">
        <div className="ellipsis" style={{ fontWeight: 600 }}>
          {ex.name}
        </div>
        <div className="small subtle">
          {MUSCLE_LABELS[ex.muscle]}
          {ex.custom ? ' · Custom' : ''}
        </div>
      </div>
      {right}
    </button>
  );
}

/** Multi-select exercise picker (single-select when `single`). */
export function ExercisePicker({
  onClose,
  onPick,
  single,
  title = 'Add Exercise',
}: {
  onClose: () => void;
  onPick: (ids: string[]) => void;
  single?: boolean;
  title?: string;
}) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | 'all'>('all');
  const [equipment, setEquipment] = useState<Equipment | 'all'>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const list = useFilteredExercises(query, muscle, equipment);
  const workouts = useWorkouts();

  const recentIds = useMemo(() => {
    const ids: string[] = [];
    for (const w of workouts ?? []) {
      for (const id of w.exerciseIds) if (!ids.includes(id)) ids.push(id);
      if (ids.length >= 8) break;
    }
    return ids;
  }, [workouts]);

  const showRecent = !query && muscle === 'all' && equipment === 'all' && recentIds.length > 0;
  const byId = new Map(list.map((e) => [e.id, e]));

  const toggle = (id: string) => {
    if (single) {
      onPick([id]);
      onClose();
      return;
    }
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  if (creating) {
    return (
      <ExerciseForm
        initialName={query}
        onClose={() => setCreating(false)}
        onSaved={(id) => {
          setCreating(false);
          toggle(id);
        }}
      />
    );
  }

  return (
    <Sheet
      full
      title={title}
      onClose={onClose}
      headerRight={
        <button className="btn ghost" onClick={() => setCreating(true)}>
          Create
        </button>
      }
      footer={
        !single && (
          <button
            className="btn primary block"
            disabled={selected.length === 0}
            onClick={() => {
              onPick(selected);
              onClose();
            }}
          >
            {selected.length ? `Add ${selected.length} exercise${selected.length > 1 ? 's' : ''}` : 'Select exercises'}
          </button>
        )
      }
    >
      <div className="search">
        <IconSearch size={18} />
        <input className="input" placeholder="Search exercise" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus={false} />
      </div>
      <FilterChips muscle={muscle} setMuscle={setMuscle} equipment={equipment} setEquipment={setEquipment} />

      {showRecent && (
        <>
          <div className="section-title">Recent</div>
          <div className="list">
            {recentIds
              .map((id) => byId.get(id))
              .filter((e): e is Exercise => !!e)
              .map((e) => (
                <ExerciseRow key={'r' + e.id} ex={e} selected={selected.includes(e.id)} onClick={() => toggle(e.id)} />
              ))}
          </div>
        </>
      )}
      <div className="section-title">{showRecent ? 'All exercises' : `${list.length} exercises`}</div>
      {list.length === 0 ? (
        <div className="empty">
          <p>No exercises found.</p>
          <button className="btn primary" onClick={() => setCreating(true)}>
            <IconPlus size={18} /> Create “{query || 'custom exercise'}”
          </button>
        </div>
      ) : (
        <div className="list">
          {list.map((e) => (
            <ExerciseRow key={e.id} ex={e} selected={selected.includes(e.id)} onClick={() => toggle(e.id)} />
          ))}
        </div>
      )}
    </Sheet>
  );
}
