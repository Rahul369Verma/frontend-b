import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { Zap, Plus, Play, Pause, Trash2, Activity, TrendingUp, TrendingDown, Clock, AlertTriangle, Octagon, Power } from 'lucide-react';
import { INSTRUMENT_CONFIG, MONTH_NAMES } from '../constants';
import { fetchExpiriesForSymbol } from '../utils/expiryUtils';

// Build a Fyers futures symbol from an index key + expiry date.
//   buildFuturesSymbol('NSE:NIFTYBANK-INDEX', '2026-06-30')
//     → 'NSE:BANKNIFTY26JUNFUT'
// Returns null when the index isn't in INSTRUMENT_CONFIG (e.g. raw custom
// override) — the caller falls back to the manual text input in that case.
function buildFuturesSymbol(indexKey, expiryDateStr) {
    const cfg = INSTRUMENT_CONFIG[indexKey];
    if (!cfg || !expiryDateStr) return null;
    const d = new Date(expiryDateStr);
    if (Number.isNaN(d.getTime())) return null;
    const yy = String(d.getFullYear()).slice(-2);
    const mmm = MONTH_NAMES[d.getMonth()];
    return `${cfg.exchange}:${cfg.underlying}${yy}${mmm}FUT`;
}

// Tick-driven strategy management. PAPER-only in Phase 1 — strategies fire
// signals against the raw Fyers tick stream and emit paper trades into the
// tick_trades collection. Hooked into the backend tickEngine via
// /api/tick-strategies + socket event 'tick_strategy_event'.

const API_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;
const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function TickStrategies() {
    const [strategies, setStrategies] = useState([]);
    const [snapshot, setSnapshot] = useState({ events: [], totals: {} });
    const [types, setTypes] = useState({});
    const [trades, setTrades] = useState([]);
    const [tradesTotal, setTradesTotal] = useState(0);

    const [createOpen, setCreateOpen] = useState(false);
    // form.symbol is the FINAL symbol sent to backend (the one fyersData
    // subscribes to). We derive it from (indexSymbol + dataSource + futuresExpiry)
    // unless the user types into the manual override, which sets symbol directly.
    const [form, setForm] = useState({
        name: '',
        strategyType: '',
        indexSymbol: 'NSE:NIFTYBANK-INDEX',
        dataSource: 'SPOT',           // 'SPOT' | 'FUT'
        futuresExpiry: '',            // YYYY-MM-DD when dataSource=FUT
        symbol: 'NSE:NIFTYBANK-INDEX',
        params: {},
        presetId: '',
    });
    const [editingId, setEditingId] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    // Expiry list for the currently-selected index. Loaded lazily when the
    // user switches dataSource to FUT — calling /api/expiry on every dropdown
    // open would be wasteful.
    const [expiryDates, setExpiryDates] = useState([]);
    const [expiryLoading, setExpiryLoading] = useState(false);

    const fetchAll = async () => {
        try {
            const [list, typesRes, tradesRes] = await Promise.all([
                axios.get(`${API_URL}/tick-strategies`),
                axios.get(`${API_URL}/tick-strategies/types`),
                axios.get(`${API_URL}/tick-strategies/trades?limit=25`),
            ]);
            setStrategies(list.data.strategies || []);
            setSnapshot(list.data.snapshot || { events: [], totals: {} });
            setTypes(typesRes.data.types || {});
            setTrades(tradesRes.data.trades || []);
            setTradesTotal(tradesRes.data.total || 0);
        } catch (err) {
            console.error('Failed to load tick strategies', err);
            setError(err.response?.data?.error || err.message);
        }
    };

    useEffect(() => {
        fetchAll();
        const socket = io(SOCKET_URL, { withCredentials: true });
        // Server emits 'tick_strategy_event' with a snapshot piggy-backed
        // so the live feed updates without a full refetch.
        socket.on('tick_strategy_event', (payload) => {
            if (payload?.snapshot) setSnapshot(payload.snapshot);
        });
        return () => socket.disconnect();
    }, []);

    const openCreate = (preset) => {
        const t = preset || Object.keys(types)[0] || '';
        const idx = 'NSE:NIFTYBANK-INDEX';
        setForm({
            name: '',
            strategyType: t,
            indexSymbol: idx,
            dataSource: 'SPOT',
            futuresExpiry: '',
            symbol: idx,
            params: t ? { ...(types[t]?.defaults || {}) } : {},
            presetId: '',  // "custom" until the user picks a preset
        });
        setEditingId(null);
        setCreateOpen(true);
        setError(null);
        setExpiryDates([]);
    };

    const openEdit = (strategy) => {
        // Best-effort reverse-mapping of the stored symbol back to (index, dataSource).
        // Exact match in INSTRUMENT_CONFIG → SPOT mode. A "*FUT" symbol → FUT mode
        // with indexSymbol matched by underlying. Anything else stays in manual
        // override (indexSymbol left as-is so the dropdown won't reset state).
        let indexSymbol = strategy.symbol;
        let dataSource = 'SPOT';
        let futuresExpiry = '';
        if (!INSTRUMENT_CONFIG[strategy.symbol]) {
            const futMatch = /([A-Z]+):([A-Z0-9]+?)(\d{2})([A-Z]{3})FUT$/.exec(strategy.symbol || '');
            if (futMatch) {
                const [, exch, underlying] = futMatch;
                // Find the INSTRUMENT_CONFIG key that matches exchange + underlying
                const matched = Object.entries(INSTRUMENT_CONFIG).find(
                    ([, cfg]) => cfg.exchange === exch && cfg.underlying === underlying
                );
                if (matched) {
                    indexSymbol = matched[0];
                    dataSource = 'FUT';
                    // We can't recover the exact expiry date from yy+MMM alone
                    // without ambiguity — leave blank and let the user re-pick.
                }
            }
        }
        setForm({
            name: strategy.name,
            strategyType: strategy.strategyType,
            indexSymbol,
            dataSource,
            futuresExpiry,
            symbol: strategy.symbol,
            params: { ...(types[strategy.strategyType]?.defaults || {}), ...(strategy.params || {}) },
            // Editing always starts in "custom" preset — we don't try to reverse-
            // match an existing strategy's params back to a preset id.
            presetId: '',
        });
        setEditingId(strategy._id);
        setCreateOpen(true);
        setError(null);
        setExpiryDates([]);
    };

    // Fetch expiry dates whenever the user switches to FUT (or changes index
    // while in FUT). Cached per-index implicitly by React: we re-fetch when
    // indexSymbol changes because that's the input to the API call.
    useEffect(() => {
        if (!createOpen) return;
        if (form.dataSource !== 'FUT') return;
        if (!form.indexSymbol || !INSTRUMENT_CONFIG[form.indexSymbol]) return;
        let cancelled = false;
        setExpiryLoading(true);
        fetchExpiriesForSymbol(form.indexSymbol, 4, 1)
            .then(list => {
                if (cancelled) return;
                setExpiryDates(list);
                // If we don't have an expiry picked yet, default to the nearest
                // future one — matches Backtest's default.
                setForm(f => {
                    if (f.futuresExpiry) return f;
                    const next = list.find(e => !e.isPast) || list[0];
                    return next ? { ...f, futuresExpiry: next.date } : f;
                });
            })
            .catch(err => console.warn('Expiry fetch failed:', err.message))
            .finally(() => { if (!cancelled) setExpiryLoading(false); });
        return () => { cancelled = true; };
    }, [createOpen, form.dataSource, form.indexSymbol]);

    // Derive form.symbol from (indexSymbol, dataSource, futuresExpiry).
    // Skipped when the dropdowns don't fully resolve a symbol — keeps the
    // user's manual override input intact.
    useEffect(() => {
        if (!createOpen) return;
        if (form.dataSource === 'SPOT') {
            if (form.indexSymbol && form.symbol !== form.indexSymbol) {
                setForm(f => ({ ...f, symbol: f.indexSymbol }));
            }
        } else if (form.dataSource === 'FUT') {
            const built = buildFuturesSymbol(form.indexSymbol, form.futuresExpiry);
            if (built && form.symbol !== built) {
                setForm(f => ({ ...f, symbol: built }));
            }
        }
    }, [createOpen, form.dataSource, form.indexSymbol, form.futuresExpiry]);

    const onTypeChange = (newType) => {
        setForm(f => ({ ...f, strategyType: newType, params: { ...(types[newType]?.defaults || {}) }, presetId: '' }));
    };

    const applyPreset = (presetId) => {
        if (!presetId) {
            setForm(f => ({ ...f, presetId: '' }));  // user picked "Custom" — keep current params
            return;
        }
        const preset = (types[form.strategyType]?.presets || []).find(p => p.id === presetId);
        if (!preset) return;
        setForm(f => ({ ...f, presetId, params: { ...preset.params } }));
    };

    const submitForm = async () => {
        if (!form.name || !form.strategyType || !form.symbol) {
            setError('Name, type, and symbol are required.');
            return;
        }
        setLoading(true);
        try {
            // Coerce numeric param strings to numbers so the strategy class
            // doesn't compare strings against thresholds.
            const params = {};
            for (const [k, v] of Object.entries(form.params)) {
                if (v === '' || v === null) continue;
                const num = Number(v);
                params[k] = Number.isFinite(num) && String(num) === String(v).trim() ? num : v;
            }
            if (editingId) {
                await axios.put(`${API_URL}/tick-strategies/${editingId}`, { ...form, params });
            } else {
                await axios.post(`${API_URL}/tick-strategies`, { ...form, params, isActive: false });
            }
            setCreateOpen(false);
            setEditingId(null);
            await fetchAll();
        } catch (err) {
            setError(err.response?.data?.error || err.message);
        } finally {
            setLoading(false);
        }
    };

    const toggleActive = async (s) => {
        try {
            await axios.post(`${API_URL}/tick-strategies/${s._id}/toggle`, { isActive: !s.isActive });
            await fetchAll();
        } catch (err) {
            alert('Toggle failed: ' + (err.response?.data?.error || err.message));
        }
    };

    const deleteStrategy = async (s) => {
        if (!window.confirm(`Delete "${s.name}"? Open paper position (if any) will be closed at last LTP.`)) return;
        try {
            await axios.delete(`${API_URL}/tick-strategies/${s._id}`);
            await fetchAll();
        } catch (err) {
            alert('Delete failed: ' + (err.response?.data?.error || err.message));
        }
    };

    // ── Kill-switch handlers ──────────────────────────────────────────────
    // Halt blocks new entries (open positions still exit on TP/SL/max-hold).
    // Kill-all halts AND force-flats every open paper position at last LTP.
    // Both are wrapped in confirm dialogs because they are mass actions.
    const handleHalt = async () => {
        const reason = window.prompt('Halt the tick engine?\nReason (logged + telegrammed):', 'manual halt');
        if (reason == null) return;
        try {
            await axios.post(`${API_URL}/tick-strategies/halt`, { reason, actor: 'operator' });
            await fetchAll();
        } catch (err) { alert('Halt failed: ' + (err.response?.data?.error || err.message)); }
    };
    const handleResume = async () => {
        if (!window.confirm('Resume tick engine? New entries will be permitted again.')) return;
        try {
            await axios.post(`${API_URL}/tick-strategies/resume`, { actor: 'operator' });
            await fetchAll();
        } catch (err) { alert('Resume failed: ' + (err.response?.data?.error || err.message)); }
    };
    const handleKillAll = async () => {
        const openCount = snapshot?.totals?.openPositions || 0;
        const reason = window.prompt(`KILL ALL: force-close every open paper position (${openCount} currently) and halt the engine. Type the reason:`, 'kill-all');
        if (reason == null) return;
        if (!window.confirm(`Confirm KILL ALL: close ${openCount} position(s) at last LTP and halt entries?`)) return;
        try {
            const res = await axios.post(`${API_URL}/tick-strategies/kill-all`, { reason, actor: 'operator' });
            alert(`Closed ${res.data.closed} position(s). Engine is halted.`);
            await fetchAll();
        } catch (err) { alert('Kill-all failed: ' + (err.response?.data?.error || err.message)); }
    };

    // Merge runtime snapshot stats onto the persisted strategy docs so each
    // card can show live state (open position, hit count, PnL) without two
    // separate lookups in render.
    const merged = useMemo(() => {
        const bySnapId = new Map((snapshot.strategies || []).map(s => [s._id, s]));
        return strategies.map(s => ({ ...s, runtime: bySnapId.get(String(s._id)) || null }));
    }, [strategies, snapshot]);

    const totals = snapshot.totals || {};

    return (
        <div className="p-8 space-y-8">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                        <Zap className="w-7 h-7 text-amber-400" /> Live Tick Strategies
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/40">
                            PAPER ONLY
                        </span>
                    </h1>
                    <p className="text-slate-400 mt-1 text-sm">
                        Sub-second strategies that react to raw tick data — volume bursts, order-flow footprints, premium spikes.
                        These can't be backtested against 1-min candles, so they run paper-only against the live tick stream.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {/* Halt / Resume / Kill — emergency controls */}
                    {snapshot?.engine?.halted ? (
                        <button
                            onClick={handleResume}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold text-sm transition"
                            title="Resume tick engine (allow new entries)"
                        >
                            <Play className="w-4 h-4" /> Resume
                        </button>
                    ) : (
                        <button
                            onClick={handleHalt}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-600/90 hover:bg-amber-700 text-white font-semibold text-sm transition"
                            title="Halt — block new entries; open positions still exit normally"
                        >
                            <Octagon className="w-4 h-4" /> Halt
                        </button>
                    )}
                    <button
                        onClick={handleKillAll}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-sm transition"
                        title="KILL ALL — force-flat every open position + halt entries"
                    >
                        <Power className="w-4 h-4" /> KILL ALL
                    </button>
                    <button
                        onClick={() => openCreate()}
                        disabled={Object.keys(types).length === 0}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:bg-slate-700 disabled:text-slate-500 text-black font-semibold transition"
                    >
                        <Plus className="w-4 h-4" /> New Tick Strategy
                    </button>
                </div>
            </div>

            {/* Halt banner — pulses red when engine is halted */}
            {snapshot?.engine?.halted && (
                <div className="bg-red-950 border border-red-700 rounded-xl p-4 flex items-start gap-3 animate-pulse">
                    <Octagon className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <h3 className="text-red-200 font-bold mb-1">🛑 Tick engine is HALTED — no new entries will fire</h3>
                        <p className="text-red-200/80 text-sm">
                            Halted by <span className="font-mono">{snapshot.engine.haltActor || 'system'}</span>:
                            {' '}<span className="font-semibold">{snapshot.engine.haltReason || '(no reason)'}</span>
                            {snapshot.engine.haltAt && ` · since ${new Date(snapshot.engine.haltAt).toLocaleTimeString()}`}
                        </p>
                        <p className="text-red-200/60 text-xs mt-1">
                            Open positions still exit normally on TP/SL/max-hold. Click <span className="font-semibold">Resume</span> to re-enable new entries.
                        </p>
                    </div>
                </div>
            )}

            {/* Totals strip */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatBox label="Strategies" value={totals.strategyCount ?? strategies.length} icon={Activity} color="violet" />
                <StatBox label="Active" value={totals.activeCount ?? 0} icon={Play} color="green" />
                <StatBox label="Open Paper Positions" value={totals.openPositions ?? 0} icon={Clock} color="amber" />
            </div>

            {/* Strategies list */}
            <div className="bg-surface p-6 rounded-xl border border-slate-700">
                <h2 className="text-lg font-bold text-white mb-4">Deployed Strategies</h2>
                {merged.length === 0 ? (
                    <div className="text-slate-500 text-sm italic text-center py-8">
                        No tick strategies yet. Click <span className="text-amber-400 font-semibold">New Tick Strategy</span> to deploy one — e.g. a Large Order Detector on NIFTY futures to catch institutional fills.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {merged.map(s => <StrategyCard
                            key={s._id}
                            strategy={s}
                            typeMeta={types[s.strategyType]}
                            onToggle={() => toggleActive(s)}
                            onEdit={() => openEdit(s)}
                            onDelete={() => deleteStrategy(s)}
                        />)}
                    </div>
                )}
            </div>

            {/* Live event feed */}
            <div className="bg-surface p-6 rounded-xl border border-slate-700">
                <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-cyan-400" /> Live Event Feed
                    <span className="text-xs font-normal text-slate-500">({snapshot.events?.length || 0} recent)</span>
                </h2>
                {!snapshot.events || snapshot.events.length === 0 ? (
                    <div className="text-slate-500 text-sm italic text-center py-6">
                        Waiting for signals… activate a strategy and let the tick stream do its thing.
                    </div>
                ) : (
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                        {snapshot.events.map(ev => <EventRow key={ev.id} ev={ev} />)}
                    </div>
                )}
            </div>

            {/* Paper trade log */}
            <div className="bg-surface p-6 rounded-xl border border-slate-700">
                <h2 className="text-lg font-bold text-white mb-4">Paper Trade Log <span className="text-xs font-normal text-slate-500">(showing latest {trades.length} of {tradesTotal})</span></h2>
                {trades.length === 0 ? (
                    <div className="text-slate-500 text-sm italic text-center py-6">No trades recorded yet.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="text-xs uppercase text-slate-500 border-b border-slate-700">
                                <tr>
                                    <th className="text-left py-2 pr-3">Time</th>
                                    <th className="text-left py-2 pr-3">Strategy</th>
                                    <th className="text-left py-2 pr-3">Symbol</th>
                                    <th className="text-left py-2 pr-3">Dir</th>
                                    <th className="text-right py-2 pr-3">Entry</th>
                                    <th className="text-right py-2 pr-3">Exit</th>
                                    <th className="text-right py-2 pr-3">PnL pts</th>
                                    <th className="text-right py-2 pr-3" title="Estimated net rupee PnL after Indian options charges + slippage, projected onto an ATM option leg">Net ₹ (est)</th>
                                    <th className="text-right py-2 pr-3">Hold</th>
                                    <th className="text-left py-2 pr-3">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {trades.map(t => {
                                    // For OPEN trades, surface the LIVE unrealized PnL/hold time
                                    // from the snapshot rather than the persisted defaults (0).
                                    // We match the snapshot openPosition by tickTradeId.
                                    const liveOpen = t.status === 'OPEN'
                                        ? (snapshot.strategies || []).find(s => s.openPosition?.tickTradeId === String(t._id))?.openPosition
                                        : null;
                                    const displayPnl = liveOpen?.unrealizedPoints
                                        ?? (t.pnlPoints != null && t.status === 'CLOSED' ? t.pnlPoints : null);
                                    const displayHoldMs = liveOpen?.holdMs ?? t.holdMs;
                                    const displayExit = t.exitPrice != null
                                        ? t.exitPrice.toFixed(2)
                                        : (liveOpen?.currentLtp != null ? `${liveOpen.currentLtp.toFixed(2)} *` : '—');
                                    // Net ₹: from persisted option_estimate on CLOSED rows; from live
                                    // snapshot estimate on OPEN rows; null when book data missing.
                                    const netRupees = t.status === 'CLOSED'
                                        ? t.option_estimate?.net_pnl
                                        : liveOpen?.unrealizedOption?.net_pnl;
                                    const netTooltip = liveOpen?.unrealizedOption
                                        ? `Live estimate — gross ₹${liveOpen.unrealizedOption.gross_pnl?.toFixed(0)}, charges ₹${liveOpen.unrealizedOption.charges?.total?.toFixed(0)}, slippage ₹${liveOpen.unrealizedOption.slippage_cost?.toFixed(0)}`
                                        : t.option_estimate
                                            ? `Gross ₹${t.option_estimate.gross_pnl}, charges ₹${t.option_estimate.charges?.total}, slippage ₹${t.option_estimate.slippage_cost}`
                                            : 'Options-leg estimate not available';
                                    return (
                                        <tr key={t._id} className="border-b border-slate-800 hover:bg-slate-800/40">
                                            <td className="py-2 pr-3 text-slate-400 font-mono text-xs">{new Date(t.entryTime).toLocaleTimeString()}</td>
                                            <td className="py-2 pr-3 text-slate-300">{t.strategyName}</td>
                                            <td className="py-2 pr-3 font-mono text-slate-300 text-xs">{t.symbol}</td>
                                            <td className={`py-2 pr-3 font-bold ${t.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>{t.direction}</td>
                                            <td className="py-2 pr-3 text-right font-mono">{t.entryPrice?.toFixed(2)}</td>
                                            <td className="py-2 pr-3 text-right font-mono" title={liveOpen ? 'Live LTP (position still open)' : ''}>
                                                {displayExit}
                                            </td>
                                            <td className={`py-2 pr-3 text-right font-mono font-bold ${displayPnl == null ? 'text-slate-500' : (displayPnl >= 0 ? 'text-green-400' : 'text-red-400')}`}
                                                title={liveOpen ? 'Unrealized — updates live' : ''}>
                                                {displayPnl != null
                                                    ? (displayPnl >= 0 ? '+' : '') + displayPnl.toFixed(2) + (liveOpen ? ' (live)' : '')
                                                    : '—'}
                                            </td>
                                            <td className={`py-2 pr-3 text-right font-mono ${netRupees == null ? 'text-slate-500' : (netRupees >= 0 ? 'text-green-400' : 'text-red-400')}`}
                                                title={netTooltip}>
                                                {netRupees != null
                                                    ? (netRupees >= 0 ? '+' : '') + Math.round(netRupees).toLocaleString()
                                                    : '—'}
                                            </td>
                                            <td className="py-2 pr-3 text-right font-mono text-slate-400 text-xs">
                                                {displayHoldMs ? `${(displayHoldMs / 1000).toFixed(1)}s` : '—'}
                                            </td>
                                            <td className="py-2 pr-3">
                                                <span className={`text-xs px-2 py-0.5 rounded ${t.status === 'OPEN' ? 'bg-amber-500/20 text-amber-300 animate-pulse' : 'bg-slate-700 text-slate-400'}`}>{t.status}</span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Create / edit modal */}
            {createOpen && (
                <Modal
                    title={editingId ? 'Edit Tick Strategy' : 'Deploy New Tick Strategy'}
                    onClose={() => { setCreateOpen(false); setEditingId(null); }}
                    onSubmit={submitForm}
                    submitLabel={editingId ? 'Save Changes' : 'Deploy (paused)'}
                    loading={loading}
                    error={error}
                >
                    <FormField label="Strategy Type">
                        <select
                            value={form.strategyType}
                            onChange={e => onTypeChange(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200"
                            disabled={!!editingId}
                        >
                            {Object.entries(types).map(([key, meta]) => (
                                <option key={key} value={key}>{meta.label}</option>
                            ))}
                        </select>
                        {form.strategyType && types[form.strategyType] && (
                            <p className="text-xs text-slate-400 mt-2 leading-relaxed">{types[form.strategyType].description}</p>
                        )}
                    </FormField>

                    <FormField label="Name">
                        <input
                            type="text"
                            value={form.name}
                            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                            placeholder="e.g. NIFTY big-order scalp"
                            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200"
                        />
                    </FormField>

                    <FormField label="Underlying">
                        <select
                            value={form.indexSymbol}
                            onChange={e => setForm(f => ({ ...f, indexSymbol: e.target.value, futuresExpiry: '' }))}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200"
                        >
                            <optgroup label="Indices">
                                {Object.entries(INSTRUMENT_CONFIG)
                                    .filter(([k]) => !k.includes('-EQ') && !k.startsWith('MCX:'))
                                    .map(([key, cfg]) => (
                                        <option key={key} value={key}>{cfg.underlying} — {key}</option>
                                    ))}
                            </optgroup>
                            <optgroup label="── Precious Metals (MCX) ──">
                                {Object.entries(INSTRUMENT_CONFIG)
                                    .filter(([k]) => k.startsWith('MCX:') && ['GOLD','GOLDM','GOLDPETAL','SILVER','SILVERMIC','SILVERM'].includes(INSTRUMENT_CONFIG[k].underlying))
                                    .map(([key, cfg]) => (
                                        <option key={key} value={key}>{cfg.displayName || cfg.underlying}</option>
                                    ))}
                            </optgroup>
                            <optgroup label="── Energy (MCX) ──">
                                {Object.entries(INSTRUMENT_CONFIG)
                                    .filter(([k]) => k.startsWith('MCX:') && ['CRUDEOIL','NATURALGAS'].includes(INSTRUMENT_CONFIG[k].underlying))
                                    .map(([key, cfg]) => (
                                        <option key={key} value={key}>{cfg.displayName || cfg.underlying}</option>
                                    ))}
                            </optgroup>
                            <optgroup label="── Base Metals (MCX) ──">
                                {Object.entries(INSTRUMENT_CONFIG)
                                    .filter(([k]) => k.startsWith('MCX:') && ['COPPER','ZINC','ALUMINIUM','LEAD','NICKEL'].includes(INSTRUMENT_CONFIG[k].underlying))
                                    .map(([key, cfg]) => (
                                        <option key={key} value={key}>{cfg.displayName || cfg.underlying}</option>
                                    ))}
                            </optgroup>
                            <optgroup label="Stocks">
                                {Object.entries(INSTRUMENT_CONFIG)
                                    .filter(([k]) => k.includes('-EQ'))
                                    .map(([key, cfg]) => (
                                        <option key={key} value={key}>{cfg.underlying}</option>
                                    ))}
                            </optgroup>
                        </select>
                    </FormField>

                    <FormField label="Data Source">
                        <select
                            value={form.dataSource}
                            onChange={e => setForm(f => ({ ...f, dataSource: e.target.value, futuresExpiry: e.target.value === 'SPOT' ? '' : f.futuresExpiry }))}
                            className="w-full bg-slate-800 border border-blue-800 rounded px-3 py-2 text-slate-200"
                        >
                            <option value="SPOT">Spot / Index (no per-tick volume)</option>
                            <option value="FUT">Futures Contract (recommended)</option>
                        </select>
                        <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                            {form.dataSource === 'SPOT'
                                ? '⚠️ Index spot ticks report vol=0 — volume-driven strategies (Large Order, CVD, VWAP Reversion) will never trigger. Use this only for price-only strategies.'
                                : '✓ Futures contracts carry per-tick traded volume — required for any volume-aware strategy.'}
                        </p>
                    </FormField>

                    {form.dataSource === 'FUT' && (
                        <FormField label="Futures Expiry Date">
                            <select
                                value={form.futuresExpiry}
                                onChange={e => setForm(f => ({ ...f, futuresExpiry: e.target.value }))}
                                className="w-full bg-slate-800 border border-purple-900 rounded px-3 py-2 text-slate-200"
                                disabled={expiryLoading}
                            >
                                <option value="">{expiryLoading ? 'Loading…' : '— select expiry —'}</option>
                                {expiryDates.map(exp => (
                                    <option key={exp.date} value={exp.date} disabled={exp.isPast}>
                                        {exp.label}{exp.isPast ? ' (past)' : ''}
                                    </option>
                                ))}
                            </select>
                            <p className="text-xs text-slate-500 mt-1.5">
                                Most index futures roll monthly. The current-month contract has the deepest liquidity for tick strategies.
                            </p>
                        </FormField>
                    )}

                    <FormField label="Resolved Symbol (sent to Fyers)">
                        <input
                            type="text"
                            value={form.symbol}
                            onChange={e => setForm(f => ({ ...f, symbol: e.target.value }))}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200 font-mono text-sm"
                        />
                        <p className="text-xs text-slate-500 mt-1">
                            Auto-built from the selections above. Editable — type a custom symbol if you need one not in the lists (e.g. <code className="bg-slate-700 px-1">NSE:NIFTY25NOVFUT</code>).
                        </p>
                    </FormField>

                    {form.strategyType && (types[form.strategyType]?.presets?.length > 0) && (() => {
                        const presets = types[form.strategyType].presets;
                        const selected = presets.find(p => p.id === form.presetId);
                        return (
                            <FormField label="Tuning Preset">
                                <select
                                    value={form.presetId}
                                    onChange={e => applyPreset(e.target.value)}
                                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200"
                                >
                                    <option value="">— Custom (manual params below) —</option>
                                    {presets.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                                {selected ? (
                                    <p className="text-xs text-slate-400 mt-2 leading-relaxed p-2 bg-slate-800/60 border border-slate-700 rounded">
                                        <span className="text-amber-300 font-semibold">{selected.name}: </span>
                                        {selected.description}
                                    </p>
                                ) : (
                                    <p className="text-xs text-slate-500 mt-1.5">
                                        Pick a preset to fill the parameters below, then tweak as needed. Presets are heuristic starting points — validate against live ticks before relying on them.
                                    </p>
                                )}
                            </FormField>
                        );
                    })()}

                    {form.strategyType && (
                        <FormField label="Parameters">
                            <div className="grid grid-cols-2 gap-3">
                                {Object.entries(form.params).map(([key, val]) => (
                                    <div key={key}>
                                        <label className="text-[10px] uppercase tracking-wider text-slate-500">{key.replace(/_/g, ' ')}</label>
                                        <input
                                            type="text"
                                            value={val}
                                            onChange={e => setForm(f => ({
                                                ...f,
                                                // Manual edits move the form out of any preset selection so the
                                                // dropdown stops claiming the params match a preset.
                                                presetId: '',
                                                params: { ...f.params, [key]: e.target.value },
                                            }))}
                                            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 text-sm font-mono"
                                        />
                                    </div>
                                ))}
                            </div>
                        </FormField>
                    )}
                </Modal>
            )}
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────

function StatBox({ label, value, icon: Icon, color }) {
    return (
        <div className="bg-surface p-5 rounded-xl border border-slate-700 flex items-center justify-between">
            <div>
                <p className="text-slate-400 text-xs uppercase tracking-wider">{label}</p>
                <h3 className="text-3xl font-bold text-white mt-1">{value}</h3>
            </div>
            <div className={`p-3 rounded-lg bg-${color}-500/10 text-${color}-400`}>
                <Icon className="w-6 h-6" />
            </div>
        </div>
    );
}

function StrategyCard({ strategy: s, typeMeta, onToggle, onEdit, onDelete }) {
    const rt = s.runtime;
    const open = rt?.openPosition;
    const stats = rt?.stats || { totalTrades: 0, wins: 0, totalPnl: 0 };
    const winRate = stats.totalTrades > 0 ? (stats.wins / stats.totalTrades) * 100 : null;
    return (
        <div className="bg-slate-800 rounded-lg border border-slate-600 overflow-hidden">
            <div className="p-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 flex-1 min-w-[200px]">
                    <button
                        onClick={onToggle}
                        title={s.isActive ? 'Pause strategy' : 'Activate strategy'}
                        className={`w-10 h-10 rounded-full flex items-center justify-center transition ${s.isActive ? 'bg-green-500 hover:bg-green-600 text-black' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}
                    >
                        {s.isActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </button>
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-bold text-white">{s.name}</h4>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/40">
                                {typeMeta?.label || s.strategyType}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-700 text-slate-300 font-mono">{s.symbol}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                            {rt?.errors?.autoDeactivatedAt && !s.isActive
                                ? <span className="text-red-400 font-semibold">⚠️ Auto-deactivated (errors)</span>
                                : (s.isActive ? '🟢 Listening to ticks' : '⏸ Paused')}
                            {rt?.errors?.total > 0 && (
                                <span
                                    className={`ml-2 ${rt.errors.consecutive > 0 ? 'text-red-400' : 'text-amber-400'}`}
                                    title={`Last error: ${rt.errors.lastMessage}\n${rt.errors.consecutive > 0 ? `Consecutive: ${rt.errors.consecutive}` : 'Recovered'}`}
                                >
                                    · {rt.errors.total} err{rt.errors.total === 1 ? '' : 's'}
                                    {rt.errors.consecutive > 0 ? ` (${rt.errors.consecutive} streak)` : ''}
                                </span>
                            )}
                            {rt?.health && s.isActive && (
                                <span className={`ml-2 ${rt.health.warnedNoVol ? 'text-amber-400' : 'text-slate-500'}`}>
                                    · <span className={rt.health.ticksPerSec > 0 ? 'text-cyan-400 font-semibold' : ''}>{rt.health.ticksPerSec || 0} t/s</span>
                                    {' '}({rt.health.totalTicks} total
                                    {rt.health.totalTicks > 0 && (
                                        rt.health.ticksWithVol > 0
                                            ? `, ${Math.round((rt.health.ticksWithVol / rt.health.totalTicks) * 100)}% w/vol`
                                            : ', no volume — wrong symbol?'
                                    )})
                                </span>
                            )}
                            {open && (
                                <span className="ml-1">
                                    {' · '}
                                    Open <span className={open.direction === 'LONG' ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>{open.direction}</span>
                                    {' @ '}{open.entryPrice?.toFixed(2)}, held {(open.holdMs / 1000).toFixed(1)}s
                                    {open.unrealizedPoints != null && (
                                        <span className={`ml-1 font-mono ${open.unrealizedPoints >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                            ({open.unrealizedPoints >= 0 ? '+' : ''}{open.unrealizedPoints.toFixed(2)} pts)
                                        </span>
                                    )}
                                    {open.unrealizedOption?.net_pnl != null && (
                                        <span className={`ml-1 font-mono ${open.unrealizedOption.net_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}
                                              title={`Estimated net option-leg PnL if closed now (gross ₹${open.unrealizedOption.gross_pnl?.toFixed(0)}, charges ₹${open.unrealizedOption.charges?.total?.toFixed(0)}, slippage ₹${open.unrealizedOption.slippage_cost?.toFixed(0)})`}>
                                            · est net ₹{open.unrealizedOption.net_pnl >= 0 ? '+' : ''}{open.unrealizedOption.net_pnl.toFixed(0)}
                                        </span>
                                    )}
                                </span>
                            )}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                    <Stat label="Trades" value={stats.totalTrades} />
                    <Stat
                        label="Win % (net)"
                        value={
                            stats.totalTrades > 0 && stats.winsNet != null
                                ? `${((stats.winsNet / stats.totalTrades) * 100).toFixed(0)}%`
                                : (winRate != null ? `${winRate.toFixed(0)}%*` : '—')
                        }
                    />
                    <Stat
                        label="PnL pts"
                        value={(stats.totalPnl >= 0 ? '+' : '') + stats.totalPnl.toFixed(2)}
                        color={stats.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}
                    />
                    <Stat
                        label="Net ₹ (est)"
                        value={
                            stats.optionNetPnl != null
                                ? (stats.optionNetPnl >= 0 ? '+' : '') + Math.round(stats.optionNetPnl).toLocaleString()
                                : '—'
                        }
                        color={(stats.optionNetPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}
                    />
                    <button onClick={onEdit} className="text-xs px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200">Edit</button>
                    <button onClick={onDelete} className="p-2 rounded text-red-400 hover:bg-red-500/10" title="Delete">
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}

function Stat({ label, value, color = 'text-white' }) {
    return (
        <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
            <p className={`font-bold font-mono ${color}`}>{value}</p>
        </div>
    );
}

function EventRow({ ev }) {
    const isEntry = ev.kind === 'ENTRY';
    const isWarn  = ev.kind === 'WARNING';
    const Icon = isWarn ? AlertTriangle
        : isEntry ? (ev.direction === 'LONG' ? TrendingUp : TrendingDown)
        : Clock;
    const color = isWarn ? 'text-amber-400'
        : isEntry ? (ev.direction === 'LONG' ? 'text-green-400' : 'text-red-400')
        : (ev.pnl >= 0 ? 'text-green-400' : 'text-red-400');
    const rowCls = isWarn
        ? 'bg-amber-900/20 border-amber-700/40'
        : 'bg-slate-900/40 border-slate-800';
    return (
        <div className={`flex items-start gap-3 p-2 rounded border ${rowCls}`}>
            <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${color}`} />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap text-sm">
                    <span className={`font-bold ${color}`}>{ev.kind}</span>
                    <span className="text-slate-300">{ev.strategyName}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 font-mono">{ev.symbol}</span>
                    {ev.direction && (
                        <span className={`text-xs font-bold ${ev.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>{ev.direction}</span>
                    )}
                    {isEntry && <span className="text-xs text-slate-400 font-mono">@ {ev.entryPrice?.toFixed(2)}</span>}
                    {ev.kind === 'EXIT' && (
                        <span className="text-xs text-slate-400 font-mono">
                            {ev.entryPrice?.toFixed(2)} → {ev.exitPrice?.toFixed(2)} · {(ev.pnlPoints >= 0 ? '+' : '') + ev.pnlPoints?.toFixed(2)} pts · {(ev.holdMs / 1000).toFixed(1)}s
                        </span>
                    )}
                    <span className="text-xs text-slate-500 ml-auto font-mono">{new Date(ev.time).toLocaleTimeString()}</span>
                </div>
                <p className={`text-xs mt-0.5 ${isWarn ? 'text-amber-200' : 'text-slate-500 truncate'}`}>{ev.reason}</p>
            </div>
        </div>
    );
}

function Modal({ title, children, onClose, onSubmit, submitLabel, loading, error }) {
    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6">
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-5">
                    <h3 className="text-lg font-bold text-white">{title}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
                </div>
                <div className="space-y-4">{children}</div>
                {error && <p className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded p-3">{error}</p>}
                <div className="flex justify-end gap-2 mt-6">
                    <button onClick={onClose} className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-200">Cancel</button>
                    <button
                        onClick={onSubmit}
                        disabled={loading}
                        className="px-4 py-2 rounded bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-black font-semibold"
                    >
                        {loading ? 'Saving…' : submitLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}

function FormField({ label, children }) {
    return (
        <div>
            <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1.5">{label}</label>
            {children}
        </div>
    );
}
