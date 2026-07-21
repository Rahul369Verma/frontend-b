// DeploymentsPanel — the single place to see + manage every deployed strategy.
//
// Full feature parity with the old "Active Strategy Configuration" panel
// (which this replaces): filter chips + search, active toggle, PAPER/LIVE
// toggle, +CE/+PE manual trade, Test-in-Backtester, 🧪 Sim, AI Risk Filter
// summary strip (incl. Claude/Gemini web-session health badges), quick-stats
// strip with global-override awareness, and the expandable all-params grid —
// PLUS the multi-deployment features: N strategies per symbol each with its
// own resolution, create-from-saved-config, per-deployment edit/delete.
//
// Data flow:
//   GET  /api/deployments                    → list
//   POST /api/deployments                    → create (saved-config prefill)
//   PUT  /api/deployments/:id                → partial update (params, name)
//   POST /api/deployments/:id/toggle         → on/off (per deployment)
//   POST /api/deployments/:id/toggle-mode    → PAPER/LIVE (per deployment)
//   DELETE /api/deployments/:id              → remove (refuses if open position)
//
// Handlers passed from Dashboard (reuse its modals — no duplicated machinery):
//   onTest(symbol, config)      → navigate to Backtester with params
//   onSim(symbol)               → open the 🧪 signal-simulator modal
//   onManualTrade(type, symbol) → open the +CE/+PE trade modal
//   sessionHealth               → /api/strategies/session-health results
//   globalConfig                → global settings (for max_daily_loss override)

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000') + '/api';

// Fallback list — used only if /api/strategies/registry doesn't respond
// (e.g. old backend image). Mirrors the canonical strategyMapper.STRATEGY_MAP.
const KNOWN_STRATEGIES_FALLBACK = [
    { id: 'mta_ema_crossover', label: 'MTA EMA Crossover' },
    { id: 'vwap_momentum', label: 'VWAP Momentum Scalper' },
    { id: 'bb_reversion', label: 'Bollinger Band Reversion' },
    { id: 'inside_bar', label: 'Inside Bar Breakout' },
    { id: 'false_inside_bar', label: 'False Inside Bar (Fakey)' },
    { id: 'hybrid_inside_bar', label: 'Hybrid Inside Bar + Fakey' },
    { id: 'universal', label: 'Universal / Discovery Mode' },
    { id: 'orb_breakout', label: 'Open Range Breakout (ORB)' },
    { id: 'supertrend_adx', label: 'SuperTrend + ADX Filter' },
    { id: 'ai_filtered', label: 'AI Filtered' },
    { id: 'candlestick_pattern', label: 'Candlestick Pattern (Reversal)' },
    { id: 'breakout_range', label: 'Breakout Range Strategy' },
    { id: 'pos_5ema_scalp', label: 'Power of Stocks 5 EMA Scalp' },
    { id: 'vwap_scalp', label: 'VWAP Rejection Scalp' },
    { id: 'momentum_scalp', label: 'Momentum RSI-EMA Scalp' },
    { id: 'trend_line', label: 'Trend Line Support/Resistance' },
    { id: 'rl_agent', label: 'RL Agent' },
    { id: 'apex_confluence', label: 'Apex Confluence (Pullback + Fade)' },
    { id: 'smc_ob', label: 'Smart Money Concepts (BOS/CHoCH + Order Block)' },
    { id: 'liquidity_sweep', label: 'Liquidity Sweep / Stop-Hunt Reversal' },
    { id: 'wyckoff_spring', label: 'Wyckoff Spring / Upthrust Reversal' },
    { id: 'fib_golden_pocket', label: 'Fibonacci Golden Pocket Pullback' },
    { id: 'quantum_qho', label: 'Quantum QHO Mean-Reversion' },
    { id: 'volume_surge', label: 'Volume Surge (Climax Fade)' },
    { id: 'council_ensemble', label: 'Council Ensemble (Multi-Strategy Vote)' },
    { id: 'rsi2_reversion', label: 'RSI-2 Deep Pullback Reversion (Connors)' },
    { id: 'gap_edge', label: 'Opening Gap Edge (Fade / Follow)' },
    { id: 'intraday_momentum', label: 'Intraday Momentum (Session Persistence)' },
    { id: 'momentum_divergence', label: 'RSI Divergence Reversal' },
    { id: 'open_drive_trend', label: 'Open Drive Trend-Day Rider' },
    { id: 'ichimoku_kumo', label: 'Ichimoku Kumo (Kijun Fade)' },
];

const KNOWN_SYMBOLS = [
    'NSE:NIFTY50-INDEX', 'NSE:NIFTYBANK-INDEX', 'NSE:FINNIFTY-INDEX',
    'NSE:MIDCPNIFTY-INDEX', 'BSE:SENSEX-INDEX',
];

const RESOLUTIONS = ['1', '3', '5', '15', '30', '60'];

// AI-related param keys rendered in the summary strip — skipped in the
// all-params grid to avoid duplication. Same list the legacy panel used.
const AI_PARAM_KEYS = [
    'enable_ai_confirmation', 'use_ai_confirmation', 'ai_follow_sl_tp', 'ai_follow_sl', 'ai_follow_tp',
    'ai_confidence_threshold', 'ai_models', 'ai_follow_strategy_exits', 'ai_concurrency',
    'use_claude_web_session', 'claude_web_session_key', 'claude_web_org_id', 'claude_web_model', 'claude_web_batch_size',
    'use_gemini_web_session', 'gemini_web_psid', 'gemini_web_psidts', 'gemini_web_psidcc', 'gemini_web_model', 'gemini_web_batch_size',
    'claude_thinking_enabled', 'claude_thinking_budget',
    'ai_fail_closed', 'ai_use_spot_exits', 'ai_sl_safety_buffer',
    'use_ai_fair_entry', 'enable_mastra_validator',
];

function _normalizeStrategies(list) {
    if (!Array.isArray(list)) return KNOWN_STRATEGIES_FALLBACK;
    return list.map(s => typeof s === 'string' ? { id: s, label: s } : { id: s.id, label: s.label || s.id });
}

function strategyLabel(strategies, id) {
    const hit = (strategies || []).find(s => s.id === id);
    return hit?.label || id || '—';
}

// Compact human date for the deployed/updated timestamps, e.g. "13 Jun 2026, 23:31".
// Returns null for missing/invalid values so callers can skip rendering.
function fmtDate(v) {
    if (!v) return null;
    const dt = new Date(v);
    if (isNaN(dt.getTime())) return null;
    return dt.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
    });
}

export default function DeploymentsPanel({ onTest, onSim, onManualTrade, sessionHealth, globalConfig }) {
    const navigate = useNavigate();
    // Open the analytics view (equity curve / calendar / trades / distribution)
    // scoped to this deployment. Carries deploymentId + strategy + label in the
    // query so StrategyDetail can filter to it (with symbol-level fallback).
    const openResults = (d) => {
        const qs = new URLSearchParams({
            deploymentId: d._id,
            strategyName: d.strategyName || '',
            label: d.name || '',
        }).toString();
        navigate(`/strategy/${encodeURIComponent(d.symbol)}?${qs}`);
    };
    const [deployments, setDeployments] = useState([]);
    const [strategies, setStrategies] = useState(KNOWN_STRATEGIES_FALLBACK);
    const [savedConfigs, setSavedConfigs] = useState([]); // SavedStrategy docs (backtest "Save Config")
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [showCreate, setShowCreate] = useState(false);
    const [createDefaults, setCreateDefaults] = useState(null); // {symbol} prefill
    const [editingId, setEditingId] = useState(null);
    const [busyId, setBusyId] = useState(null);           // deploymentId mid-mutation
    const [expanded, setExpanded] = useState({});         // { [deploymentId]: bool } params grid
    const [modeFilter, setModeFilter] = useState('all');  // all | live | paper | inactive
    const [search, setSearch] = useState('');
    // Whole-panel accordion. Persisted so the user's fold choice survives reload.
    // Defaults OPEN — this is the primary management surface.
    const [panelOpen, setPanelOpen] = useState(() => {
        try { const v = localStorage.getItem('dash:deploymentsOpen'); return v === null ? true : v === '1'; }
        catch (_) { return true; }
    });
    const togglePanel = () => setPanelOpen(prev => {
        const next = !prev;
        try { localStorage.setItem('dash:deploymentsOpen', next ? '1' : '0'); } catch (_) {}
        return next;
    });

    // Fetch the live strategy registry + the user's saved backtest configs
    // once on mount. The saved configs power "Start from Saved Config" in the
    // create modal — the primary flow: tune in Backtest → Save → deploy here.
    useEffect(() => {
        let cancelled = false;
        axios.get(`${API_URL}/strategies/registry`)
            .then(res => {
                if (cancelled) return;
                const list = _normalizeStrategies(res.data?.strategies);
                if (list && list.length) setStrategies(list);
            })
            .catch(() => { /* fallback already loaded */ });
        axios.get(`${API_URL}/config/strategies/saved`)
            .then(res => {
                if (cancelled) return;
                if (Array.isArray(res.data)) setSavedConfigs(res.data);
            })
            .catch(() => { /* no saved configs — modal hides the picker */ });
        return () => { cancelled = true; };
    }, []);

    // Per-deployment realized PnL over trailing windows (7d + 30d) — ONE
    // aggregation for all cards (badges next to each Results button).
    // { [deploymentId]: { d7: {pnl,trades,wins}, d30: {...} } }
    const [pnlSummary, setPnlSummary] = useState({});
    const fetchAll = React.useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const res = await axios.get(`${API_URL}/deployments`);
            setDeployments(Array.isArray(res.data) ? res.data : []);
        } catch (err) {
            setError(err.response?.data?.error || err.message);
        } finally {
            setLoading(false);
        }
        // Best-effort — a summary failure must not block the panel.
        try {
            const s = await axios.get(`${API_URL}/deployments/pnl-summary`, { params: { windows: '7,30' } });
            setPnlSummary(s.data?.summary || {});
        } catch (_) { /* badges simply show — */ }
    }, []);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    // ── Filtering (parity with legacy chips + search) ──────────────────────
    const counts = useMemo(() => {
        const c = { all: deployments.length, live: 0, paper: 0, inactive: 0 };
        for (const d of deployments) {
            if (d.isActive === false) c.inactive++;
            else if (d.tradeMode === 'LIVE') c.live++;
            else c.paper++;
        }
        return c;
    }, [deployments]);

    const filtered = useMemo(() => {
        let list = deployments;
        if (modeFilter === 'inactive') list = list.filter(d => d.isActive === false);
        else if (modeFilter === 'live') list = list.filter(d => d.isActive !== false && d.tradeMode === 'LIVE');
        else if (modeFilter === 'paper') list = list.filter(d => d.isActive !== false && d.tradeMode !== 'LIVE');
        const q = search.trim().toLowerCase();
        if (q) {
            list = list.filter(d =>
                (d.symbol || '').toLowerCase().includes(q) ||
                (d.strategyName || '').toLowerCase().includes(q) ||
                (d.name || '').toLowerCase().includes(q)
            );
        }
        return list;
    }, [deployments, modeFilter, search]);

    const bySymbol = useMemo(() => {
        const m = {};
        for (const d of filtered) (m[d.symbol] ||= []).push(d);
        return m;
    }, [filtered]);
    const symbols = Object.keys(bySymbol).sort();

    // All-expand convenience
    const allIds = filtered.map(d => d._id);
    const allExpanded = allIds.length > 0 && allIds.every(id => expanded[id]);

    async function _mutate(label, fn) {
        try {
            const res = await fn();
            await fetchAll();
            return res;
        } catch (err) {
            const msg = err.response?.data?.error || err.message;
            alert(`${label} failed: ${msg}`);
            throw err;
        }
    }

    const toggleActive = async (d) => {
        setBusyId(d._id);
        try {
            await _mutate('Toggle', () => axios.post(`${API_URL}/deployments/${d._id}/toggle`, { isActive: !(d.isActive !== false) }));
        } finally { setBusyId(null); }
    };
    const toggleMode = async (d) => {
        setBusyId(d._id);
        try {
            const newMode = d.tradeMode === 'LIVE' ? 'PAPER' : 'LIVE';
            const confirmMsg = newMode === 'LIVE'
                ? `Switch "${d.name}" to LIVE? Real orders will be placed at the broker.`
                : `Switch "${d.name}" to PAPER?`;
            if (!window.confirm(confirmMsg)) return;
            await _mutate('Mode', () => axios.post(`${API_URL}/deployments/${d._id}/toggle-mode`, { tradeMode: newMode }));
        } finally { setBusyId(null); }
    };
    const remove = async (d) => {
        if (!window.confirm(`Delete deployment "${d.name}"?\nEngine refuses if a position is still open on it.`)) return;
        setBusyId(d._id);
        try {
            await _mutate('Delete', () => axios.delete(`${API_URL}/deployments/${d._id}`));
        } finally { setBusyId(null); }
    };

    return (
        <div className="bg-surface rounded-xl border border-slate-700 p-6">
            {/* ── Header (click the title to fold the whole panel) ─────────── */}
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <button
                    type="button"
                    onClick={togglePanel}
                    aria-expanded={panelOpen}
                    title={panelOpen ? 'Collapse panel' : 'Expand panel'}
                    className="text-xl font-bold flex items-center gap-2 text-left hover:text-primary transition-colors"
                >
                    {panelOpen
                        ? <ChevronDown className="w-4 h-4 text-slate-400" />
                        : <ChevronRight className="w-4 h-4 text-slate-400" />}
                    🧩 Multi-Strategy Deployments
                    <span className="text-xs font-normal text-slate-500">
                        ({counts.all}) · {Object.keys(bySymbol).length || 0} symbol{Object.keys(bySymbol).length === 1 ? '' : 's'}
                    </span>
                </button>
                <div className="flex items-center gap-2">
                    {panelOpen && counts.all > 0 && (
                        <button
                            onClick={() => {
                                const next = {};
                                if (!allExpanded) for (const id of allIds) next[id] = true;
                                setExpanded(next);
                            }}
                            className="text-[11px] px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
                        >
                            {allExpanded ? 'Collapse all' : 'Expand all'}
                        </button>
                    )}
                    <button
                        onClick={fetchAll}
                        disabled={loading}
                        className="text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-50"
                    >
                        {loading ? '…' : 'Refresh'}
                    </button>
                    <button
                        onClick={() => { setCreateDefaults(null); setShowCreate(true); }}
                        className="text-[11px] px-3 py-1 rounded bg-primary text-white font-semibold hover:opacity-90"
                    >
                        + Add Deployment
                    </button>
                </div>
            </div>

            {panelOpen && (<>
            {/* ── Filter chips + search (parity with legacy) ───────────────── */}
            {counts.all > 0 && (
                <div className="flex items-center gap-2 flex-wrap mb-4">
                    {[
                        { key: 'all',      label: 'All',      cls: 'bg-slate-700 text-slate-200' },
                        { key: 'live',     label: 'Live',     cls: 'bg-red-700/40 text-red-200 border-red-700' },
                        { key: 'paper',    label: 'Paper',    cls: 'bg-blue-700/40 text-blue-200 border-blue-700' },
                        { key: 'inactive', label: 'Inactive', cls: 'bg-slate-700/40 text-slate-400 border-slate-600' },
                    ].map(chip => {
                        const active = modeFilter === chip.key;
                        return (
                            <button
                                key={chip.key}
                                onClick={() => setModeFilter(chip.key)}
                                className={`text-[11px] px-2 py-1 rounded border ${
                                    active ? chip.cls : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300'
                                }`}
                            >
                                {chip.label} <span className="opacity-70">·{counts[chip.key]}</span>
                            </button>
                        );
                    })}
                    <input
                        type="text"
                        placeholder="Search symbol, strategy or name…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="flex-1 min-w-[200px] bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200"
                    />
                </div>
            )}

            {error && (
                <div className="mb-3 px-3 py-2 rounded bg-rose-950/40 border border-rose-700 text-rose-200 text-xs">
                    {error}
                </div>
            )}

            {counts.all === 0 && !loading && (
                <div className="text-center py-8 text-slate-500 text-sm bg-slate-900/40 rounded border border-dashed border-slate-700">
                    No deployments yet. Click <b>+ Add Deployment</b> to wire up a strategy on a symbol.
                </div>
            )}
            {counts.all > 0 && filtered.length === 0 && (
                <div className="text-slate-500 text-sm italic p-4 text-center border border-dashed border-slate-700 rounded-lg">
                    No deployments match the current filter.
                    <button
                        onClick={() => { setSearch(''); setModeFilter('all'); }}
                        className="ml-2 text-blue-400 hover:underline"
                    >Reset filters</button>
                </div>
            )}

            {/* ── Symbol groups, each with N deployment cards ──────────────── */}
            <div className="space-y-4">
                {symbols.map(sym => {
                    const list = bySymbol[sym];
                    return (
                        <div key={sym} className="rounded-lg border border-slate-800 bg-slate-900/30 p-3">
                            <div className="flex items-center justify-between mb-2 gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="font-mono text-sm text-white truncate">{sym}</span>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                                        {list.length} deployment{list.length === 1 ? '' : 's'}
                                    </span>
                                </div>
                                <button
                                    onClick={() => { setCreateDefaults({ symbol: sym }); setShowCreate(true); }}
                                    className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                                    title={`Add another strategy on ${sym}`}
                                >
                                    + Add to {sym.split(':').pop().replace('-INDEX', '')}
                                </button>
                            </div>

                            <div className="space-y-2">
                                {list.map(d => (
                                    <DeploymentCard
                                        key={d._id}
                                        d={d}
                                        strategies={strategies}
                                        sessionHealth={sessionHealth}
                                        globalConfig={globalConfig}
                                        isBusy={busyId === d._id}
                                        isExpanded={!!expanded[d._id]}
                                        isEditing={editingId === d._id}
                                        onToggleActive={() => toggleActive(d)}
                                        onToggleMode={() => toggleMode(d)}
                                        onDelete={() => remove(d)}
                                        onToggleExpand={() => setExpanded(s => ({ ...s, [d._id]: !s[d._id] }))}
                                        onToggleEdit={() => setEditingId(editingId === d._id ? null : d._id)}
                                        onEdited={() => { setEditingId(null); fetchAll(); }}
                                        onTest={onTest}
                                        onSim={onSim}
                                        onManualTrade={onManualTrade}
                                        onResults={() => openResults(d)}
                                        pnlWindows={pnlSummary[String(d._id)] || null}
                                    />
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
            </>)}

            {showCreate && (
                <CreateDeployment
                    defaults={createDefaults}
                    strategies={strategies}
                    savedConfigs={savedConfigs}
                    onClose={() => setShowCreate(false)}
                    onCreated={() => { setShowCreate(false); fetchAll(); }}
                />
            )}
        </div>
    );
}

// ── One deployment card — full parity with the legacy strategy card ────────
// Compact realized-PnL badge for one trailing window ("7d" / "30d").
// stats = { pnl, trades, wins } or null (no closed tagged trades in window).
function PnlBadge({ label, stats }) {
    const has = stats && stats.trades > 0;
    const cls = !has ? 'text-slate-500 border-slate-700 bg-slate-800/40'
        : stats.pnl > 0 ? 'text-emerald-300 border-emerald-700/50 bg-emerald-900/20'
        : stats.pnl < 0 ? 'text-red-300 border-red-700/50 bg-red-900/20'
        : 'text-slate-300 border-slate-600 bg-slate-800/40';
    const title = has
        ? `Last ${label} (this deployment): ${stats.trades} closed trade${stats.trades === 1 ? '' : 's'}, ${stats.wins} win${stats.wins === 1 ? '' : 's'}`
        : `No closed trades tagged to this deployment in the last ${label}`;
    return (
        <span className={`px-2 py-1 rounded text-xs font-semibold border ${cls}`} title={title}>
            {label} {!has ? '—'
                : `${stats.pnl > 0 ? '+' : stats.pnl < 0 ? '−' : ''}₹${Math.abs(stats.pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })} · ${stats.trades}t`}
        </span>
    );
}

function DeploymentCard({
    d, strategies, sessionHealth, globalConfig,
    isBusy, isExpanded, isEditing,
    onToggleActive, onToggleMode, onDelete, onToggleExpand, onToggleEdit, onEdited,
    onTest, onSim, onManualTrade, onResults, pnlWindows,
}) {
    const params = d.params || {};
    const isActive = d.isActive !== false;
    const isLive = d.tradeMode === 'LIVE';
    const resolution = String(params.resolution || '?');
    const aiEnabled = !!(params.enable_ai_confirmation || params.use_ai_confirmation);

    return (
        <div className={`rounded-lg border overflow-hidden ${
            isActive
                ? (isLive ? 'border-red-700/50 bg-red-950/10' : 'border-emerald-700/40 bg-emerald-950/10')
                : 'border-slate-800 bg-slate-900/40 opacity-80'
        }`}>
            {/* ── Row 1: toggles + identity + action buttons ──────────────── */}
            <div className="px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    {/* Active toggle (switch — same style as legacy) */}
                    <label className="relative inline-flex items-center cursor-pointer" title={isActive ? 'Deployment ON — click to disable' : 'Deployment OFF — click to enable'}>
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={isActive}
                            disabled={isBusy}
                            onChange={onToggleActive}
                        />
                        <div className="w-9 h-5 bg-slate-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"></div>
                    </label>

                    {/* PAPER/LIVE toggle (switch — same style as legacy) */}
                    <div className="flex items-center bg-slate-800/80 px-2 py-1 rounded border border-slate-600/50">
                        <span className={`text-xs mr-2 font-bold ${isLive ? 'text-slate-400' : 'text-blue-400'}`}>PAPER</span>
                        <label className="relative inline-flex items-center cursor-pointer" title="Toggle Trade Mode (PAPER/LIVE) for THIS deployment only">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={isLive}
                                disabled={isBusy}
                                onChange={onToggleMode}
                            />
                            <div className="w-9 h-5 bg-blue-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-500/80"></div>
                        </label>
                        <span className={`text-xs ml-2 font-bold ${isLive ? 'text-red-400' : 'text-slate-400'}`}>LIVE</span>
                    </div>

                    {/* Identity — name is clickable → opens analytics for this deployment */}
                    <button
                        onClick={onResults}
                        className="text-sm text-slate-100 font-semibold truncate hover:text-primary hover:underline text-left"
                        title={`View results & charts for "${d.name}"`}
                    >
                        {d.name}
                    </button>
                    <span className="text-xs px-2 py-1 rounded bg-white/5 border border-white/10 text-gray-400" title={d.strategyName}>
                        {strategyLabel(strategies, d.strategyName)}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono">{resolution}m</span>
                    {aiEnabled && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/40 text-violet-300 flex items-center gap-1">
                            🤖 AI
                            {params.ai_follow_sl_tp && <span className="text-violet-400">SL/TP</span>}
                        </span>
                    )}
                    <span
                        className="text-[10px] font-mono text-slate-500"
                        title={`Deployment ID: ${d._id}\nClick to copy`}
                        style={{ cursor: 'copy' }}
                        onClick={() => { try { navigator.clipboard.writeText(d._id); } catch (_) {} }}
                    >
                        {String(d._id).slice(-6).toUpperCase()}
                    </span>
                </div>

                {/* Action buttons — identical affordances to the legacy card */}
                <div className="flex gap-2 items-center flex-wrap">
                    {/* Trailing realized PnL for THIS deployment (tagged trades
                        only) — 7-day and 30-day windows. */}
                    <PnlBadge label="7d" stats={pnlWindows?.d7 || null} />
                    <PnlBadge label="30d" stats={pnlWindows?.d30 || null} />
                    {onResults && (
                        <button
                            onClick={onResults}
                            className="px-3 py-1 bg-primary/15 hover:bg-primary/25 text-primary border border-primary/40 rounded text-xs font-semibold transition-colors"
                            title="Equity curve, calendar, trades table & PnL distribution for this deployment"
                        >
                            📊 Results
                        </button>
                    )}
                    {onManualTrade && (
                        <>
                            <button
                                onClick={() => onManualTrade('CE', d.symbol)}
                                className="px-2 py-1 bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/40 rounded text-xs font-bold transition-colors"
                                title={`Simulate BUY CE Signal for ${d.symbol}`}
                            >
                                + CE
                            </button>
                            <button
                                onClick={() => onManualTrade('PE', d.symbol)}
                                className="px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 rounded text-xs font-bold transition-colors"
                                title={`Simulate BUY PE Signal for ${d.symbol}`}
                            >
                                + PE
                            </button>
                        </>
                    )}
                    {onTest && (
                        <button
                            onClick={() => onTest(d.symbol, { strategyName: d.strategyName, ...params })}
                            className="px-3 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded text-xs transition-colors"
                            title="Test this config in the Backtester"
                        >
                            Test
                        </button>
                    )}
                    {onSim && (
                        <button
                            onClick={() => onSim(d.symbol)}
                            className="px-3 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded text-xs transition-colors"
                            title="Simulate a signal through the live engine (AI + SL/TP), no order placed"
                        >
                            🧪 Sim
                        </button>
                    )}
                    <button
                        onClick={onToggleEdit}
                        disabled={isBusy}
                        className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 disabled:opacity-50"
                        title="Edit name / params (JSON)"
                    >
                        {isEditing ? '× Close' : 'Edit'}
                    </button>
                    <button
                        onClick={onDelete}
                        disabled={isBusy}
                        className="text-xs px-2 py-1 rounded bg-rose-900/40 hover:bg-rose-800 text-rose-300 disabled:opacity-50"
                        title="Delete this deployment"
                    >
                        ⌫
                    </button>
                </div>
            </div>

            {/* ── AI Settings Summary strip (ported 1:1 from legacy) ───────── */}
            {aiEnabled && (
                <div className="px-4 py-2 border-t border-violet-500/20 bg-violet-500/5 flex flex-wrap gap-2 text-[11px]">
                    <span className="text-violet-400 font-semibold">✨ AI Risk Filter:</span>
                    <span className={`px-1.5 py-0.5 rounded ${params.ai_follow_sl_tp ? 'bg-green-500/20 text-green-300' : 'bg-slate-700 text-slate-400'}`}>
                        {params.ai_follow_sl_tp ? '✓ AI SL/TP' : 'Strategy SL/TP'}
                    </span>
                    {params.ai_follow_strategy_exits && (
                        <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">✓ Strategy Exits</span>
                    )}
                    <span className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">
                        Thresh: {Math.round((params.ai_confidence_threshold || 0.6) * 100)}%
                    </span>
                    {params.ai_models && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                            {Array.isArray(params.ai_models) ? params.ai_models.join(', ') : params.ai_models}
                        </span>
                    )}
                    {params.use_claude_web_session && (() => {
                        const h = sessionHealth?.results?.[d.symbol]?.claude_web;
                        const isOk = h?.valid === true;
                        const isBad = h && h.valid === false;
                        return (
                            <span
                                className={`px-1.5 py-0.5 rounded ${isBad ? 'bg-red-700/60 text-red-100 ring-1 ring-red-400 animate-pulse' : 'bg-amber-700/40 text-amber-200'}`}
                                title={
                                    `Model: ${params.claude_web_model || 'claude-web/claude-sonnet-4-6'}` +
                                    `\nBatch size: ${parseInt(params.claude_web_batch_size, 10) || 1}×` +
                                    `\nCookies: global Settings → AI Web Cookies` +
                                    (h ? `\n\nSession status: ${isOk ? '✓ VALID' : `✗ ${h.reason || 'invalid'}`}` : '') +
                                    (isBad && h.error ? `\nDetail: ${h.error}` : '') +
                                    (isBad ? '\n\n→ Open Settings → AI Web Cookies, paste fresh sessionKey, Save' : '')
                                }
                            >
                                🍪 Claude.ai Web (
                                {String(params.claude_web_model || 'sonnet').replace('claude-web/claude-', '')}
                                , batch {parseInt(params.claude_web_batch_size, 10) || 1}×
                                {isBad && ` · ⚠️ ${h.reason === 'missing_cookies' ? 'no cookie' : 'EXPIRED — refresh in Settings'}`}
                                {isOk && ' · ✓ valid'}
                                )
                            </span>
                        );
                    })()}
                    {params.use_gemini_web_session && (() => {
                        const h = sessionHealth?.results?.[d.symbol]?.gemini_web;
                        const isOk = h?.valid === true;
                        const isBad = h && h.valid === false;
                        return (
                            <span
                                className={`px-1.5 py-0.5 rounded ${isBad ? 'bg-red-700/60 text-red-100 ring-1 ring-red-400 animate-pulse' : 'bg-cyan-700/40 text-cyan-200'}`}
                                title={
                                    `Model: ${params.gemini_web_model || 'gemini-web/gemini-2.5-pro'}` +
                                    `\nBatch size: ${parseInt(params.gemini_web_batch_size, 10) || 1}×` +
                                    `\nCookies: global Settings → AI Web Cookies` +
                                    (h ? `\n\nSession status: ${isOk ? '✓ VALID' : `✗ ${h.reason || 'invalid'}`}` : '') +
                                    (isBad && h.error ? `\nDetail: ${h.error}` : '') +
                                    (isBad ? '\n\n→ Open Settings → AI Web Cookies, paste fresh PSID/PSIDTS, Save' : '') +
                                    (h?.rotated_psidts ? '\n\n(server rotated __Secure-1PSIDTS — fresh value cached in-memory)' : '')
                                }
                            >
                                🍪 Gemini Web (
                                {String(params.gemini_web_model || 'pro').replace('gemini-web/gemini-', '')}
                                , batch {parseInt(params.gemini_web_batch_size, 10) || 1}×
                                {isBad && ` · ⚠️ ${h.reason === 'missing_cookies' ? 'no cookies' : 'EXPIRED — refresh in Settings'}`}
                                {isOk && ' · ✓ valid'}
                                )
                            </span>
                        );
                    })()}
                    {params.claude_thinking_enabled && (
                        <span
                            className="px-1.5 py-0.5 rounded bg-orange-700/40 text-orange-200"
                            title={
                                `Thinking budget: ${(parseInt(params.claude_thinking_budget, 10) || 32000).toLocaleString()} tokens` +
                                `\nApplies to: Anthropic API + Claude.ai web (paprika_mode)` +
                                `\nNote: temperature forced to 1.0 when thinking is on`
                            }
                        >
                            🧠 Thinking ({(parseInt(params.claude_thinking_budget, 10) || 32000).toLocaleString()})
                        </span>
                    )}
                    {params.ai_fail_closed && (
                        <span
                            className="px-1.5 py-0.5 rounded bg-red-700/40 text-red-200"
                            title="On AI timeout/error: REJECT the trade instead of falling back to threshold gate"
                        >
                            🛑 Fail-closed
                        </span>
                    )}
                    {params.ai_use_spot_exits && (
                        <span
                            className="px-1.5 py-0.5 rounded bg-cyan-700/40 text-cyan-200"
                            title={
                                `Live engine actively monitors the index and fires market exits when ` +
                                `spot crosses AI's suggested SL/TP exactly.\n\n` +
                                `Broker SL stays as the safety net at ${params.ai_sl_safety_buffer || 1.5}× ` +
                                `the AI SL distance — fires automatically if the engine disconnects.`
                            }
                        >
                            🎯 Spot Exits ({params.ai_sl_safety_buffer || 1.5}× safety)
                        </span>
                    )}
                    {params.ai_follow_strategy_exits === false && (
                        <span
                            className="px-1.5 py-0.5 rounded bg-amber-700/50 text-amber-200 ring-1 ring-amber-500/40"
                            title={
                                `ai_follow_strategy_exits = FALSE → live rides positions to the AI SL/TP instead ` +
                                `of following the strategy's exits (the same switch the backtest AI column uses).\n\n` +
                                `SKIPPED: Max Hold candles, strategy-signal reversal, soft trade_end_time stop.\n` +
                                `STILL ACTIVE: mandatory 15:19 intraday square-off, day-change force-exit, ` +
                                `broker SL, daily-loss breaker.\n\n` +
                                `For exit-point parity with the backtest AI column, also enable ai_use_spot_exits.`
                            }
                        >
                            🏃 Ride to AI Targets
                        </span>
                    )}
                    {params.use_ai_fair_entry && (
                        <span
                            className="px-1.5 py-0.5 rounded bg-teal-700/40 text-teal-200"
                            title="AI suggests a fair-value spot level after breakout. Live: limit order at suggested premium. Paper: waits for LTP to pull back. Skips if not reached in 3 candles (~15 min)."
                        >
                            🎯 Fair Entry
                        </span>
                    )}
                    {params.enable_mastra_validator && (
                        <span
                            className="px-1.5 py-0.5 rounded bg-purple-700/40 text-purple-200"
                            title="Mastra second-AI validator runs at trade execution time. Off by default; only matters if explicitly enabled."
                        >
                            🤖 Mastra Gate
                        </span>
                    )}
                </div>
            )}

            {/* ── Quick-stats strip — always visible (parity with legacy) ──── */}
            <div className="px-4 py-2 border-t border-slate-700 bg-slate-900/40 flex flex-wrap gap-x-6 gap-y-1 text-[11px]">
                {(() => {
                    const quickKeys = [
                        { k: 'capital',          label: 'Capital',   prefix: '₹' },
                        { k: 'lots',             label: 'Lots',      prefix: '' },
                        { k: 'lot_size',         label: 'Lot Size',  prefix: '' },
                        { k: 'max_daily_loss',   label: 'Max Loss',  prefix: '₹', global: true },
                        { k: 'trade_start_time', label: 'Start',     prefix: '' },
                        { k: 'trade_end_time',   label: 'End',       prefix: '' },
                    ];
                    return quickKeys.map(({ k, label, prefix, global }) => {
                        let val = params[k];
                        if (val == null || val === '') return null;
                        // For global-override fields, show the engine's effective value
                        if (global && globalConfig && globalConfig[k] != null) {
                            val = globalConfig[k];
                        }
                        return (
                            <div key={k} className="flex items-center gap-1">
                                <span className="text-slate-500 uppercase text-[9px] tracking-wider">{label}</span>
                                <span className="font-mono text-slate-200 font-bold">{prefix}{typeof val === 'number' ? val.toLocaleString() : val}</span>
                            </div>
                        );
                    });
                })()}
                {/* Deployed = createdAt, Updated = updatedAt (bumped on every save/toggle). */}
                {fmtDate(d.createdAt) && (
                    <div className="flex items-center gap-1" title={`Deployed on ${new Date(d.createdAt).toString()}`}>
                        <span className="text-slate-500 uppercase text-[9px] tracking-wider">Deployed</span>
                        <span className="font-mono text-slate-300">{fmtDate(d.createdAt)}</span>
                    </div>
                )}
                {fmtDate(d.updatedAt) && (
                    <div className="flex items-center gap-1" title={`Last updated ${new Date(d.updatedAt).toString()}`}>
                        <span className="text-slate-500 uppercase text-[9px] tracking-wider">Updated</span>
                        <span className="font-mono text-slate-300">{fmtDate(d.updatedAt)}</span>
                    </div>
                )}
                <button
                    onClick={onToggleExpand}
                    className="ml-auto text-[10px] px-2 py-0.5 rounded bg-slate-700/60 hover:bg-slate-700 text-slate-300"
                >
                    {isExpanded ? '▲ Hide details' : '▼ Show all params'}
                </button>
            </div>

            {/* ── All-params grid — collapsed by default (parity with legacy) ── */}
            {isExpanded && (
                <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 border-t border-slate-800">
                    {Object.entries(params).map(([key, val]) => {
                        if (key === 'strategyName' || key === 'resolution') return null; // in header
                        if (AI_PARAM_KEYS.includes(key)) return null; // in AI strip
                        let displayVal = val;
                        if (typeof val === 'boolean') displayVal = val ? 'TRUE' : 'FALSE';
                        if (typeof val === 'object') displayVal = JSON.stringify(val);
                        const isKey = ['lots', 'capital', 'max_daily_loss', 'max_single_trade_loss'].includes(key);
                        // Global-override: engine reads max_daily_loss from global settings —
                        // the per-deployment snapshot can be stale. Show effective value + tag.
                        const isGlobalOverride = key === 'max_daily_loss';
                        let overrideTag = null;
                        if (isGlobalOverride && globalConfig && globalConfig[key] != null && globalConfig[key] !== val) {
                            displayVal = globalConfig[key];
                            overrideTag = (
                                <span className="text-[9px] text-amber-400 font-normal ml-1" title={`Stored on deployment: ₹${val}. Engine uses global setting (₹${globalConfig[key]}).`}>
                                    (global ↑ from ₹{val})
                                </span>
                            );
                        }
                        return (
                            <div key={key} className="overflow-hidden">
                                <p className="text-slate-500 text-[10px] uppercase font-bold tracking-wider mb-0.5">
                                    {key.replace(/_/g, ' ')}{overrideTag}
                                </p>
                                <p className={`font-mono text-sm truncate ${isKey ? 'text-white font-bold' : 'text-slate-300'} ${typeof val === 'boolean' ? (val ? 'text-green-400' : 'text-red-400') : ''}`} title={String(displayVal)}>
                                    {String(displayVal)}
                                </p>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── JSON editor (multi-deployment extra) ─────────────────────── */}
            {isEditing && (
                <EditDeployment
                    deployment={d}
                    onClose={onToggleEdit}
                    onSaved={onEdited}
                />
            )}
        </div>
    );
}

function CreateDeployment({ defaults, strategies, savedConfigs, onClose, onCreated }) {
    const stratList = (strategies && strategies.length) ? strategies : KNOWN_STRATEGIES_FALLBACK;
    const [symbol, setSymbol] = useState(defaults?.symbol || KNOWN_SYMBOLS[0]);
    const [strategyName, setStrategyName] = useState(stratList[0]?.id || stratList[0]);
    const [resolution, setResolution] = useState('5');
    const [name, setName] = useState('');
    const [tradeMode, setTradeMode] = useState('PAPER');
    const [isActive, setIsActive] = useState(false);
    const [paramsJson, setParamsJson] = useState('{}');
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState(null);
    const [sourceConfigId, setSourceConfigId] = useState('');

    // "Start from Saved Config" — prefill the whole form from a SavedStrategy
    // doc (the configs the user saved from Backtest). This is the PRIMARY
    // deploy flow: tune in Backtest → Save Config → deploy it here with the
    // exact same params. Manual entry below remains for ad-hoc deployments.
    const applySavedConfig = (cfgId) => {
        setSourceConfigId(cfgId);
        if (!cfgId) return;
        const cfg = (savedConfigs || []).find(c => c._id === cfgId);
        if (!cfg) return;
        const p = cfg.params || {};
        if (cfg.strategyId) setStrategyName(cfg.strategyId);
        if (cfg.symbol) setSymbol(cfg.symbol);
        if (p.resolution != null) setResolution(String(p.resolution));
        setName(cfg.name || '');
        // Strip resolution from the JSON blob — it's auto-injected from the
        // dropdown on submit, so showing it twice would be confusing.
        const { resolution: _r, ...rest } = p;
        setParamsJson(JSON.stringify(rest, null, 2));
    };

    const submit = async () => {
        setErr(null);
        let extraParams = {};
        try { extraParams = paramsJson.trim() ? JSON.parse(paramsJson) : {}; }
        catch (e) { setErr('Invalid params JSON: ' + e.message); return; }
        const params = { ...extraParams, resolution };
        const payload = {
            name: name.trim() || `${symbol} · ${strategyName} · ${resolution}m`,
            symbol, strategyName, params, tradeMode, isActive,
        };
        setSubmitting(true);
        try {
            await axios.post(`${API_URL}/deployments`, payload);
            onCreated();
        } catch (e) {
            setErr(e.response?.data?.error || e.message);
        } finally { setSubmitting(false); }
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-surface rounded-xl border border-slate-700 p-5 w-full max-w-md max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-3">
                    <h4 className="font-bold text-lg">New Deployment</h4>
                    <button onClick={onClose} className="text-slate-400 hover:text-white">×</button>
                </div>
                {err && <div className="mb-2 px-2 py-1 rounded bg-rose-950/40 border border-rose-700 text-rose-200 text-xs">{err}</div>}
                <div className="space-y-2 text-sm">
                    {(savedConfigs && savedConfigs.length > 0) && (
                        <label className="block bg-blue-950/30 border border-blue-800/50 rounded p-2">
                            <span className="text-xs font-bold text-blue-300">📂 Start from Saved Config <span className="font-normal text-blue-400/70">(from Backtest → Save)</span></span>
                            <select
                                className="mt-1 w-full bg-slate-900 border border-blue-700/50 rounded px-2 py-1 text-white"
                                value={sourceConfigId}
                                onChange={(e) => applySavedConfig(e.target.value)}
                            >
                                <option value="">— pick a saved config to prefill —</option>
                                {savedConfigs.map(cfg => (
                                    <option key={cfg._id} value={cfg._id}>
                                        {cfg.name} ({cfg.strategyId}{cfg.params?.resolution ? ` · ${cfg.params.resolution}m` : ''})
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                    <label className="block">
                        <span className="text-xs text-slate-400">Symbol</span>
                        <select className="mt-0.5 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                            {KNOWN_SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </label>
                    <label className="block">
                        <span className="text-xs text-slate-400">Strategy</span>
                        <select className="mt-0.5 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white" value={strategyName} onChange={(e) => setStrategyName(e.target.value)}>
                            {stratList.map(s => {
                                const id = s?.id || s;
                                const label = s?.label || s;
                                return <option key={id} value={id}>{label}</option>;
                            })}
                        </select>
                    </label>
                    <label className="block">
                        <span className="text-xs text-slate-400">Resolution (minutes)</span>
                        <select className="mt-0.5 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white" value={resolution} onChange={(e) => setResolution(e.target.value)}>
                            {RESOLUTIONS.map(r => <option key={r} value={r}>{r}m</option>)}
                        </select>
                    </label>
                    <label className="block">
                        <span className="text-xs text-slate-400">Display name (optional)</span>
                        <input className="mt-0.5 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white" placeholder={`${symbol} · ${strategyName} · ${resolution}m`} value={name} onChange={(e) => setName(e.target.value)} />
                    </label>
                    <label className="block">
                        <span className="text-xs text-slate-400">Mode</span>
                        <select className="mt-0.5 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white" value={tradeMode} onChange={(e) => setTradeMode(e.target.value)}>
                            <option value="PAPER">PAPER</option>
                            <option value="LIVE">LIVE</option>
                        </select>
                    </label>
                    <label className="flex items-center gap-2">
                        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                        <span className="text-xs">Activate immediately</span>
                    </label>
                    <label className="block">
                        <span className="text-xs text-slate-400">Extra params (JSON; <code>resolution</code> auto-injected)</span>
                        <textarea
                            className="mt-0.5 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white font-mono text-[11px]"
                            rows={6}
                            placeholder='{"ema_short": 5, "ema_long": 7}'
                            value={paramsJson}
                            onChange={(e) => setParamsJson(e.target.value)}
                        />
                    </label>
                </div>
                <div className="flex justify-end gap-2 mt-3">
                    <button onClick={onClose} className="px-3 py-1 text-xs rounded bg-slate-800 text-slate-300 hover:bg-slate-700">Cancel</button>
                    <button
                        onClick={submit}
                        disabled={submitting}
                        className="px-3 py-1 text-xs rounded bg-primary text-white font-semibold disabled:opacity-50"
                    >
                        {submitting ? 'Creating…' : 'Create'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function EditDeployment({ deployment, onClose, onSaved }) {
    const [name, setName] = useState(deployment.name);
    const [paramsJson, setParamsJson] = useState(JSON.stringify(deployment.params || {}, null, 2));
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);
    const save = async () => {
        setErr(null);
        let params = {};
        try { params = JSON.parse(paramsJson || '{}'); }
        catch (e) { setErr('Invalid JSON: ' + e.message); return; }
        setBusy(true);
        try {
            await axios.put(`${API_URL}/deployments/${deployment._id}`, { name, params });
            onSaved();
        } catch (e) {
            setErr(e.response?.data?.error || e.message);
        } finally { setBusy(false); }
    };
    return (
        <div className="m-3 mt-0 p-2 rounded border border-slate-700 bg-slate-950/50 text-xs space-y-2">
            {err && <div className="px-2 py-1 rounded bg-rose-950/40 border border-rose-700 text-rose-200">{err}</div>}
            <label className="block">
                <span className="text-[10px] text-slate-500">Name</span>
                <input className="mt-0.5 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block">
                <span className="text-[10px] text-slate-500">Params JSON</span>
                <textarea
                    className="mt-0.5 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white font-mono text-[10px]"
                    rows={8}
                    value={paramsJson}
                    onChange={(e) => setParamsJson(e.target.value)}
                />
            </label>
            <div className="flex justify-end gap-2">
                <button onClick={onClose} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">Cancel</button>
                <button onClick={save} disabled={busy} className="px-2 py-0.5 rounded bg-primary text-white disabled:opacity-50">
                    {busy ? 'Saving…' : 'Save'}
                </button>
            </div>
        </div>
    );
}
