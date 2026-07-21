import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Layers, Play, SlidersHorizontal, RefreshCw, Radar, Zap, FlaskConical, Rocket, Save, Trash2, Square, StopCircle, Activity, TrendingUp } from 'lucide-react';

const API_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;

// Static fallback — replaced by /api/config/instruments (same source as Backtest).
const FALLBACK_SYMBOLS = [
    { v: 'NSE:NIFTY50-INDEX', label: 'NIFTY', spot: 24000 },
    { v: 'NSE:NIFTYBANK-INDEX', label: 'BANKNIFTY', spot: 57000 },
    { v: 'NSE:FINNIFTY-INDEX', label: 'FINNIFTY', spot: 25500 },
    { v: 'NSE:MIDCPNIFTY-INDEX', label: 'MIDCPNIFTY', spot: 14700 },
    { v: 'BSE:SENSEX-INDEX', label: 'SENSEX', spot: 82000 },
];

const OUTLOOK_COLORS = {
    bullish: 'text-emerald-300 border-emerald-700/50', 'bullish-volatile': 'text-emerald-300 border-emerald-700/50',
    'bullish-target': 'text-emerald-300 border-emerald-700/50', 'bullish-range': 'text-emerald-300 border-emerald-700/50',
    bearish: 'text-red-300 border-red-700/50', 'bearish-volatile': 'text-red-300 border-red-700/50',
    'bearish-target': 'text-red-300 border-red-700/50', 'bearish-range': 'text-red-300 border-red-700/50',
    neutral: 'text-sky-300 border-sky-700/50', 'neutral-wide': 'text-sky-300 border-sky-700/50',
    volatile: 'text-amber-300 border-amber-700/50',
    'neutral-slightly-bullish': 'text-sky-300 border-sky-700/50', 'neutral-slightly-bearish': 'text-sky-300 border-sky-700/50',
};
const METRICS = [
    { v: 'netPnl', label: 'Net PnL' }, { v: 'profitFactor', label: 'Profit factor' },
    { v: 'roiOnMarginPct', label: 'ROI on margin' }, { v: 'winRate', label: 'Win rate' },
];
const RESOLUTIONS = [
    { v: '5', label: '5 min' }, { v: '15', label: '15 min' }, { v: '30', label: '30 min' }, { v: '60', label: '1 hour' },
];
// 20-level budget ladder — populations scale exponentially with level; grid
// density (structure TP/SL/strike resolution) steps up at 8 and 15. Level 1-3
// are minutes; 15+ can run for DAYS (jobs persist server-side — re-attach
// from the Recent runs list after a browser refresh).
function budgetForLevel(L) {
    const exp = (b, r) => Math.round(b * Math.pow(r, L - 1));
    return {
        survivors1: 4 + 2 * L,
        explore: Math.max(1, Math.round(L * 0.9)),
        signalSamples: Math.min(600, exp(3, 1.30)),
        survivors2: 3 + Math.round(1.6 * L),
        champions: Math.min(12, 2 + Math.floor(L / 3)),
        sweepCap: Math.min(20000, exp(60, 1.36)),
        gridDensity: L >= 15 ? 3 : L >= 8 ? 2 : 1,
        aiCallCap: 20 + 10 * L,
        minTrades: L >= 10 ? 5 : 3, // deeper searches must clear a higher significance bar
    };
}
const BUDGET_HELP = {
    survivors1: 'stage-1 survivors (broad race keeps)',
    explore: 'stage-1 random param draws per strategy (raced ALONGSIDE defaults — a strategy is judged by its best variant, not just defaults)',
    signalSamples: 'random param draws per survivor (stage-2 refinement)',
    survivors2: 'stage-2 survivors (into structure sweep)',
    champions: 'final champions',
    sweepCap: 'max structure combos per survivor (ceiling)',
    gridDensity: 'structure grid resolution 1-3: finer TP/SL steps + wider strike range',
    aiCallCap: 'max AI confirmations per champion',
    minTrades: 'min trades per window to be rankable',
};

const fmt = (n, d = 0) => (n == null || !Number.isFinite(Number(n))) ? (n === Infinity ? '∞' : n === -Infinity ? '−∞' : '—')
    : Number(n).toLocaleString('en-IN', { maximumFractionDigits: d });
const isoDaysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
const shortSym = (s) => String(s).replace('NSE:', '').replace('BSE:', '').replace('-INDEX', '');

export default function MultiLeg() {
    const [templates, setTemplates] = useState([]);
    const [instruments, setInstruments] = useState(FALLBACK_SYMBOLS);
    const [tplKey, setTplKey] = useState('iron_condor');
    const [symbol, setSymbol] = useState(FALLBACK_SYMBOLS[0].v);
    const [spot, setSpot] = useState(FALLBACK_SYMBOLS[0].spot);
    const [iv, setIv] = useState(0.14);
    const [params, setParams] = useState({});
    const [preview, setPreview] = useState(null);
    const [from, setFrom] = useState(isoDaysAgo(45));
    const [to, setTo] = useState(isoDaysAgo(0));
    const [resolution, setResolution] = useState('5');
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState(null);
    const [mode, setMode] = useState('backtest'); // backtest | sweep | scan | auto — the active TAB
    const [gridText, setGridText] = useState('');
    const [sweep, setSweep] = useState(null);
    const [metric, setMetric] = useState('netPnl');
    const [split, setSplit] = useState(0.3);
    const [refine, setRefine] = useState(true);
    const [sweepCap, setSweepCap] = useState(300);
    const [sweepTopN, setSweepTopN] = useState(25);
    const [scanSymbols, setScanSymbols] = useState([FALLBACK_SYMBOLS[0].v, FALLBACK_SYMBOLS[1].v]);
    const [scanOutlook, setScanOutlook] = useState('all'); // all|bullish|bearish|neutral|volatile
    const [scan, setScan] = useState(null);
    const [error, setError] = useState(null);
    const [strategies, setStrategies] = useState([]);          // single-leg signal sources
    const [entryMode, setEntryMode] = useState('time');        // time | signal
    const [signalStrategy, setSignalStrategy] = useState('breakout_range');
    const [useSignalExit, setUseSignalExit] = useState(false);  // strategy-driven early exit (reverse/thesis-break)
    const [signalParams, setSignalParams] = useState(null);    // TUNED strategy params (from a champion/save) — null = strategy defaults
    // Auto-optimize (joint race) state
    const [budgetLevel, setBudgetLevel] = useState(3);         // 1..20 (15+ = multi-day marathons)
    const [budgetAdv, setBudgetAdv] = useState(false);         // show editable budget numbers
    const [budgetCustom, setBudgetCustom] = useState({});      // overrides on top of the level
    const [autoJobs, setAutoJobs] = useState([]);              // recent persisted runs (re-attach)
    const [autoAi, setAutoAi] = useState(false);
    const [aiThreshold, setAiThreshold] = useState(0.60);
    const [autoJob, setAutoJob] = useState(null);              // { jobId }
    const [autoState, setAutoState] = useState(null);          // polled job doc
    const [autoStrategies, setAutoStrategies] = useState([]);  // [] = all optimizable
    const [autoEntryStyle, setAutoEntryStyle] = useState('both'); // both | signal-only
    // Saved strategies + live deployments (Deploy tab)
    const [savedList, setSavedList] = useState([]);
    const [savedDetail, setSavedDetail] = useState(null); // _id of the expanded saved-strategy row
    const [depDetail, setDepDetail] = useState(null);     // _id of the expanded deployment (full order detail)
    const [saveName, setSaveName] = useState('');
    const [saveMsg, setSaveMsg] = useState(null);
    const [deployLots, setDeployLots] = useState(1);
    const [mlDeps, setMlDeps] = useState({ deployments: [], events: [] });
    const [mlStatus, setMlStatus] = useState(null); // engine book status (limits vs exposure, greeks)
    const [mlTrades, setMlTrades] = useState([]);
    // Results tab: full trade history + filters (deployment/template/symbol/mode)
    const [resTrades, setResTrades] = useState([]);
    const [resLoading, setResLoading] = useState(false);
    const [resFilter, setResFilter] = useState({ mode: 'all', deploymentId: 'all', template: 'all', symbol: 'all' });
    const [ivCalib, setIvCalib] = useState(null);      // chain-IV calibration result
    const [ivCalibBusy, setIvCalibBusy] = useState(false);

    const tpl = useMemo(() => templates.find(t => t.key === tplKey) || null, [templates, tplKey]);
    const effBudget = useMemo(() => ({ ...budgetForLevel(budgetLevel), ...budgetCustom }), [budgetLevel, budgetCustom]);

    // Rough size/duration estimate for the CURRENT selections at the chosen
    // level (assumes ~30 backtests/s on a 12-core box; signal-heavy runs vary).
    const autoEstimate = useMemo(() => {
        const B = effBudget;
        const tpls = scanOutlook === 'all' ? templates : templates.filter(t => String(t.outlook).startsWith(scanOutlook));
        const dir = tpls.filter(t => /^bull|^bear/.test(String(t.outlook))).length;
        const neu = tpls.length - dir;
        const nStrat = Math.min(12, autoStrategies.length || strategies.filter(s => s.optimizable !== false).length || 12);
        const nSym = Math.max(1, scanSymbols.length);
        const pairings = autoEntryStyle === 'signal-only' ? nSym * tpls.length * nStrat : nSym * (dir * nStrat + neu);
        const gridAvg = B.gridDensity >= 3 ? 3500 : B.gridDensity === 2 ? 700 : 130;
        const total = pairings * (1 + (B.explore || 0)) + B.survivors1 * B.signalSamples + B.survivors2 * Math.min(B.sweepCap, gridAvg) + (B.champions || 3);
        const secs = total / 30;
        const dur = secs < 5400 ? `~${Math.max(1, Math.round(secs / 60))} min`
            : secs < 129600 ? `~${(secs / 3600).toFixed(1)} h`
            : `~${(secs / 86400).toFixed(1)} days`;
        return { total, dur };
    }, [effBudget, templates, strategies, scanSymbols, autoStrategies, autoEntryStyle, scanOutlook]);

    // Reset editable params + starter sweep grid for a template. Called from
    // event handlers / fetch callbacks (NOT a render effect — avoids the
    // set-state-in-effect cascade).
    const resetForTemplate = useCallback((t) => {
        if (!t) return;
        setParams({ ...t.defaults });
        const g = t.style === 'credit'
            ? { tp_pct_credit: [30, 40, 50, 60], sl_x_credit: [1.5, 2.0], leg_sl_x: t.defaults.leg_sl_x ? [1.3, 1.4, 1.6] : undefined }
            : t.style === 'ratio'
                ? { tp_pct_credit: [40, 60], sl_x_credit: [1.5, 2.0], tp_pct_max_profit: [50], sl_pct_debit: [50] }
                : { tp_pct_max_profit: [40, 50, 60], sl_pct_debit: [40, 50, 60] };
        Object.keys(g).forEach(k => g[k] === undefined && delete g[k]);
        setGridText(JSON.stringify(g, null, 2));
        setResult(null); setSweep(null);
    }, []);

    const selectTemplate = useCallback((key, list) => {
        setTplKey(key);
        resetForTemplate((list || templates).find(t => t.key === key));
    }, [templates, resetForTemplate]);

    useEffect(() => {
        axios.get(`${API_URL}/multileg/templates`).then(r => {
            const list = Array.isArray(r.data) ? r.data : [];
            setTemplates(list);
            resetForTemplate(list.find(t => t.key === 'iron_condor') || list[0]);
        }).catch(() => {});
        // Same instrument source the Backtest page uses.
        axios.get(`${API_URL}/config/instruments`).then(r => {
            const cfg = r.data || {};
            const list = Object.keys(cfg).filter(s => s.includes('-INDEX')).map(v => ({
                v, label: shortSym(v), spot: FALLBACK_SYMBOLS.find(f => f.v === v)?.spot || 20000,
            }));
            if (list.length) setInstruments(list);
        }).catch(() => {});
        // Single-leg strategies as SIGNAL SOURCES (same registry as Backtest).
        axios.get(`${API_URL}/strategies/registry`).then(r => {
            const list = r.data?.strategies || [];
            if (Array.isArray(list) && list.length) setStrategies(list);
        }).catch(() => {});
    }, [resetForTemplate]);

    // Entry-mode fields ride inside params so backtest AND sweep carry them —
    // INCLUDING tuned signal params (a champion's edge lives in its params;
    // running the strategy at defaults is a different strategy).
    const entryParams = useMemo(() => (
        entryMode === 'signal'
            ? { entry_mode: 'signal', signal_strategy: signalStrategy, ...(useSignalExit ? { use_signal_exit: true } : {}), ...(signalParams ? { signal_params: signalParams } : {}) }
            : {}
    ), [entryMode, signalStrategy, signalParams, useSignalExit]);

    const fetchPreview = useCallback(() => {
        if (!tpl) return;
        axios.get(`${API_URL}/multileg/payoff`, { params: { template: tpl.key, symbol, spot, iv } })
            .then(r => setPreview(r.data)).catch(e => setError(e.response?.data?.error || e.message));
    }, [tpl, symbol, spot, iv]);
    useEffect(() => { fetchPreview(); }, [fetchPreview]);

    const runBacktest = async (overrideParams = null) => {
        setRunning(true); setError(null); setResult(null);
        try {
            const p = overrideParams || { ...params, ...entryParams };
            const r = await axios.post(`${API_URL}/multileg/backtest`, { template: tplKey, symbol, from, to, resolution, params: p });
            setResult(r.data);
        } catch (e) { setError(e.response?.data?.error || e.message); }
        setRunning(false);
    };

    // One-click full backtest for a SCAN row (explicit args — state updates are
    // async so we can't rely on setTplKey/setSymbol landing before the POST).
    const runBacktestFor = async (templateKey, sym) => {
        selectTemplate(templateKey);
        setSymbol(sym);
        const inst = instruments.find(x => x.v === sym);
        if (inst?.spot) setSpot(inst.spot);
        setMode('backtest');
        setRunning(true); setError(null); setResult(null);
        try {
            const t = templates.find(x => x.key === templateKey);
            const r = await axios.post(`${API_URL}/multileg/backtest`, {
                template: templateKey, symbol: sym, from, to, resolution, params: { ...(t?.defaults || {}) },
            });
            setResult(r.data);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (e) { setError(e.response?.data?.error || e.message); }
        setRunning(false);
    };

    // Apply a sweep row's params on top of Setup and run the full backtest.
    const testSweepRow = async (row) => {
        const merged = { ...params, ...entryParams, ...(row.params || {}) };
        setParams(p => ({ ...p, ...(row.params || {}) }));
        setMode('backtest');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        await runBacktest(merged);
    };

    const runSweep = async () => {
        setRunning(true); setError(null); setSweep(null);
        try {
            const grid = JSON.parse(gridText || '{}');
            const r = await axios.post(`${API_URL}/multileg/sweep`, {
                template: tplKey, symbol, from, to, resolution, grid,
                split, metric, rounds: refine ? 2 : 1, cap: sweepCap, topN: sweepTopN,
                // Edited Setup params apply UNDER every combo (backend `base`);
                // entry fields ride along so signal mode applies to all combos.
                params: { ...params, ...entryParams },
            });
            setSweep(r.data);
        } catch (e) { setError(e.response?.data?.error || e.message); }
        setRunning(false);
    };

    const startAuto = async () => {
        setRunning(true); setError(null); setAutoState(null);
        try {
            const templatesArg = scanOutlook === 'all' ? 'all' : scanOutlook;
            const r = await axios.post(`${API_URL}/multileg/optimize`, {
                symbols: scanSymbols.slice(0, 4),
                strategies: autoStrategies.length ? autoStrategies : 'all',
                templates: templatesArg,
                from, to, resolution, metric, split,
                budget: effBudget, ai_validate: autoAi,
                ai_confidence_threshold: aiThreshold,
                entry_style: autoEntryStyle,
            });
            setAutoJob(r.data);
        } catch (e) { setError(e.response?.data?.error || e.message); setRunning(false); }
    };
    const cancelAuto = async () => {
        if (autoJob?.jobId) await axios.post(`${API_URL}/multileg/optimize/${autoJob.jobId}/cancel`).catch(() => { /* best effort */ });
    };
    // recent persisted runs (re-attach after a refresh; see interrupted runs)
    const refreshAutoJobs = useCallback(() => {
        axios.get(`${API_URL}/multileg/optimize`).then(r => setAutoJobs(r.data?.jobs || [])).catch(() => {});
    }, []);
    useEffect(() => {
        if (mode !== 'auto') return;
        refreshAutoJobs();
        const t = setInterval(refreshAutoJobs, 15000);
        return () => clearInterval(t);
    }, [mode, refreshAutoJobs]);
    const attachJob = (j) => {
        // restore the run's CONFIGURATION so the form describes what actually
        // ran (dates, resolution, ranking, entries, symbols, budget)
        const req = j.request || {};
        if (req.from) setFrom(req.from);
        if (req.to) setTo(req.to);
        if (req.resolution) setResolution(String(req.resolution));
        if (req.metric) setMetric(req.metric);
        if (req.split != null) setSplit(Number(req.split));
        if (req.entry_style) setAutoEntryStyle(req.entry_style);
        if (Array.isArray(req.symbols) && req.symbols.length) setScanSymbols(req.symbols);
        if (typeof req.templates === 'string') setScanOutlook(req.templates);
        setAutoStrategies(req.strategiesAll ? [] : (Array.isArray(req.strategyKeys) ? req.strategyKeys : []));
        if (req.budget) setBudgetCustom(req.budget); // exact run budget overrides the level
        setAutoState(null);
        setRunning(j.status === 'running');
        setAutoJob({ jobId: j.jobId });
    };

    // Resume an interrupted marathon from its last stage checkpoint — the
    // server re-fetches candles, rebuilds the pool, and skips finished stages.
    const resumeJob = async (j) => {
        try {
            await axios.post(`${API_URL}/multileg/optimize/${j.jobId}/resume`);
            attachJob(j);        // restore its config + start polling
            setRunning(true);
            setAutoJob({ jobId: j.jobId });
            refreshAutoJobs();
        } catch (e) {
            alert(`Resume failed: ${e.response?.data?.error || e.message}`);
        }
    };

    // poll the running job
    useEffect(() => {
        if (!autoJob?.jobId) return;
        const t = setInterval(() => {
            axios.get(`${API_URL}/multileg/optimize/${autoJob.jobId}`).then(r => {
                setAutoState(r.data);
                if (['done', 'error', 'cancelled'].includes(r.data.status)) {
                    setRunning(false);
                    clearInterval(t);
                }
            }).catch(() => { /* transient poll failure — keep polling */ });
        }, 2500);
        return () => clearInterval(t);
    }, [autoJob]);

    // Load a champion's FULL config into Setup + Backtest for hand inspection:
    // template + structure params + strategy + its TUNED params + the exact
    // date range/resolution the run used — so the backtest reproduces the
    // champion's Full-net numbers (modulo fresh candles if `to` is today).
    const loadChampion = (ch) => {
        selectTemplate(ch.template);
        setSymbol(ch.symbol);
        const inst = instruments.find(x => x.v === ch.symbol);
        if (inst?.spot) setSpot(inst.spot);
        if (ch.signal_strategy) {
            setEntryMode('signal');
            setSignalStrategy(ch.signal_strategy);
            setSignalParams(ch.signal_params || null);
            setUseSignalExit(!!(ch.structure_params || {}).use_signal_exit); // the optimizer may have picked it
        } else { setEntryMode('time'); setSignalParams(null); setUseSignalExit(false); }
        // structure params over defaults
        setParams(p => ({ ...p, ...(ch.structure_params || {}) }));
        // run on the SAME window the optimizer used
        const req = autoState?.request;
        if (req?.from) setFrom(req.from);
        if (req?.to) setTo(req.to);
        if (req?.resolution) setResolution(String(req.resolution));
        setMode('backtest');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // ── Saved strategies + deployments (Deploy tab) ─────────────────────────
    const refreshSaved = useCallback(() => {
        axios.get(`${API_URL}/multileg/strategies`).then(r => setSavedList(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    }, []);
    const refreshDeployments = useCallback(() => {
        axios.get(`${API_URL}/multileg/deployments`).then(r => setMlDeps(r.data || { deployments: [], events: [] })).catch(() => {});
        axios.get(`${API_URL}/multileg/trades`).then(r => setMlTrades(Array.isArray(r.data) ? r.data.slice(0, 30) : [])).catch(() => {});
        axios.get(`${API_URL}/multileg/status`).then(r => setMlStatus(r.data || null)).catch(() => {});
    }, []);
    // poll while the Deploy tab is visible
    useEffect(() => {
        if (mode !== 'deploy') return;
        refreshSaved(); refreshDeployments();
        const t = setInterval(refreshDeployments, 5000);
        return () => clearInterval(t);
    }, [mode, refreshSaved, refreshDeployments]);

    // Results tab: pull the FULL structure-trade history (deployment list too,
    // for the filter dropdown). Refreshes on open + a gentle poll for live runs.
    const refreshResults = useCallback(() => {
        setResLoading(true);
        axios.get(`${API_URL}/multileg/trades`, { params: { limit: 2000 } })
            .then(r => setResTrades(Array.isArray(r.data) ? r.data : []))
            .catch(() => {})
            .finally(() => setResLoading(false));
        axios.get(`${API_URL}/multileg/deployments`).then(r => setMlDeps(r.data || { deployments: [], events: [] })).catch(() => {});
    }, []);
    useEffect(() => {
        if (mode !== 'results') return;
        refreshResults();
        const t = setInterval(refreshResults, 15000);
        return () => clearInterval(t);
    }, [mode, refreshResults]);

    // Calibrate the backtest IV proxy to the LIVE chain ATM IV (level parity).
    const calibrateIv = useCallback(() => {
        setIvCalibBusy(true); setIvCalib(null);
        axios.get(`${API_URL}/multileg/calibrate`, { params: { symbol } })
            .then(r => {
                setIvCalib(r.data);
                if (r.data?.iv_mult) setParams(p => ({ ...p, iv_mult: r.data.iv_mult }));
            })
            .catch(e => setIvCalib({ error: e.response?.data?.error || e.message }))
            .finally(() => setIvCalibBusy(false));
    }, [symbol]);

    // filtered trades + computed KPIs / equity / breakdowns (live-engine parity)
    const resFiltered = useMemo(() => {
        return resTrades.filter(t =>
            (resFilter.mode === 'all' || t.trade_mode === resFilter.mode) &&
            (resFilter.deploymentId === 'all' || String(t.deploymentId) === resFilter.deploymentId) &&
            (resFilter.template === 'all' || t.template === resFilter.template) &&
            (resFilter.symbol === 'all' || t.symbol === resFilter.symbol)
        );
    }, [resTrades, resFilter]);
    const resStats = useMemo(() => {
        const closed = [...resFiltered].sort((a, b) => new Date(a.exitAt) - new Date(b.exitAt));
        const n = closed.length;
        if (!n) return { n: 0, equity: [] };
        let net = 0, gross = 0, charges = 0, wins = 0, losses = 0, grossWin = 0, grossLoss = 0, best = -Infinity, worst = Infinity, holdSum = 0;
        let cum = 0, peak = 0, maxDD = 0;
        const equity = [], byReason = {}, byTemplate = {}, bySymbol = {};
        for (let i = 0; i < closed.length; i++) {
            const t = closed[i];
            const p = Number(t.netPnl) || 0;
            net += p; gross += Number(t.grossPnl) || 0; charges += Number(t.charges) || 0;
            if (p > 0) { wins++; grossWin += p; } else if (p < 0) { losses++; grossLoss += Math.abs(p); }
            best = Math.max(best, p); worst = Math.min(worst, p);
            holdSum += Number(t.holdDays) || ((new Date(t.exitAt) - new Date(t.entryAt)) / 86400e3) || 0;
            cum += p; peak = Math.max(peak, cum); maxDD = Math.min(maxDD, cum - peak);
            equity.push({ idx: i + 1, date: istDateTime(t.exitAt), cum: +cum.toFixed(0), pnl: +p.toFixed(0) });
            const agg = (m, k) => { m[k] = m[k] || { net: 0, n: 0, wins: 0 }; m[k].net += p; m[k].n++; if (p > 0) m[k].wins++; };
            agg(byReason, t.exitReason || '—'); agg(byTemplate, t.template || '—'); agg(bySymbol, t.symbol || '—');
        }
        return {
            n, net, gross, charges, wins, losses,
            winRate: wins + losses ? (100 * wins / (wins + losses)) : 0,
            profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
            avgWin: wins ? grossWin / wins : 0, avgLoss: losses ? grossLoss / losses : 0,
            best, worst, maxDD, avgHold: holdSum / n,
            equity, byReason, byTemplate, bySymbol,
        };
    }, [resFiltered]);

    const saveStrategy = async () => {
        const name = saveName.trim();
        if (!name) { setSaveMsg('Enter a name first'); return; }
        setSaveMsg(null);
        try {
            await axios.post(`${API_URL}/multileg/strategies`, {
                // use_signal_exit rides in params so the deployment's engine reads it
                name, template: tplKey, symbol, params: { ...params, ...(entryMode === 'signal' && useSignalExit ? { use_signal_exit: true } : {}) },
                entry_mode: entryMode,
                signal_strategy: entryMode === 'signal' ? signalStrategy : null,
                signal_params: entryMode === 'signal' ? signalParams : null, // tuned params — deployments must run them, not defaults
                backtest: { from, to, resolution, metrics: result?.metrics || null },
            });
            setSaveMsg(`Saved “${name}” ✓ — see the Deploy tab`);
            refreshSaved();
        } catch (e) { setSaveMsg(e.response?.data?.error || e.message); }
    };

    const loadSaved = (s) => {
        selectTemplate(s.template);
        setSymbol(s.symbol);
        const inst = instruments.find(x => x.v === s.symbol);
        if (inst?.spot) setSpot(inst.spot);
        setParams(p => ({ ...p, ...(s.params || {}) }));
        if (s.entry_mode === 'signal' && s.signal_strategy) {
            setEntryMode('signal'); setSignalStrategy(s.signal_strategy); setSignalParams(s.signal_params || null);
            setUseSignalExit(!!(s.params || {}).use_signal_exit);
        } else { setEntryMode('time'); setSignalParams(null); setUseSignalExit(false); }
        if (s.backtest?.from) setFrom(s.backtest.from);
        if (s.backtest?.to) setTo(s.backtest.to);
        if (s.backtest?.resolution) setResolution(String(s.backtest.resolution));
        setSaveName(s.name);
        setMode('backtest');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const deploySaved = async (s, tradeMode) => {
        if (tradeMode === 'LIVE' && !window.confirm(
            `Deploy "${s.name}" LIVE?\n\nThis places REAL orders at the broker (${deployLots} lot(s), market orders, hedges first). Are you sure?`)) return;
        setError(null);
        try {
            await axios.post(`${API_URL}/multileg/strategies/${s._id}/deploy`, { trade_mode: tradeMode, lots: deployLots });
            refreshDeployments();
        } catch (e) { setError(e.response?.data?.error || e.message); }
    };

    const deleteSaved = async (s) => {
        if (!window.confirm(`Delete saved strategy "${s.name}"?`)) return;
        await axios.delete(`${API_URL}/multileg/strategies/${s._id}`).catch(() => {});
        refreshSaved();
    };

    const depAction = async (dep, action) => {
        setError(null);
        try {
            if (action === 'stop') await axios.post(`${API_URL}/multileg/deployments/${dep._id}/stop`, {});
            if (action === 'stop-close') {
                if (!window.confirm(`Stop "${dep.name}" and CLOSE its open structure now?`)) return;
                await axios.post(`${API_URL}/multileg/deployments/${dep._id}/stop`, { close: true });
            }
            if (action === 'start') await axios.post(`${API_URL}/multileg/deployments/${dep._id}/start`, {});
            if (action === 'close') {
                if (!window.confirm(`Close "${dep.name}"'s open structure at market now?`)) return;
                await axios.post(`${API_URL}/multileg/deployments/${dep._id}/close`, {});
            }
            if (action === 'delete') {
                if (!window.confirm(`Delete deployment "${dep.name}"?`)) return;
                await axios.delete(`${API_URL}/multileg/deployments/${dep._id}`);
            }
            refreshDeployments();
        } catch (e) { setError(e.response?.data?.error || e.message); }
    };

    const runScan = async () => {
        setRunning(true); setError(null); setScan(null);
        try {
            const keys = scanOutlook === 'all' ? 'all'
                : templates.filter(t => String(t.outlook).startsWith(scanOutlook)).map(t => t.key);
            const r = await axios.post(`${API_URL}/multileg/scan`, {
                templates: keys, symbols: scanSymbols, from, to, resolution, split, metric,
            });
            setScan(r.data);
        } catch (e) { setError(e.response?.data?.error || e.message); }
        setRunning(false);
    };

    const equity = useMemo(() => {
        if (!result?.trades?.length) return [];
        let acc = 0;
        return result.trades.map((t, i) => { acc += t.netPnl; return { i: i + 1, equity: Math.round(acc) }; });
    }, [result]);

    const a = preview?.analysis;
    const M = (m, key) => m ? (m[key] === Infinity ? '∞' : m[key]) : '—';

    // ── shared building blocks ───────────────────────────────────────────────
    const inputCls = 'w-full mt-1 bg-slate-800 border border-slate-700 rounded p-1.5 text-slate-200';

    const DateRangeInputs = (
        <>
            <label className="text-slate-400">From<input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} /></label>
            <label className="text-slate-400">To<input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} /></label>
            <label className="text-slate-400">Candles
                <select value={resolution} onChange={e => setResolution(e.target.value)} className={inputCls}>
                    {RESOLUTIONS.map(r => <option key={r.v} value={r.v}>{r.label}</option>)}
                </select>
            </label>
        </>
    );

    const RankingInputs = (
        <>
            <label className="text-slate-400">Rank by
                <select value={metric} onChange={e => setMetric(e.target.value)} className={inputCls}>
                    {METRICS.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
                </select>
            </label>
            <label className="text-slate-400">Validation (OOS)
                <select value={split} onChange={e => setSplit(Number(e.target.value))} className={inputCls}>
                    <option value={0}>Off (full period)</option>
                    <option value={0.2}>Hold out last 20%</option>
                    <option value={0.3}>Hold out last 30%</option>
                    <option value={0.4}>Hold out last 40%</option>
                </select>
            </label>
        </>
    );

    const TemplatePicker = (
        <div className="flex flex-wrap gap-2 mb-4">
            {templates.map(t => (
                <button key={t.key} onClick={() => selectTemplate(t.key)}
                    className={`px-3 py-1.5 rounded border text-xs ${t.key === tplKey ? 'bg-primary/20 border-primary text-primary' : `bg-slate-800 hover:bg-slate-700 ${OUTLOOK_COLORS[t.outlook] || 'text-slate-300 border-slate-700'}`}`}
                    title={t.notes}>
                    {t.name}
                </button>
            ))}
        </div>
    );

    const SetupCard = (
        <div className="bg-surface rounded-xl border border-slate-700 p-4">
            <div className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><SlidersHorizontal className="w-4 h-4 text-primary" /> Setup — {tpl?.name || tplKey}</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="text-slate-400">Symbol
                    <select value={symbol} onChange={e => { setSymbol(e.target.value); const s = instruments.find(x => x.v === e.target.value); if (s?.spot) setSpot(s.spot); }}
                        className={inputCls}>
                        {instruments.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                    </select>
                </label>
                <label className="text-slate-400">Spot (preview)
                    <input type="number" value={spot} onChange={e => setSpot(Number(e.target.value))} className={inputCls} />
                </label>
                <label className="text-slate-400">IV (preview)
                    <input type="number" step="0.01" value={iv} onChange={e => setIv(Number(e.target.value))} className={inputCls} />
                </label>
                <label className="text-slate-400">Lots
                    <input type="number" value={params.lots || 1} onChange={e => setParams(p => ({ ...p, lots: Number(e.target.value) }))} className={inputCls} />
                </label>
            </div>

            <div className="text-xs text-slate-400 mt-3 mb-1 font-semibold">Entry trigger</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="text-slate-400">Mode
                    <select value={entryMode} onChange={e => { setEntryMode(e.target.value); setSignalParams(null); }} className={inputCls}>
                        <option value="time">Time-based (entry_time)</option>
                        <option value="signal">Strategy signal</option>
                    </select>
                </label>
                {entryMode === 'signal' && (
                    <label className="text-slate-400">Signal strategy
                        <select value={signalStrategy} onChange={e => { setSignalStrategy(e.target.value); setSignalParams(null); }} className={inputCls}>
                            {(strategies.length ? strategies : [{ id: 'breakout_range', label: 'Breakout Range' }]).map(s => (
                                <option key={s.id} value={s.id}>{s.label || s.id}</option>
                            ))}
                        </select>
                    </label>
                )}
            </div>
            {entryMode === 'signal' && signalParams && (
                <div className="mt-1 p-1.5 rounded bg-violet-900/15 border border-violet-800/40">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] text-violet-300 font-semibold">TUNED signal params (from champion/save)</span>
                        <button onClick={() => setSignalParams(null)} className="text-[10px] text-slate-500 hover:text-red-300" title="Discard tuned params — run the strategy at its defaults">✕ use defaults</button>
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 break-all">{JSON.stringify(signalParams)}</div>
                </div>
            )}
            {entryMode === 'signal' && (
                <>
                    <label className="flex items-center gap-2 mt-2 text-[11px] text-slate-300 cursor-pointer"
                        title="Exit early when the strategy REVERSES (fires the opposite direction) or its own checkExit says the thesis broke — before the structure SL. Directional structures honor both; neutral ones (condor/fly) honor only a thesis-break (an opposite edge-fade inside a range is normal).">
                        <input type="checkbox" checked={useSignalExit} onChange={e => setUseSignalExit(e.target.checked)} className="accent-amber-500" />
                        Strategy early exit <span className="text-slate-500">— close on reverse / thesis-break before SL</span>
                    </label>
                    <div className="text-[10px] text-slate-600 mt-1">
                        Entries fire only when {signalStrategy} signals — {String(tpl?.outlook || '').startsWith('bullish') ? 'CE signals only (bullish structure)' : String(tpl?.outlook || '').startsWith('bearish') ? 'PE signals only (bearish structure)' : 'any direction (neutral structure = volatility trigger)'} — still one entry/day.
                        {useSignalExit ? ' Early exit ON: TP still wins first, then a reverse/thesis-break closes before the structure SL.' : ''}
                    </div>
                </>
            )}

            <div className="text-xs text-slate-400 mt-4 mb-1 font-semibold">Deployment risk (engine underwriting — saved with the strategy)</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="text-slate-500">size_mode
                    <select value={params.size_mode || 'fixed'} onChange={e => setParams(p => ({ ...p, size_mode: e.target.value }))}
                        className="w-full mt-0.5 bg-slate-800 border border-slate-700 rounded p-1 text-slate-200">
                        <option value="fixed">fixed (use Lots)</option>
                        <option value="risk">risk (₹ budget / worst case)</option>
                    </select>
                </label>
                {(params.size_mode === 'risk') && (
                    <label className="text-slate-500" title="₹ risked per structure — lots = floor(budget ÷ worst-case loss per lot)">risk_per_trade ₹
                        <input type="number" value={params.risk_per_trade ?? 10000} onChange={e => setParams(p => ({ ...p, risk_per_trade: Number(e.target.value) }))}
                            className="w-full mt-0.5 bg-slate-800 border border-slate-700 rounded p-1 text-slate-200" />
                    </label>
                )}
                <label className="text-slate-500" title="hard ceiling on sized lots">max_lots
                    <input type="number" value={params.max_lots ?? 10} onChange={e => setParams(p => ({ ...p, max_lots: Number(e.target.value) }))}
                        className="w-full mt-0.5 bg-slate-800 border border-slate-700 rounded p-1 text-slate-200" />
                </label>
                <label className="text-slate-500" title="deployment stops entering for the day after this realized loss">max_loss_per_day ₹
                    <input type="number" value={params.max_loss_per_day ?? ''} placeholder="off" onChange={e => setParams(p => ({ ...p, max_loss_per_day: e.target.value === '' ? undefined : Number(e.target.value) }))}
                        className="w-full mt-0.5 bg-slate-800 border border-slate-700 rounded p-1 text-slate-200" />
                </label>
                <label className="text-slate-500" title="LIVE entries are limit orders capped this % from the quote — a gapping wing can't fill arbitrarily far away">entry_slippage_cap_pct
                    <input type="number" step="0.1" value={params.entry_slippage_cap_pct ?? 1.5} onChange={e => setParams(p => ({ ...p, entry_slippage_cap_pct: Number(e.target.value) }))}
                        className="w-full mt-0.5 bg-slate-800 border border-slate-700 rounded p-1 text-slate-200" />
                </label>
            </div>

            <div className="text-xs text-slate-400 mt-4 mb-1 font-semibold">Vol edge & realism (IV-percentile gate · greeks · spread model)</div>
            <div className="grid grid-cols-3 gap-2 text-xs">
                <label className="text-slate-500" title="sell premium ONLY when the symbol's realized-vol percentile ≥ this (0/blank = off). Same math in backtest and live.">min_ivp
                    <input type="number" value={params.min_ivp ?? ''} placeholder="off" onChange={e => setParams(p => ({ ...p, min_ivp: e.target.value === '' ? undefined : Number(e.target.value) }))}
                        className="w-full mt-0.5 bg-slate-800 border border-slate-700 rounded p-1 text-slate-200" />
                </label>
                <label className="text-slate-500" title="buy premium ONLY when the vol percentile ≤ this (blank = off)">max_ivp
                    <input type="number" value={params.max_ivp ?? ''} placeholder="off" onChange={e => setParams(p => ({ ...p, max_ivp: e.target.value === '' ? undefined : Number(e.target.value) }))}
                        className="w-full mt-0.5 bg-slate-800 border border-slate-700 rounded p-1 text-slate-200" />
                </label>
                <label className="text-slate-500" title="trailing days the percentile ranks against">ivp_lookback
                    <input type="number" value={params.ivp_lookback ?? 120} onChange={e => setParams(p => ({ ...p, ivp_lookback: Number(e.target.value) }))}
                        className="w-full mt-0.5 bg-slate-800 border border-slate-700 rounded p-1 text-slate-200" />
                </label>
                <label className="text-slate-500" title="LIVE alert when |structure delta per unit| exceeds this band — a neutral structure gone directional (blank = off)">delta_alert
                    <input type="number" step="0.05" value={params.delta_alert ?? ''} placeholder="off" onChange={e => setParams(p => ({ ...p, delta_alert: e.target.value === '' ? undefined : Number(e.target.value) }))}
                        className="w-full mt-0.5 bg-slate-800 border border-slate-700 rounded p-1 text-slate-200" />
                </label>
                <label className="text-slate-500" title="BACKTEST: minimum ₹ cost per side per leg (real spreads have an absolute floor — a ₹4 wing costs ~2.5%/side, not 0.5%)">spread_floor ₹
                    <input type="number" step="0.05" value={params.spread_floor ?? 0.10} onChange={e => setParams(p => ({ ...p, spread_floor: Number(e.target.value) }))}
                        className="w-full mt-0.5 bg-slate-800 border border-slate-700 rounded p-1 text-slate-200" />
                </label>
                <label className="text-slate-500" title="BACKTEST: spreads widen this % per strike-step away from ATM (books thin out off the money)">spread_step_pct
                    <input type="number" step="1" value={params.spread_step_pct ?? 5} onChange={e => setParams(p => ({ ...p, spread_step_pct: Number(e.target.value) }))}
                        className="w-full mt-0.5 bg-slate-800 border border-slate-700 rounded p-1 text-slate-200" />
                </label>
            </div>

            {/* IV LEVEL calibration — the biggest backtest↔live parity lever. */}
            <div className="mt-3 p-2 rounded border border-slate-800 bg-slate-900/40">
                <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-[11px] text-slate-500" title="Backtest prices legs from realizedVol × iv_mult. 1.15 is a guess; calibrate it to the live chain so backtest premium LEVEL (and %-of-credit SL/TP) matches what the deployed engine sees.">iv_mult
                        <input type="number" step="0.01" value={params.iv_mult ?? 1.15} onChange={e => setParams(p => ({ ...p, iv_mult: Number(e.target.value) }))}
                            className="w-20 ml-1 bg-slate-800 border border-slate-700 rounded p-1 text-slate-200" />
                    </label>
                    <button onClick={calibrateIv} disabled={ivCalibBusy}
                        className="px-2 py-1 rounded border border-cyan-700/50 bg-cyan-900/20 text-cyan-300 text-[11px] hover:bg-cyan-900/40 disabled:opacity-50 flex items-center gap-1">
                        <RefreshCw className={`w-3 h-3 ${ivCalibBusy ? 'animate-spin' : ''}`} /> Calibrate IV to live chain ({shortSym(symbol)})
                    </button>
                    {params.iv_mult != null && params.iv_mult !== 1.15 && (
                        <button onClick={() => { setParams(p => { const { iv_mult, ...rest } = p; return rest; }); setIvCalib(null); }}
                            className="text-[10px] text-slate-500 hover:text-red-300" title="Revert to the default 1.15">✕ reset</button>
                    )}
                </div>
                {ivCalib && (ivCalib.error
                    ? <div className="text-[10px] text-red-400 mt-1">Calibration failed: {ivCalib.error} (needs live market hours + a valid option chain)</div>
                    : <div className="text-[10px] text-slate-400 mt-1 font-mono">
                        chain ATM IV <span className="text-cyan-300">{ivCalib.observedIvPct}%</span> vs realized {ivCalib.realizedVolPct}% → iv_mult <span className="text-cyan-300">{ivCalib.iv_mult}</span> (was 1.15) · ATM {ivCalib.atmStrike} {ivCalib.expiry} · CE ₹{ivCalib.atmCe} PE ₹{ivCalib.atmPe}
                    </div>)}
                <div className="text-[10px] text-slate-600 mt-1">Aligns backtest premium LEVEL to the market. Skew / term-structure / microstructure still differ — paper-validate before LIVE.</div>
            </div>

            <div className="text-xs text-slate-400 mt-4 mb-1 font-semibold">Parameters (every one editable + sweepable)</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(params).filter(([k]) => !['lots', 'size_mode', 'risk_per_trade', 'max_lots', 'max_loss_per_day', 'entry_slippage_cap_pct', 'min_ivp', 'max_ivp', 'ivp_lookback', 'delta_alert', 'spread_floor', 'spread_step_pct', 'iv_mult'].includes(k)).map(([k, v]) => (
                    <label key={k} className="text-slate-500">{k}
                        <input value={v ?? ''} onChange={e => {
                            const raw = e.target.value;
                            setParams(p => ({ ...p, [k]: raw === '' ? '' : (isNaN(Number(raw)) ? raw : Number(raw)) }));
                        }} className="w-full mt-0.5 bg-slate-800 border border-slate-700 rounded p-1 text-slate-200" />
                    </label>
                ))}
            </div>

            {preview?.legs && (
                <div className="mt-4">
                    <div className="text-xs text-slate-400 font-semibold mb-1">Legs @ spot {fmt(spot)}</div>
                    <table className="w-full text-xs text-slate-300">
                        <tbody>
                            {preview.legs.map((l, i) => (
                                <tr key={i} className="border-t border-slate-800">
                                    <td className={`py-1 ${l.action === 'BUY' ? 'text-emerald-300' : 'text-red-300'}`}>{l.action} {l.ratio > 1 ? `${l.ratio}×` : ''}</td>
                                    <td>{l.type} {fmt(l.strike)}</td>
                                    <td className="text-slate-500">{l.expiry}</td>
                                    <td className="text-right">₹{l.premium}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {a && (
                        <div className="flex flex-wrap gap-2 mt-2 text-[11px]">
                            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700">net {a.netPremium >= 0 ? 'credit' : 'debit'} ₹{fmt(Math.abs(a.netPremium), 2)}</span>
                            <span className="px-2 py-0.5 rounded bg-emerald-900/30 border border-emerald-700/50 text-emerald-300">max +₹{fmt(a.maxProfit, 0)}</span>
                            <span className="px-2 py-0.5 rounded bg-red-900/30 border border-red-700/50 text-red-300">max −₹{fmt(Math.abs(a.maxLoss === -Infinity ? Infinity : a.maxLoss), 0)}{a.maxLoss === -Infinity ? ' (unbounded)' : ''}</span>
                            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700">BE: {(a.breakevens || []).map(b => fmt(b)).join(' / ') || '—'}</span>
                        </div>
                    )}
                    <div className="text-[10px] text-slate-600 mt-2">{tpl?.notes}</div>
                </div>
            )}
        </div>
    );

    const PayoffCard = (
        <div className="bg-surface rounded-xl border border-slate-700 p-4">
            <div className="text-sm font-semibold text-white mb-2">Payoff at expiry (per unit)</div>
            {preview?.curve ? (
                <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={preview.curve}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="S" tick={{ fill: '#64748b', fontSize: 10 }} domain={['dataMin', 'dataMax']} type="number" />
                        <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} labelFormatter={(v) => `Spot ${fmt(v)}`} />
                        <ReferenceLine y={0} stroke="#475569" />
                        <ReferenceLine x={spot} stroke="#6366f1" strokeDasharray="4 4" label={{ value: 'spot', fill: '#6366f1', fontSize: 10 }} />
                        <Line type="monotone" dataKey="pnl" stroke="#22d3ee" dot={false} strokeWidth={2} />
                    </LineChart>
                </ResponsiveContainer>
            ) : (
                <div className="text-xs text-slate-500 py-12 text-center">{tpl?.multiExpiry ? 'Calendar: risk profile is computed at NEAR expiry (see numbers on the left).' : 'Loading…'}</div>
            )}
        </div>
    );

    const SymbolChips = (max) => (
        <div className="flex gap-1 flex-wrap">
            {instruments.map(s => (
                <button key={s.v} onClick={() => setScanSymbols(prev => prev.includes(s.v) ? prev.filter(x => x !== s.v) : prev.length < max ? [...prev, s.v] : prev)}
                    className={`px-2 py-1 rounded border text-[11px] ${scanSymbols.includes(s.v) ? 'bg-primary/20 border-primary text-primary' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                    {s.label}
                </button>
            ))}
        </div>
    );

    const OutlookChips = (
        <div className="flex gap-1 flex-wrap">
            {['all', 'bullish', 'bearish', 'neutral', 'volatile'].map(o => (
                <button key={o} onClick={() => setScanOutlook(o)}
                    className={`px-2 py-1 rounded border text-[11px] ${scanOutlook === o ? 'bg-primary/20 border-primary text-primary' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                    {o === 'all' ? `All (${templates.length})` : o}
                </button>
            ))}
        </div>
    );

    const TABS = [
        { id: 'backtest', label: 'Backtest', icon: Play, desc: 'One structure, full detail — equity curve + every trade' },
        { id: 'sweep', label: 'Optimizer', icon: FlaskConical, desc: 'Grid-sweep this structure\'s params with OOS ranking + refine' },
        { id: 'scan', label: 'Scan', icon: Radar, desc: 'Every structure × symbols at defaults — one leaderboard' },
        { id: 'auto', label: 'Auto ⚡', icon: Zap, desc: 'The full race: strategies × params × structures × symbols' },
        { id: 'deploy', label: 'Deploy', icon: Rocket, desc: 'Saved strategies → PAPER or LIVE structure runners on the multileg engine' },
        { id: 'results', label: 'Results', icon: TrendingUp, desc: 'Live/paper deployment results — KPIs, equity curve, every structure round-trip' },
    ];

    return (
        <div className="p-6 max-w-[1600px] mx-auto">
            <h1 className="text-2xl font-bold text-white flex items-center gap-3 mb-1">
                <Layers className="w-6 h-6 text-primary" /> Multi-Leg Structures
            </h1>
            <div className="text-sm text-slate-500 mb-4">Spreads · butterflies · condors · straddles · ratio backspreads · calendars — backtest, optimize, scan, and auto-race across symbols before any deployment.</div>

            {/* ── Tabs ── */}
            <div className="flex gap-2 mb-1 border-b border-slate-800">
                {TABS.map(t => (
                    <button key={t.id} onClick={() => setMode(t.id)}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-t-lg text-sm font-semibold border border-b-0 transition-colors ${mode === t.id
                            ? (t.id === 'auto' ? 'bg-amber-500/15 border-amber-600/60 text-amber-300' : 'bg-primary/15 border-primary/60 text-primary')
                            : 'bg-slate-900/60 border-slate-800 text-slate-500 hover:text-slate-300'}`}>
                        <t.icon className="w-4 h-4" /> {t.label}
                    </button>
                ))}
            </div>
            <div className="text-[11px] text-slate-600 mb-4 pl-1">{TABS.find(t => t.id === mode)?.desc}</div>

            {error && <div className="mb-4 p-2 bg-red-900/20 border border-red-700/50 rounded text-red-300 text-xs">{error}</div>}

            {/* ═══════════════ BACKTEST TAB ═══════════════ */}
            {mode === 'backtest' && (
                <>
                    {TemplatePicker}
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                        {SetupCard}
                        {PayoffCard}
                        <div className="bg-surface rounded-xl border border-slate-700 p-4">
                            <div className="text-sm font-semibold text-white mb-3">Run</div>
                            <div className="grid grid-cols-3 gap-2 text-xs mb-3">{DateRangeInputs}</div>
                            <button onClick={() => runBacktest()} disabled={running}
                                className="w-full py-2 bg-primary/20 hover:bg-primary/30 border border-primary/50 text-primary rounded font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                                {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                {running ? 'Running…' : 'Run Backtest'}
                            </button>
                            <div className="mt-3 pt-3 border-t border-slate-800">
                                <div className="text-xs text-slate-400 font-semibold mb-1 flex items-center gap-1"><Save className="w-3.5 h-3.5" /> Save this configuration</div>
                                <div className="flex gap-2">
                                    <input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="strategy name"
                                        className="flex-1 bg-slate-800 border border-slate-700 rounded p-1.5 text-xs text-slate-200" />
                                    <button onClick={saveStrategy}
                                        className="px-3 py-1.5 bg-sky-900/30 hover:bg-sky-900/50 border border-sky-700/50 text-sky-300 rounded text-xs font-semibold">
                                        Save
                                    </button>
                                </div>
                                <div className="text-[10px] text-slate-600 mt-1">{saveMsg || 'Saves template + all params + entry trigger to the DB — load or deploy it from the Deploy tab.'}</div>
                            </div>
                            {result?.metrics && (
                                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                                    <Tile label="Trades" value={result.metrics.n} />
                                    <Tile label="Win rate" value={`${result.metrics.winRate}%`} />
                                    <Tile label="Net PnL" value={`₹${fmt(result.metrics.netPnl)}`} good={result.metrics.netPnl > 0} bad={result.metrics.netPnl < 0} />
                                    <Tile label="Profit factor" value={result.metrics.profitFactor === Infinity ? '∞' : result.metrics.profitFactor} />
                                    <Tile label="Avg win" value={`₹${fmt(result.metrics.avgWin)}`} good />
                                    <Tile label="Avg loss" value={`₹${fmt(result.metrics.avgLoss)}`} bad />
                                    <Tile label="Max DD" value={`₹${fmt(result.metrics.maxDrawdown)}`} bad />
                                    <Tile label="Avg margin" value={`₹${fmt(result.metrics.avgMargin)}`} />
                                    <Tile label="ROI on margin" value={result.metrics.roiOnMarginPct != null ? `${result.metrics.roiOnMarginPct}%` : '—'} good={result.metrics.roiOnMarginPct > 0} />
                                    <Tile label="Exits" value={Object.entries(result.metrics.exitReasons || {}).map(([k, v]) => `${k}:${v}`).join(' ')} small />
                                </div>
                            )}
                        </div>
                    </div>

                    {result?.trades?.length > 0 && (
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
                            <div className="bg-surface rounded-xl border border-slate-700 p-4">
                                <div className="text-sm font-semibold text-white mb-2">Equity (net, ₹)</div>
                                <ResponsiveContainer width="100%" height={300}>
                                    <LineChart data={equity}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                        <XAxis dataKey="i" tick={{ fill: '#64748b', fontSize: 10 }} />
                                        <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                                        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />
                                        <ReferenceLine y={0} stroke="#475569" />
                                        <Line type="monotone" dataKey="equity" stroke="#34d399" dot={false} strokeWidth={2} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="bg-surface rounded-xl border border-slate-700 p-4 overflow-x-auto">
                                <div className="text-sm font-semibold text-white mb-2">Trades ({result.trades.length})</div>
                                <div className="max-h-[340px] overflow-y-auto">
                                    <table className="w-full text-[11px] text-slate-300">
                                        <thead className="sticky top-0 bg-surface"><tr className="text-slate-500 text-left"><th>Entry</th><th>Exit</th><th>Hold</th><th>Reason</th><th className="text-right">Spot in→out</th><th className="text-right">Credit</th><th className="text-right">Margin</th><th className="text-right">Net ₹</th></tr></thead>
                                        <tbody>
                                            {result.trades.slice().reverse().map((t, i) => (
                                                <tr key={i} className="border-t border-slate-800">
                                                    <td title="IST">{istDateTime(t.entryTime)}</td>
                                                    <td title="IST">{istDateTime(t.exitTime)}</td>
                                                    <td>{t.holdDays}d</td>
                                                    <td className="text-slate-400">{t.reason}</td>
                                                    <td className="text-right text-slate-400">{fmt(t.spotEntry)}→{fmt(t.spotExit)}</td>
                                                    <td className="text-right">₹{fmt(t.credit, 1)}</td>
                                                    <td className="text-right text-slate-500">₹{fmt(t.margin)}</td>
                                                    <td className={`text-right font-semibold ${t.netPnl > 0 ? 'text-emerald-300' : 'text-red-300'}`}>₹{fmt(t.netPnl)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ═══════════════ OPTIMIZER TAB ═══════════════ */}
            {mode === 'sweep' && (
                <>
                    {TemplatePicker}
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                        {SetupCard}
                        {PayoffCard}
                        <div className="bg-surface rounded-xl border border-slate-700 p-4">
                            <div className="text-sm font-semibold text-white mb-3">Sweep configuration</div>
                            <div className="grid grid-cols-3 gap-2 text-xs mb-3">{DateRangeInputs}</div>
                            <div className="grid grid-cols-2 gap-2 text-xs mb-3">{RankingInputs}</div>
                            <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                                <label className="text-slate-400">Max combos
                                    <input type="number" value={sweepCap} min={10} max={1000} onChange={e => setSweepCap(Number(e.target.value) || 300)} className={inputCls} />
                                </label>
                                <label className="text-slate-400">Show top
                                    <select value={sweepTopN} onChange={e => setSweepTopN(Number(e.target.value))} className={inputCls}>
                                        <option value={25}>25 results</option>
                                        <option value={50}>50 results</option>
                                        <option value={100}>100 results</option>
                                    </select>
                                </label>
                            </div>
                            <label className="flex items-center gap-2 text-xs text-slate-400 mb-2">
                                <input type="checkbox" checked={refine} onChange={e => setRefine(e.target.checked)} />
                                Round 2: refine around the leader (midpoint grid)
                            </label>
                            <label className="text-xs text-slate-400 block mb-3">Grid (JSON — arrays expand; edited Setup params apply under every combo)
                                <textarea value={gridText} onChange={e => setGridText(e.target.value)} rows={7}
                                    className="w-full mt-1 bg-slate-800 border border-slate-700 rounded p-2 font-mono text-[11px] text-slate-200" />
                            </label>
                            <button onClick={runSweep} disabled={running}
                                className="w-full py-2 bg-primary/20 hover:bg-primary/30 border border-primary/50 text-primary rounded font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                                {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
                                {running ? 'Running…' : 'Run Sweep'}
                            </button>
                        </div>
                    </div>

                    {sweep?.top && (
                        <div className="bg-surface rounded-xl border border-slate-700 p-4 mt-4 overflow-x-auto">
                            <div className="text-sm font-semibold text-white mb-1">
                                Sweep — {sweep.combos} combos over {sweep.rounds} round{sweep.rounds > 1 ? 's' : ''} ({(sweep.combosPerRound || []).join(' + ')}), ranked by {sweep.split > 0 ? 'VALIDATION' : 'full-period'} {METRICS.find(m => m.v === sweep.metric)?.label}
                            </div>
                            {sweep.window && <div className="text-[11px] text-slate-500 mb-2">Train {sweep.window.trainDays}d → validate on the last {sweep.window.valDays}d (out-of-sample). Distrust combos whose train ≫ validation.</div>}
                            <table className="w-full text-[11px] text-slate-300">
                                <thead><tr className="text-slate-500 text-left">
                                    <th>#</th><th>Params (grid part)</th>
                                    {sweep.split > 0 ? (<><th className="text-right">Val n</th><th className="text-right">Val win%</th><th className="text-right">Val net ₹</th><th className="text-right">Val PF</th><th className="text-right">Val ROI%</th><th className="text-right">Train net ₹</th></>)
                                        : (<><th className="text-right">n</th><th className="text-right">Win%</th><th className="text-right">Net ₹</th><th className="text-right">PF</th><th className="text-right">ROI%</th><th className="text-right">MaxDD</th></>)}
                                    <th className="text-right">Actions</th>
                                </tr></thead>
                                <tbody>
                                    {sweep.top.map((r, i) => {
                                        const v = r.val || r.metrics, tr = r.train;
                                        return (
                                            <tr key={i} className="border-t border-slate-800 hover:bg-slate-800/40">
                                                <td className="text-slate-500">{i + 1}</td>
                                                <td className="font-mono text-[10px] text-slate-400">{JSON.stringify(r.params)}</td>
                                                <td className="text-right">{M(v, 'n')}</td>
                                                <td className="text-right">{M(v, 'winRate')}</td>
                                                <td className={`text-right font-semibold ${(v?.netPnl ?? 0) > 0 ? 'text-emerald-300' : 'text-red-300'}`}>₹{fmt(v?.netPnl)}</td>
                                                <td className="text-right">{M(v, 'profitFactor')}</td>
                                                <td className="text-right">{v?.roiOnMarginPct != null ? `${v.roiOnMarginPct}%` : '—'}</td>
                                                <td className="text-right">{sweep.split > 0 ? `₹${fmt(tr?.netPnl)}` : `₹${fmt(v?.maxDrawdown)}`}</td>
                                                <td className="text-right whitespace-nowrap">
                                                    <button onClick={() => testSweepRow(r)} disabled={running}
                                                        className="px-2 py-0.5 rounded border border-emerald-700/50 bg-emerald-900/20 text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40"
                                                        title="Apply these params to Setup and run the full backtest">
                                                        ▶ Test
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}

            {/* ═══════════════ SCAN TAB ═══════════════ */}
            {mode === 'scan' && (
                <>
                    <div className="bg-surface rounded-xl border border-slate-700 p-4 mb-4">
                        <div className="text-sm font-semibold text-white mb-3">Scan configuration — every structure at its defaults, one leaderboard</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                            <div>
                                <div className="text-slate-400 mb-1">Structures</div>
                                {OutlookChips}
                                <div className="text-slate-400 mb-1 mt-3">Symbols (≤6)</div>
                                {SymbolChips(6)}
                            </div>
                            <div>
                                <div className="grid grid-cols-3 gap-2 mb-2">{DateRangeInputs}</div>
                                <div className="grid grid-cols-2 gap-2 mb-3">{RankingInputs}</div>
                                <button onClick={runScan} disabled={running}
                                    className="w-full py-2 bg-primary/20 hover:bg-primary/30 border border-primary/50 text-primary rounded font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                                    {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
                                    {running ? 'Running…' : `Scan ${scanOutlook === 'all' ? templates.length : scanOutlook} × ${scanSymbols.length} symbols`}
                                </button>
                            </div>
                        </div>
                    </div>

                    {scan?.rows && (
                        <div className="bg-surface rounded-xl border border-slate-700 p-4 overflow-x-auto">
                            <div className="text-sm font-semibold text-white mb-1">
                                Scan — {scan.templatesScanned} structures × {scan.symbolsScanned} symbols, ranked by {scan.split > 0 ? 'VALIDATION' : 'full-period'} {METRICS.find(m => m.v === scan.metric)?.label}
                            </div>
                            <div className="text-[11px] text-slate-500 mb-2">All at template defaults — ▶ Test runs the full backtest, ⚙ Tune opens it in the Optimizer.</div>
                            <table className="w-full text-[11px] text-slate-300">
                                <thead><tr className="text-slate-500 text-left">
                                    <th>#</th><th>Structure</th><th>Outlook</th><th>Symbol</th>
                                    <th className="text-right">{scan.split > 0 ? 'Val n' : 'n'}</th>
                                    <th className="text-right">Win%</th><th className="text-right">Net ₹</th><th className="text-right">PF</th>
                                    <th className="text-right">ROI/margin</th>
                                    {scan.split > 0 && <th className="text-right">Train net ₹</th>}
                                    <th className="text-right">Actions</th>
                                </tr></thead>
                                <tbody>
                                    {scan.rows.filter(r => !r.error).slice(0, 60).map((r, i) => {
                                        const v = r.val || r.metrics;
                                        return (
                                            <tr key={i} className="border-t border-slate-800 hover:bg-slate-800/40">
                                                <td className="text-slate-500">{i + 1}</td>
                                                <td>{r.name || r.template}</td>
                                                <td className={`${(OUTLOOK_COLORS[r.outlook] || '').split(' ')[0]}`}>{r.outlook}</td>
                                                <td>{shortSym(r.symbol)}</td>
                                                <td className="text-right">{M(v, 'n')}</td>
                                                <td className="text-right">{M(v, 'winRate')}</td>
                                                <td className={`text-right font-semibold ${(v?.netPnl ?? 0) > 0 ? 'text-emerald-300' : 'text-red-300'}`}>₹{fmt(v?.netPnl)}</td>
                                                <td className="text-right">{M(v, 'profitFactor')}</td>
                                                <td className="text-right">{v?.roiOnMarginPct != null ? `${v.roiOnMarginPct}%` : '—'}</td>
                                                {scan.split > 0 && <td className="text-right text-slate-400">₹{fmt(r.train?.netPnl)}</td>}
                                                <td className="text-right whitespace-nowrap">
                                                    <button onClick={() => runBacktestFor(r.template, r.symbol)} disabled={running}
                                                        className="px-2 py-0.5 mr-1 rounded border border-emerald-700/50 bg-emerald-900/20 text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40"
                                                        title="Full backtest (whole period) — equity curve + every trade">
                                                        ▶ Test
                                                    </button>
                                                    <button onClick={() => { selectTemplate(r.template); setSymbol(r.symbol); const inst = instruments.find(x => x.v === r.symbol); if (inst?.spot) setSpot(inst.spot); setMode('sweep'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                                        className="px-2 py-0.5 rounded border border-sky-700/50 bg-sky-900/20 text-sky-300 hover:bg-sky-900/40"
                                                        title="Open in Optimizer with this template + symbol preloaded">
                                                        ⚙ Tune
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}

            {/* ═══════════════ AUTO TAB ═══════════════ */}
            {mode === 'auto' && (
                <>
                    <div className="bg-surface rounded-xl border border-amber-700/30 p-4 mb-4">
                        <div className="text-sm font-semibold text-amber-300 mb-1 flex items-center gap-2"><Zap className="w-4 h-4" /> Auto-Optimize — the full race</div>
                        <div className="text-xs text-slate-400 mb-3">Every selected strategy (own params, random-searched) × {scanOutlook === 'all' ? 'all' : scanOutlook} structures × symbols → structure sweep + refine → OOS-ranked champions{autoAi ? ' → AI-validated' : ''}. Runs on all CPU cores.</div>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
                            <div>
                                <div className="text-slate-400 mb-1 font-semibold">Structures</div>
                                {OutlookChips}
                                <div className="text-slate-400 mb-1 mt-3 font-semibold">Symbols (≤4)</div>
                                {SymbolChips(4)}
                                <div className="text-slate-400 mb-1 mt-3 font-semibold">Signal strategies ({autoStrategies.length ? `${autoStrategies.length} selected` : 'all optimizable'})</div>
                                <div className="flex gap-1 flex-wrap max-h-28 overflow-y-auto">
                                    <button onClick={() => setAutoStrategies([])}
                                        className={`px-2 py-1 rounded border text-[11px] ${!autoStrategies.length ? 'bg-primary/20 border-primary text-primary' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                                        All
                                    </button>
                                    {strategies.map(s => (
                                        <button key={s.id}
                                            onClick={() => setAutoStrategies(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])}
                                            title={s.reason || s.label}
                                            className={`px-2 py-1 rounded border text-[11px] ${autoStrategies.includes(s.id) ? 'bg-primary/20 border-primary text-primary' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                                            {s.label || s.id}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <div className="grid grid-cols-3 gap-2 mb-2">{DateRangeInputs}</div>
                                <div className="grid grid-cols-2 gap-2 mb-2">{RankingInputs}</div>
                                <div className="grid grid-cols-2 gap-2">
                                    <label className="text-slate-400">Budget level
                                        <select value={budgetLevel} onChange={e => { setBudgetLevel(Number(e.target.value)); setBudgetCustom({}); }} className={inputCls}>
                                            {Array.from({ length: 20 }, (_, i) => i + 1).map(L => (
                                                <option key={L} value={L}>
                                                    Level {L}{L <= 3 ? ' · quick' : L <= 7 ? ' · thorough' : L <= 14 ? ' · deep (fine grids)' : ' · marathon (days)'}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="text-slate-400">Entries
                                        <select value={autoEntryStyle} onChange={e => setAutoEntryStyle(e.target.value)} className={inputCls}>
                                            <option value="both">Signals + time-based neutrals</option>
                                            <option value="signal-only">Strategy signals ONLY</option>
                                        </select>
                                    </label>
                                </div>
                                <div className="mt-2 text-[11px] text-slate-500">
                                    ≈ {fmt(autoEstimate.total)} backtests · est. {autoEstimate.dur}
                                    {budgetLevel >= 15 && <span className="text-amber-400"> · survives refresh (re-attach below); a server redeploy interrupts it</span>}
                                </div>
                                <button onClick={() => setBudgetAdv(v => !v)} className="mt-1 text-[11px] text-sky-400 hover:text-sky-300">
                                    {budgetAdv ? '▾ Hide advanced budget' : '▸ Advanced budget (edit every number)'}
                                </button>
                                {budgetAdv && (
                                    <div className="grid grid-cols-2 gap-2 mt-2">
                                        {Object.keys(effBudget).map(k => (
                                            <label key={k} className="text-slate-500" title={BUDGET_HELP[k] || k}>{k}
                                                <input type="number" value={effBudget[k]}
                                                    onChange={e => setBudgetCustom(c => ({ ...c, [k]: Number(e.target.value) || 0 }))}
                                                    className="w-full mt-0.5 bg-slate-800 border border-slate-700 rounded p-1 text-slate-200" />
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div>
                                <label className="text-slate-400 flex items-center gap-2 mb-2">
                                    <input type="checkbox" checked={autoAi} onChange={e => setAutoAi(e.target.checked)} />
                                    AI-validate champions (replays each entry through the AI confirm gate)
                                </label>
                                {autoAi && (
                                    <label className="text-slate-400 block mb-2">AI confidence threshold
                                        <input type="number" step="0.05" min="0.3" max="0.9" value={aiThreshold}
                                            onChange={e => setAiThreshold(Number(e.target.value) || 0.6)} className={inputCls} />
                                    </label>
                                )}
                                <button onClick={startAuto} disabled={running}
                                    className="w-full py-2.5 mt-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/60 text-amber-300 rounded font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                                    {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                                    {running ? 'Running…' : 'Start Auto-Optimize ⚡'}
                                </button>
                                {running && (
                                    <button onClick={cancelAuto} className="w-full mt-2 py-1.5 bg-red-900/20 border border-red-700/50 text-red-300 rounded text-xs">Cancel run</button>
                                )}
                                {autoState && (
                                    <div className="mt-3 text-xs">
                                        <div className="flex justify-between text-slate-400 mb-1">
                                            <span>Stage {autoState.progress?.stage || 0}/4 — {autoState.progress?.note || autoState.status}</span>
                                            <span>{autoState.workers ? `${autoState.workers} cores · ` : ''}{autoState.progress?.pct ?? 0}%</span>
                                        </div>
                                        <div className="h-2 bg-slate-800 rounded overflow-hidden">
                                            {/* stage 0 (data fetch) = first 10%, stages 1-4 share the rest */}
                                            <div className="h-full bg-amber-500/70 transition-all" style={{
                                                width: `${Math.min(100, Math.max(1,
                                                    (autoState.progress?.stage || 0) === 0
                                                        ? (autoState.progress?.pct || 0) * 0.10
                                                        : 10 + ((autoState.progress.stage - 1) * 22.5) + (autoState.progress.pct || 0) * 0.225
                                                ))}%`,
                                            }} />
                                        </div>
                                        {['error', 'interrupted'].includes(autoState.status) && <div className="mt-2 text-red-300">{autoState.error}</div>}
                                        {autoState.status === 'done' && autoState.result?.stages && (
                                            <div className="mt-2 text-slate-500">
                                                {autoState.result.stages.map(s => s.stage === 4
                                                    ? `S4 ${s.name}: ${s.combos ?? 0} champions full-tested${s.aiCalls ? ` · ${s.aiCalls} AI calls` : ''}`
                                                    : `S${s.stage} ${s.name}: ${s.combos ?? 0} combos → kept ${s.kept ?? 0}`).join(' · ')}
                                                {` · total ${autoState.result.totalCombos} backtests`}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {autoJobs.length > 0 && (
                        <div className="bg-surface rounded-xl border border-slate-700 p-3 mb-4">
                            <div className="text-xs font-semibold text-white mb-2">Recent runs (persisted — re-attach after a refresh)</div>
                            <div className="space-y-1 text-[11px]">
                                {autoJobs.map(j => (
                                    <div key={j.jobId} className="flex items-center gap-2 border-b border-slate-800/60 pb-1">
                                        <span className={`px-1.5 py-0.5 rounded border text-[10px] ${j.status === 'running' ? 'border-amber-600 text-amber-300' : j.status === 'done' ? 'border-emerald-700 text-emerald-300' : 'border-red-800 text-red-400'}`}>{j.status}</span>
                                        <span className="text-slate-500" title="IST">{istDateTime(j.startedAt)}</span>
                                        <span className="text-slate-400 flex-1 truncate">
                                            {(j.request?.symbols || []).map(shortSym).join('+')} · {j.request?.strategies ?? '?'} strategies · {j.request?.entry_style || 'both'}
                                            {j.status === 'running' && j.progress?.note ? ` — ${j.progress.note}` : ''}
                                            {j.status === 'interrupted' && j.checkpoint?.stage ? (
                                                j.checkpoint.phase === 'partial'
                                                    ? ` — checkpoint mid-stage ${j.checkpoint.stage}${j.checkpoint.cursor ? ` (${j.checkpoint.cursor} done)` : ''}`
                                                    : ` — checkpoint after stage ${j.checkpoint.stage}`) : ''}
                                        </span>
                                        {autoJob?.jobId !== j.jobId && ['running', 'done'].includes(j.status) && (
                                            <button onClick={() => attachJob(j)}
                                                className="px-2 py-0.5 rounded border border-sky-700/50 bg-sky-900/20 text-sky-300 hover:bg-sky-900/40">
                                                {j.status === 'running' ? 'Attach' : 'View results'}
                                            </button>
                                        )}
                                        {j.status === 'interrupted' && j.checkpoint?.stage && (
                                            <button onClick={() => resumeJob(j)} title="Continue from the last checkpoint"
                                                className="px-2 py-0.5 rounded border border-emerald-700/50 bg-emerald-900/20 text-emerald-300 hover:bg-emerald-900/40">
                                                {j.checkpoint.phase === 'partial' ? `Resume ↻ S${j.checkpoint.stage}` : `Resume ▸ S${j.checkpoint.stage + 1}`}
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {autoState?.status === 'done' && autoState.result?.champions?.length > 0 && (
                        <div>
                            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                                {autoState.result.champions.map((ch, i) => (
                                    <div key={i} className={`bg-surface rounded-xl border p-4 ${i === 0 ? 'border-amber-500/60' : 'border-slate-700'}`}>
                                        <div className="flex items-center justify-between mb-1">
                                            <div className="text-sm font-semibold text-white">{i === 0 ? '🏆 ' : `#${i + 1} `}{ch.name}</div>
                                            <span className={`text-[10px] px-2 py-0.5 rounded border ${OUTLOOK_COLORS[ch.outlook] || 'border-slate-700 text-slate-400'}`}>{ch.outlook}</span>
                                        </div>
                                        <div className="text-xs text-slate-400 mb-2">
                                            {shortSym(ch.symbol)} · {ch.signal_strategy ? `signal: ${ch.signal_strategy}` : 'time-based entries'}
                                        </div>
                                        <div className="grid grid-cols-3 gap-1 text-[11px] mb-2">
                                            <Tile label="Val net" value={`₹${fmt(ch.val?.netPnl)}`} good={ch.val?.netPnl > 0} bad={ch.val?.netPnl < 0} />
                                            <Tile label="Train net" value={`₹${fmt(ch.train?.netPnl)}`} good={ch.train?.netPnl > 0} bad={ch.train?.netPnl < 0} />
                                            <Tile label="Full net" value={`₹${fmt(ch.full?.netPnl)}`} good={ch.full?.netPnl > 0} bad={ch.full?.netPnl < 0} />
                                            <Tile label="Val PF" value={ch.val?.profitFactor === Infinity ? '∞' : ch.val?.profitFactor ?? '—'} />
                                            <Tile label="Win%" value={ch.full?.winRate ?? '—'} />
                                            <Tile label="ROI/margin" value={ch.full?.roiOnMarginPct != null ? `${ch.full.roiOnMarginPct}%` : '—'} />
                                        </div>
                                        {ch.withAi && (
                                            <div className="text-[11px] mb-2 p-2 rounded bg-violet-900/20 border border-violet-700/40 text-violet-200">
                                                🧠 With AI gate: net ₹{fmt(ch.withAi.netPnl)} over {ch.withAi.n} trades
                                                ({ch.aiStats?.permitted}/{ch.aiStats?.candidates} entries permitted, {ch.aiStats?.calls} calls)
                                                {ch.full && ch.withAi.netPnl > ch.full.netPnl ? ' — AI improved it' : ' — AI filtered it down'}
                                            </div>
                                        )}
                                        {ch.signal_params && <div className="text-[10px] font-mono text-slate-500 break-all mb-1">signal: {JSON.stringify(ch.signal_params)}</div>}
                                        {ch.structure_params && <div className="text-[10px] font-mono text-slate-500 break-all mb-2">structure: {JSON.stringify(ch.structure_params)}</div>}
                                        <button onClick={() => loadChampion(ch)}
                                            className="w-full py-1.5 bg-primary/15 hover:bg-primary/25 border border-primary/40 text-primary rounded text-xs font-semibold">
                                            Load config → Backtest
                                        </button>
                                    </div>
                                ))}
                            </div>
                            {autoState.result.leaderboard?.length > 0 && (
                                <div className="bg-surface rounded-xl border border-slate-700 p-4 mt-4 overflow-x-auto">
                                    <div className="text-sm font-semibold text-white mb-2">Full leaderboard (stage-3 survivors)</div>
                                    <table className="w-full text-[11px] text-slate-300">
                                        <thead><tr className="text-slate-500 text-left"><th>#</th><th>Structure</th><th>Symbol</th><th>Signal</th><th className="text-right">Val net ₹</th><th className="text-right">Val PF</th><th className="text-right">Val win%</th><th className="text-right">Train net ₹</th></tr></thead>
                                        <tbody>
                                            {autoState.result.leaderboard.map((r, i) => (
                                                <tr key={i} className="border-t border-slate-800">
                                                    <td className="text-slate-500">{i + 1}</td>
                                                    <td>{r.name || r.template}</td>
                                                    <td>{shortSym(r.symbol)}</td>
                                                    <td className="text-slate-400">{r.signal_strategy || 'time'}</td>
                                                    <td className={`text-right font-semibold ${(r.val?.netPnl ?? 0) > 0 ? 'text-emerald-300' : 'text-red-300'}`}>₹{fmt(r.val?.netPnl)}</td>
                                                    <td className="text-right">{r.val?.profitFactor === Infinity ? '∞' : r.val?.profitFactor ?? '—'}</td>
                                                    <td className="text-right">{r.val?.winRate ?? '—'}</td>
                                                    <td className="text-right text-slate-400">₹{fmt(r.train?.netPnl)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}

            {/* ═══════════════ DEPLOY TAB ═══════════════ */}
            {mode === 'deploy' && (
                <>
                    <div className="bg-surface rounded-xl border border-slate-700 p-4 mb-4">
                        <div className="flex items-center justify-between mb-2">
                            <div className="text-sm font-semibold text-white flex items-center gap-2"><Save className="w-4 h-4 text-sky-400" /> Saved strategies ({savedList.length})</div>
                            <label className="text-xs text-slate-400 flex items-center gap-2">Deploy lots
                                <input type="number" min={1} value={deployLots} onChange={e => setDeployLots(Math.max(1, Number(e.target.value) || 1))}
                                    className="w-16 bg-slate-800 border border-slate-700 rounded p-1 text-slate-200" />
                            </label>
                        </div>
                        {savedList.length === 0 ? (
                            <div className="text-xs text-slate-500 py-4 text-center">Nothing saved yet — run a backtest on the Backtest tab and hit Save.</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-[11px] text-slate-300">
                                    <thead><tr className="text-slate-500 text-left">
                                        <th>Name</th><th>Structure</th><th>Symbol</th><th>Entry</th>
                                        <th className="text-right">BT net ₹</th><th className="text-right">BT win%</th><th className="text-right">BT PF</th><th className="text-right">BT n</th>
                                        <th className="text-right">Actions</th>
                                    </tr></thead>
                                    <tbody>
                                        {savedList.map(s => {
                                            const m = s.backtest?.metrics || {};
                                            const isOpen = savedDetail === s._id;
                                            return (
                                            <React.Fragment key={s._id}>
                                            <tr className="border-t border-slate-800 hover:bg-slate-800/40">
                                                <td className="font-semibold text-slate-200">{s.name}</td>
                                                <td>{templates.find(t => t.key === s.template)?.name || s.template}</td>
                                                <td>{shortSym(s.symbol)}</td>
                                                <td className="text-slate-400">{s.entry_mode === 'signal' ? `signal: ${s.signal_strategy}${(s.params||{}).use_signal_exit ? ' +exit' : ''}` : 'time'}</td>
                                                <td className={`text-right font-semibold ${(m.netPnl ?? 0) > 0 ? 'text-emerald-300' : 'text-red-300'}`}>₹{fmt(m.netPnl)}</td>
                                                <td className="text-right">{m.winRate != null ? `${m.winRate}%` : '—'}</td>
                                                <td className="text-right">{m.profitFactor != null ? (m.profitFactor === null ? '∞' : fmt(m.profitFactor, 2)) : '—'}</td>
                                                <td className="text-right">{m.n ?? '—'}</td>
                                                <td className="text-right whitespace-nowrap">
                                                    <button onClick={() => setSavedDetail(isOpen ? null : s._id)}
                                                        className={`px-2 py-0.5 mr-1 rounded border ${isOpen ? 'border-amber-600 bg-amber-900/25 text-amber-300' : 'border-slate-600 bg-slate-800 text-slate-300'} hover:bg-slate-700`} title="Show backtest results + params saved with this strategy">
                                                        {isOpen ? '▲ Hide' : '▾ Details'}
                                                    </button>
                                                    <button onClick={() => loadSaved(s)}
                                                        className="px-2 py-0.5 mr-1 rounded border border-sky-700/50 bg-sky-900/20 text-sky-300 hover:bg-sky-900/40" title="Load into Backtest for inspection">
                                                        Load
                                                    </button>
                                                    <button onClick={() => deploySaved(s, 'PAPER')}
                                                        className="px-2 py-0.5 mr-1 rounded border border-emerald-700/50 bg-emerald-900/20 text-emerald-300 hover:bg-emerald-900/40" title="Deploy as PAPER (simulated fills at quotes)">
                                                        ▶ Paper
                                                    </button>
                                                    <button onClick={() => deploySaved(s, 'LIVE')}
                                                        className="px-2 py-0.5 mr-1 rounded border border-red-700/60 bg-red-900/25 text-red-300 hover:bg-red-900/45 font-semibold" title="Deploy LIVE — real broker orders (confirmation required)">
                                                        🔴 LIVE
                                                    </button>
                                                    <button onClick={() => deleteSaved(s)}
                                                        className="px-2 py-0.5 rounded border border-slate-700 bg-slate-800 text-slate-400 hover:text-red-300" title="Delete saved strategy">
                                                        <Trash2 className="w-3 h-3 inline" />
                                                    </button>
                                                </td>
                                            </tr>
                                            {isOpen && (
                                                <tr className="bg-slate-900/60">
                                                    <td colSpan={9} className="p-3">
                                                        {s.backtest?.metrics ? (
                                                            <div className="space-y-2">
                                                                <div className="text-[11px] text-slate-400">
                                                                    Backtest window <span className="text-slate-300">{s.backtest.from} → {s.backtest.to}</span> · {s.backtest.resolution || '5'}m
                                                                    {m.exitReasons && <span> · exits: {Object.entries(m.exitReasons).map(([k, v]) => `${k}×${v}`).join(', ')}</span>}
                                                                </div>
                                                                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                                                                    <Tile label="Net PnL" value={`₹${fmt(m.netPnl)}`} good={m.netPnl > 0} bad={m.netPnl < 0} />
                                                                    <Tile label="Trades" value={m.n ?? '—'} />
                                                                    <Tile label="Win Rate" value={m.winRate != null ? `${m.winRate}%` : '—'} good={m.winRate >= 50} />
                                                                    <Tile label="Profit Factor" value={m.profitFactor == null ? '∞' : fmt(m.profitFactor, 2)} good={m.profitFactor == null || m.profitFactor >= 1.3} bad={m.profitFactor != null && m.profitFactor < 1} />
                                                                    <Tile label="Max Drawdown" value={`₹${fmt(m.maxDrawdown)}`} bad={m.maxDrawdown < 0} />
                                                                    <Tile label="ROI on margin" value={m.roiOnMarginPct != null ? `${fmt(m.roiOnMarginPct, 1)}%` : '—'} good={m.roiOnMarginPct > 0} />
                                                                    <Tile label="Avg Win" value={`₹${fmt(m.avgWin)}`} good />
                                                                    <Tile label="Avg Loss" value={`₹${fmt(m.avgLoss)}`} bad />
                                                                    <Tile label="Avg margin (capital)" value={`₹${fmt(m.avgMargin)}`} />
                                                                    <Tile label="Gross win" value={`₹${fmt(m.grossWin)}`} good />
                                                                    <Tile label="Gross loss" value={`₹${fmt(m.grossLoss)}`} bad />
                                                                    <Tile label="Wins" value={`${m.wins ?? '—'}`} />
                                                                </div>
                                                                <div>
                                                                    <div className="text-[10px] text-slate-500 mb-0.5">Structure params</div>
                                                                    <div className="text-[10px] font-mono text-slate-400 break-all">{JSON.stringify(s.params || {})}</div>
                                                                    {s.signal_params && <><div className="text-[10px] text-violet-400 mt-1 mb-0.5">Tuned signal params</div><div className="text-[10px] font-mono text-slate-400 break-all">{JSON.stringify(s.signal_params)}</div></>}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="text-[11px] text-slate-500">No backtest snapshot saved with this strategy. Load it → run a backtest → re-save to attach results.</div>
                                                        )}
                                                    </td>
                                                </tr>
                                            )}
                                            </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* ── Summary cards (live-engine dashboard parity) ───────────── */}
                    {mlStatus && (() => {
                        const realized = (mlStatus.realizedToday?.LIVE || 0) + (mlStatus.realizedToday?.PAPER || 0);
                        const open = mlStatus.openMtmRupees || 0;
                        const combined = realized + open;
                        const cap = mlStatus.limits?.dailyLossLimit || 0;
                        // worst-book loss vs the per-mode cap
                        const worstLoss = Math.max(0, -(mlStatus.dayPnl?.LIVE || 0), -(mlStatus.dayPnl?.PAPER || 0));
                        const lossPct = cap > 0 ? Math.min(100, Math.round(100 * worstLoss / cap)) : null;
                        const engState = mlStatus.halted ? 'HALTED' : mlStatus.started ? 'RUNNING' : 'STOPPED';
                        const brk = Object.entries(mlStatus.templateBreakdown || {});
                        const tickAgeS = mlStatus.lastTickAt ? Math.round((Date.now() - new Date(mlStatus.lastTickAt).getTime()) / 1000) : null;
                        const Card = ({ label, children, tone }) => (
                            <div className={`rounded-xl border p-3 ${tone || 'border-slate-700 bg-slate-900/40'}`}>
                                <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">{label}</div>
                                {children}
                            </div>
                        );
                        return (
                            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
                                <Card label="Combined PnL (all books)" tone={combined < 0 ? 'border-rose-800/50 bg-rose-950/10' : 'border-emerald-800/50 bg-emerald-950/10'}>
                                    <div className={`text-xl font-mono font-bold ${combined < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>₹{fmt(combined)}</div>
                                    <div className="text-[10px] text-slate-500">Realized ₹{fmt(realized)} · Open {open >= 0 ? '+' : ''}₹{fmt(open)}</div>
                                </Card>
                                <Card label="Structures closed today">
                                    <div className="text-xl font-mono font-bold text-slate-200">{mlStatus.tradesToday || 0}</div>
                                    <div className="text-[10px] text-slate-500" title="Deployments that have used their one-per-day entry slot (including a structure carried in from a prior day).">{mlStatus.entriesUsed || 0}/{mlStatus.active || 0} used today’s entry slot</div>
                                </Card>
                                <Card label="Daily Loss Used" tone={lossPct >= 80 ? 'border-rose-800/50 bg-rose-950/10' : undefined}>
                                    {cap > 0 ? (
                                        <>
                                            <div className={`text-xl font-mono font-bold ${lossPct >= 80 ? 'text-rose-300' : 'text-slate-200'}`}>{lossPct}%</div>
                                            <div className="text-[10px] text-slate-500">of ₹{fmt(cap)} cap (per book)</div>
                                        </>
                                    ) : (
                                        <><div className="text-sm font-mono text-slate-400">no cap set</div><div className="text-[10px] text-slate-600">MULTILEG_DAILY_LOSS_LIMIT</div></>
                                    )}
                                </Card>
                                <Card label="Engine Status" tone={engState === 'HALTED' ? 'border-rose-800/50 bg-rose-950/10' : undefined}>
                                    <div className={`text-lg font-bold ${engState === 'RUNNING' ? 'text-emerald-300' : engState === 'HALTED' ? 'text-rose-300' : 'text-slate-400'}`}>{engState}</div>
                                    <div className="text-[10px] text-slate-500 truncate" title={brk.map(([k, v]) => `${k} × ${v}`).join(' · ')}>
                                        {mlStatus.openStructures || 0} open{brk.length ? ' · ' + brk.map(([k, v]) => `${k} × ${v}`).join(' · ') : ''}
                                        {tickAgeS != null && tickAgeS > 30 ? ` · ⚠ loop ${tickAgeS}s ago` : ''}
                                    </div>
                                </Card>
                            </div>
                        );
                    })()}

                    {/* ── Signal Status Timeline (per deployment) ────────────────── */}
                    {mlDeps.signalStatus && Object.keys(mlDeps.signalStatus).length > 0 && (
                        <div className="bg-surface rounded-xl border border-slate-700 p-4 mb-4">
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-sm font-semibold text-white flex items-center gap-2"><Activity className="w-4 h-4 text-amber-400" /> Signal Status Timeline</div>
                                <span className="text-[10px] text-slate-500">newest → · 🟢 entry · ⚪ neutral · 🔵 ready · 🟡 waiting</span>
                            </div>
                            <div className="space-y-1.5">
                                {mlDeps.deployments.filter(d => mlDeps.signalStatus[d._id]).map(d => {
                                    const info = mlDeps.signalStatus[d._id];
                                    const cur = info?.current;
                                    const hist = info?.history || [];
                                    const colorFor = (a) => a === 'ENTRY' ? 'bg-emerald-500' : a === 'READY' ? 'bg-blue-500/70' : a === 'WAIT' ? 'bg-amber-500/70' : a === 'DONE' ? 'bg-slate-500' : 'bg-slate-700';
                                    return (
                                        <div key={d._id} className="flex items-center gap-3 text-xs">
                                            <div className="w-40 truncate text-slate-300" title={d.name}>{d.name}</div>
                                            <div className="flex items-center gap-1.5 w-24">
                                                <span className={`w-2 h-2 rounded-full ${colorFor(cur?.action)}`} />
                                                <span className={`uppercase text-[10px] font-bold ${cur?.action === 'ENTRY' ? 'text-emerald-300' : cur?.action === 'READY' ? 'text-blue-300' : cur?.action === 'WAIT' ? 'text-amber-300' : 'text-slate-400'}`}>{cur?.action || '—'}</span>
                                                {cur?.type && <span className="text-[10px] text-slate-500">{cur.type}</span>}
                                            </div>
                                            <div className="flex-1 truncate text-[11px] text-slate-500 italic" title={cur?.reason || ''}>{cur?.reason || '—'}</div>
                                            <div className="flex items-center gap-0.5 flex-shrink-0">
                                                {hist.map((h, i) => (
                                                    <span key={i} className={`w-1.5 h-3 rounded-sm ${colorFor(h.action)}`}
                                                        title={`${istTimeSec(h.ts)} IST\n${h.action}${h.type ? ' ' + h.type : ''}: ${h.reason || ''}`} />
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className="bg-surface rounded-xl border border-slate-700 p-4 mb-4">
                        <div className="text-sm font-semibold text-white mb-2 flex items-center gap-2"><Rocket className="w-4 h-4 text-amber-400" /> Deployments ({mlDeps.deployments.length})</div>
                        {mlStatus && (
                            <div className="flex flex-wrap gap-3 text-[11px] font-mono mb-3 px-2 py-1.5 rounded border border-slate-800 bg-slate-900/40"
                                title="Whole-book exposure vs engine limits. Greeks: Δ ₹/spot-pt · V ₹/IV-pt · Θ ₹/day. Short vega is what the vega cap gates on.">
                                <span className="text-slate-400">book:</span>
                                <span className={mlStatus.openMtmRupees < 0 ? 'text-red-300' : 'text-emerald-300'}>MTM ₹{fmt(mlStatus.openMtmRupees)}</span>
                                <span className="text-slate-300">margin ₹{fmt(mlStatus.openMarginRupees)}{mlStatus.limits?.maxMargin > 0 ? `/${fmt(mlStatus.limits.maxMargin)}` : ''}</span>
                                <span className="text-slate-300">short-prem ₹{fmt(mlStatus.openShortPremiumRupees)}</span>
                                <span className={mlStatus.openShortVegaRupees > 0 ? 'text-amber-300' : 'text-slate-500'}>short-vega ₹{fmt(mlStatus.openShortVegaRupees)}/IVpt{mlStatus.limits?.maxVega > 0 ? `/${fmt(mlStatus.limits.maxVega)}` : ''}</span>
                                {mlStatus.bookGreeks && (mlStatus.bookGreeks.delta !== 0 || mlStatus.bookGreeks.vega !== 0) && (
                                    <span className="text-sky-300">Δ₹{fmt(mlStatus.bookGreeks.delta, 1)} V₹{fmt(mlStatus.bookGreeks.vega, 1)} Θ₹{fmt(mlStatus.bookGreeks.theta, 1)}</span>
                                )}
                                <span className="text-slate-500">LIVE day ₹{fmt(mlStatus.dayPnl?.LIVE)} · PAPER day ₹{fmt(mlStatus.dayPnl?.PAPER)}</span>
                            </div>
                        )}
                        {mlDeps.deployments.length === 0 ? (
                            <div className="text-xs text-slate-500 py-4 text-center">No structure runners yet — deploy a saved strategy above (Paper first, always).</div>
                        ) : (
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                                {mlDeps.deployments.map(d => {
                                    const st = d.position?.state || 'IDLE';
                                    const open = ['OPEN', 'ENTERING', 'EXITING'].includes(st);
                                    const pos = d.position || {};
                                    const P = d.params || {};
                                    // expiry + DTE from the structure's legs
                                    const expiry = pos.legs?.map(l => l.expiry).filter(Boolean).sort()[0] || null;
                                    const dte = expiry ? Math.round((new Date(expiry + 'T15:30:00+05:30') - Date.now()) / 86400e3) : null;
                                    // what the engine is managing this structure TO (its exit config)
                                    const exitBits = [];
                                    if (P.tp_pct_credit) exitBits.push(`TP ${P.tp_pct_credit}% credit`);
                                    if (P.tp_pct_max_profit) exitBits.push(`TP ${P.tp_pct_max_profit}% maxP`);
                                    if (P.sl_x_credit) exitBits.push(`SL ${P.sl_x_credit}×`);
                                    if (P.sl_pct_debit) exitBits.push(`SL ${P.sl_pct_debit}%`);
                                    if (P.leg_sl_x) exitBits.push(`legSL ${P.leg_sl_x}×`);
                                    if (P.dte_exit != null) exitBits.push(`DTE≤${P.dte_exit}`);
                                    if (P.tp_x_debit) exitBits.push(`TP ${P.tp_x_debit}× debit`);
                                    if (P.use_signal_exit) exitBits.push('early-exit');
                                    if (P.square_off) exitBits.push(`sq-off ${P.square_off}`);
                                    // per-unit → ₹ multiplier = lotSize×lots. Prefer the engine's own
                                    // ratio (lastMtmRupees/lastMtm), which is correct even after a broker
                                    // lot-correction/partial-fill; fall back to leg.qty/ratio.
                                    const unitToRupee = (pos.lastMtm && pos.lastMtmRupees) ? (pos.lastMtmRupees / pos.lastMtm)
                                        : (pos.legs?.length ? Number(pos.legs[0].qty) / (pos.legs[0].ratio || 1) : null);
                                    // computed exit PRICE LEVELS (₹ MTM thresholds the engine acts on —
                                    // mirrors exits.js _monitor tpHit/slHit exactly, incl. tp_x_debit)
                                    const isCredit = pos.origCredit > 0;
                                    let tpUnit = null, slUnit = null;
                                    if (pos.origCredit != null) {
                                        if (isCredit) {
                                            if (P.tp_pct_credit) tpUnit = pos.origCredit * P.tp_pct_credit / 100;
                                            if (P.sl_x_credit) slUnit = -pos.origCredit * (P.sl_x_credit - 1);
                                        } else {
                                            if (P.tp_pct_max_profit && Number.isFinite(pos.maxProfit) && pos.maxProfit > 0) tpUnit = pos.maxProfit * P.tp_pct_max_profit / 100;
                                            else if (P.tp_x_debit) tpUnit = Math.abs(pos.origCredit) * P.tp_x_debit;
                                            if (P.sl_pct_debit) slUnit = -Math.abs(pos.origCredit) * P.sl_pct_debit / 100;
                                        }
                                    }
                                    const rup = (u) => (u != null && unitToRupee) ? `₹${fmt(u * unitToRupee)}` : (u != null ? `₹${fmt(u, 1)}/u` : '—');
                                    const detailOpen = depDetail === d._id;
                                    return (
                                        <div key={d._id} className={`rounded-lg border p-3 ${d.trade_mode === 'LIVE' ? 'border-red-800/60 bg-red-950/10' : 'border-slate-700 bg-slate-900/40'}`}>
                                            <div className="flex items-center justify-between mb-1">
                                                <div className="text-xs font-semibold text-slate-200">{d.name}</div>
                                                <div className="flex gap-1">
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${d.trade_mode === 'LIVE' ? 'border-red-700 text-red-300' : 'border-sky-700 text-sky-300'}`}>{d.trade_mode}</span>
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${d.status === 'ACTIVE' ? 'border-emerald-700 text-emerald-300' : 'border-slate-600 text-slate-400'}`}>{d.status}</span>
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${open ? 'border-amber-600 text-amber-300' : 'border-slate-700 text-slate-500'}`}>{st}</span>
                                                    <button onClick={() => setDepDetail(detailOpen ? null : d._id)}
                                                        className={`text-[10px] px-1.5 py-0.5 rounded border ${detailOpen ? 'border-amber-600 text-amber-300' : 'border-slate-600 text-slate-400'} hover:text-white`}
                                                        title="Full order detail — legs, prices, SL/TP levels, exit deadlines">{detailOpen ? '▲' : '▾'} details</button>
                                                </div>
                                            </div>
                                            <div className="text-[11px] text-slate-400 mb-1">
                                                {templates.find(t => t.key === d.template)?.name || d.template} · {shortSym(d.symbol)} · {d.lots} lot(s)
                                                {d.entry_mode === 'signal' ? ` · signal: ${d.signal_strategy}` : ' · time entry'}
                                            </div>
                                            <div className="grid grid-cols-3 gap-1 text-[11px] mb-2">
                                                <div title="MTM = mark-to-market, the structure's live PnL if closed now. '/unit' is per single lot-share (before × lot size × lots); the ₹ figure is the actual money on the book.">
                                                    <Tile label="MTM (₹ · /unit)"
                                                        value={d.position?.lastMtm != null ? `₹${fmt(d.position.lastMtmRupees ?? 0)} · ${fmt(d.position.lastMtm, 1)}/u` : '—'}
                                                        good={d.position?.lastMtm > 0} bad={d.position?.lastMtm < 0} />
                                                </div>
                                                <Tile label="Today" value={`₹${fmt(d.daily?.pnlToday)}`} good={d.daily?.pnlToday > 0} bad={d.daily?.pnlToday < 0} />
                                                <Tile label={`Total (${d.totals?.trades || 0})`} value={`₹${fmt(d.totals?.netPnl)}`} good={d.totals?.netPnl > 0} bad={d.totals?.netPnl < 0} />
                                            </div>
                                            {open && d.position?.greeks && (
                                                <div className="text-[10px] font-mono mb-2 flex gap-3"
                                                    title="Live book greeks — Δ: ₹ per 1pt spot move · V: ₹ per 1 IV point · Θ: ₹ per day. IVP = vol percentile at entry.">
                                                    <span className={d.position.greeks.delta < 0 ? 'text-red-300' : 'text-emerald-300'}>Δ ₹{fmt(d.position.greeks.delta, 1)}/pt</span>
                                                    <span className={d.position.greeks.vega < 0 ? 'text-amber-300' : 'text-sky-300'}>V ₹{fmt(d.position.greeks.vega, 1)}/IVpt</span>
                                                    <span className={d.position.greeks.theta > 0 ? 'text-emerald-300' : 'text-red-300'}>Θ ₹{fmt(d.position.greeks.theta, 1)}/day</span>
                                                    {d.position.ivpAtEntry != null && <span className="text-slate-500">IVP@in {fmt(d.position.ivpAtEntry, 0)}</span>}
                                                </div>
                                            )}
                                            {/* Entry timing + position detail (the trade's story) */}
                                            {open && pos.entryAt && (
                                                <div className="text-[10px] font-mono text-slate-400 mb-2 space-y-0.5 border-t border-slate-800 pt-1.5">
                                                    <div>⏱ <span className="text-slate-300">Entered {fmtClock(pos.entryAt)}</span> · held {fmtDur(pos.entryAt)}{pos.entryDir ? ` · dir ${pos.entryDir}` : ''}</div>
                                                    <div>
                                                        spot@in {fmt(pos.entrySpot)}
                                                        {pos.origCredit != null && <> · net {pos.origCredit > 0 ? 'credit' : 'debit'} <span className="text-slate-300">₹{fmt(Math.abs(pos.origCredit), 1)}/u</span></>}
                                                        {Number.isFinite(pos.maxProfit) && pos.maxProfit != null && <> · maxP ₹{fmt(pos.maxProfit, 1)}/u</>}
                                                        {pos.marginEst > 0 && <> · margin ₹{fmt(pos.marginEst)}</>}
                                                    </div>
                                                    {expiry && <div>expiry {expiry}{dte != null ? ` · ${dte} DTE` : ''} · {pos.lots || d.lots} lot(s){pos.vegaEst != null ? ` · vega@in ₹${fmt(pos.vegaEst, 0)}` : ''}</div>}
                                                    {exitBits.length > 0 && <div className="text-slate-500">manages to: {exitBits.join(' · ')}</div>}
                                                </div>
                                            )}
                                            {st === 'OPEN' && d.position?.legs?.length > 0 && (
                                                <div className="text-[10px] font-mono text-slate-500 mb-2">
                                                    {d.position.legs.map((l, i) => <div key={i}>{l.action} {l.symbol?.split(':')[1]} @ ₹{l.entryPrice}{l.exitPrice ? ` → ₹${l.exitPrice}` : ''}</div>)}
                                                </div>
                                            )}
                                            {/* IDLE deployments: show what it's waiting for + config summary */}
                                            {!open && d.status === 'ACTIVE' && (
                                                <div className="text-[10px] font-mono text-slate-500 mb-2 border-t border-slate-800 pt-1.5">
                                                    flat — waiting for {d.entry_mode === 'signal' ? `a ${d.signal_strategy} signal` : `the ${P.entry_time || '09:20'} entry`}
                                                    {d.daily?.entered ? ' · already entered today' : ''}{exitBits.length ? ` · exits: ${exitBits.slice(0, 3).join(' · ')}` : ''}
                                                </div>
                                            )}
                                            {/* ── Full order detail (professional view) ── */}
                                            {detailOpen && (
                                                <div className="text-[10px] mb-2 border-t border-slate-800 pt-2 space-y-2">
                                                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-slate-400">
                                                        <div>Deployment <span className="text-slate-300">{d.name}</span></div>
                                                        <div>Created <span className="text-slate-300">{istDateTime(d.createdAt)}</span></div>
                                                        <div>Mode <span className={d.trade_mode === 'LIVE' ? 'text-red-300' : 'text-sky-300'}>{d.trade_mode}</span> · {d.status}</div>
                                                        <div>Entry <span className="text-slate-300">{d.entry_mode === 'signal' ? `${d.signal_strategy}${P.use_signal_exit ? ' +exit' : ''}` : `time ${P.entry_time || '09:20'}`}</span></div>
                                                        {open && <><div>Entered <span className="text-slate-300">{istDateTime(pos.entryAt)}</span> · held {fmtDur(pos.entryAt)}</div>
                                                        <div>Entry spot <span className="text-slate-300">{fmt(pos.entrySpot)}</span>{pos.entryDir ? ` · dir ${pos.entryDir}` : ''}</div></>}
                                                    </div>
                                                    {open && pos.legs?.length > 0 && (
                                                        <div className="overflow-x-auto">
                                                            <table className="w-full font-mono text-slate-300">
                                                                <thead><tr className="text-slate-500 text-left"><th>Leg</th><th>Strike</th><th className="text-right">Qty</th><th className="text-right">Entry ₹</th><th className="text-right">Now/Exit</th><th>Status</th>{d.trade_mode === 'LIVE' && <th>OrderId</th>}</tr></thead>
                                                                <tbody>
                                                                    {pos.legs.map((l, i) => (
                                                                        <tr key={i} className="border-t border-slate-800/60">
                                                                            <td className={l.action === 'BUY' ? 'text-emerald-300' : 'text-red-300'}>{l.action} {l.type}</td>
                                                                            <td>{l.strike}{l.ratio > 1 ? ` ×${l.ratio}` : ''}</td>
                                                                            <td className="text-right">{l.qty}</td>
                                                                            <td className="text-right">{fmt(l.entryPrice, 2)}</td>
                                                                            <td className="text-right text-slate-500">{l.exitPrice ? fmt(l.exitPrice, 2) : '—'}</td>
                                                                            <td className="text-slate-500">{l.status}</td>
                                                                            {d.trade_mode === 'LIVE' && <td className="text-slate-600 truncate max-w-[90px]" title={l.orderId}>{l.orderId || '—'}</td>}
                                                                        </tr>
                                                                    ))}
                                                                    {pos.closedLegs?.map((l, i) => (
                                                                        <tr key={`c${i}`} className="border-t border-slate-800/60 opacity-60">
                                                                            <td className={l.action === 'BUY' ? 'text-emerald-300' : 'text-red-300'}>{l.action} {l.type}</td>
                                                                            <td>{l.strike}</td><td className="text-right">{l.qty}</td>
                                                                            <td className="text-right">{fmt(l.entryPrice, 2)}</td>
                                                                            <td className="text-right">{fmt(l.exitPrice, 2)}</td>
                                                                            <td className="text-slate-500">{l.closeReason || l.status}</td>
                                                                            {d.trade_mode === 'LIVE' && <td className="text-slate-600">closed</td>}
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    )}
                                                    {open && (
                                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-0.5 font-mono text-slate-400">
                                                            <div>Net {isCredit ? 'credit' : 'debit'} <span className="text-slate-300">₹{fmt(Math.abs(pos.origCredit), 1)}/u</span>{unitToRupee ? ` (₹${fmt(Math.abs(pos.origCredit) * unitToRupee)})` : ''}</div>
                                                            {Number.isFinite(pos.maxProfit) && <div>Max profit ₹{fmt(pos.maxProfit, 1)}/u{unitToRupee ? ` (₹${fmt(pos.maxProfit * unitToRupee)})` : ''}</div>}
                                                            <div>Margin <span className="text-slate-300">₹{fmt(pos.marginEst || 0)}</span></div>
                                                            <div className="text-emerald-300">TP level {rup(tpUnit)}{tpUnit != null && unitToRupee ? ` (${fmt(tpUnit,1)}/u)` : ''}</div>
                                                            <div className="text-red-300">SL level {rup(slUnit)}{slUnit != null && unitToRupee ? ` (${fmt(slUnit,1)}/u)` : ''}</div>
                                                            {P.leg_sl_x > 0 && <div className="text-amber-300">leg-SL @ entry ×{P.leg_sl_x}</div>}
                                                            <div>MTM now <span className={pos.lastMtm > 0 ? 'text-emerald-300' : pos.lastMtm < 0 ? 'text-red-300' : 'text-slate-300'}>₹{fmt(pos.lastMtmRupees ?? 0)}</span></div>
                                                            {expiry && <div>Expiry {expiry} · {dte} DTE</div>}
                                                            <div className="text-slate-500">Exit by: {P.square_off && `sq-off ${P.square_off}`}{expiry ? ` · expiry-day 15:00${dte === 0 ? ' (today)' : ''}` : ''}{P.dte_exit != null ? ` · DTE≤${P.dte_exit}` : ''}</div>
                                                        </div>
                                                    )}
                                                    {!open && <div className="font-mono text-slate-500">Flat. Last daily PnL ₹{fmt(d.daily?.pnlToday)} · lifetime {d.totals?.trades || 0} trades ₹{fmt(d.totals?.netPnl)}. Config → {exitBits.join(' · ') || 'defaults'}.</div>}
                                                </div>
                                            )}
                                            {d.lastError && <div className="text-[10px] text-red-400 mb-2">⚠ {d.lastError}</div>}
                                            <div className="flex gap-1 flex-wrap">
                                                {d.status === 'ACTIVE'
                                                    ? <button onClick={() => depAction(d, open ? 'stop-close' : 'stop')} className="px-2 py-0.5 rounded border border-amber-700/50 bg-amber-900/20 text-amber-300 text-[11px] hover:bg-amber-900/40"><StopCircle className="w-3 h-3 inline mr-0.5" />{open ? 'Stop + close' : 'Stop'}</button>
                                                    : <button onClick={() => depAction(d, 'start')} className="px-2 py-0.5 rounded border border-emerald-700/50 bg-emerald-900/20 text-emerald-300 text-[11px] hover:bg-emerald-900/40"><Play className="w-3 h-3 inline mr-0.5" />Resume</button>}
                                                {st === 'OPEN' && <button onClick={() => depAction(d, 'close')} className="px-2 py-0.5 rounded border border-red-700/50 bg-red-900/20 text-red-300 text-[11px] hover:bg-red-900/40"><Square className="w-3 h-3 inline mr-0.5" />Close now</button>}
                                                {!open && <button onClick={() => depAction(d, 'delete')} className="px-2 py-0.5 rounded border border-slate-700 bg-slate-800 text-slate-400 text-[11px] hover:text-red-300"><Trash2 className="w-3 h-3 inline mr-0.5" />Delete</button>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        <div className="bg-surface rounded-xl border border-slate-700 p-4">
                            <div className="text-sm font-semibold text-white mb-2">Engine events</div>
                            {mlDeps.events.length === 0 ? <div className="text-xs text-slate-500">No events yet.</div> : (
                                <div className="max-h-[300px] overflow-y-auto text-[11px] space-y-1">
                                    {mlDeps.events.map((e, i) => (
                                        <div key={i} className="flex gap-2 border-b border-slate-800/60 pb-1">
                                            <span className="text-slate-600 whitespace-nowrap" title={istDateTime(e.at) + ' IST'}>{istTimeSec(e.at)}</span>
                                            <span className={`font-semibold whitespace-nowrap ${/FAIL|ERROR|SKIP/.test(e.type) ? 'text-red-300' : /ENTRY|EXIT/.test(e.type) ? 'text-emerald-300' : 'text-sky-300'}`}>{e.type}</span>
                                            <span className="text-slate-400">{e.name ? `[${e.name}] ` : ''}{e.message}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="bg-surface rounded-xl border border-slate-700 p-4 overflow-x-auto">
                            <div className="text-sm font-semibold text-white mb-2">Structure trades ({mlTrades.length})</div>
                            {mlTrades.length === 0 ? <div className="text-xs text-slate-500">No completed structure round-trips yet.</div> : (
                                <table className="w-full text-[11px] text-slate-300">
                                    <thead><tr className="text-slate-500 text-left"><th>Exit</th><th>Name</th><th>Mode</th><th>Reason</th><th className="text-right">Gross ₹</th><th className="text-right">Charges</th><th className="text-right">Net ₹</th></tr></thead>
                                    <tbody>
                                        {mlTrades.map((t, i) => (
                                            <tr key={i} className="border-t border-slate-800">
                                                <td title="IST">{istDateTime(t.exitAt)}</td>
                                                <td>{t.name}</td>
                                                <td className={t.trade_mode === 'LIVE' ? 'text-red-300' : 'text-sky-300'}>{t.trade_mode}</td>
                                                <td className="text-slate-400">{t.exitReason}</td>
                                                <td className="text-right">₹{fmt(t.grossPnl)}</td>
                                                <td className="text-right text-slate-500">₹{fmt(t.charges)}</td>
                                                <td className={`text-right font-semibold ${t.netPnl > 0 ? 'text-emerald-300' : 'text-red-300'}`}>₹{fmt(t.netPnl)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </>
            )}

            {mode === 'results' && (
                <div className="space-y-4">
                    {/* Filters */}
                    <div className="bg-surface rounded-xl border border-slate-700 p-4 flex flex-wrap items-end gap-3">
                        <div>
                            <div className="text-[10px] text-slate-500 mb-0.5">Book</div>
                            <select value={resFilter.mode} onChange={e => setResFilter(f => ({ ...f, mode: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded p-1 text-xs text-slate-200">
                                <option value="all">All books</option><option value="LIVE">LIVE only</option><option value="PAPER">PAPER only</option>
                            </select>
                        </div>
                        <div>
                            <div className="text-[10px] text-slate-500 mb-0.5">Deployment</div>
                            <select value={resFilter.deploymentId} onChange={e => setResFilter(f => ({ ...f, deploymentId: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded p-1 text-xs text-slate-200 max-w-[180px]">
                                <option value="all">All deployments</option>
                                {[...new Map(resTrades.map(t => [String(t.deploymentId), t.name])).entries()].filter(([id]) => id && id !== 'undefined').map(([id, name]) => <option key={id} value={id}>{name || id.slice(-6)}</option>)}
                            </select>
                        </div>
                        <div>
                            <div className="text-[10px] text-slate-500 mb-0.5">Structure</div>
                            <select value={resFilter.template} onChange={e => setResFilter(f => ({ ...f, template: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded p-1 text-xs text-slate-200">
                                <option value="all">All structures</option>
                                {[...new Set(resTrades.map(t => t.template))].filter(Boolean).map(k => <option key={k} value={k}>{templates.find(t => t.key === k)?.name || k}</option>)}
                            </select>
                        </div>
                        <div>
                            <div className="text-[10px] text-slate-500 mb-0.5">Symbol</div>
                            <select value={resFilter.symbol} onChange={e => setResFilter(f => ({ ...f, symbol: e.target.value }))} className="bg-slate-800 border border-slate-700 rounded p-1 text-xs text-slate-200">
                                <option value="all">All symbols</option>
                                {[...new Set(resTrades.map(t => t.symbol))].filter(Boolean).map(s => <option key={s} value={s}>{shortSym(s)}</option>)}
                            </select>
                        </div>
                        <button onClick={refreshResults} className="ml-auto px-2 py-1 rounded border border-slate-700 bg-slate-800 text-xs text-slate-300 hover:text-white flex items-center gap-1">
                            <RefreshCw className={`w-3 h-3 ${resLoading ? 'animate-spin' : ''}`} /> Refresh
                        </button>
                    </div>

                    {resStats.n === 0 ? (
                        <div className="bg-surface rounded-xl border border-slate-700 p-8 text-center text-sm text-slate-500">
                            {resLoading ? 'Loading…' : 'No completed structure round-trips yet for this filter. Deploy a strategy (PAPER first) — booked structures show here.'}
                        </div>
                    ) : (
                        <>
                            {/* KPI strip */}
                            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
                                <Tile label="Net PnL" value={`₹${fmt(resStats.net)}`} good={resStats.net > 0} bad={resStats.net < 0} />
                                <Tile label="Trades" value={`${resStats.n}`} />
                                <Tile label="Win Rate" value={`${resStats.winRate.toFixed(0)}%`} good={resStats.winRate >= 50} bad={resStats.winRate < 50} />
                                <Tile label="Profit Factor" value={resStats.profitFactor == null ? '∞' : resStats.profitFactor.toFixed(2)} good={resStats.profitFactor == null || resStats.profitFactor >= 1.3} bad={resStats.profitFactor != null && resStats.profitFactor < 1} />
                                <Tile label="Max Drawdown" value={`₹${fmt(resStats.maxDD)}`} bad={resStats.maxDD < 0} />
                                <Tile label="Charges paid" value={`₹${fmt(resStats.charges)}`} bad />
                                <Tile label="Avg Win" value={`₹${fmt(resStats.avgWin)}`} good />
                                <Tile label="Avg Loss" value={`₹${fmt(-resStats.avgLoss)}`} bad />
                                <Tile label="Best" value={`₹${fmt(resStats.best)}`} good />
                                <Tile label="Worst" value={`₹${fmt(resStats.worst)}`} bad />
                                <Tile label="Avg Hold" value={`${resStats.avgHold.toFixed(1)}d`} />
                                <Tile label="Gross (pre-cost)" value={`₹${fmt(resStats.gross)}`} good={resStats.gross > 0} bad={resStats.gross < 0} />
                            </div>

                            {/* Equity curve */}
                            <div className="bg-surface rounded-xl border border-slate-700 p-4">
                                <div className="text-sm font-semibold text-white mb-2 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-400" /> Equity Curve (cumulative net ₹)</div>
                                <ResponsiveContainer width="100%" height={260}>
                                    <LineChart data={resStats.equity} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} minTickGap={40} />
                                        <YAxis tick={{ fontSize: 10, fill: '#64748b' }} width={54} />
                                        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 12 }} />
                                        <ReferenceLine y={0} stroke="#475569" />
                                        <Line type="monotone" dataKey="cum" stroke="#34d399" dot={false} strokeWidth={2} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Breakdowns */}
                            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                                {[['By exit reason', resStats.byReason], ['By structure', resStats.byTemplate], ['By symbol', resStats.bySymbol]].map(([title, m]) => (
                                    <div key={title} className="bg-surface rounded-xl border border-slate-700 p-4">
                                        <div className="text-sm font-semibold text-white mb-2">{title}</div>
                                        <table className="w-full text-[11px] text-slate-300">
                                            <thead><tr className="text-slate-500 text-left"><th>Key</th><th className="text-right">Trades</th><th className="text-right">Win%</th><th className="text-right">Net ₹</th></tr></thead>
                                            <tbody>
                                                {Object.entries(m).sort((a, b) => b[1].net - a[1].net).map(([k, v]) => (
                                                    <tr key={k} className="border-t border-slate-800">
                                                        <td className="truncate max-w-[120px]" title={k}>{title === 'By structure' ? (templates.find(t => t.key === k)?.name || k) : title === 'By symbol' ? shortSym(k) : k}</td>
                                                        <td className="text-right">{v.n}</td>
                                                        <td className="text-right text-slate-400">{Math.round(100 * v.wins / v.n)}%</td>
                                                        <td className={`text-right font-semibold ${v.net > 0 ? 'text-emerald-300' : 'text-red-300'}`}>₹{fmt(v.net)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ))}
                            </div>

                            {/* Trades table */}
                            <div className="bg-surface rounded-xl border border-slate-700 p-4 overflow-x-auto">
                                <div className="text-sm font-semibold text-white mb-2">Structure round-trips ({resFiltered.length})</div>
                                <table className="w-full text-[11px] text-slate-300">
                                    <thead><tr className="text-slate-500 text-left">
                                        <th>Entry → Exit</th><th>Structure</th><th>Sym</th><th>Mode</th><th>Reason</th>
                                        <th className="text-right">Credit/u</th><th className="text-right">IVP@in</th><th className="text-right">Gross ₹</th><th className="text-right">Chg</th><th className="text-right">Net ₹</th>
                                    </tr></thead>
                                    <tbody>
                                        {[...resFiltered].sort((a, b) => new Date(b.exitAt) - new Date(a.exitAt)).map((t, i) => (
                                            <tr key={i} className="border-t border-slate-800">
                                                <td className="whitespace-nowrap" title="IST">{istDateTime(t.entryAt)} → {istTime(t.exitAt)}</td>
                                                <td className="truncate max-w-[120px]" title={t.template}>{templates.find(x => x.key === t.template)?.name || t.template}</td>
                                                <td>{shortSym(t.symbol)}</td>
                                                <td className={t.trade_mode === 'LIVE' ? 'text-red-300' : 'text-sky-300'}>{t.trade_mode}</td>
                                                <td className="text-slate-400">{t.exitReason}</td>
                                                <td className="text-right">{t.origCredit != null ? `₹${fmt(t.origCredit, 1)}` : '—'}</td>
                                                <td className="text-right text-slate-500">{t.ivpAtEntry != null ? fmt(t.ivpAtEntry, 0) : '—'}</td>
                                                <td className="text-right">₹{fmt(t.grossPnl)}</td>
                                                <td className="text-right text-slate-500">₹{fmt(t.charges)}</td>
                                                <td className={`text-right font-semibold ${t.netPnl > 0 ? 'text-emerald-300' : 'text-red-300'}`}>₹{fmt(t.netPnl)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

// All engine/trade timestamps are stored UTC; render them in IST explicitly
// (timeZone:'Asia/Kolkata') so it's correct regardless of the viewer's browser
// timezone — never raw-slice an ISO string (that shows UTC).
const IST_TZ = 'Asia/Kolkata';
function istStr(v, opts = {}) {
    if (!v) return '—';
    const d = new Date(v);
    if (isNaN(d.getTime())) return '—';
    try { return d.toLocaleString('en-IN', { timeZone: IST_TZ, hour12: false, ...opts }); }
    catch { return '—'; }
}
const istDateTime = (v) => istStr(v, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); // "21 Jul 13:42"
const istTimeSec = (v) => istStr(v, { hour: '2-digit', minute: '2-digit', second: '2-digit' });               // "13:42:27"
const istTime = (v) => istStr(v, { hour: '2-digit', minute: '2-digit' });                                     // "13:42"
function fmtClock(iso) { return istDateTime(iso); }
function fmtDur(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms) || ms < 0) return '';
    const m = Math.floor(ms / 60000);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function Tile({ label, value, good, bad, small }) {
    return (
        <div className="bg-slate-800/60 border border-slate-700 rounded p-2">
            <div className="text-[10px] text-slate-500">{label}</div>
            <div className={`${small ? 'text-[10px]' : 'text-sm font-semibold'} ${good ? 'text-emerald-300' : bad ? 'text-red-300' : 'text-slate-200'}`}>{value}</div>
        </div>
    );
}
