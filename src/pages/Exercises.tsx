import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Equipment, MuscleGroup } from '../db/types';
import { ExerciseRow, FilterChips, useFilteredExercises } from '../components/ExercisePicker';
import { ExerciseForm } from '../components/ExerciseForm';
import { IconChevron, IconPlus, IconSearch } from '../components/Icons';

export default function Exercises() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | 'all'>('all');
  const [equipment, setEquipment] = useState<Equipment | 'all'>('all');
  const [creating, setCreating] = useState(false);
  const list = useFilteredExercises(query, muscle, equipment);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="title">Exercises</h1>
        <button className="btn primary sm" onClick={() => setCreating(true)}>
          <IconPlus size={18} /> Custom
        </button>
      </div>
      <div className="search">
        <IconSearch size={18} />
        <input className="input" placeholder="Search exercise" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <FilterChips muscle={muscle} setMuscle={setMuscle} equipment={equipment} setEquipment={setEquipment} />
      <div className="section-title">{list.length} exercises</div>
      <div className="list">
        {list.map((e) => (
          <ExerciseRow key={e.id} ex={e} onClick={() => navigate(`/exercises/${e.id}`)} right={<IconChevron size={18} className="faint" />} />
        ))}
      </div>
      {creating && <ExerciseForm initialName={query} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/exercises/${id}`)} />}
    </div>
  );
}
