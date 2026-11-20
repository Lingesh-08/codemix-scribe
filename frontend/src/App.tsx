import { useState } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { getUser, setUser, type User } from "./api";
import Login from "./pages/Login";
import Live from "./pages/Live";
import Upload from "./pages/Upload";
import History from "./pages/History";
import Settings from "./pages/Settings";
import HealthBadge from "./components/HealthBadge";
import Icon, { Logo, type IconName } from "./components/Icon";

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: "/live", label: "Live", icon: "mic" },
  { to: "/upload", label: "Upload", icon: "upload" },
  { to: "/history", label: "History", icon: "history" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

export default function App() {
  const [user, setUserState] = useState<User | null>(getUser());
  const navigate = useNavigate();

  const onLogin = (u: User) => {
    setUser(u);
    setUserState(u);
    navigate("/live");
  };
  const logout = () => {
    setUser(null);
    setUserState(null);
    navigate("/login");
  };

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLogin={onLogin} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const initials = (user.name || user.email).split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="min-h-full md:flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-slate-950 text-slate-300">
        <div className="flex items-center gap-3 px-6 h-16">
          <Logo className="w-8 h-8" />
          <div>
            <div className="text-white font-bold tracking-tight leading-none">CodeMix Scribe</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Code-mixed speech to text</div>
          </div>
        </div>

        <nav className="flex-1 px-3 mt-4 space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon name={n.icon} className={`w-5 h-5 ${isActive ? "text-indigo-400" : "text-slate-500 group-hover:text-slate-300"}`} />
                  {n.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 pb-3 space-y-3">
          <HealthBadge />
          <div className="flex items-center gap-3 rounded-2xl px-3 py-2.5">
            <div className="grid place-items-center w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white text-sm font-semibold">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-white">{user.name}</div>
              <div className="truncate text-xs text-slate-500">{user.email}</div>
            </div>
            <button onClick={logout} title="Log out" className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white">
              <Icon name="logout" className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Top bar (mobile) */}
      <header className="md:hidden sticky top-0 z-10 bg-slate-950 text-slate-300">
        <div className="flex items-center gap-3 px-4 h-14">
          <Logo className="w-7 h-7" />
          <span className="text-white font-bold">CodeMix Scribe</span>
          <div className="ml-auto flex items-center gap-3">
            <HealthBadge compact />
            <button onClick={logout} title="Log out" className="p-1.5 text-slate-400 hover:text-white">
              <Icon name="logout" className="w-5 h-5" />
            </button>
          </div>
        </div>
        <nav className="flex px-2 pb-2 gap-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] font-medium ${isActive ? "bg-white/10 text-white" : "text-slate-400"}`
              }
            >
              <Icon name={n.icon} className="w-5 h-5" />
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="flex-1 md:pl-64 min-w-0">
        <div className="mx-auto max-w-6xl px-4 sm:px-8 py-8">
          <Routes>
            <Route path="/live" element={<Live token={user.token} />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/history" element={<History />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/live" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
