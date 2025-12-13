import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, LineChart, Settings, Activity, Play, Square, Terminal } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Backtest from './pages/Backtest';
import Optimizer from './pages/Optimizer';
import SettingsPage from './pages/Settings';
import Callback from './pages/Callback';

function Sidebar() {
  const location = useLocation();
  const isActive = (path) => location.pathname === path;

  const navItems = [
    { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/backtest', icon: LineChart, label: 'Backtest' },
    { path: '/optimizer', icon: Activity, label: 'Optimizer' },
    { path: '/settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="w-64 bg-surface border-r border-slate-700 h-screen flex flex-col">
      <div className="p-6 border-b border-slate-700">
        <h1 className="text-xl font-bold text-primary flex items-center gap-2">
          <Terminal className="w-6 h-6" />
          AlgoBot
        </h1>
      </div>
      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
              isActive(item.path)
                ? 'bg-primary/10 text-primary'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <item.icon className="w-5 h-5" />
            <span className="font-medium">{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className="p-4 border-t border-slate-700">
        <div className="flex items-center gap-3 px-4 py-2 text-sm text-slate-400">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          System Online
        </div>
      </div>
    </div>
  );
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
    <GlobalProvider>
      <Router>
        <div className="flex min-h-screen bg-background text-white font-sans">
          <Sidebar />
          <main className="flex-1 overflow-auto">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/backtest" element={<Backtest />} />
              <Route path="/optimizer" element={<Optimizer />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/callback" element={<Callback />} />
            </Routes>
          </main>
        </div>
      </Router>
    </GlobalProvider>
  );
}

export default App;
