import { BookOpen, Library, LogOut, MessageSquare, Settings as SettingsIcon } from 'lucide-react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Chat } from './pages/Chat';
import { KnowledgeBases } from './pages/KnowledgeBases';
import { Library as LibraryPage } from './pages/Library';
import { Login } from './pages/Login';
import { Settings } from './pages/Settings';

const NAV = [
  { to: '/knowledge-bases', label: 'Knowledge Bases', Icon: BookOpen },
  { to: '/chat', label: 'Chat', Icon: MessageSquare },
  { to: '/library', label: 'Library', Icon: Library },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
];

function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const token = localStorage.getItem('access_token');
  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const isLoginPage = location.pathname === '/login';

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex h-screen flex-col bg-[var(--dm-surface)] font-body">
      {/* Top nav — hidden on login page */}
      {!isLoginPage && (
        <header className="flex items-center gap-6 border-b border-slate-200 bg-white px-6 py-3 shadow-sm">
          <span className="text-xl font-semibold text-[var(--dm-primary)]">DocuMind</span>
          <nav className="flex flex-1 gap-1" aria-label="Main navigation">
            {NAV.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-blue-50 text-[var(--dm-primary)] shadow-sm'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-all"
            aria-label="Log out"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </header>
      )}

      {/* Page content */}
      <div className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Navigate to="/knowledge-bases" replace />} />
          <Route path="/knowledge-bases" element={<RequireAuth><KnowledgeBases /></RequireAuth>} />
          <Route path="/chat" element={<RequireAuth><Chat /></RequireAuth>} />
          <Route path="/library" element={<RequireAuth><LibraryPage /></RequireAuth>} />
          <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
        </Routes>
      </div>
    </div>
  );
}
