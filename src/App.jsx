import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, LineChart, Settings, Activity, Play, Square, Terminal, LogOut, Shield, Zap, PanelLeftClose, PanelLeftOpen, Layers, Gauge } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Backtest from './pages/Backtest';
import Optimizer from './pages/Optimizer';
import SettingsPage from './pages/Settings';
import Callback from './pages/Callback';
import LoginPage from './pages/LoginPage';
import StrategyDetail from './pages/StrategyDetail';
import AiManager from './components/AiManager'; // New Component
import DataManager from './components/DataManager'; // New Component
import ParityAuditDashboard from './components/ParityAuditDashboard';
import TickStrategies from './pages/TickStrategies';
import MultiLeg from './pages/MultiLeg';
import Risk from './pages/Risk';
import { AuthProvider, useAuth } from './context/AuthContext';

function Sidebar() {
  const location = useLocation();
  const isActive = (path) => location.pathname === path;

  // Collapsed state persisted to localStorage so it survives reload.
  // Defaults to COLLAPSED on first visit (no stored preference) to maximise
  // content width; once the user toggles, their choice is remembered.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const v = localStorage.getItem('sidebar:collapsed');
      return v === null ? true : v === '1';
    } catch (_) { return true; }
  });
  const toggle = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('sidebar:collapsed', next ? '1' : '0'); } catch (_) {}
      return next;
    });
  };

  const navItems = [
    { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/backtest', icon: LineChart, label: 'Backtest' },
    { path: '/optimizer', icon: Activity, label: 'Optimizer' },
    { path: '/multi-leg', icon: Layers, label: 'Multi-Leg' },
    { path: '/risk', icon: Gauge, label: 'Portfolio Risk' },
    { path: '/tick-strategies', icon: Zap, label: 'Tick Strategies' },
    { path: '/ai-manager', icon: Terminal, label: 'AI Manager' }, // New Item
    { path: '/parity-audit', icon: Activity, label: 'Parity Audit' },
    { path: '/data-manager', icon: Square, label: 'Data Manager' }, // Archiving
    { path: '/settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <div className={`${collapsed ? 'w-16' : 'w-64'} bg-surface border-r border-slate-700 h-screen flex flex-col transition-[width] duration-200`}>
      <div className="p-4 border-b border-slate-700 flex items-center justify-between gap-2">
        {!collapsed && (
          <h1 className="text-xl font-bold text-primary flex items-center gap-2">
            <Terminal className="w-6 h-6" />
            AlgoBot
          </h1>
        )}
        <button
          onClick={toggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="text-slate-400 hover:text-white hover:bg-slate-800 rounded p-2 transition-colors ml-auto"
        >
          {collapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
        </button>
      </div>
      <nav className={`flex-1 p-4 space-y-2 ${collapsed ? 'overflow-x-hidden' : ''}`}>
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            title={collapsed ? item.label : undefined}
            className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-3 rounded-lg transition-colors ${
              isActive(item.path)
                ? 'bg-primary/10 text-primary'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <item.icon className="w-5 h-5 flex-shrink-0" />
            {!collapsed && <span className="font-medium">{item.label}</span>}
          </Link>
        ))}
      </nav>
      <div className="p-4 border-t border-slate-700 space-y-2">
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3 px-4'} py-2 text-sm text-slate-400`}>
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" title={collapsed ? 'System Online' : undefined} />
          {!collapsed && <span>System Online</span>}
        </div>
        {!collapsed && <SessionFooter />}
      </div>
    </div>
  );
}

/**
 * SessionFooter — small block under the sidebar showing session expiry +
 * a logout button. Only renders when auth is actually on (not 'disabled').
 */
function SessionFooter() {
    const { status, expiresAt, logout } = useAuth();
    if (status !== 'authenticated') return null;
    // Format "in 3 days" / "in 12 hours" / "in 45 min"
    let expiryStr = null;
    if (expiresAt) {
        const ms = new Date(expiresAt).getTime() - Date.now();
        if (ms > 0) {
            const days  = Math.floor(ms / 86400000);
            const hours = Math.floor((ms % 86400000) / 3600000);
            const mins  = Math.floor((ms % 3600000) / 60000);
            if (days > 0)  expiryStr = `${days}d ${hours}h`;
            else if (hours > 0) expiryStr = `${hours}h ${mins}m`;
            else expiryStr = `${mins}m`;
        }
    }
    return (
        <button
            onClick={() => { if (window.confirm('Log out of the dashboard?')) logout(); }}
            className="w-full flex items-center justify-between gap-2 px-4 py-2 text-xs text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded transition"
            title="Log out — clears session cookie"
        >
            <span className="flex items-center gap-2">
                <Shield className="w-3 h-3" />
                {expiryStr ? `Session: ${expiryStr}` : 'Session active'}
            </span>
            <LogOut className="w-3 h-3" />
        </button>
    );
}

/**
 * AuthGate — wraps the routed app. While checking, shows a spinner. If
 * unauthenticated, shows LoginPage. Once authenticated (or when auth is
 * disabled server-side), shows the children.
 */
function AuthGate({ children }) {
    const { status } = useAuth();
    if (status === 'checking') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background text-slate-500 text-sm">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
                    Checking session…
                </div>
            </div>
        );
    }
    if (status === 'unauthenticated') return <LoginPage />;
    // 'authenticated' or 'disabled' → render the app
    return children;
}

import { GlobalProvider } from './context/GlobalContext';

function App() {
  // Handle malformed Fyers redirect (e.g. http://localhost:5173/s=ok&code=...)
  useEffect(() => {
    if (window.location.pathname.startsWith('/s=ok')) {
      const search = window.location.pathname.substring(1); // remove leading /
      // Redirect to settings with query params
      window.location.href = `/settings?${search}`;
    }
  }, []);

  return (
    <AuthProvider>
      <AuthGate>
        <GlobalProvider>
          <Router>
            <div className="flex min-h-screen bg-background text-white font-sans">
              <Sidebar />
              <main className="flex-1 overflow-auto">
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/strategy/:symbol" element={<StrategyDetail />} />
                  <Route path="/backtest" element={<Backtest />} />
                  <Route path="/optimizer" element={<Optimizer />} />
                  <Route path="/multi-leg" element={<MultiLeg />} />
                  <Route path="/risk" element={<Risk />} />
                  <Route path="/tick-strategies" element={<TickStrategies />} />
                  <Route path="/ai-manager" element={<AiManager />} />
                  <Route path="/parity-audit" element={<ParityAuditDashboard />} />
                  <Route path="/data-manager" element={<DataManager />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/callback" element={<Callback />} />
                </Routes>
              </main>
            </div>
          </Router>
        </GlobalProvider>
      </AuthGate>
    </AuthProvider>
  );
}

export default App;
