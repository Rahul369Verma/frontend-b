import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Key, Bell, RefreshCw, Trash2, CheckCircle, AlertTriangle, Cookie, Save } from 'lucide-react';
import { API_URL } from '../config/api.js';
import { useConfirm } from '../components/confirmContext.js';


export default function Settings() {
  const confirm = useConfirm();
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
      const data = res.data;
      // Flatten strategy_params for easier access
      if (data.strategy_params) {
        Object.assign(data, data.strategy_params);
      }
      setConfig(data);
    } catch (err) {
      console.error("Failed to fetch config", err);
      setMessage({ type: 'error', text: 'Failed to load settings. Backend might be down.' });
    } finally {
      setLoading(false);
    }
  };

  const handleHeadlessLogin = async () => {
    setLoading(true);
    setMessage({ type: 'info', text: 'Generating token via TOTP... this may take 10-15 seconds.' });
    try {
      await axios.post(`${API_URL}/auth/fyers/headless`);
      setMessage({ type: 'success', text: 'Token generated successfully via TOTP!' });
      fetchConfig();
    } catch (err) {
      setMessage({ type: 'error', text: 'TOTP login failed: ' + (err.response?.data?.error || err.message) });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteToken = async () => {
    if (!await confirm({ title: 'Delete Fyers token', body: "Delete Fyers token? You will need to re-login.", danger: true, confirmLabel: 'Delete Fyers token' })) return;
    setLoading(true);
    setMessage(null);
    try {
      await axios.post(`${API_URL}/auth/fyers/delete-token`);
      setMessage({ type: 'success', text: 'Token deleted. Please re-login.' });
      fetchConfig();
    } catch {
      setMessage({ type: 'error', text: 'Failed to delete token.' });
    } finally {
      setLoading(false);
    }
  };

  const handleTestNotification = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await axios.post(`${API_URL}/notifications/test`);
      setMessage({ type: 'success', text: 'Test notification sent!' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to send notification.' });
    } finally {
      setLoading(false);
    }
  };

  // ── AI Web Cookies state ─────────────────────────────────────────────
  // Global single-source-of-truth for Claude.ai + Gemini web-session cookies.
  // Replaces the per-strategy copies that used to live in SymbolConfig.params.
  // Browser never receives raw saved values back — only metadata (set/last4/updatedAt).
  const [cookieMeta, setCookieMeta] = useState(null);
  const [cookieDraft, setCookieDraft] = useState({
    claude_web_session_key: '',
    claude_web_org_id: '',
    gemini_web_psid: '',
    gemini_web_psidts: '',
    gemini_web_psidcc: '',
  });
  const [cookieSaving, setCookieSaving] = useState(false);

  const fetchCookieMeta = async () => {
    try {
      const r = await axios.get(`${API_URL}/settings/ai-cookies`);
      setCookieMeta(r.data);
    } catch (err) {
      console.error('Failed to fetch cookie metadata', err);
    }
  };

  useEffect(() => { fetchCookieMeta(); }, []);

  const handleSaveCookies = async () => {
    // Only send fields the user actually filled in this session — empty = "leave alone".
    const payload = {};
    for (const k of Object.keys(cookieDraft)) {
      if (cookieDraft[k] && cookieDraft[k].trim()) payload[k] = cookieDraft[k].trim();
    }
    if (Object.keys(payload).length === 0) {
      setMessage({ type: 'error', text: 'Nothing to save — paste at least one cookie value.' });
      return;
    }
    setCookieSaving(true);
    setMessage(null);
    try {
      const r = await axios.put(`${API_URL}/settings/ai-cookies`, payload);
      setMessage({
        type: 'success',
        text: `Cookies saved. Wiped ${r.data?.wiped_strategy_copies ?? 0} stale per-strategy copies.`,
      });
      setCookieDraft({ claude_web_session_key: '', claude_web_org_id: '', gemini_web_psid: '', gemini_web_psidts: '', gemini_web_psidcc: '' });
      fetchCookieMeta();
    } catch (err) {
      setMessage({ type: 'error', text: 'Save failed: ' + (err.response?.data?.error || err.message) });
    } finally {
      setCookieSaving(false);
    }
  };

  const tabs = [
    { id: 'api', label: 'API Configuration', icon: Key },
    { id: 'cookies', label: 'AI Web Cookies', icon: Cookie },
    { id: 'notifications', label: 'Notifications', icon: Bell },
  ];

  return (
    <div className="p-8 space-y-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-fg">Settings</h1>

      {message && (
        <div className={`p-4 rounded-lg flex items-center gap-2 ${
          message.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
          message.type === 'info'    ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                                       'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
          {message.text}
        </div>
      )}

      <div className="bg-surface rounded-xl border border-line overflow-hidden">
        <div className="flex border-b border-line">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-6 py-4 font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-primary/10 text-primary-ink border-b-2 border-primary'
                  : 'text-fg-4 hover:text-fg hover:bg-slate-800'
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
              {/* General Configuration */}
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-fg flex items-center gap-2">
                   <div className="w-2 h-8 bg-purple-500 rounded-full"></div>
                   General Configuration
                </h3>
                <div className="p-4 bg-slate-900/50 rounded-lg border border-line flex items-center justify-between">
                     <div>
                        <h4 className="text-fg font-medium">Live Data Source</h4>
                        <p className="text-sm text-fg-4">Select the price source for analysis (Spot vs Futures).</p>
                     </div>
                     <select 
                        value={config?.dataSource || 'SPOT'}
                        onChange={async (e) => {
                             try {
                                 const newVal = e.target.value;
                                 await axios.post(`${API_URL}/settings`, { dataSource: newVal }); // Ensure /settings endpoint handles partial updates
                                 setConfig(prev => ({ ...prev, dataSource: newVal }));
                                 setMessage({ type: 'success', text: `Data Source set to ${newVal}` });
                             } catch {
                                 setMessage({ type: 'error', text: 'Failed to update Data Source' });
                             }
                        }}
                        className="bg-slate-800 text-fg border border-line-2 rounded px-3 py-2 focus:outline-none focus:border-primary"
                     >
                        <option value="SPOT">Spot Price (Index)</option>
                        <option value="FUTURES">Futures Price (Current Month)</option>
                     </select>
                </div>
                <div className="p-4 bg-slate-900/50 rounded-lg border border-line flex items-center justify-between">
                     <div>
                        <h4 className="text-fg font-medium">Max Daily Loss (₹)</h4>
                        <p className="text-sm text-fg-4">Circuit breaker: blocks new entries when daily loss hits this limit.</p>
                     </div>
                     <div className="flex items-center gap-2">
                        <span className="text-fg-4 text-sm">₹</span>
                        <input
                           type="number"
                           min="0"
                           step="100"
                           value={config?.max_daily_loss ?? 2000}
                           onChange={(e) => setConfig(prev => ({ ...prev, max_daily_loss: Number(e.target.value) }))}
                           onBlur={async (e) => {
                              try {
                                 const newVal = Number(e.target.value);
                                 await axios.post(`${API_URL}/settings`, { max_daily_loss: newVal });
                                 setMessage({ type: 'success', text: `Max Daily Loss set to ₹${newVal}` });
                              } catch {
                                 setMessage({ type: 'error', text: 'Failed to update Max Daily Loss' });
                              }
                           }}
                           className="w-28 bg-slate-800 text-fg border border-line-2 rounded px-3 py-2 focus:outline-none focus:border-primary text-right"
                        />
                     </div>
                </div>
              </div>

              <hr className="border-line" />

              {/* Fyers Section */}
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-fg flex items-center gap-2">
                  <div className="w-2 h-8 bg-blue-500 rounded-full"></div>
                  Fyers API Settings
                </h3>
                <div className="grid gap-4 p-4 bg-slate-900/50 rounded-lg border border-line">
                  <div>
                    <label className="block text-sm font-medium text-fg-4 mb-1">App ID</label>
                    <div className="font-mono text-fg bg-slate-800 p-2 rounded border border-line">
                      {config?.fyers_app_id || '7IO8E****-200'}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-fg-4 mb-1">Redirect URL</label>
                    <div className="font-mono text-fg bg-slate-800 p-2 rounded border border-line truncate">
                      {config?.fyers_redirect_url || 'https://wilburn-cuplike-bleatingly.ngrok-free.dev/'}
                    </div>
                    <p className="text-xs text-yellow-400 mt-1">Ensure this matches exactly in Fyers Dashboard.</p>
                  </div>
                  
                  <div className="flex items-center gap-2 mt-2">
                    <div className={`w-3 h-3 rounded-full ${config?.fyers_connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <span className="text-sm text-fg-3">
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
                      } catch {
                        setMessage({ type: 'error', text: 'Failed to get login URL' });
                      }
                    }}
                    disabled={loading}
                    className="flex-1 bg-primary hover:bg-red-600 text-white py-2 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <Key className="w-4 h-4" />
                    {config?.fyers_connected ? 'Re-Login (Browser)' : 'Login to Fyers'}
                  </button>
                  <button
                    onClick={handleHeadlessLogin}
                    disabled={loading}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-fg py-2 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    Auto Login (TOTP)
                  </button>
                  <button
                    onClick={handleDeleteToken}
                    disabled={loading}
                    className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 py-2 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Token
                  </button>
                </div>
              </div>

              <hr className="border-line" />

              {/* Angel Section */}
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-fg flex items-center gap-2">
                  <div className="w-2 h-8 bg-orange-500 rounded-full"></div>
                  Angel One Settings
                </h3>
                <div className="grid gap-4 p-4 bg-slate-900/50 rounded-lg border border-line">
                   <div>
                    <label className="block text-sm font-medium text-fg-4 mb-1">API Key</label>
                    <div className="font-mono text-fg bg-slate-800 p-2 rounded border border-line">
                      MbQS****
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <div className={`w-3 h-3 rounded-full ${config?.angel_connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <span className="text-sm text-fg-3">
                      {config?.angel_connected ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                </div>
              </div>

              <hr className="border-line" />

              {/* MCX Section */}
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-fg flex items-center gap-2">
                  <div className="w-2 h-8 bg-yellow-500 rounded-full"></div>
                  Commodities (MCX)
                </h3>
                <div className="p-4 bg-slate-900/50 rounded-lg border border-line flex items-center justify-between">
                  <div>
                    <h4 className="text-fg font-medium">Enable MCX Trading</h4>
                    <p className="text-sm text-fg-4">Allow the bot to trade Gold, Silver, and Crude Oil Futures.</p>
                  </div>
                  
                  <button 
                    onClick={async () => {
                      try {
                        const newValue = !config?.mcx_enabled;
                        await axios.post(`${API_URL}/settings`, { mcx_enabled: newValue }); // Fixed endpoint
                        setConfig(prev => ({ ...prev, mcx_enabled: newValue }));
                        setMessage({ type: 'success', text: `MCX Trading ${newValue ? 'Enabled' : 'Disabled'}` });
                      } catch (err) {
                        console.error("MCX Toggle Error:", err);
                        setMessage({ type: 'error', text: 'Failed to update setting' });
                      }
                    }}
                    className={`relative w-14 h-7 rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
                      config?.mcx_enabled ? 'bg-green-500' : 'bg-slate-700'
                    }`}
                  >
                    {/* The knob stays white (knobs are white in light UIs too) but needs the
                        gray-300 hairline that the app's <input peer> switches carry: without it
                        the face is only 1.3-1.8:1 against the off-track on the light themes.
                        With it, the ring does the delineating there (4.4-6.3:1) and the face
                        does it on the dark themes (7.5-10.4:1). */}
                    <span
                      className={`block w-5 h-5 bg-white border border-gray-300 rounded-full shadow transform transition-transform duration-200 ease-in-out ${
                        config?.mcx_enabled ? 'translate-x-8' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'cookies' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-bold text-fg flex items-center gap-2">
                  <div className="w-2 h-8 bg-amber-500 rounded-full"></div>
                  AI Web Cookies (Global)
                </h3>
                <p className="text-sm text-fg-4 mt-2">
                  Update Claude.ai and Gemini web-session cookies in ONE place. Every backtest
                  and every deployed live strategy reads from here — you no longer need to
                  paste cookies per-strategy. Saving wipes stale per-strategy copies automatically.
                </p>
              </div>

              {/* Current state summary */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  { key: 'claude_web_session_key', label: 'Claude sessionKey', vendor: 'claude' },
                  { key: 'claude_web_org_id',      label: 'Claude org_id',     vendor: 'claude' },
                  { key: 'gemini_web_psid',        label: 'Gemini __Secure-1PSID',   vendor: 'gemini' },
                  { key: 'gemini_web_psidts',      label: 'Gemini __Secure-1PSIDTS', vendor: 'gemini' },
                  { key: 'gemini_web_psidcc',      label: 'Gemini __Secure-1PSIDCC (optional)', vendor: 'gemini' },
                ].map(({ key, label, vendor }) => {
                  const m = cookieMeta?.[key];
                  const isSet = !!m?.set;
                  const optional = key === 'claude_web_org_id' || key === 'gemini_web_psidcc';
                  return (
                    <div key={key} className={`p-3 rounded-lg border ${isSet ? 'border-line bg-slate-900/40' : optional ? 'border-line-0 bg-slate-900/20' : 'border-amber-500/30 bg-amber-500/5'}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-fg-4 font-medium">{label}</span>
                        <span className={`text-3xs px-2 py-0.5 rounded-full ${isSet ? 'bg-green-500/20 text-green-400' : optional ? 'bg-slate-700 text-fg-4' : 'bg-amber-500/20 text-amber-400'}`}>
                          {isSet ? 'set' : optional ? 'optional' : '⚠ missing'}
                        </span>
                      </div>
                      <div className="font-mono text-sm text-fg mt-1">
                        {isSet ? <>…{m.last4} <span className="text-fg-5 text-xs">({vendor})</span></> : <span className="text-fg-6">—</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              {cookieMeta?.updatedAt && (
                <div className="text-xs text-fg-5">
                  Last updated: {new Date(cookieMeta.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                </div>
              )}

              <hr className="border-line" />

              {/* Edit form — paste in new values; leave blank to keep existing */}
              <div className="space-y-4">
                <h4 className="text-fg font-semibold">Update cookies</h4>
                <p className="text-xs text-fg-5">
                  Paste fresh values from <code className="text-fg-3">claude.ai</code> or
                  <code className="text-fg-3"> gemini.google.com</code> (DevTools → Application → Cookies).
                  Leave any field empty to keep its current saved value.
                </p>

                {/* Claude */}
                <div className="p-4 bg-slate-900/50 rounded-lg border border-line space-y-3">
                  <div className="text-orange-400 font-medium text-sm">🟠 Claude.ai</div>
                  <div>
                    <label htmlFor="settings-sessionkey-1" className="block text-xs text-fg-4 mb-1">sessionKey</label>
                    <input id="settings-sessionkey-1"
                      type="text"
                      autoComplete="off"
                      value={cookieDraft.claude_web_session_key}
                      onChange={e => setCookieDraft({ ...cookieDraft, claude_web_session_key: e.target.value })}
                      placeholder="sk-ant-sid01-…"
                      className="w-full bg-slate-800 text-fg border border-line-2 rounded px-3 py-2 font-mono text-xs focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label htmlFor="settings-org-id-optional-auto-detecte-2" className="block text-xs text-fg-4 mb-1">org_id (optional — auto-detected if blank)</label>
                    <input id="settings-org-id-optional-auto-detecte-2"
                      type="text"
                      autoComplete="off"
                      value={cookieDraft.claude_web_org_id}
                      onChange={e => setCookieDraft({ ...cookieDraft, claude_web_org_id: e.target.value })}
                      placeholder="UUID, e.g. abcdef12-3456-…"
                      className="w-full bg-slate-800 text-fg border border-line-2 rounded px-3 py-2 font-mono text-xs focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>

                {/* Gemini */}
                <div className="p-4 bg-slate-900/50 rounded-lg border border-line space-y-3">
                  <div className="text-cyan-400 font-medium text-sm">🔵 Gemini (gemini.google.com)</div>
                  <div>
                    <label htmlFor="settings-secure-1psid-3" className="block text-xs text-fg-4 mb-1">__Secure-1PSID</label>
                    <input id="settings-secure-1psid-3"
                      type="text"
                      autoComplete="off"
                      value={cookieDraft.gemini_web_psid}
                      onChange={e => setCookieDraft({ ...cookieDraft, gemini_web_psid: e.target.value })}
                      placeholder="g.a000…"
                      className="w-full bg-slate-800 text-fg border border-line-2 rounded px-3 py-2 font-mono text-xs focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label htmlFor="settings-secure-1psidts-4" className="block text-xs text-fg-4 mb-1">__Secure-1PSIDTS</label>
                    <input id="settings-secure-1psidts-4"
                      type="text"
                      autoComplete="off"
                      value={cookieDraft.gemini_web_psidts}
                      onChange={e => setCookieDraft({ ...cookieDraft, gemini_web_psidts: e.target.value })}
                      placeholder="sidts-…"
                      className="w-full bg-slate-800 text-fg border border-line-2 rounded px-3 py-2 font-mono text-xs focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label htmlFor="settings-secure-1psidcc-optional-5" className="block text-xs text-fg-4 mb-1">__Secure-1PSIDCC (optional)</label>
                    <input id="settings-secure-1psidcc-optional-5"
                      type="text"
                      autoComplete="off"
                      value={cookieDraft.gemini_web_psidcc}
                      onChange={e => setCookieDraft({ ...cookieDraft, gemini_web_psidcc: e.target.value })}
                      placeholder="ABjs…"
                      className="w-full bg-slate-800 text-fg border border-line-2 rounded px-3 py-2 font-mono text-xs focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>

                <button
                  onClick={handleSaveCookies}
                  disabled={cookieSaving}
                  className="bg-primary hover:bg-red-600 text-white px-6 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {cookieSaving ? 'Saving…' : 'Save Cookies'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
             <div className="space-y-6">
                <h3 className="text-xl font-bold text-fg">Telegram Notifications</h3>
                <div className="p-4 bg-slate-900/50 rounded-lg border border-line space-y-4">
                    <p className="text-fg-4 text-sm">Send a test message to verify your Telegram bot integration.</p>
                    <button 
                        onClick={handleTestNotification}
                        disabled={loading}
                        className="bg-primary hover:bg-blue-600 text-white px-4 py-2 rounded flex items-center gap-2 disabled:opacity-50"
                    >
                        <Bell className="w-4 h-4" /> 
                        {loading ? 'Sending...' : 'Send Test Notification'}
                    </button>
                </div>
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
