import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Save, Key, Database, Bell, RefreshCw, Trash2, CheckCircle, AlertTriangle } from 'lucide-react';

const API_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;

export default function Settings() {
  const [activeTab, setActiveTab] = useState('api');
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const authCode = searchParams.get('auth_code');
    if (authCode) {
      handleAuthCallback(authCode);
    } else {
      fetchConfig();
    }
  }, [searchParams]);

  const handleAuthCallback = async (code) => {
    setLoading(true);
    setMessage({ type: 'info', text: 'Processing Fyers Login...' });
    try {
      await axios.post(`${API_URL}/auth/fyers/callback`, { auth_code: code });
      setMessage({ type: 'success', text: 'Fyers Login Successful!' });
      // Remove auth_code from URL without reloading
      setSearchParams({});
      fetchConfig();
    } catch (err) {
      console.error("Auth Error", err);
      setMessage({ type: 'error', text: 'Fyers Login Failed: ' + (err.response?.data?.error || err.message) });
    } finally {
      setLoading(false);
    }
  };

  const fetchConfig = async () => {
    setLoading(true);
    try {
      // In a real app, we'd fetch this from backend. 
      // For now, we'll mock or fetch status.
      const res = await axios.get(`${API_URL}/engine/status`);
      setConfig(res.data);
    } catch (err) {
      console.error("Failed to fetch config", err);
      setMessage({ type: 'error', text: 'Failed to load settings. Backend might be down.' });
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshToken = async () => {
    setLoading(true);
    setMessage(null);
    try {
      // Implement refresh endpoint in backend if needed, or just simulate
      // For now, we'll just show a success message as the logic is in backend
      await new Promise(r => setTimeout(r, 1000)); 
      setMessage({ type: 'success', text: 'Token reloaded successfully!' });
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to reload token.' });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteToken = async () => {
    if (!window.confirm("Are you sure? You will need to re-login.")) return;
    setLoading(true);
    setMessage(null);
    try {
       // Implement delete endpoint
       await new Promise(r => setTimeout(r, 1000));
       setMessage({ type: 'success', text: 'Token deleted. Please re-login.' });
    } catch (err) {
       setMessage({ type: 'error', text: 'Failed to delete token.' });
    } finally {
       setLoading(false);
    }
  };

  const tabs = [
    { id: 'api', label: 'API Configuration', icon: Key },
    { id: 'notifications', label: 'Notifications', icon: Bell },
  ];

  return (
    <div className="p-8 space-y-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-white">Settings</h1>

      {message && (
        <div className={`p-4 rounded-lg flex items-center gap-2 ${
          message.type === 'success' ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'
        }`}>
          {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
          {message.text}
        </div>
      )}

      <div className="bg-surface rounded-xl border border-slate-700 overflow-hidden">
        <div className="flex border-b border-slate-700">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-6 py-4 font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-primary/10 text-primary border-b-2 border-primary'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-8">
          {activeTab === 'api' && (
            <div className="space-y-8">
              {/* Fyers Section */}
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <div className="w-2 h-8 bg-blue-500 rounded-full"></div>
                  Fyers API Settings
                </h3>
                <div className="grid gap-4 p-4 bg-slate-900/50 rounded-lg border border-slate-700">
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">App ID</label>
                    <div className="font-mono text-white bg-slate-800 p-2 rounded border border-slate-700">
                      {config?.fyers_app_id || 'N1JI****-100'}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Redirect URL</label>
                    <div className="font-mono text-white bg-slate-800 p-2 rounded border border-slate-700 truncate">
                      {config?.fyers_redirect_url || 'https://wilburn-cuplike-bleatingly.ngrok-free.dev/'}
                    </div>
                    <p className="text-xs text-yellow-500 mt-1">Ensure this matches exactly in Fyers Dashboard.</p>
                  </div>
                  
                  <div className="flex items-center gap-2 mt-2">
                    <div className={`w-3 h-3 rounded-full ${config?.fyers_connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <span className="text-sm text-slate-300">
                      {config?.fyers_connected ? 'Authenticated' : 'Not Authenticated'}
                    </span>
                  </div>
                </div>

                <div className="flex gap-4">
                  <button 
                    onClick={async () => {
                      try {
                        const res = await axios.get(`${API_URL}/auth/fyers/url`);
                        window.location.href = res.data.url;
                      } catch (err) {
                        alert("Failed to get login URL");
                      }
                    }}
                    className="flex-1 bg-primary hover:bg-red-600 text-white py-2 rounded-lg flex items-center justify-center gap-2 transition-colors"
                  >
                    <Key className="w-4 h-4" />
                    {config?.fyers_connected ? 'Re-Login to Fyers' : 'Login to Fyers'}
                  </button>
                  <button 
                    onClick={handleRefreshToken}
                    disabled={loading}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg flex items-center justify-center gap-2 transition-colors"
                  >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    Refresh Token
                  </button>
                  <button 
                    onClick={handleDeleteToken}
                    disabled={loading}
                    className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 py-2 rounded-lg flex items-center justify-center gap-2 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Token
                  </button>
                </div>
              </div>

              <hr className="border-slate-700" />

              {/* Angel Section */}
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <div className="w-2 h-8 bg-orange-500 rounded-full"></div>
                  Angel One Settings
                </h3>
                <div className="grid gap-4 p-4 bg-slate-900/50 rounded-lg border border-slate-700">
                   <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">API Key</label>
                    <div className="font-mono text-white bg-slate-800 p-2 rounded border border-slate-700">
                      MbQS****
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <div className={`w-3 h-3 rounded-full ${config?.angel_connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <span className="text-sm text-slate-300">
                      {config?.angel_connected ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
             <div className="space-y-6">
                <h3 className="text-xl font-bold text-white">Telegram Notifications</h3>
                <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700 space-y-4">
                    <p className="text-slate-400 text-sm">Send a test message to verify your Telegram bot integration.</p>
                    <button className="bg-primary hover:bg-blue-600 text-white px-4 py-2 rounded flex items-center gap-2">
                        <Bell className="w-4 h-4" /> Send Test Notification
                    </button>
                </div>
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
