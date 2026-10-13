import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useActive, useNow, useToastHost } from './lib/hooks';
import { fmtDuration } from './lib/units';
import { IconDumbbell, IconHistory, IconHome, IconList, IconUser } from './components/Icons';
import Home from './pages/Home';
import History from './pages/History';
import WorkoutDetail from './pages/WorkoutDetail';
import WorkoutLogger from './pages/WorkoutLogger';
import Routines from './pages/Routines';
import RoutineEditor from './pages/RoutineEditor';
import Exercises from './pages/Exercises';
import ExerciseDetail from './pages/ExerciseDetail';
import Profile from './pages/Profile';

const TABS = [
  { to: '/', label: 'Today', icon: IconHome, end: true },
  { to: '/history', label: 'History', icon: IconHistory },
  { to: '/routines', label: 'Routines', icon: IconList },
  { to: '/exercises', label: 'Exercises', icon: IconDumbbell },
  { to: '/profile', label: 'Profile', icon: IconUser },
];

function ResumeBar() {
  const active = useActive();
  const now = useNow(1000);
  const navigate = useNavigate();
  if (!active) return null;
  return (
    <div className="resume-bar">
      <div>
        <button onClick={() => navigate('/workout')}>
          <span className="ellipsis" style={{ flex: 1, textAlign: 'left' }}>
            {active.editingId != null ? 'Editing: ' : ''}
            {active.title}
          </span>
          {active.editingId == null && <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtDuration((now - active.startTime) / 1000)}</span>}
          <span>Resume ›</span>
        </button>
      </div>
    </div>
  );
}

function Shell() {
  const location = useLocation();
  const toast = useToastHost();
  const hideTabs = location.pathname === '/workout' || location.pathname.startsWith('/routines/');
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/workout" element={<WorkoutLogger />} />
        <Route path="/history" element={<History />} />
        <Route path="/history/:id" element={<WorkoutDetail />} />
        <Route path="/routines" element={<Routines />} />
        <Route path="/routines/:id" element={<RoutineEditor />} />
        <Route path="/exercises" element={<Exercises />} />
        <Route path="/exercises/:id" element={<ExerciseDetail />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="*" element={<Home />} />
      </Routes>
      {!hideTabs && (
        <>
          <ResumeBar />
          <div className="tabbar">
            <nav>
              {TABS.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
                  <Icon size={22} />
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
        </>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
