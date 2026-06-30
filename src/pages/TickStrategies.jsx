import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { Zap, Plus, Play, Pause, Trash2, Activity, TrendingUp, TrendingDown, Clock, AlertTriangle, Octagon, Power, Eye, Square, Layers, Sliders } from 'lucide-react';
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

    // ── Tick Recordings state ─────────────────────────────────────────────
    // Recordings live in their own collection on the backend; they are not
    // piggy-backed onto the tick_strategy_event snapshot, so we poll the list
    // endpoint on a short interval. See §5.5 of the design spec.
    const [recordings, setRecordings] = useState([]);
    const [recordingFormOpen, setRecordingFormOpen] = useState(false);
    const [samplePreview, setSamplePreview] = useState({ open: false, recordingId: null });
    const [replayModal, setReplayModal] = useState({ open: false, recordingId: null });
    // Backend feature-gate: older backends don't expose /api/tick-recordings.
    // We start optimistic (true) and flip to false the first time the list
    // fetch returns a 404 (route not mounted) so the entire section + "New
    // Recording" button get hidden instead of rendering broken ghosts.
    const [recordingsSupported, setRecordingsSupported] = useState(true);

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

    // ── Recordings fetch + poll ───────────────────────────────────────────
    // Independent poll (NOT piggy-backed on the tick_strategy_event socket)
    // because recording status is not user-facing-urgent — a 3s lag on tick
    // counts is invisible. See §5.5.
    const fetchRecordings = async () => {
        try {
            const r = await axios.get(`${API_URL}/tick-recordings`);
            setRecordings(r.data.recordings || []);
            // First successful fetch confirms the backend supports recordings.
            // (Idempotent — repeated sets to true are cheap.)
            setRecordingsSupported(true);
        } catch (err) {
            // 404 → route not mounted (older backend). Hide the section
            // entirely so the user isn't shown a broken empty list with
            // disabled buttons. Other errors (network blip, 500) keep the
            // section visible so it can recover on the next poll.
            if (err.response?.status === 404) {
                setRecordingsSupported(false);
            } else {
                console.warn('Failed to fetch recordings:', err.message);
            }
        }
    };
    useEffect(() => {
        let cancelled = false;
        const tick = async () => {
            if (cancelled) return;
            await fetchRecordings();
        };
        tick();
        const interval = setInterval(tick, 3000);
        return () => { cancelled = true; clearInterval(interval); };
    }, []);

    const startRecording = async ({ name, symbols, autoStopMinutes }) => {
        const payload = { name, symbols };
        if (autoStopMinutes != null && autoStopMinutes !== '') {
            payload.autoStopMinutes = Number(autoStopMinutes);
        }
        await axios.post(`${API_URL}/tick-recordings/start`, payload);
        await fetchRecordings();
    };

    // Optimistic UI: flip the row to STOPPED locally so the action buttons
    // (sample / replay / delete) become enabled immediately. Roll back to
    // the prior state on error.
    const stopRecording = async (rec) => {
        const prev = recordings;
        setRecordings(curr => curr.map(r => r._id === rec._id
            ? { ...r, status: 'STOPPED', stoppedAt: new Date().toISOString(), isActive: false }
            : r));
        try {
            await axios.post(`${API_URL}/tick-recordings/${rec._id}/stop`);
            await fetchRecordings();
        } catch (err) {
            setRecordings(prev);
            alert('Stop failed: ' + (err.response?.data?.error || err.message));
            fetchRecordings();
        }
    };

    const deleteRecording = async (rec) => {
        if (!window.confirm(`Delete recording "${rec.name}" and all ${(rec.tickCount || 0).toLocaleString()} ticks? This cannot be undone.`)) return;
        const prev = recordings;
        setRecordings(curr => curr.filter(r => r._id !== rec._id));
        try {
            await axios.delete(`${API_URL}/tick-recordings/${rec._id}`);
            await fetchRecordings();
        } catch (err) {
            setRecordings(prev);
            alert('Delete failed: ' + (err.response?.data?.error || err.message));
            fetchRecordings();
        }
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

    // Optimistic UI: flip isActive in local state immediately so rapid
    // start/stop/start clicks reflect the *latest* user intent instead of
    // showing stale state for the duration of the API round-trip. On error
    // we roll back to the pre-click value AND refetch so the UI reconverges
    // with the server (covers the case where the server processed the call
    // but returned an error after partial mutation).
    const toggleActive = async (s) => {
        const prev = s.isActive;
        const next = !prev;
        setStrategies(curr => curr.map(x => x._id === s._id ? { ...x, isActive: next } : x));
        try {
            await axios.post(`${API_URL}/tick-strategies/${s._id}/toggle`, { isActive: next });
            // Refresh to pick up runtime state (open positions, hit counters)
            // that the optimistic flip doesn't know about.
            await fetchAll();
        } catch (err) {
            // Roll back the optimistic update.
            setStrategies(curr => curr.map(x => x._id === s._id ? { ...x, isActive: prev } : x));
            alert('Toggle failed: ' + (err.response?.data?.error || err.message));
            // Re-sync from server in case our snapshot has drifted.
            fetchAll();
        }
    };

    const deleteStrategy = async (s) => {
        if (!window.confirm(`Delete "${s.name}"? Open paper position (if any) will be closed at last LTP.`)) return;
        // Optimistic remove. If the server rejects (rare — usually a race
        // with another tab deleting first) we re-add it on rollback by
        // refetching the canonical list.
        const prev = strategies;
        setStrategies(curr => curr.filter(x => x._id !== s._id));
        try {
            await axios.delete(`${API_URL}/tick-strategies/${s._id}`);
            await fetchAll();
        } catch (err) {
            setStrategies(prev);
            alert('Delete failed: ' + (err.response?.data?.error || err.message));
            fetchAll();
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
                            {snapshot.engine.haltAt && ` · since ${new Date(snapshot.engine.haltAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} IST`}
                        </p>
                        <p className="text-red-200/60 text-xs mt-1">
                            Open positions still exit normally on TP/SL/max-hold.
                        </p>
                    </div>
                    {/* Prominent Resume button inside the banner — the toolbar button is easy to miss when halted. */}
                    <button
                        onClick={handleResume}
                        className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-lg flex-shrink-0 self-center shadow-lg shadow-green-900/50"
                        title="Resume tick engine (allow new entries)"
                    >
                        <Play className="w-4 h-4" /> Resume Engine
                    </button>
                </div>
            )}

            {/* Market-hours pill — hidden on older backends that don't emit engine.marketOpen */}
            {snapshot?.engine?.marketOpen !== undefined && (() => {
                const exch = snapshot.engine.exchange || 'NSE';
                if (snapshot.engine.marketOpen) {
                    const closesAt = snapshot.engine.sessionClosesAt
                        ? new Date(snapshot.engine.sessionClosesAt).toLocaleTimeString('en-IN', {
                            timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
                        })
                        : '—';
                    return (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-500/40">
                            ● {exch} Open — closes {closesAt} IST
                        </span>
                    );
                }
                let dayLabel = '—';
                let timeLabel = '—';
                if (snapshot.engine.nextSessionAt) {
                    const d = new Date(snapshot.engine.nextSessionAt);
                    dayLabel = d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' });
                    timeLabel = d.toLocaleTimeString('en-IN', {
                        timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
                    });
                }
                return (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        ● {exch} Closed — next open {dayLabel} {timeLabel} IST
                    </span>
                );
            })()}

            {/* Totals strip — includes today's aggregate net P&L vs the loss limit
                (the number the auto-halt fires on; per-strategy cards only show
                their own slice, so this is the figure that explains a halt). */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatBox label="Strategies" value={totals.strategyCount ?? strategies.length} icon={Activity} color="violet" />
                <StatBox label="Active" value={totals.activeCount ?? 0} icon={Play} color="green" />
                <StatBox label="Open Paper Positions" value={totals.openPositions ?? 0} icon={Clock} color="amber" />
                {(() => {
                    const e = snapshot?.engine || {};
                    const net = e.dailyNetPnl ?? 0;
                    const limit = e.dailyLossLimit ?? 0;
                    const entries = e.dailyEntries ?? 0;
                    const maxEntries = e.maxEntriesPerSession ?? 0;
                    const pos = net >= 0;
                    return (
                        <StatBox
                            label="Today's Net P&L (all strategies)"
                            value={`${pos ? '+' : '−'}₹${Math.abs(Math.round(net)).toLocaleString('en-IN')}`}
                            icon={pos ? TrendingUp : TrendingDown}
                            color={pos ? 'green' : 'rose'}
                            valueClass={pos ? 'text-emerald-400' : 'text-rose-400'}
                            subtext={`${limit > 0 ? `auto-halt at −₹${limit.toLocaleString('en-IN')} · ` : ''}${entries}${maxEntries > 0 ? `/${maxEntries}` : ''} entries today`}
                        />
                    );
                })()}
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
                            engineMarketOpen={snapshot?.engine?.marketOpen}
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

            {/* Tick Recordings — captures raw tick stream for replay/backtest.
                Sits between Live Event Feed and Paper Trade Log per the design
                spec's cognitive flow: strategies → events → recordings → trades.
                Gated behind recordingsSupported so older backends (without the
                /api/tick-recordings route) don't render a misleading empty
                section with disabled action buttons. */}
            {recordingsSupported && (
                <div className="bg-surface p-6 rounded-xl border border-slate-700">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-lg font-bold text-white flex items-center gap-2">
                            <Layers className="w-5 h-5 text-cyan-400" /> Tick Recordings
                            <span className="text-xs font-normal text-slate-500">({recordings.length})</span>
                        </h2>
                        <button
                            onClick={() => setRecordingFormOpen(true)}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-black font-semibold text-sm transition"
                        >
                            <Plus className="w-4 h-4" /> New Recording
                        </button>
                    </div>
                    <RecordingList
                        recordings={recordings}
                        onStop={stopRecording}
                        onDelete={deleteRecording}
                        onSample={(rec) => setSamplePreview({ open: true, recordingId: rec._id })}
                        onReplay={(rec) => setReplayModal({ open: true, recordingId: rec._id })}
                    />
                </div>
            )}

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
                                    <th className="text-left py-2 pr-3">Date · Time</th>
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
                                            <td className="py-2 pr-3 text-slate-400 font-mono text-xs whitespace-nowrap">{new Date(t.entryTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</td>
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

            {/* Recording form modal */}
            {recordingFormOpen && (
                <RecordingForm
                    onClose={() => setRecordingFormOpen(false)}
                    onSubmit={async (payload) => {
                        await startRecording(payload);
                        setRecordingFormOpen(false);
                    }}
                />
            )}

            {/* Sample preview modal */}
            {samplePreview.open && (
                <SamplePreviewModal
                    recording={recordings.find(r => r._id === samplePreview.recordingId)}
                    onClose={() => setSamplePreview({ open: false, recordingId: null })}
                />
            )}

            {/* Replay modal */}
            {replayModal.open && (
                <ReplayModal
                    recording={recordings.find(r => r._id === replayModal.recordingId)}
                    types={types}
                    onClose={() => setReplayModal({ open: false, recordingId: null })}
                />
            )}
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────

function StatBox({ label, value, icon: Icon, color, subtext, valueClass = 'text-white' }) {
    return (
        <div className="bg-surface p-5 rounded-xl border border-slate-700 flex items-center justify-between">
            <div>
                <p className="text-slate-400 text-xs uppercase tracking-wider">{label}</p>
                <h3 className={`text-3xl font-bold mt-1 ${valueClass}`}>{value}</h3>
                {subtext && <p className="text-[11px] text-slate-500 mt-1">{subtext}</p>}
            </div>
            <div className={`p-3 rounded-lg bg-${color}-500/10 text-${color}-400`}>
                <Icon className="w-6 h-6" />
            </div>
        </div>
    );
}

function StrategyCard({ strategy: s, typeMeta, engineMarketOpen, onToggle, onEdit, onDelete }) {
    const rt = s.runtime;
    const open = rt?.openPosition;
    const stats = rt?.stats || { totalTrades: 0, wins: 0, totalPnl: 0 };
    const winRate = stats.totalTrades > 0 ? (stats.wins / stats.totalTrades) * 100 : null;

    // Stream-health dot + label. Falls back to the legacy 🟢/⏸ behavior when
    // the backend hasn't surfaced engine.marketOpen (older snapshot shape).
    const tps = rt?.health?.ticksPerSec ?? 0;
    const totalTicks = rt?.health?.totalTicks ?? 0;
    let streamDot = null;        // emoji dot prefix
    let streamSuffix = '';       // extra suffix appended to the listening label
    if (s.isActive) {
        if (engineMarketOpen === undefined) {
            streamDot = '🟢';    // legacy fallback
        } else if (engineMarketOpen === false) {
            streamDot = '⚪';
            streamSuffix = ' (market closed)';
        } else if (tps > 0) {
            streamDot = '🟢';
        } else if (totalTicks > 0) {
            streamDot = '🟡';
            streamSuffix = ' (stale)';
        } else {
            streamDot = '🔴';
        }
    }
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
                                : (s.isActive ? `${streamDot} Listening to ticks${streamSuffix}` : '⏸ Paused')}
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
    const isExit  = ev.kind === 'EXIT';
    const isWarn  = ev.kind === 'WARNING';
    const isStreamHealthy = ev.kind === 'STREAM_HEALTHY';
    const isStreamStale   = ev.kind === 'STREAM_STALE';
    const Icon = isWarn || isStreamStale ? AlertTriangle
        : isStreamHealthy ? Activity
        : isEntry ? (ev.direction === 'LONG' ? TrendingUp : TrendingDown)
        : Clock;
    const color = isWarn || isStreamStale ? 'text-amber-400'
        : isStreamHealthy ? 'text-green-400'
        : isEntry ? (ev.direction === 'LONG' ? 'text-green-400' : 'text-red-400')
        : isExit ? (ev.pnl >= 0 ? 'text-green-400' : 'text-red-400')
        : 'text-slate-400';
    const rowCls = isWarn || isStreamStale
        ? 'bg-amber-900/20 border-amber-700/40'
        : isStreamHealthy
            ? 'bg-green-900/10 border-green-800/40'
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
                            {ev.entryPrice?.toFixed(2)} → {ev.exitPrice?.toFixed(2)}
                            {ev.pnlPoints != null && ` · ${ev.pnlPoints >= 0 ? '+' : ''}${ev.pnlPoints.toFixed(2)} pts`}
                            {ev.holdMs != null && ` · ${(ev.holdMs / 1000).toFixed(1)}s`}
                        </span>
                    )}
                    <span className="text-xs text-slate-500 ml-auto font-mono">{new Date(ev.time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>
                </div>
                <p className={`text-xs mt-0.5 ${isWarn || isStreamStale ? 'text-amber-200' : isStreamHealthy ? 'text-green-200' : 'text-slate-500 truncate'}`}>{ev.reason}</p>
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

// ────────────────────────────────────────────────────────────────────────
// Tick Recordings sub-components
// ────────────────────────────────────────────────────────────────────────

// Compact, human-readable duration. "12m 34s" / "1h 02m" / "3s".
function formatDuration(ms) {
    if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
    return `${s}s`;
}

function formatBytes(bytes) {
    if (!bytes || bytes < 1024) return `${bytes || 0} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function RecordingStatusPill({ status }) {
    let cls = 'bg-slate-700 text-slate-300';
    let pulsing = false;
    if (status === 'RECORDING') { cls = 'bg-green-500/20 text-green-300 border border-green-500/40'; pulsing = true; }
    else if (status === 'STOPPED') { cls = 'bg-slate-700 text-slate-300 border border-slate-600'; }
    else if (status === 'INCOMPLETE_STOPPED') { cls = 'bg-amber-500/20 text-amber-300 border border-amber-500/40'; }
    else if (status === 'ERROR') { cls = 'bg-red-500/20 text-red-300 border border-red-500/40'; }
    return (
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${cls} ${pulsing ? 'animate-pulse' : ''}`}>
            {status}
        </span>
    );
}

function RecordingList({ recordings, onStop, onDelete, onSample, onReplay }) {
    // Tick state used to refresh duration/age cells once per second without
    // calling Date.now() during render (which the lint rule flags as impure).
    const [nowTs, setNowTs] = useState(() => Date.now());
    useEffect(() => {
        const i = setInterval(() => setNowTs(Date.now()), 1000);
        return () => clearInterval(i);
    }, []);

    if (!recordings || recordings.length === 0) {
        return (
            <div className="text-slate-500 text-sm italic text-center py-8">
                No recordings yet. Click <span className="text-amber-400 font-semibold">New Recording</span> to capture a live tick stream for replay.
            </div>
        );
    }
    return (
        <div className="space-y-3">
            {recordings.map(rec => {
                const isActive = rec.status === 'RECORDING';
                const startedAt = rec.startedAt ? new Date(rec.startedAt) : null;
                const stoppedAt = rec.stoppedAt ? new Date(rec.stoppedAt) : null;
                const durationMs = startedAt
                    ? (stoppedAt ? stoppedAt.getTime() : nowTs) - startedAt.getTime()
                    : null;
                const ageMs = startedAt ? nowTs - startedAt.getTime() : null;
                const symbolsList = Array.isArray(rec.symbols) ? rec.symbols : [];
                const visibleSymbols = symbolsList.slice(0, 3);
                const extraSymbols = Math.max(0, symbolsList.length - visibleSymbols.length);
                return (
                    <div key={rec._id} className="bg-slate-800 rounded-lg border border-slate-600 p-4">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                            <div className="flex-1 min-w-[200px]">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h4 className="font-bold text-white">{rec.name}</h4>
                                    <RecordingStatusPill status={rec.status} />
                                    {rec.autoStopMinutes != null && isActive && (
                                        <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/40">
                                            auto-stop {rec.autoStopMinutes}m
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                                    {visibleSymbols.map(sym => (
                                        <span key={sym} className="text-[10px] px-2 py-0.5 rounded bg-slate-700 text-slate-300 font-mono">{sym}</span>
                                    ))}
                                    {extraSymbols > 0 && (
                                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-700 text-slate-400">+{extraSymbols} more</span>
                                    )}
                                </div>
                                {rec.errorMessage && (
                                    <p className="text-xs text-red-400 mt-1 truncate" title={rec.errorMessage}>⚠ {rec.errorMessage}</p>
                                )}
                            </div>
                            <div className="flex items-center gap-4 text-sm">
                                <Stat label="Ticks" value={(rec.tickCount || 0).toLocaleString()} />
                                <Stat label="Duration" value={formatDuration(durationMs)} />
                                <Stat label="Age" value={formatDuration(ageMs)} />
                                <Stat label="Size" value={formatBytes(rec.sizeBytesEstimate)} />
                                <div className="flex items-center gap-1">
                                    {isActive && (
                                        <button
                                            onClick={() => onStop(rec)}
                                            title="Stop recording"
                                            className="p-2 rounded text-amber-400 hover:bg-amber-500/10"
                                        >
                                            <Square className="w-4 h-4" />
                                        </button>
                                    )}
                                    <button
                                        onClick={() => onSample(rec)}
                                        title="Sample first 100 ticks"
                                        className="p-2 rounded text-cyan-400 hover:bg-cyan-500/10"
                                        disabled={!rec.tickCount}
                                    >
                                        <Eye className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => onReplay(rec)}
                                        title="Replay against a strategy"
                                        className="p-2 rounded text-violet-400 hover:bg-violet-500/10"
                                        disabled={!rec.tickCount || isActive}
                                    >
                                        <Play className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => onDelete(rec)}
                                        title="Delete recording"
                                        className="p-2 rounded text-red-400 hover:bg-red-500/10"
                                        disabled={isActive}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// RecordingForm — modal to create a new recording.
// Symbol catalog mirrors the strategy create form (lines 573–615) — same
// optgroups, with multi-select chip UI on top.
function RecordingForm({ onClose, onSubmit }) {
    const [name, setName] = useState('');
    const [symbols, setSymbols] = useState([]);
    const [autoStopMinutes, setAutoStopMinutes] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // ── Per-symbol picker (mirrors the strategy-create modal pattern) ──
    // The user picks an index + data source + (when FUT) expiry, then clicks
    // "Add" to push the resolved symbol into the chip list above. This lets
    // the recorder capture FUT contracts (which carry vol) instead of being
    // limited to INDEX spot symbols (vol=0). The flow is identical to "New
    // Strategy" so the operator gets a familiar UX.
    const [pickerIndex, setPickerIndex] = useState('');
    const [pickerDataSource, setPickerDataSource] = useState('FUT');  // default FUT — recording vol matters
    const [pickerExpiry, setPickerExpiry] = useState('');
    const [pickerExpiryDates, setPickerExpiryDates] = useState([]);
    const [pickerExpiryLoading, setPickerExpiryLoading] = useState(false);

    // Index keys that support a meaningful SPOT (the -INDEX or -EQ key). MCX
    // entries are futures-only in this codebase, so the SPOT toggle is hidden
    // for them. We treat any key without -INDEX/-EQ suffix as futures-only.
    const pickerCfg = pickerIndex ? INSTRUMENT_CONFIG[pickerIndex] : null;
    const pickerSupportsSpot = pickerIndex
        && (pickerIndex.includes('-INDEX') || pickerIndex.includes('-EQ'));
    const pickerSupportsFut  = !!pickerCfg;  // anything in the config has a futures contract

    // Force FUT when SPOT isn't available (MCX, etc.)
    useEffect(() => {
        if (pickerIndex && !pickerSupportsSpot && pickerDataSource !== 'FUT') {
            setPickerDataSource('FUT');
        }
    }, [pickerIndex, pickerSupportsSpot, pickerDataSource]);

    // Fetch expiries when (index, dataSource=FUT) is selected. Cached implicitly
    // by React effect deps — re-fetches only when the index changes.
    useEffect(() => {
        if (pickerDataSource !== 'FUT' || !pickerIndex || !pickerCfg) {
            setPickerExpiryDates([]);
            return;
        }
        let cancelled = false;
        setPickerExpiryLoading(true);
        fetchExpiriesForSymbol(pickerIndex, 4, 1)
            .then(list => {
                if (cancelled) return;
                setPickerExpiryDates(list);
                setPickerExpiry(prev => {
                    if (prev) return prev;
                    const next = list.find(e => !e.isPast) || list[0];
                    return next ? next.date : '';
                });
            })
            .catch(err => console.warn('Expiry fetch failed:', err.message))
            .finally(() => { if (!cancelled) setPickerExpiryLoading(false); });
        return () => { cancelled = true; };
    }, [pickerIndex, pickerDataSource, pickerCfg]);

    // Reset the expiry pick whenever the index changes so we don't keep a
    // stale expiry from a different underlying.
    useEffect(() => { setPickerExpiry(''); }, [pickerIndex]);

    // Resolve the final symbol the recorder will subscribe to.
    const resolvedPickerSymbol = (() => {
        if (!pickerIndex || !pickerCfg) return null;
        if (pickerDataSource === 'SPOT') return pickerIndex;
        // FUT path — need expiry
        return buildFuturesSymbol(pickerIndex, pickerExpiry);
    })();

    const addSymbol = (sym) => {
        if (!sym) return;
        if (symbols.includes(sym)) return;
        if (symbols.length >= 10) {
            setError('Max 10 symbols per recording.');
            return;
        }
        setSymbols([...symbols, sym]);
        setError(null);
    };
    const removeSymbol = (sym) => setSymbols(symbols.filter(s => s !== sym));
    const handleAddPicked = () => {
        if (!resolvedPickerSymbol) return;
        addSymbol(resolvedPickerSymbol);
        // Reset the expiry so the next add starts clean. Keep the index +
        // dataSource so the user can quickly add multiple expiries.
        setPickerExpiry('');
    };

    const handleSubmit = async () => {
        setError(null);
        if (!name.trim()) { setError('Name is required.'); return; }
        if (symbols.length === 0) { setError('Pick at least one symbol.'); return; }
        if (autoStopMinutes !== '') {
            const n = Number(autoStopMinutes);
            if (!Number.isFinite(n) || n < 1 || n > 1440) {
                setError('Auto-stop minutes must be between 1 and 1440.');
                return;
            }
        }
        setLoading(true);
        try {
            await onSubmit({
                name: name.trim(),
                symbols,
                autoStopMinutes: autoStopMinutes === '' ? null : Number(autoStopMinutes),
            });
        } catch (err) {
            setError(err.response?.data?.error || err.message);
        } finally {
            setLoading(false);
        }
    };

    // Same optgroups as strategy create form — picker-only dropdown that
    // populates the chip list above when its value changes.
    return (
        <Modal
            title="New Tick Recording"
            onClose={onClose}
            onSubmit={handleSubmit}
            submitLabel="Start Recording"
            loading={loading}
            error={error}
        >
            <FormField label="Name">
                <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. NIFTY Spot 9:30-10:00"
                    maxLength={100}
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200"
                />
            </FormField>

            <FormField label={`Symbols (${symbols.length}/10)`}>
                <div className="flex items-center gap-1.5 flex-wrap mb-2 min-h-[28px]">
                    {symbols.length === 0 && (
                        <span className="text-xs text-slate-500 italic">No symbols picked yet.</span>
                    )}
                    {symbols.map(sym => (
                        <span key={sym} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/40 font-mono">
                            {sym}
                            <button
                                type="button"
                                onClick={() => removeSymbol(sym)}
                                className="text-violet-300 hover:text-white text-sm leading-none"
                                aria-label={`Remove ${sym}`}
                            >×</button>
                        </span>
                    ))}
                </div>
                {/* Index + Data Source + (optional) Expiry → resolves to a
                    single symbol that the [+ Add] button pushes onto the chip
                    list above. Same UX as the New Strategy modal. */}
                <div className="grid grid-cols-12 gap-2">
                    <select
                        value={pickerIndex}
                        onChange={e => setPickerIndex(e.target.value)}
                        className="col-span-5 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200 text-sm"
                    >
                        <option value="">— pick underlying —</option>
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

                    {/* Data Source — disabled (forced FUT) when SPOT isn't meaningful */}
                    <select
                        value={pickerDataSource}
                        onChange={e => setPickerDataSource(e.target.value)}
                        disabled={!pickerIndex || !pickerSupportsSpot}
                        title={!pickerSupportsSpot && pickerIndex ? 'This underlying is futures-only.' : ''}
                        className="col-span-3 bg-slate-800 border border-slate-700 rounded px-2 py-2 text-slate-200 text-sm disabled:opacity-50"
                    >
                        {pickerSupportsSpot && <option value="SPOT">Spot</option>}
                        {pickerSupportsFut  && <option value="FUT">Futures</option>}
                    </select>

                    {/* Expiry (only shown for FUT) */}
                    {pickerDataSource === 'FUT' ? (
                        <select
                            value={pickerExpiry}
                            onChange={e => setPickerExpiry(e.target.value)}
                            disabled={!pickerIndex || pickerExpiryLoading || pickerExpiryDates.length === 0}
                            className="col-span-3 bg-slate-800 border border-slate-700 rounded px-2 py-2 text-slate-200 text-sm disabled:opacity-50"
                        >
                            {pickerExpiryLoading && <option value="">Loading…</option>}
                            {!pickerExpiryLoading && pickerExpiryDates.length === 0 && (
                                <option value="">— no expiries —</option>
                            )}
                            {!pickerExpiryLoading && pickerExpiryDates.map(exp => (
                                <option key={exp.date} value={exp.date}>
                                    {exp.label || exp.date}{exp.isPast ? ' (past)' : ''}
                                </option>
                            ))}
                        </select>
                    ) : (
                        <div className="col-span-3 text-xs text-slate-500 italic flex items-center px-2">
                            (no expiry for spot)
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={handleAddPicked}
                        disabled={!resolvedPickerSymbol}
                        className="col-span-1 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded px-2 py-2 text-sm font-semibold"
                        title={resolvedPickerSymbol || 'Pick an underlying first'}
                    >+ Add</button>
                </div>

                {/* Live preview of the resolved symbol below the picker row */}
                <p className="text-xs mt-1.5">
                    {resolvedPickerSymbol ? (
                        <span className="text-violet-300">Will add: <code className="bg-slate-700 px-1 font-mono">{resolvedPickerSymbol}</code></span>
                    ) : (
                        <span className="text-slate-500">
                            Pick an underlying, then (for futures) pick an expiry. Index spot ticks report vol=0 — use Futures for volume-aware replays.
                        </span>
                    )}
                </p>
            </FormField>

            <FormField label="Auto-Stop Minutes (optional)">
                <input
                    type="number"
                    min="1"
                    max="1440"
                    value={autoStopMinutes}
                    onChange={e => setAutoStopMinutes(e.target.value)}
                    placeholder="leave blank for manual stop"
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200"
                />
                <p className="text-xs text-slate-500 mt-1.5">
                    Recording stops automatically after this many minutes. Range 1–1440. Leave blank to require a manual stop.
                </p>
            </FormField>
        </Modal>
    );
}

// SamplePreviewModal — fetches /sample?limit=N and renders a scrollable
// table. Supports per-symbol filtering when the recording has >1 symbol
// and "Load N more" up to 500 (the server cap).
function SamplePreviewModal({ recording, onClose }) {
    const [ticks, setTicks] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [limit, setLimit] = useState(100);
    const [symbolFilter, setSymbolFilter] = useState('');

    useEffect(() => {
        if (!recording) return;
        let cancelled = false;
        const fetchSample = async () => {
            setLoading(true);
            setError(null);
            try {
                const params = new URLSearchParams();
                params.set('limit', String(limit));
                if (symbolFilter) params.set('symbol', symbolFilter);
                const r = await axios.get(`${API_URL}/tick-recordings/${recording._id}/sample?${params.toString()}`);
                if (!cancelled) setTicks(r.data.ticks || []);
            } catch (err) {
                if (!cancelled) setError(err.response?.data?.error || err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        fetchSample();
        return () => { cancelled = true; };
    }, [recording, limit, symbolFilter]);

    if (!recording) return null;
    const symbols = Array.isArray(recording.symbols) ? recording.symbols : [];

    return (
        <Modal
            title={`Sample — ${recording.name}`}
            onClose={onClose}
            onSubmit={onClose}
            submitLabel="Close"
            loading={false}
            error={error}
        >
            <div className="flex items-center gap-3 flex-wrap mb-2">
                <span className="text-xs text-slate-400">
                    Showing first {ticks.length} of {(recording.tickCount || 0).toLocaleString()} ticks
                </span>
                {symbols.length > 1 && (
                    <select
                        value={symbolFilter}
                        onChange={e => setSymbolFilter(e.target.value)}
                        className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs"
                    >
                        <option value="">All symbols</option>
                        {symbols.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                )}
                {limit < 500 && (
                    <button
                        onClick={() => setLimit(Math.min(500, limit + 100))}
                        className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
                        disabled={loading}
                    >
                        Load 100 more
                    </button>
                )}
            </div>
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto border border-slate-700 rounded">
                <table className="w-full text-xs">
                    <thead className="text-[10px] uppercase text-slate-500 border-b border-slate-700 bg-slate-900 sticky top-0">
                        <tr>
                            <th className="text-left py-2 px-2">Seq</th>
                            <th className="text-left py-2 px-2">Symbol</th>
                            <th className="text-left py-2 px-2">Received</th>
                            <th className="text-right py-2 px-2">LTP</th>
                            <th className="text-right py-2 px-2">Vol</th>
                            <th className="text-right py-2 px-2">Bid / Ask</th>
                            <th className="text-right py-2 px-2">Tot Buy / Sell</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && ticks.length === 0 ? (
                            <tr><td colSpan={7} className="py-4 text-center text-slate-500 italic">Loading…</td></tr>
                        ) : ticks.length === 0 ? (
                            <tr><td colSpan={7} className="py-4 text-center text-slate-500 italic">No ticks.</td></tr>
                        ) : ticks.map(t => (
                            <tr key={`${t.recordingId}_${t.sequence}`} className="border-b border-slate-800 hover:bg-slate-800/40">
                                <td className="py-1 px-2 font-mono text-slate-400">{t.sequence}</td>
                                <td className="py-1 px-2 font-mono text-slate-300">{t.symbol}</td>
                                <td className="py-1 px-2 font-mono text-slate-400">
                                    {t.receivedAt ? new Date(t.receivedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—'}
                                </td>
                                <td className="py-1 px-2 text-right font-mono">{t.ltp != null ? Number(t.ltp).toFixed(2) : '—'}</td>
                                <td className="py-1 px-2 text-right font-mono text-slate-400">{t.vol != null ? t.vol.toLocaleString() : '—'}</td>
                                <td className="py-1 px-2 text-right font-mono text-slate-400">
                                    {t.bid_price != null ? Number(t.bid_price).toFixed(2) : '—'}
                                    {' / '}
                                    {t.ask_price != null ? Number(t.ask_price).toFixed(2) : '—'}
                                </td>
                                <td className="py-1 px-2 text-right font-mono text-slate-400">
                                    {t.tot_buy_qty != null ? t.tot_buy_qty.toLocaleString() : '—'}
                                    {' / '}
                                    {t.tot_sell_qty != null ? t.tot_sell_qty.toLocaleString() : '—'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Modal>
    );
}

// ReplayModal — picks a strategyType, optionally fills params from a preset
// or randomized optimizer trials, then POSTs /replay and renders results.
function ReplayModal({ recording, types, onClose }) {
    const typeKeys = Object.keys(types || {});
    const [strategyType, setStrategyType] = useState(typeKeys[0] || '');
    const [mode, setMode] = useState('single');  // 'single' | 'optimizer'
    const [params, setParams] = useState({});
    const [presetId, setPresetId] = useState('');
    const [optimizerCount, setOptimizerCount] = useState(10);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);
    const [expandedRun, setExpandedRun] = useState(0);
    // Wall-clock the run started so we can show "elapsed Xs" while it's
    // in flight (better feedback than the static "this can take a minute"
    // message — a long replay otherwise feels hung).
    const [runStartedAt, setRunStartedAt] = useState(null);
    const [elapsedSec, setElapsedSec] = useState(0);
    // AbortController so the user can cancel a slow replay without
    // hard-closing the modal (which would still leave the server crunching
    // on the cursor for up to 5 minutes).
    const [abortCtl, setAbortCtl] = useState(null);

    // Tick the elapsed counter once per second while a replay is running.
    useEffect(() => {
        if (!running || !runStartedAt) return;
        const i = setInterval(() => {
            setElapsedSec(Math.floor((Date.now() - runStartedAt) / 1000));
        }, 1000);
        return () => clearInterval(i);
    }, [running, runStartedAt]);

    // When strategyType changes, reset params to that strategy's defaults.
    useEffect(() => {
        if (!strategyType || !types[strategyType]) return;
        setParams({ ...(types[strategyType].defaults || {}) });
        setPresetId('');
    }, [strategyType, types]);

    const applyPreset = (id) => {
        if (!id) { setPresetId(''); return; }
        const preset = (types[strategyType]?.presets || []).find(p => p.id === id);
        if (!preset) return;
        setPresetId(id);
        setParams({ ...preset.params });
    };

    // Default-shape lookup used both for type hints in the input row and for
    // client-side validation (reject obviously-bad input before bothering
    // the server with a 5-min cursor).
    const defaultsForType = types[strategyType]?.defaults || {};

    const handleRun = async () => {
        setError(null);
        setResult(null);
        if (!strategyType) { setError('Pick a strategy type.'); return; }
        // Client-side type validation: if the default for a key is a number,
        // require the user's input to parse to a finite number. This catches
        // obvious typos before they hit the server (where the validator
        // would also catch them, but only after a network round trip).
        const coerced = {};
        const typeErrors = [];
        for (const [k, v] of Object.entries(params)) {
            if (v === '' || v == null) continue;
            const defVal = defaultsForType[k];
            if (typeof defVal === 'number') {
                const num = Number(v);
                if (!Number.isFinite(num)) {
                    typeErrors.push(`${k}: expected a number, got "${v}"`);
                    continue;
                }
                if (num < 0) {
                    typeErrors.push(`${k}: must be non-negative (got ${num})`);
                    continue;
                }
                coerced[k] = num;
            } else {
                // Non-numeric default: pass through as-is (string/bool params
                // don't get coerced — the server's validateParams is the
                // single source of truth for those).
                coerced[k] = v;
            }
        }
        if (typeErrors.length > 0) {
            setError('Parameter validation failed:\n• ' + typeErrors.join('\n• '));
            return;
        }
        const payload = { strategyType, params: coerced };
        if (mode === 'optimizer') {
            const n = Number(optimizerCount);
            if (!Number.isFinite(n) || n < 1 || n > 50) {
                setError('Optimizer count must be 1..50.');
                return;
            }
            payload.optimizerCount = n;
        }
        // Fresh AbortController so we can support user-initiated cancellation
        // without leaking a stale signal from a previous run.
        const ctl = new AbortController();
        setAbortCtl(ctl);
        setRunStartedAt(Date.now());
        setElapsedSec(0);
        setRunning(true);
        try {
            // Replay can take up to 5 minutes server-side; bump the axios
            // timeout so a long replay isn't aborted client-side.
            const r = await axios.post(
                `${API_URL}/tick-recordings/${recording._id}/replay`,
                payload,
                { timeout: 5 * 60 * 1000, signal: ctl.signal }
            );
            setResult(r.data.result || null);
            setExpandedRun(r.data.result?.bestRun || 0);
        } catch (err) {
            // axios surfaces aborts as either Cancel or ERR_CANCELED depending
            // on version. Treat all abort flavors as a clean cancel rather
            // than a real error so the modal closes back to its config view.
            if (axios.isCancel?.(err) || err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') {
                setError('Replay cancelled.');
            } else {
                setError(err.response?.data?.error || err.message);
            }
        } finally {
            setRunning(false);
            setAbortCtl(null);
        }
    };

    const handleCancel = () => {
        if (abortCtl) abortCtl.abort();
    };

    if (!recording) return null;
    const presets = types[strategyType]?.presets || [];

    return (
        <Modal
            title={`Replay — ${recording.name}`}
            onClose={onClose}
            onSubmit={result ? onClose : handleRun}
            submitLabel={result ? 'Close' : (running ? 'Running…' : 'Run Replay')}
            loading={running}
            error={error}
        >
            {!result ? (
                <>
                    <FormField label="Strategy Type">
                        <select
                            value={strategyType}
                            onChange={e => setStrategyType(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200"
                        >
                            {typeKeys.length === 0 && <option value="">— no strategy types loaded —</option>}
                            {typeKeys.map(k => (
                                <option key={k} value={k}>{types[k]?.label || k}</option>
                            ))}
                        </select>
                        {strategyType && types[strategyType]?.description && (
                            <p className="text-xs text-slate-400 mt-2 leading-relaxed">{types[strategyType].description}</p>
                        )}
                    </FormField>

                    <FormField label="Mode">
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setMode('single')}
                                className={`flex-1 px-3 py-2 rounded text-sm font-semibold transition ${mode === 'single' ? 'bg-amber-500 text-black' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                            >
                                <Sliders className="w-4 h-4 inline mr-1" /> Single Run
                            </button>
                            <button
                                type="button"
                                onClick={() => setMode('optimizer')}
                                className={`flex-1 px-3 py-2 rounded text-sm font-semibold transition ${mode === 'optimizer' ? 'bg-amber-500 text-black' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                            >
                                <Layers className="w-4 h-4 inline mr-1" /> Optimizer (random params)
                            </button>
                        </div>
                    </FormField>

                    {mode === 'single' && presets.length > 0 && (
                        <FormField label="Tuning Preset">
                            <select
                                value={presetId}
                                onChange={e => applyPreset(e.target.value)}
                                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200"
                            >
                                <option value="">— Custom (manual params below) —</option>
                                {presets.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </FormField>
                    )}

                    {mode === 'single' && strategyType && (
                        <FormField label="Parameters">
                            <div className="grid grid-cols-2 gap-3">
                                {Object.entries(params).map(([key, val]) => {
                                    // Pull the type from the strategy defaults
                                    // so each input row can carry a type hint
                                    // ("number" / "text") and an HTML5 type
                                    // attribute that triggers numeric keypads
                                    // on mobile + browser-level validation.
                                    const defVal = defaultsForType[key];
                                    const isNumeric = typeof defVal === 'number';
                                    return (
                                        <div key={key}>
                                            <label className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                                                <span>{key.replace(/_/g, ' ')}</span>
                                                <span className="text-[9px] normal-case text-slate-600 font-mono">
                                                    {isNumeric ? 'number' : (typeof defVal === 'boolean' ? 'bool' : 'text')}
                                                </span>
                                            </label>
                                            <input
                                                type={isNumeric ? 'number' : 'text'}
                                                step="any"
                                                value={val}
                                                onChange={e => setParams(p => ({ ...p, [key]: e.target.value }))}
                                                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 text-sm font-mono"
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </FormField>
                    )}

                    {mode === 'optimizer' && (
                        <FormField label="Number of Trials (1–50)">
                            <input
                                type="number"
                                min="1"
                                max="50"
                                value={optimizerCount}
                                onChange={e => setOptimizerCount(e.target.value)}
                                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200"
                            />
                            <p className="text-xs text-slate-500 mt-1.5">
                                The engine will run this many trials with randomized parameters and rank by net PnL. Larger counts take longer.
                            </p>
                        </FormField>
                    )}

                    {running && (
                        <div className="text-slate-300 text-sm bg-slate-800/50 border border-slate-700 rounded p-3 flex items-center justify-between gap-3">
                            <div>
                                Running replay — elapsed <span className="font-mono text-amber-300">{elapsedSec}s</span>.
                                Don't close this modal. Server timeout 5min.
                            </div>
                            <button
                                type="button"
                                onClick={handleCancel}
                                className="text-xs px-2 py-1 rounded bg-red-700/80 hover:bg-red-600 text-white font-semibold"
                                title="Cancel the in-flight replay"
                            >
                                Cancel
                            </button>
                        </div>
                    )}
                </>
            ) : (
                <ReplayResults result={result} expandedRun={expandedRun} onExpandRun={setExpandedRun} />
            )}
        </Modal>
    );
}

function ReplayResults({ result, expandedRun, onExpandRun }) {
    const runs = result?.runs || [];
    const isOptimizer = runs.length > 1;
    const elapsedSec = result?.elapsedMs != null ? (result.elapsedMs / 1000).toFixed(2) : '—';
    // Engine-side non-fatal warnings (empty recording, non-monotonic clock,
    // etc). Rendered as a yellow banner above the run table so the operator
    // doesn't trust replay numbers blindly when the input has quality issues.
    const warnings = Array.isArray(result?.warnings) ? result.warnings : [];

    return (
        <div className="space-y-4">
            <div className="text-xs text-slate-400 flex items-center gap-3 flex-wrap">
                <span>Recording: <span className="text-slate-200 font-semibold">{result.recordingName}</span></span>
                <span>·</span>
                <span>Strategy: <span className="text-violet-300 font-semibold">{result.strategyType}</span></span>
                <span>·</span>
                <span>{(result.ticksProcessed || 0).toLocaleString()} ticks processed in {elapsedSec}s</span>
            </div>

            {warnings.length > 0 && (
                <div className="text-xs bg-amber-950/40 border border-amber-700/60 text-amber-200 rounded p-3 space-y-1">
                    <div className="font-bold">Replay warnings:</div>
                    <ul className="list-disc list-inside space-y-0.5">
                        {warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                </div>
            )}

            {isOptimizer && (
                <div>
                    <h4 className="text-sm font-bold text-white mb-2">Leaderboard ({runs.length} trials)</h4>
                    <div className="overflow-x-auto border border-slate-700 rounded">
                        <table className="w-full text-xs">
                            <thead className="text-[10px] uppercase text-slate-500 border-b border-slate-700 bg-slate-900">
                                <tr>
                                    <th className="text-left py-2 px-2">#</th>
                                    <th className="text-right py-2 px-2">Net PnL</th>
                                    <th className="text-right py-2 px-2">Win %</th>
                                    <th className="text-right py-2 px-2">Trades</th>
                                    <th className="text-right py-2 px-2">Avg Hold</th>
                                    <th className="text-center py-2 px-2"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...runs]
                                    .sort((a, b) => (b.stats?.netPnl || 0) - (a.stats?.netPnl || 0))
                                    .map(run => {
                                        const isBest = run.runIndex === result.bestRun;
                                        const isExpanded = run.runIndex === expandedRun;
                                        const net = run.stats?.netPnl || 0;
                                        const winRate = run.stats?.totalTrades > 0
                                            ? (run.stats.winningTrades / run.stats.totalTrades) * 100
                                            : 0;
                                        return (
                                            <tr key={run.runIndex} className={`border-b border-slate-800 ${isBest ? 'bg-amber-500/5' : ''}`}>
                                                <td className="py-1.5 px-2 font-mono text-slate-300">
                                                    #{run.runIndex}{isBest && <span className="ml-1 text-amber-400">★</span>}
                                                </td>
                                                <td className={`py-1.5 px-2 text-right font-mono font-bold ${net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                    {net >= 0 ? '+' : ''}{net.toFixed(2)}
                                                </td>
                                                <td className="py-1.5 px-2 text-right font-mono text-slate-300">{winRate.toFixed(0)}%</td>
                                                <td className="py-1.5 px-2 text-right font-mono text-slate-300">{run.stats?.totalTrades || 0}</td>
                                                <td className="py-1.5 px-2 text-right font-mono text-slate-400">
                                                    {run.stats?.avgHoldMs != null ? formatDuration(run.stats.avgHoldMs) : '—'}
                                                </td>
                                                <td className="py-1.5 px-2 text-center">
                                                    <button
                                                        onClick={() => onExpandRun(isExpanded ? -1 : run.runIndex)}
                                                        className="text-xs px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
                                                    >
                                                        {isExpanded ? 'Hide' : 'View'}
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {(() => {
                const run = runs.find(r => r.runIndex === expandedRun) || runs[0];
                if (!run) return <div className="text-slate-500 italic text-sm">No runs.</div>;
                return <ReplayRunDetail run={run} isOptimizer={isOptimizer} />;
            })()}
        </div>
    );
}

function ReplayRunDetail({ run, isOptimizer }) {
    const stats = run?.stats || {};
    const trades = run?.trades || [];
    const netCls = (stats.netPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400';

    return (
        <div className="space-y-3">
            {isOptimizer && (
                <div className="text-xs text-slate-400">
                    Run #{run.runIndex} — params:
                    <span className="ml-2 font-mono text-slate-300 break-all">
                        {Object.entries(run.params || {}).map(([k, v]) => `${k}=${v}`).join(', ')}
                    </span>
                </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <ReplayStatBox label="Total Trades" value={stats.totalTrades || 0} />
                <ReplayStatBox
                    label="Win Rate"
                    value={stats.totalTrades > 0 ? `${((stats.winningTrades / stats.totalTrades) * 100).toFixed(0)}%` : '—'}
                />
                <ReplayStatBox
                    label="Net PnL"
                    value={(stats.netPnl || 0) >= 0 ? `+${(stats.netPnl || 0).toFixed(2)}` : (stats.netPnl || 0).toFixed(2)}
                    color={netCls}
                />
                <ReplayStatBox
                    label="Avg Trade"
                    value={stats.avgTradePnl != null ? (stats.avgTradePnl >= 0 ? '+' : '') + stats.avgTradePnl.toFixed(2) : '—'}
                />
                <ReplayStatBox
                    label="Max DD"
                    value={stats.maxDrawdown != null ? stats.maxDrawdown.toFixed(2) : '—'}
                    color="text-red-400"
                />
            </div>

            <div className="overflow-x-auto max-h-72 overflow-y-auto border border-slate-700 rounded">
                <table className="w-full text-xs">
                    <thead className="text-[10px] uppercase text-slate-500 border-b border-slate-700 bg-slate-900 sticky top-0">
                        <tr>
                            <th className="text-left py-2 px-2">Symbol</th>
                            <th className="text-left py-2 px-2">Dir</th>
                            <th className="text-right py-2 px-2">Entry</th>
                            <th className="text-right py-2 px-2">Exit</th>
                            <th className="text-right py-2 px-2">PnL pts</th>
                            <th className="text-right py-2 px-2">Hold</th>
                            <th className="text-left py-2 px-2">Entry → Exit Reason</th>
                        </tr>
                    </thead>
                    <tbody>
                        {trades.length === 0 ? (
                            <tr><td colSpan={7} className="py-4 text-center text-slate-500 italic">No trades simulated.</td></tr>
                        ) : trades.map((t, i) => (
                            <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/40">
                                <td className="py-1 px-2 font-mono text-slate-300">{t.symbol}</td>
                                <td className={`py-1 px-2 font-bold ${t.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>{t.direction}</td>
                                <td className="py-1 px-2 text-right font-mono">{t.entryPrice != null ? Number(t.entryPrice).toFixed(2) : '—'}</td>
                                <td className="py-1 px-2 text-right font-mono">{t.exitPrice != null ? Number(t.exitPrice).toFixed(2) : '—'}</td>
                                <td className={`py-1 px-2 text-right font-mono font-bold ${(t.pnlPoints || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {(t.pnlPoints || 0) >= 0 ? '+' : ''}{(t.pnlPoints || 0).toFixed(2)}
                                </td>
                                <td className="py-1 px-2 text-right font-mono text-slate-400">{formatDuration(t.holdMs)}</td>
                                <td className="py-1 px-2 text-slate-400 truncate max-w-[260px]" title={`${t.entryReason || ''} → ${t.exitReason || ''}`}>
                                    {(t.entryReason || '—')} → {(t.exitReason || '—')}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function ReplayStatBox({ label, value, color = 'text-white' }) {
    return (
        <div className="bg-slate-800 border border-slate-700 rounded p-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
            <p className={`font-bold font-mono text-lg ${color}`}>{value}</p>
        </div>
    );
}
