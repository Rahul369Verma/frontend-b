import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { Zap, Plus, Play, Pause, Trash2, Activity, TrendingUp, TrendingDown, Clock, AlertTriangle } from 'lucide-react';
import { INSTRUMENT_CONFIG } from '../constants';

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
    const [form, setForm] = useState({ name: '', strategyType: '', symbol: 'NSE:NIFTYBANK-INDEX', params: {}, presetId: '' });
    const [editingId, setEditingId] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

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
        setForm({
            name: '',
            strategyType: t,
            symbol: 'NSE:NIFTYBANK-INDEX',
            params: t ? { ...(types[t]?.defaults || {}) } : {},
            presetId: '',  // "custom" until the user picks a preset
        });
        setEditingId(null);
        setCreateOpen(true);
        setError(null);
    };

    const openEdit = (strategy) => {
        setForm({
            name: strategy.name,
            strategyType: strategy.strategyType,
            symbol: strategy.symbol,
            params: { ...(types[strategy.strategyType]?.defaults || {}), ...(strategy.params || {}) },
            // Editing always starts in "custom" — we don't try to reverse-match
            // an existing strategy's params back to a preset id. If the user
            // wants to reset to a preset, they pick one explicitly.
            presetId: '',
        });
        setEditingId(strategy._id);
        setCreateOpen(true);
        setError(null);
    };

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
                <button
                    onClick={() => openCreate()}
                    disabled={Object.keys(types).length === 0}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:bg-slate-700 disabled:text-slate-500 text-black font-semibold transition"
                >
                    <Plus className="w-4 h-4" /> New Tick Strategy
                </button>
            </div>

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
                                    <th className="text-right py-2 pr-3">Hold</th>
                                    <th className="text-left py-2 pr-3">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {trades.map(t => (
                                    <tr key={t._id} className="border-b border-slate-800 hover:bg-slate-800/40">
                                        <td className="py-2 pr-3 text-slate-400 font-mono text-xs">{new Date(t.entryTime).toLocaleTimeString()}</td>
                                        <td className="py-2 pr-3 text-slate-300">{t.strategyName}</td>
                                        <td className="py-2 pr-3 font-mono text-slate-300 text-xs">{t.symbol}</td>
                                        <td className={`py-2 pr-3 font-bold ${t.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>{t.direction}</td>
                                        <td className="py-2 pr-3 text-right font-mono">{t.entryPrice?.toFixed(2)}</td>
                                        <td className="py-2 pr-3 text-right font-mono">{t.exitPrice != null ? t.exitPrice.toFixed(2) : '—'}</td>
                                        <td className={`py-2 pr-3 text-right font-mono font-bold ${(t.pnlPoints || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                            {t.pnlPoints != null ? (t.pnlPoints >= 0 ? '+' : '') + t.pnlPoints.toFixed(2) : '—'}
                                        </td>
                                        <td className="py-2 pr-3 text-right font-mono text-slate-400 text-xs">{t.holdMs ? `${(t.holdMs / 1000).toFixed(1)}s` : '—'}</td>
                                        <td className="py-2 pr-3">
                                            <span className={`text-xs px-2 py-0.5 rounded ${t.status === 'OPEN' ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-700 text-slate-400'}`}>{t.status}</span>
                                        </td>
                                    </tr>
                                ))}
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

                    <FormField label="Symbol">
                        <select
                            value={form.symbol}
                            onChange={e => setForm(f => ({ ...f, symbol: e.target.value }))}
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
                        <input
                            type="text"
                            value={form.symbol}
                            onChange={e => setForm(f => ({ ...f, symbol: e.target.value }))}
                            placeholder="Or type custom (e.g. NSE:NIFTY25NOVFUT)"
                            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs mt-2 font-mono text-slate-300"
                        />
                        <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                            ⚠️ Volume-driven strategies need a <span className="text-amber-300">futures contract</span> (e.g. <code className="bg-slate-700 px-1">NSE:NIFTY25NOVFUT</code>) — index symbols report <code className="bg-slate-700 px-1">vol=0</code> per tick, so the burst gate never fires.
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
                            {s.isActive ? '🟢 Listening to ticks' : '⏸ Paused'}
                            {rt?.health && s.isActive && (
                                <span className={`ml-2 ${rt.health.warnedNoVol ? 'text-amber-400' : 'text-slate-500'}`}>
                                    · {rt.health.totalTicks} ticks
                                    {rt.health.totalTicks > 0 && (
                                        rt.health.ticksWithVol > 0
                                            ? ` (${Math.round((rt.health.ticksWithVol / rt.health.totalTicks) * 100)}% w/ vol)`
                                            : ' (no volume — wrong symbol?)'
                                    )}
                                </span>
                            )}
                            {open && ` · Open ${open.direction} @ ${open.entryPrice?.toFixed(2)}, held ${(open.holdMs / 1000).toFixed(1)}s`}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                    <Stat label="Trades" value={stats.totalTrades} />
                    <Stat label="Win %" value={winRate != null ? `${winRate.toFixed(0)}%` : '—'} />
                    <Stat
                        label="PnL pts"
                        value={(stats.totalPnl >= 0 ? '+' : '') + stats.totalPnl.toFixed(2)}
                        color={stats.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}
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
