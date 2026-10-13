import { useState } from 'react';
import { db, newId } from '../db/db';
import type { Equipment, Exercise, ExerciseType, MuscleGroup } from '../db/types';
import { EQUIPMENT_LABELS, MUSCLE_LABELS, TYPE_LABELS } from '../data/exercises';
import { Sheet } from './Sheet';

export function ExerciseForm({
  existing,
  initialName = '',
  onClose,
  onSaved,
}: {
  existing?: Exercise;
  initialName?: string;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const [name, setName] = useState(existing?.name ?? initialName);
  const [muscle, setMuscle] = useState<MuscleGroup>(existing?.muscle ?? 'chest');
  const [equipment, setEquipment] = useState<Equipment>(existing?.equipment ?? 'barbell');
  const [type, setType] = useState<ExerciseType>(existing?.type ?? 'weight_reps');
  const [error, setError] = useState('');

  const save = async () => {
    const n = name.trim();
    if (!n) return setError('Name is required');
    const clash = await db.exercises.filter((e) => e.name.toLowerCase() === n.toLowerCase() && e.id !== existing?.id).first();
    if (clash) return setError('An exercise with this name already exists');
    const ex: Exercise = { id: existing?.id ?? newId('custom-'), name: n, muscle, equipment, type, custom: true };
    await db.exercises.put(ex);
    onSaved?.(ex.id);
    onClose();
  };

  return (
    <Sheet
      title={existing ? 'Edit Exercise' : 'Create Exercise'}
      onClose={onClose}
      footer={
        <button className="btn primary block" onClick={save}>
          Save
        </button>
      }
    >
      <label className="field">
        <span>Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Incline Hammer Curl" />
      </label>
      <label className="field">
        <span>Primary muscle</span>
        <select className="input" value={muscle} onChange={(e) => setMuscle(e.target.value as MuscleGroup)}>
          {Object.entries(MUSCLE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Equipment</span>
        <select className="input" value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment)}>
          {Object.entries(EQUIPMENT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Exercise type</span>
        <select className="input" value={type} onChange={(e) => setType(e.target.value as ExerciseType)}>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
    </Sheet>
  );
}
