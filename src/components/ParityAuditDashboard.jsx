import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    FaSync, FaCheckCircle, FaTimesCircle, FaExclamationTriangle,
    FaChevronDown, FaChevronUp, FaFilter, FaTerminal, FaSearch,
} from 'react-icons/fa';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import { INSTRUMENT_CONFIG } from '../constants';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse structured parity check lines from accumulated log string. */
function parseParityResults(logs) {
    if (!logs) return [];
    const results = [];
    const seen = new Set();

    // Try JSON summary first (emitted as PARITY_JSON:{...})
    const jsonMatch = logs.match(/PARITY_JSON:(\[.*\])/s);
    if (jsonMatch) {
        try {
            const rows = JSON.parse(jsonMatch[1]);
            return rows.map(r => ({
                name:      r.name,
                metric:    r.metric,
                value:     r.value,
                threshold: r.threshold,
                bars:      r.bars,
                status:    r.passed === true ? 'PASS' : r.passed === false ? 'FAIL' : 'SKIP',
                note:      r.note || '',
            }));
        } catch { /* fall through to regex */ }
    }

    // Regex parse of human-readable lines
    // "  PASS  RSI_14                      max_abs_diff=0.000421  (limit 0.001)  bars=49900"
    const floatRe = /\s+(PASS|FAIL)\s+(\S+)\s+(\w+)=([\d.e+\-]+)\s+\(limit ([\d.e+\-]+)\)\s+bars=(\d+)/g;
    let m;
    while ((m = floatRe.exec(logs)) !== null) {
        const [, status, name, metric, value, threshold, bars] = m;
        if (!seen.has(name)) {
            seen.add(name);
            results.push({
                name, metric,
                value:     parseFloat(value),
                threshold: parseFloat(threshold),
                bars:      parseInt(bars, 10),
                status,
                note: '',
            });
        }
    }

    // SKIP lines: "  SKIP  col_name  — reason"
    const skipRe = /\s+SKIP\s+(\S+)\s+—\s+(.+)/g;
    while ((m = skipRe.exec(logs)) !== null) {
        const [, name, reason] = m;
        if (!seen.has(name)) {
            seen.add(name);
            results.push({ name, metric: 'skip', value: 0, threshold: 0, bars: 0, status: 'SKIP', note: reason.trim() });
        }
    }

    return results;
}

/** Compute KPI aggregates from result rows. */
function computeKpis(results) {
    const checked  = results.filter(r => r.status !== 'SKIP');
    const passed   = results.filter(r => r.status === 'PASS');
    const failed   = results.filter(r => r.status === 'FAIL');
    const passRate = checked.length > 0 ? (passed.length / checked.length) * 100 : null;

    let maxDriftRow = null;
    for (const r of results) {
        if (r.status === 'PASS' || r.status === 'FAIL') {
            if (!maxDriftRow || r.value > maxDriftRow.value) maxDriftRow = r;
        }
    }

    return { passRate, passed: passed.length, failed: failed.length, total: results.length, checked: checked.length, maxDriftRow };
}

/** Determine if a row should be WARN (value > 50% of threshold but still PASS). */
function rowVariant(row) {
    if (row.status === 'FAIL') return 'fail';
    if (row.status === 'SKIP') return 'skip';
    if (row.threshold > 0 && row.value > row.threshold * 0.5) return 'warn';
    return 'pass';
}

/**
 * Generate an illustrative delta time-series chart for a given parity result.
 * Since validate_parity.py doesn't stream per-bar data, we synthesize a plausible
 * profile: near-zero drift with occasional spikes up to max_diff.
 */
function buildChartData(row, nPoints = 80) {
    const seed  = row.name.charCodeAt(0) * 31 + row.name.charCodeAt(1 % row.name.length);
    const scale = row.value;
    const data  = [];
    let phase = seed % 100;
    for (let i = 0; i < nPoints; i++) {
        phase += 0.07 + (seed % 5) * 0.01;
        const noise    = (Math.sin(phase) * 0.6 + Math.sin(phase * 2.3) * 0.3) * scale;
        const ref      = 0.0;
        const nitro    = noise + (Math.random() - 0.5) * scale * 0.1;
        data.push({ bar: i + 100, standard: parseFloat(ref.toFixed(6)), nitro: parseFloat(nitro.toFixed(6)) });
    }
    return data;
}

const PROFILE_LABELS = {
    lean:          'Lean (61)',
    lean_mtf:      'Lean MTF (73)',
    lean_cdl:      'Lean CDL (77)',
    smart_money:   'Smart Money (73)',
    base:          'Base (76)',
    quantum:       'Quantum (84)',
    mtf_full:      'MTF Full (88)',
    dow_theory:    'Dow Theory (81)',
    cdl_rich:      'CDL Rich (92)',
    comprehensive: 'Comprehensive (117)',
    chart_vision:  'Chart Vision (97)',
    focused_mtf:   'Focused MTF (44)',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color = 'indigo', pulse = false }) {
    const colors = {
        emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400',
        rose:    'border-rose-500/30    bg-rose-500/5    text-rose-400',
        amber:   'border-amber-500/30   bg-amber-500/5   text-amber-400',
        indigo:  'border-indigo-500/30  bg-indigo-500/5  text-indigo-400',
        slate:   'border-slate-600/40   bg-slate-800/40  text-slate-300',
    };
    return (
        <div className={`rounded-xl border p-4 ${colors[color]}`}>
            <div className="text-xs text-slate-500 uppercase tracking-wider font-bold mb-1">{label}</div>
            <div className={`text-2xl font-bold font-mono ${pulse ? 'animate-pulse' : ''}`}>{value ?? '—'}</div>
            {sub && <div className="text-[11px] text-slate-500 mt-0.5 truncate">{sub}</div>}
        </div>
    );
}

function StatusBadge({ status }) {
    const map = {
        PASS: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        FAIL: 'bg-rose-500/20    text-rose-300    border-rose-500/40',
        WARN: 'bg-amber-500/20   text-amber-300   border-amber-500/40',
        SKIP: 'bg-slate-700/50   text-slate-400   border-slate-600/40',
    };
    return (
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border ${map[status] || map.SKIP}`}>
            {status === 'PASS' && <FaCheckCircle className="w-2.5 h-2.5" />}
            {status === 'FAIL' && <FaTimesCircle className="w-2.5 h-2.5" />}
            {status === 'WARN' && <FaExclamationTriangle className="w-2.5 h-2.5" />}
            {status}
        </span>
    );
}

function ResultRow({ row, expanded, onToggle }) {
    const variant   = rowVariant(row);
    const chartData = expanded ? buildChartData(row) : null;

    const rowBg = variant === 'fail'
        ? 'bg-rose-500/5 border-l-2 border-l-rose-500/60 animate-[pulse_3s_ease-in-out_infinite]'
        : variant === 'warn'
        ? 'border-l-2 border-l-amber-500/40'
        : '';

    return (
        <>
            <tr
                className={`border-b border-slate-800 hover:bg-slate-800/40 cursor-pointer transition-colors ${rowBg}`}
                onClick={onToggle}
            >
                <td className="px-4 py-2.5 font-mono text-xs text-slate-200">{row.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{row.metric}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-300">
                    {row.status === 'SKIP' ? '—' : row.value.toExponential(4)}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-300">
                    {row.status === 'SKIP' ? '—' : row.threshold.toExponential(4)}
                </td>
                <td className="px-4 py-2.5">
                    {row.status === 'SKIP' ? (
                        <StatusBadge status="SKIP" />
                    ) : variant === 'warn' ? (
                        <StatusBadge status="WARN" />
                    ) : (
                        <StatusBadge status={row.status} />
                    )}
                </td>
                <td className="px-4 py-2.5 text-right">
                    {expanded ? <FaChevronUp className="w-3 h-3 text-slate-500 ml-auto" /> : <FaChevronDown className="w-3 h-3 text-slate-500 ml-auto" />}
                </td>
            </tr>
            {expanded && (
                <tr className="bg-slate-900/60 border-b border-slate-800">
                    <td colSpan={6} className="px-6 py-4">
                        {row.status === 'SKIP' ? (
                            <p className="text-xs text-slate-500 italic">Skipped: {row.note || 'no reason given'}</p>
                        ) : (
                            <div className="space-y-3">
                                <div className="flex gap-6 text-xs">
                                    <span className="text-slate-500">Delta (MAE): <span className="text-white font-mono">{row.value.toExponential(4)}</span></span>
                                    <span className="text-slate-500">Limit: <span className="text-white font-mono">{row.threshold.toExponential(4)}</span></span>
                                    <span className="text-slate-500">Bars: <span className="text-white font-mono">{row.bars.toLocaleString()}</span></span>
                                    <span className="text-slate-500">Headroom: <span className={`font-mono ${row.threshold > 0 && row.value / row.threshold < 0.5 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                        {row.threshold > 0 ? `${(row.value / row.threshold * 100).toFixed(1)}% of limit` : '—'}
                                    </span></span>
                                </div>

                                {/* Tolerance gauge */}
                                {row.threshold > 0 && (
                                    <div>
                                        <div className="text-[10px] text-slate-600 mb-1">Tolerance gauge</div>
                                        <div className="h-2 bg-slate-800 rounded-full w-full relative overflow-hidden">
                                            <div
                                                className={`h-full rounded-full transition-all ${variant === 'fail' ? 'bg-rose-500' : variant === 'warn' ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                                style={{ width: `${Math.min(100, (row.value / row.threshold) * 100).toFixed(1)}%` }}
                                            />
                                        </div>
                                        <div className="flex justify-between text-[10px] text-slate-600 mt-0.5">
                                            <span>0</span><span>limit ({row.threshold.toExponential(2)})</span>
                                        </div>
                                    </div>
                                )}

                                {/* Illustrative delta overlay chart */}
                                <div>
                                    <div className="text-[10px] text-slate-600 mb-1 flex items-center gap-2">
                                        Standard vs. Nitro delta — illustrative (bars 100+, warm-up skipped)
                                        <span className="italic text-slate-700">Synthetic profile scaled to reported max_diff</span>
                                    </div>
                                    <div className="h-32">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                                <XAxis dataKey="bar" tick={{ fontSize: 9, fill: '#475569' }} />
                                                <YAxis tick={{ fontSize: 9, fill: '#475569' }} width={55} tickFormatter={v => v.toExponential(1)} />
                                                <Tooltip
                                                    contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 10 }}
                                                    formatter={v => v.toExponential(4)}
                                                />
                                                <ReferenceLine y={0} stroke="#334155" strokeDasharray="4 2" />
                                                <ReferenceLine y={row.threshold}  stroke="#f59e0b" strokeDasharray="4 2" strokeOpacity={0.5} label={{ value: 'limit', fontSize: 8, fill: '#f59e0b' }} />
                                                <ReferenceLine y={-row.threshold} stroke="#f59e0b" strokeDasharray="4 2" strokeOpacity={0.5} />
                                                <Line type="monotone" dataKey="standard" stroke="#6366f1" dot={false} strokeWidth={1.5} name="Standard (ref=0)" />
                                                <Line type="monotone" dataKey="nitro"    stroke="#f59e0b" dot={false} strokeWidth={1.5} name="Nitro delta" />
                                                <Legend wrapperStyle={{ fontSize: 10 }} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>
                        )}
                    </td>
                </tr>
            )}
        </>
    );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function ParityAuditDashboard() {
    const [instrumentConfig, setInstrumentConfig] = useState(INSTRUMENT_CONFIG || {});

    // Audit config
    const [config, setConfig] = useState({
        symbol:     'NSE:NIFTYBANK-INDEX',
        start_date: '2025-01-01',
        end_date:   '2026-01-01',
        profile:    'base',
        skip:       100,
        tol:        '1e-3',
    });

    // Audit state
    const [auditState, setAuditState]     = useState('idle');  // idle | running | done | failed
    const [jobId,      setJobId]          = useState(null);
    const [logs,       setLogs]           = useState('');
    const [results,    setResults]        = useState([]);
    const [kpis,       setKpis]           = useState(null);

    // Table UI state
    const [expandedRow,  setExpandedRow]  = useState(null);
    const [filterMode,   setFilterMode]   = useState('all');  // all | failures | high_dev
    const [searchTerm,   setSearchTerm]   = useState('');

    const pollRef  = useRef(null);
    const logRef   = useRef(null);

    // Auto-scroll log terminal
    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [logs]);

    // Parse results whenever logs change
    useEffect(() => {
        if (!logs) return;
        const parsed = parseParityResults(logs);
        if (parsed.length > 0) {
            setResults(parsed);
            setKpis(computeKpis(parsed));
        }
    }, [logs]);

    // Polling
    const stopPolling = useCallback(() => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }, []);

    const startPolling = useCallback((jid) => {
        stopPolling();
        pollRef.current = setInterval(async () => {
            try {
                const res  = await fetch(`${API_BASE}/api/rl/parity/status?job_id=${encodeURIComponent(jid)}`);
                const data = await res.json();
                if (data.logs  != null) setLogs(data.logs);
                if (data.status === 'completed') {
                    setAuditState('done');
                    stopPolling();
                } else if (data.status === 'failed') {
                    setAuditState('failed');
                    stopPolling();
                }
            } catch { /* network blip — retry next tick */ }
        }, 2000);
    }, [stopPolling]);

    useEffect(() => () => stopPolling(), [stopPolling]);

    // ── Actions ───────────────────────────────────────────────────────────────

    const handleRunAudit = async () => {
        if (auditState === 'running') return;
        setAuditState('running');
        setLogs('');
        setResults([]);
        setKpis(null);
        setExpandedRow(null);

        try {
            const res  = await fetch(`${API_BASE}/api/rl/parity/start`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    symbol:     config.symbol,
                    start_date: config.start_date,
                    end_date:   config.end_date,
                    profile:    config.profile,
                    skip:       config.skip,
                    tol:        parseFloat(config.tol) || 1e-3,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'API error');
            const jid = data.job_id;
            setJobId(jid);
            setLogs(data.message ? `${data.message}\n` : '');
            startPolling(jid);
        } catch (err) {
            setLogs(`Error starting parity audit: ${err.message}\n`);
            setAuditState('failed');
        }
    };

    // ── Filter results ────────────────────────────────────────────────────────

    const filteredResults = results.filter(r => {
        const variant = rowVariant(r);
        if (filterMode === 'failures' && r.status !== 'FAIL') return false;
        if (filterMode === 'high_dev' && variant !== 'warn' && variant !== 'fail') return false;
        if (searchTerm && !r.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
        return true;
    });

    const isRunning  = auditState === 'running';
    const isDone     = auditState === 'done';
    const isFailed   = auditState === 'failed';

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="p-6 space-y-6 max-w-6xl mx-auto">

            {/* ── Header ── */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-white flex items-center gap-2">
                        <span className="text-amber-400">⚡</span> Parity Audit Dashboard
                    </h1>
                    <p className="text-xs text-slate-500 mt-0.5">
                        Numerical consistency: Standard (pandas_ta/SB3) vs. Nitro (JAX/XLA) — first 100 warm-up bars skipped automatically
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {isDone  && <span className="text-[11px] text-emerald-400 font-semibold">✓ Audit complete</span>}
                    {isFailed && <span className="text-[11px] text-rose-400 font-semibold">✗ Audit failed</span>}
                    {isRunning && <span className="text-[11px] text-amber-400 animate-pulse">Syncing engines…</span>}
                </div>
            </div>

            {/* ── Config Panel ── */}
            <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 space-y-4">
                <h2 className="text-xs text-slate-400 uppercase tracking-wider font-bold">Audit Configuration</h2>

                <div className="grid grid-cols-2 gap-4">
                    {/* Symbol */}
                    <div>
                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold block mb-1">Symbol</label>
                        <select
                            value={config.symbol}
                            onChange={e => setConfig({ ...config, symbol: e.target.value })}
                            disabled={isRunning}
                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm focus:border-amber-500 outline-none disabled:opacity-50"
                        >
                            {Object.keys(instrumentConfig).length === 0 && <option>Loading…</option>}
                            <optgroup label="── NSE / BSE Indices">
                                {Object.entries(instrumentConfig).filter(([k]) => !k.includes('-EQ') && !k.startsWith('MCX:')).map(([key, cfg]) => (
                                    <option key={key} value={key}>{cfg.underlying || key}</option>
                                ))}
                            </optgroup>
                            <optgroup label="── NSE Stocks">
                                {Object.entries(instrumentConfig).filter(([k]) => k.includes('-EQ')).map(([key, cfg]) => (
                                    <option key={key} value={key}>{cfg.underlying || key}</option>
                                ))}
                            </optgroup>
                            <optgroup label="── MCX Commodities">
                                {Object.entries(instrumentConfig).filter(([k]) => k.startsWith('MCX:')).map(([key, cfg]) => (
                                    <option key={key} value={key}>{cfg.displayName || cfg.underlying || key}</option>
                                ))}
                            </optgroup>
                        </select>
                    </div>

                    {/* Profile */}
                    <div>
                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold block mb-1">
                            Feature Profile
                            <span className="ml-2 text-[10px] text-amber-400/70 font-normal normal-case">
                                {PROFILE_LABELS[config.profile]}
                            </span>
                        </label>
                        <select
                            value={config.profile}
                            onChange={e => setConfig({ ...config, profile: e.target.value })}
                            disabled={isRunning}
                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm focus:border-amber-500 outline-none disabled:opacity-50"
                        >
                            {Object.entries(PROFILE_LABELS).map(([val, label]) => (
                                <option key={val} value={val}>{label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-4 gap-4">
                    {/* Date range */}
                    <div>
                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold block mb-1">Start Date</label>
                        <input
                            type="date" value={config.start_date}
                            onChange={e => setConfig({ ...config, start_date: e.target.value })}
                            disabled={isRunning}
                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm focus:border-amber-500 outline-none disabled:opacity-50"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold block mb-1">End Date</label>
                        <input
                            type="date" value={config.end_date}
                            onChange={e => setConfig({ ...config, end_date: e.target.value })}
                            disabled={isRunning}
                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm focus:border-amber-500 outline-none disabled:opacity-50"
                        />
                    </div>
                    {/* Warm-up skip */}
                    <div>
                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold block mb-1">
                            Warm-up Skip
                            <span className="ml-1 text-slate-600 font-normal normal-case">(bars)</span>
                        </label>
                        <input
                            type="number" min={50} max={500} value={config.skip}
                            onChange={e => setConfig({ ...config, skip: parseInt(e.target.value) || 100 })}
                            disabled={isRunning}
                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm focus:border-amber-500 outline-none disabled:opacity-50"
                        />
                    </div>
                    {/* Tolerance */}
                    <div>
                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold block mb-1">
                            Tolerance
                            <span className="ml-1 text-slate-600 font-normal normal-case">(abs)</span>
                        </label>
                        <select
                            value={config.tol}
                            onChange={e => setConfig({ ...config, tol: e.target.value })}
                            disabled={isRunning}
                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm focus:border-amber-500 outline-none disabled:opacity-50"
                        >
                            <option value="1e-4">1e-4 — Strict</option>
                            <option value="5e-4">5e-4</option>
                            <option value="1e-3">1e-3 — Default</option>
                            <option value="5e-3">5e-3 — Lenient</option>
                        </select>
                    </div>
                </div>

                {/* Warm-up note */}
                <div className="flex items-start gap-2 text-[11px] text-amber-500/70 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
                    <FaExclamationTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span>
                        Warm-up bars are skipped before comparison. Wilder's smoothing (RSI, ATR, ADX) and rolling z-norm
                        require ≥ {config.skip} bars to reach steady state — results before this point are structurally different
                        between pandas_ta and JAX and are intentionally excluded.
                    </span>
                </div>

                {/* Run button */}
                <button
                    onClick={handleRunAudit}
                    disabled={isRunning}
                    className="w-full bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:cursor-not-allowed py-3 rounded-lg font-bold transition-all flex justify-center items-center gap-2 text-sm"
                >
                    {isRunning ? <><FaSync className="animate-spin" /> Engine Syncing…</> : '⚡ Run Parity Audit'}
                </button>
            </div>

            {/* ── KPI Cards ── */}
            {(kpis || isRunning) && (
                <div className="grid grid-cols-4 gap-4">
                    <KpiCard
                        label="Overall Pass Rate"
                        value={kpis?.passRate != null ? `${kpis.passRate.toFixed(1)}%` : '—'}
                        sub={`${kpis?.passed ?? '?'} / ${kpis?.checked ?? '?'} checks`}
                        color={kpis?.passRate >= 99 ? 'emerald' : kpis?.passRate >= 95 ? 'amber' : 'rose'}
                        pulse={isRunning && !kpis}
                    />
                    <KpiCard
                        label="Failed Checks"
                        value={kpis?.failed ?? '—'}
                        sub="columns with delta > tolerance"
                        color={kpis?.failed === 0 ? 'emerald' : 'rose'}
                        pulse={isRunning && !kpis}
                    />
                    <KpiCard
                        label="Max Tolerance Deviation"
                        value={kpis?.maxDriftRow ? kpis.maxDriftRow.value.toExponential(2) : '—'}
                        sub={kpis?.maxDriftRow ? `in ${kpis.maxDriftRow.name}` : 'no data yet'}
                        color={kpis?.maxDriftRow && kpis.maxDriftRow.status === 'FAIL' ? 'rose' : 'amber'}
                        pulse={isRunning && !kpis}
                    />
                    <KpiCard
                        label="Columns Verified"
                        value={kpis ? `${kpis.checked} / ${kpis.total}` : '—'}
                        sub={`profile: ${config.profile} · ${PROFILE_LABELS[config.profile]}`}
                        color="indigo"
                        pulse={isRunning && !kpis}
                    />
                </div>
            )}

            {/* ── Results Table ── */}
            {results.length > 0 && (
                <div className="bg-slate-900/60 border border-slate-700 rounded-xl overflow-hidden">
                    {/* Table toolbar */}
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700 bg-slate-900/40 flex-wrap">
                        <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Comparison Results</span>
                        <div className="flex-1" />

                        {/* Search */}
                        <div className="relative">
                            <FaSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
                            <input
                                type="text"
                                placeholder="Search feature…"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="bg-slate-800 border border-slate-700 rounded pl-7 pr-3 py-1.5 text-xs focus:border-amber-500 outline-none w-36"
                            />
                        </div>

                        {/* Filter buttons */}
                        <div className="flex items-center gap-1">
                            {[['all', 'All'], ['failures', 'Only Failures'], ['high_dev', 'High Deviation']].map(([mode, label]) => (
                                <button
                                    key={mode}
                                    onClick={() => setFilterMode(mode)}
                                    className={`text-[10px] font-semibold px-2.5 py-1 rounded transition-colors ${
                                        filterMode === mode
                                            ? 'bg-amber-600 text-white'
                                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                    }`}
                                >
                                    <FaFilter className="inline w-2.5 h-2.5 mr-1" />{label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="border-b border-slate-700 bg-slate-900/80">
                                    <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Feature Name</th>
                                    <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Metric</th>
                                    <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Delta (MAE)</th>
                                    <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Threshold</th>
                                    <th className="px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                                    <th className="px-4 py-2.5" />
                                </tr>
                            </thead>
                            <tbody>
                                {filteredResults.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                                            No results match the current filter.
                                        </td>
                                    </tr>
                                ) : filteredResults.map(row => (
                                    <ResultRow
                                        key={row.name}
                                        row={row}
                                        expanded={expandedRow === row.name}
                                        onToggle={() => setExpandedRow(expandedRow === row.name ? null : row.name)}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {filteredResults.length > 0 && (
                        <div className="px-4 py-2 border-t border-slate-800 text-[10px] text-slate-600">
                            {filteredResults.length} row{filteredResults.length !== 1 ? 's' : ''} shown
                            {filterMode !== 'all' && ` (filtered from ${results.length} total)`}
                            {' · '}Click any row to expand the indicator delta chart.
                        </div>
                    )}
                </div>
            )}

            {/* ── Log Terminal ── */}
            {(logs || isRunning) && (
                <div className="bg-slate-900/60 border border-slate-700 rounded-xl overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-700 bg-slate-900/80">
                        <FaTerminal className="w-3.5 h-3.5 text-slate-500" />
                        <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Validation Log</span>
                        {isRunning && <span className="text-[10px] text-amber-400 animate-pulse ml-auto">● Streaming</span>}
                        {isDone   && <span className="text-[10px] text-emerald-400 ml-auto">● Completed</span>}
                        {isFailed && <span className="text-[10px] text-rose-400 ml-auto">● Failed</span>}
                    </div>
                    <div
                        ref={logRef}
                        className="h-64 overflow-y-auto bg-black p-3 text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed"
                        style={{ colorScheme: 'dark' }}
                    >
                        {logs || 'Waiting for output…'}
                        {isRunning && <span className="animate-pulse text-amber-400">█</span>}
                    </div>
                </div>
            )}

        </div>
    );
}
