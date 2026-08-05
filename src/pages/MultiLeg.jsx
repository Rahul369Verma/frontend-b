import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot, ReferenceArea, Legend,
} from 'recharts';
import { Layers, Play, SlidersHorizontal, RefreshCw, Radar, Zap, FlaskConical, Rocket, Save, Trash2, Square, StopCircle, Activity, TrendingUp } from 'lucide-react';
import StructureAttributionPanel from '../components/viz/StructureAttributionPanel';

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
    { v: 'sharpe', label: 'Sharpe (smooth curve)' }, { v: 'sortino', label: 'Sortino (downside-safe)' },
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
        // stage-1 random param draws per STRATEGY (raced alongside defaults) —
        // the broad-exploration lever. Quadratic ramp: cheap early (few draws),
        // reaching 100 at the top level for a deep search.
        explore: Math.min(100, Math.max(1, Math.round(L * L / 4))),
        signalSamples: Math.min(600, exp(3, 1.30)),
        survivors2: 5 + Math.round(2 * L),
        // more champions at higher levels (was capped at 8 by level 20) — a big
        // search should surface a big shortlist. Diversity-capped server-side so
        // they're VARIED structures, not the same one repeated.
        champions: Math.min(24, 2 + Math.round(L * 1.1)),
        // how many signal strategies enter the race — the real "explore more"
        // lever. Was hard-capped at 12; now scales with level up to the full
        // catalog (server clamps to what's actually available/selected).
        maxStrategies: Math.min(40, 6 + L),
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
    champions: 'final champions (diversity-capped so they are varied structures)',
    maxStrategies: 'how many signal strategies enter the race (scales with level)',
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
    const [presets, setPresets] = useState([]);            // professional starting bundles
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
    const [depChart, setDepChart] = useState(null);       // _id of the deployment showing its live payoff chart
    const [depPayoff, setDepPayoff] = useState(null);     // { id, data } — backend risk-graph (expiry + T+0 curves)
    const [depRecon, setDepRecon] = useState(null);       // { id, data } — broker fill/PnL reconciliation (LIVE only)
    const [depActivity, setDepActivity] = useState(null); // _id of the deployment showing its P&L activity (equity) chart
    const [activityData, setActivityData] = useState(null); // { id, data } — cumulative realized P&L + live open MTM
    const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
    const [confirmState, setConfirmState] = useState(null); // { title, body, danger, confirmLabel, requireText, onConfirm }
    const [livePreview, setLivePreview] = useState(null);          // pre-deploy risk preview modal { strategy, tradeMode, data, loading }
    const [pending, setPending] = useState({});             // per-action pending flags (button spinners)
    const [depSort, setDepSort] = useLocalStorage('ml_dep_sort', 'state');   // state|mtm|pnl|name
    const [depFilter, setDepFilter] = useLocalStorage('ml_dep_filter', 'all'); // all|LIVE|PAPER|open
    const [lastPoll, setLastPoll] = useState({ at: null, ok: true });        // deploy-tab freshness/connection
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
    const [resTradeOpen, setResTradeOpen] = useState(null); // expanded trade (drill-down to legs)
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
        const nStrat = Math.min(B.maxStrategies || 12, autoStrategies.length || strategies.filter(s => s.optimizable !== false).length || 12);
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
    const resetForTemplate = useCallback((t, paramOverride = null) => {
        if (!t) return;
        setParams(paramOverride ? { ...t.defaults, ...paramOverride } : { ...t.defaults });
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

    // Apply a professional preset: template + its param bundle + entry-mode wiring.
    const applyPreset = useCallback((preset) => {
        if (!preset) return;
        const t = templates.find(x => x.key === preset.template);
        setTplKey(preset.template);
        resetForTemplate(t, preset.params); // template defaults + the preset's deltas
        if (preset.entry_mode === 'signal' && preset.signal_strategy) {
            setEntryMode('signal'); setSignalStrategy(preset.signal_strategy);
            setUseSignalExit(!!(preset.params || {}).use_signal_exit); setSignalParams(null);
        } else { setEntryMode('time'); setUseSignalExit(false); setSignalParams(null); }
        setResult(null); setSweep(null);
    }, [templates, resetForTemplate]);

    useEffect(() => {
        axios.get(`${API_URL}/multileg/templates`).then(r => {
            const list = Array.isArray(r.data) ? r.data : [];
            setTemplates(list);
            resetForTemplate(list.find(t => t.key === 'iron_condor') || list[0]);
        }).catch(() => {});
        axios.get(`${API_URL}/multileg/presets`).then(r => {
            if (Array.isArray(r.data)) setPresets(r.data);
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

    // OOS is ENFORCED in Auto (the backend floors the hold-out at 20% — an
    // unattended search that ranks on the full period returns curve-fit
    // winners). So when the Auto tab is active, "Off" isn't an option; snap a
    // 0/low split up to 30% so the control matches what will actually run.
    useEffect(() => { if (mode === 'auto' && (!split || split < 0.2)) setSplit(0.3); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

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
            pushToast(`Resume failed: ${e.response?.data?.error || e.message}`, 'error', 8000);
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
        axios.get(`${API_URL}/multileg/deployments`)
            .then(r => { setMlDeps(r.data || { deployments: [], events: [] }); setLastPoll({ at: Date.now(), ok: true }); })
            .catch(() => setLastPoll(p => ({ at: p.at, ok: false })));
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

    // Broker reconciliation for the LIVE deployment whose details are open:
    // our recorded fills ⟷ broker trade-book VWAP ⟷ broker net position, plus
    // PnL restated gross vs net-of-charges. Read-only, fetched on demand.
    useEffect(() => {
        if (!depDetail || mode !== 'deploy') { setDepRecon(null); return; }
        const d = (mlDeps.deployments || []).find(x => x._id === depDetail);
        if (!d || d.trade_mode !== 'LIVE' || !['OPEN', 'EXITING'].includes(d.position?.state)) { setDepRecon(null); return; }
        let alive = true;
        const pull = () => axios.get(`${API_URL}/multileg/deployments/${depDetail}/reconcile`)
            .then(r => { if (alive) setDepRecon({ id: depDetail, data: r.data }); })
            .catch(e => { if (alive) setDepRecon({ id: depDetail, data: { error: e.response?.data?.error || e.message } }); });
        pull();
        const t = setInterval(pull, 15000);
        return () => { alive = false; clearInterval(t); };
    }, [depDetail, mode, mlDeps.deployments]);

    // Live risk-graph (expiry + T+0 curves) for the deployment whose chart is
    // open — fetched on open and refreshed with the deploy poll so it's dynamic.
    useEffect(() => {
        if (!depChart || mode !== 'deploy') { setDepPayoff(null); return; }
        let alive = true;
        const pull = () => axios.get(`${API_URL}/multileg/deployments/${depChart}/payoff`)
            .then(r => { if (alive) setDepPayoff({ id: depChart, data: r.data }); })
            .catch(() => { if (alive) setDepPayoff({ id: depChart, data: { error: true } }); });
        pull();
        const t = setInterval(pull, 5000);
        return () => { alive = false; clearInterval(t); };
    }, [depChart, mode]);

    // P&L Activity (equity curve of booked trades + live open MTM) for the
    // deployment whose activity chart is open. Refreshed with the deploy poll
    // so the open-MTM leading point stays live.
    useEffect(() => {
        if (!depActivity || mode !== 'deploy') { setActivityData(null); return; }
        let alive = true;
        const pull = () => axios.get(`${API_URL}/multileg/deployments/${depActivity}/activity`)
            .then(r => { if (alive) setActivityData({ id: depActivity, data: r.data }); })
            .catch(() => { if (alive) setActivityData({ id: depActivity, data: { error: true } }); });
        pull();
        const t = setInterval(pull, 10000);
        return () => { alive = false; clearInterval(t); };
    }, [depActivity, mode]);

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

    const withPending = async (key, fn, okMsg) => {
        setPending(p => ({ ...p, [key]: true }));
        try { await fn(); if (okMsg) pushToast(okMsg, 'success'); }
        catch (e) { pushToast(e.response?.data?.error || e.message, 'error', 8000); }
        finally { setPending(p => { const n = { ...p }; delete n[key]; return n; }); }
    };

    // Deploy PAPER immediately; LIVE goes through the pre-deploy risk preview +
    // type-to-confirm modal (opened by openPreview below).
    const doDeploy = (s, tradeMode) => withPending(`deploy:${s._id}`, async () => {
        await axios.post(`${API_URL}/multileg/strategies/${s._id}/deploy`, { trade_mode: tradeMode, lots: deployLots });
        refreshDeployments();
    }, `Deployed “${s.name}” ${tradeMode}`);

    // Fetch a live risk preview, then open the modal (LIVE requires type-to-confirm).
    const openPreview = async (s, tradeMode) => {
        setLivePreview({ strategy: s, tradeMode, loading: true, data: null });
        try {
            const r = await axios.post(`${API_URL}/multileg/preview`, { template: s.template, symbol: s.symbol, params: s.params || {}, lots: deployLots, entry_mode: s.entry_mode });
            setLivePreview({ strategy: s, tradeMode, loading: false, data: r.data });
        } catch (e) {
            setLivePreview({ strategy: s, tradeMode, loading: false, data: { error: e.response?.data?.error || e.message } });
        }
    };
    const deploySaved = (s, tradeMode) => (tradeMode === 'PAPER' ? doDeploy(s, 'PAPER') : openPreview(s, 'LIVE'));

    const deleteSaved = (s) => setConfirmState({
        title: `Delete saved strategy “${s.name}”?`, danger: true, confirmLabel: 'Delete',
        body: <span>The saved recipe is removed. Any deployments already created from it keep running.</span>,
        onConfirm: () => withPending(`delsaved:${s._id}`, async () => { await axios.delete(`${API_URL}/multileg/strategies/${s._id}`); refreshSaved(); }, `Deleted “${s.name}”`),
    });

    const runDepAction = (dep, action) => withPending(`${action}:${dep._id}`, async () => {
        if (action === 'stop') await axios.post(`${API_URL}/multileg/deployments/${dep._id}/stop`, {});
        else if (action === 'stop-close') await axios.post(`${API_URL}/multileg/deployments/${dep._id}/stop`, { close: true });
        else if (action === 'start') await axios.post(`${API_URL}/multileg/deployments/${dep._id}/start`, {});
        else if (action === 'close') await axios.post(`${API_URL}/multileg/deployments/${dep._id}/close`, {});
        else if (action === 'delete') await axios.delete(`${API_URL}/multileg/deployments/${dep._id}`);
        refreshDeployments();
    }, action === 'start' ? `Resumed “${dep.name}”` : action === 'stop' ? `Stopped “${dep.name}”` : null);

    const depAction = (dep, action) => {
        const isLive = dep.trade_mode === 'LIVE';
        if (action === 'close' || action === 'stop-close') {
            setConfirmState({
                title: `${action === 'stop-close' ? 'Stop + close' : 'Close'} “${dep.name}” now?`, danger: true,
                confirmLabel: action === 'stop-close' ? 'Stop + close' : 'Close now',
                requireText: isLive ? dep.name : null,
                body: <span>{isLive ? 'This sends REAL market exit orders at the broker (shorts bought back first). ' : 'Simulated close at the current quotes. '}The open structure will be squared off immediately{action === 'stop-close' ? ' and the deployment stopped' : ''}.</span>,
                onConfirm: () => runDepAction(dep, action),
            });
        } else if (action === 'delete') {
            setConfirmState({ title: `Delete deployment “${dep.name}”?`, danger: true, confirmLabel: 'Delete', requireText: isLive ? dep.name : null,
                body: <span>Removes the deployment record. Only allowed when flat (no open structure).</span>,
                onConfirm: () => runDepAction(dep, action) });
        } else { runDepAction(dep, action); }
    };

    // Bulk: stop-all (halt new entries) or close-all (square off every open structure).
    const bulkAction = (kind) => {
        const targets = (mlDeps.deployments || []).filter(d => kind === 'stop-all' ? d.status === 'ACTIVE' : ['OPEN', 'EXITING'].includes(d.position?.state));
        if (!targets.length) { pushToast(`Nothing to ${kind === 'stop-all' ? 'stop' : 'close'}.`, 'info'); return; }
        const anyLive = targets.some(d => d.trade_mode === 'LIVE');
        setConfirmState({
            title: `${kind === 'stop-all' ? 'Stop' : 'CLOSE'} all ${targets.length} ${kind === 'stop-all' ? 'active deployments' : 'open structures'}?`, danger: kind === 'close-all',
            confirmLabel: kind === 'stop-all' ? 'Stop all' : 'Close all', requireText: anyLive && kind === 'close-all' ? 'CLOSE ALL' : null,
            body: <span>{anyLive && kind === 'close-all' ? 'Includes LIVE books — REAL exit orders. ' : ''}{kind === 'stop-all' ? 'No new entries; open structures keep being managed.' : 'Every open structure is squared off at market now.'}</span>,
            onConfirm: () => withPending('bulk', async () => {
                const ep = kind === 'stop-all' ? (id) => axios.post(`${API_URL}/multileg/deployments/${id}/stop`, {}) : (id) => axios.post(`${API_URL}/multileg/deployments/${id}/close`, {});
                const r = await Promise.allSettled(targets.map(d => ep(d._id)));
                const failed = r.filter(x => x.status === 'rejected').length;
                refreshDeployments();
                pushToast(`${kind === 'stop-all' ? 'Stopped' : 'Closed'} ${targets.length - failed}/${targets.length}${failed ? ` · ${failed} failed` : ''}`, failed ? 'warn' : 'success');
            }),
        });
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
            <label className="text-slate-400">Validation (OOS){mode === 'auto' && <span className="text-[9px] text-emerald-400 ml-1">enforced</span>}
                <select value={split} onChange={e => setSplit(Number(e.target.value))} className={inputCls}>
                    {mode !== 'auto' && <option value={0}>Off (full period)</option>}
                    <option value={0.2}>Hold out last 20%</option>
                    <option value={0.3}>Hold out last 30%</option>
                    <option value={0.4}>Hold out last 40%</option>
                </select>
                {mode === 'auto' && <span className="block text-[9px] text-slate-600 mt-0.5">Always on in Auto — you only choose how much to hold out.</span>}
            </label>
        </>
    );

    const [presetKey, setPresetKey] = useState('');
    const activePreset = presets.find(p => p.key === presetKey);
    const TemplatePicker = (
        <>
            {presets.length > 0 && (
                <div className="mb-3 p-2.5 rounded-lg border border-amber-800/40 bg-amber-950/10">
                    <label className="flex flex-wrap items-center gap-2 text-xs text-amber-200">
                        <span className="font-semibold">⭐ Professional preset</span>
                        <select value={presetKey}
                            onChange={e => { setPresetKey(e.target.value); const p = presets.find(x => x.key === e.target.value); if (p) applyPreset(p); }}
                            className="bg-slate-800 border border-slate-700 rounded p-1 text-slate-200 text-xs">
                            <option value="">— pick a trader-grade starting bundle —</option>
                            {presets.map(p => <option key={p.key} value={p.key}>{p.name} · {p.tag}</option>)}
                        </select>
                        {presetKey && <button onClick={() => setPresetKey('')} className="text-[10px] text-slate-500 hover:text-slate-300">clear</button>}
                    </label>
                    {activePreset && <div className="text-[11px] text-slate-400 mt-1.5 leading-snug">{activePreset.note}</div>}
                    <div className="text-[10px] text-slate-600 mt-1">Loads the template + a full, self-consistent param set. Edit anything before deploying — the pre-deploy review will flag risks.</div>
                </div>
            )}
            <div className="flex flex-wrap gap-2 mb-4">
                {templates.map(t => (
                    <button key={t.key} onClick={() => { selectTemplate(t.key); setPresetKey(''); }}
                        className={`px-3 py-1.5 rounded border text-xs ${t.key === tplKey ? 'bg-primary/20 border-primary text-primary' : `bg-slate-800 hover:bg-slate-700 ${OUTLOOK_COLORS[t.outlook] || 'text-slate-300 border-slate-700'}`}`}
                        title={t.notes}>
                        {t.name}
                    </button>
                ))}
            </div>
        </>
    );

    const SetupCard = (
        <div className="bg-surface rounded-xl border border-slate-700 p-4">
            <div className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><SlidersHorizontal className="w-4 h-4 text-primary" /> Setup — {tpl?.name || tplKey}</div>
            <MarketRead symbol={symbol} presets={presets} onApplyPreset={applyPreset} />
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

    // Deployments filtered + sorted for the panel (LIVE always first — real money on top).
    const visibleDeps = useMemo(() => {
        const isOpen = (d) => ['OPEN', 'ENTERING', 'EXITING'].includes(d.position?.state);
        let list = (mlDeps.deployments || []).filter(d =>
            depFilter === 'all' ? true : depFilter === 'open' ? isOpen(d) : d.trade_mode === depFilter);
        const key = { state: (d) => (isOpen(d) ? 0 : d.status === 'ACTIVE' ? 1 : 2), mtm: (d) => -(d.position?.lastMtmRupees || 0), pnl: (d) => -(d.totals?.netPnl || 0), name: (d) => d.name };
        const k = key[depSort] || key.state;
        list = [...list].sort((a, b) => {
            if ((a.trade_mode === 'LIVE') !== (b.trade_mode === 'LIVE')) return a.trade_mode === 'LIVE' ? -1 : 1; // LIVE first
            const ka = k(a), kb = k(b); return typeof ka === 'string' ? ka.localeCompare(kb) : ka - kb;
        });
        return list;
    }, [mlDeps.deployments, depFilter, depSort]);
    // engine-health severity for the top banner
    const engineHealth = useMemo(() => {
        if (!mlStatus) return null;
        const tickAgeS = mlStatus.lastTickAt ? (Date.now() - new Date(mlStatus.lastTickAt).getTime()) / 1000 : null;
        if (mlStatus.halted) return { level: 'halt', msg: 'ENGINE HALTED — no new multileg entries. Open structures are still managed.' };
        if (!mlStatus.started) return { level: 'halt', msg: 'ENGINE STOPPED — deployments are not being managed.' };
        if (tickAgeS != null && tickAgeS > 40) return { level: 'stale', msg: `Loop stale — no engine tick for ${Math.round(tickAgeS)}s. Open structures may be UNMANAGED.` };
        if (lastPoll.at && !lastPoll.ok) return { level: 'conn', msg: 'Dashboard can’t reach the server — data may be stale (retrying).' };
        return null;
    }, [mlStatus, lastPoll]);

    return (
        <div className="p-6 max-w-[1600px] mx-auto">
            <Toasts toasts={toasts} dismiss={dismissToast} />
            <ConfirmModal open={!!confirmState} {...(confirmState || {})}
                onConfirm={() => { const c = confirmState; setConfirmState(null); c?.onConfirm?.(); }}
                onCancel={() => setConfirmState(null)} />
            <PreviewModal preview={livePreview} deployLots={deployLots} onCancel={() => setLivePreview(null)}
                onConfirm={() => { const s = livePreview.strategy; setLivePreview(null); doDeploy(s, 'LIVE'); }} />
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
                                    <Tile label="Sharpe" value={result.metrics.sharpe != null ? result.metrics.sharpe : '—'} good={result.metrics.sharpe >= 1} bad={result.metrics.sharpe < 0} />
                                    <Tile label="Sortino" value={result.metrics.sortino != null ? result.metrics.sortino : '—'} good={result.metrics.sortino >= 1.5} bad={result.metrics.sortino < 0} />
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

                    {/* Greek attribution — is this template a theta engine or a vol bet?
                        Net P&L cannot answer that, and the two imply opposite entry rules. */}
                    {result?.attribution && (
                        <div className="mt-4">
                            <StructureAttributionPanel data={result.attribution} />
                        </div>
                    )}

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
                                    {sweep.split > 0 ? (<><th className="text-right">Val n</th><th className="text-right">Val win%</th><th className="text-right">Val net ₹</th><th className="text-right">Val PF</th><th className="text-right">Val Sharpe</th><th className="text-right">Val ROI%</th><th className="text-right">Train net ₹</th></>)
                                        : (<><th className="text-right">n</th><th className="text-right">Win%</th><th className="text-right">Net ₹</th><th className="text-right">PF</th><th className="text-right">Sharpe</th><th className="text-right">ROI%</th><th className="text-right">MaxDD</th></>)}
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
                                                <td className={`text-right ${(v?.sharpe ?? 0) >= 1 ? 'text-emerald-300' : (v?.sharpe ?? 0) < 0 ? 'text-red-300' : ''}`}>{v?.sharpe != null ? v.sharpe : '—'}</td>
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
                                        {ch.robustness && (
                                            <div className={`text-[11px] mb-2 px-2 py-1 rounded border ${ch.robustness.robust === true ? 'text-emerald-300 border-emerald-800/50 bg-emerald-950/20' : ch.robustness.robust === false ? 'text-red-300 border-red-800/50 bg-red-950/20' : 'text-slate-400 border-slate-700 bg-slate-800/30'}`}
                                                title="Automatic out-of-sample check: how the validation-window metric held up vs the train window.">
                                                {ch.robustness.robust === true ? '✓ Holds OOS' : ch.robustness.robust === false ? '⚠ Overfit risk' : 'OOS unknown'}
                                                {ch.robustness.ratio != null ? ` · val/train ${ch.robustness.ratio}` : ''} — {ch.robustness.note}
                                            </div>
                                        )}
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
                                        <thead><tr className="text-slate-500 text-left"><th>#</th><th>Structure</th><th>Symbol</th><th>Signal</th><th className="text-right">Val net ₹</th><th className="text-right">Val PF</th><th className="text-right">Val win%</th><th className="text-right">Train net ₹</th><th className="text-right">OOS</th></tr></thead>
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
                                                    <td className="text-right" title={r.robustness?.note || ''}>{r.robustness?.robust === true ? <span className="text-emerald-400">✓</span> : r.robustness?.robust === false ? <span className="text-red-400">⚠</span> : <span className="text-slate-600">—</span>}</td>
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
                                                    <button onClick={() => deploySaved(s, 'PAPER')} disabled={pending[`deploy:${s._id}`]}
                                                        className="px-2 py-0.5 mr-1 rounded border border-emerald-700/50 bg-emerald-900/20 text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40" title="Deploy as PAPER (simulated fills at quotes)">
                                                        ▶ Paper
                                                    </button>
                                                    <button onClick={() => deploySaved(s, 'LIVE')} disabled={pending[`deploy:${s._id}`]}
                                                        className="px-2 py-0.5 mr-1 rounded border border-red-700/60 bg-red-900/25 text-red-300 hover:bg-red-900/45 font-semibold disabled:opacity-40" title="Deploy LIVE — shows a risk preview + type-to-confirm before any real order">
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

                    {/* Engine-health banner — a halted engine or stale loop means open structures may be unmanaged */}
                    {engineHealth && (
                        <div className={`rounded-xl border px-4 py-2.5 mb-4 flex items-center gap-2 text-sm font-semibold ${engineHealth.level === 'halt' ? 'border-red-600 bg-red-950/40 text-red-200' : engineHealth.level === 'stale' ? 'border-amber-500 bg-amber-950/40 text-amber-200' : 'border-slate-600 bg-slate-900 text-slate-300'}`} role="alert">
                            <span className="text-lg" aria-hidden="true">{engineHealth.level === 'halt' ? '⛔' : engineHealth.level === 'stale' ? '⚠️' : '📡'}</span>
                            {engineHealth.msg}
                        </div>
                    )}

                    <div className="bg-surface rounded-xl border border-slate-700 p-4 mb-4">
                        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                            <div className="text-sm font-semibold text-white flex items-center gap-2"><Rocket className="w-4 h-4 text-amber-400" /> Deployments ({visibleDeps.length}{visibleDeps.length !== (mlDeps.deployments || []).length ? `/${(mlDeps.deployments || []).length}` : ''})</div>
                            <div className="flex items-center gap-2 text-[11px]">
                                {/* freshness / connection */}
                                <span className={`flex items-center gap-1 ${!lastPoll.ok ? 'text-red-400' : 'text-slate-500'}`} title="Auto-refreshes every 5s">
                                    <span className={`w-1.5 h-1.5 rounded-full ${!lastPoll.ok ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'}`} />
                                    {lastPoll.at ? `updated ${istTime(lastPoll.at)}` : '…'}{!lastPoll.ok ? ' (offline)' : ''}
                                </span>
                                <select value={depFilter} onChange={e => setDepFilter(e.target.value)} className="bg-slate-800 border border-slate-700 rounded p-1 text-slate-300" aria-label="Filter deployments">
                                    <option value="all">All books</option><option value="LIVE">LIVE</option><option value="PAPER">PAPER</option><option value="open">Open only</option>
                                </select>
                                <select value={depSort} onChange={e => setDepSort(e.target.value)} className="bg-slate-800 border border-slate-700 rounded p-1 text-slate-300" aria-label="Sort deployments">
                                    <option value="state">Sort: state</option><option value="mtm">Sort: MTM</option><option value="pnl">Sort: total PnL</option><option value="name">Sort: name</option>
                                </select>
                                <button onClick={() => bulkAction('stop-all')} disabled={pending.bulk} className="px-2 py-1 rounded border border-amber-700/50 bg-amber-900/20 text-amber-300 hover:bg-amber-900/40 disabled:opacity-40">Stop all</button>
                                <button onClick={() => bulkAction('close-all')} disabled={pending.bulk} className="px-2 py-1 rounded border border-red-700/50 bg-red-900/25 text-red-300 hover:bg-red-900/45 disabled:opacity-40">Close all</button>
                            </div>
                        </div>
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
                        ) : visibleDeps.length === 0 ? (
                            <div className="text-xs text-slate-500 py-4 text-center">No deployments match this filter.</div>
                        ) : (
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                                {visibleDeps.map(d => {
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
                                    const chartOpen = depChart === d._id;
                                    const activityOpen = depActivity === d._id;
                                    const act = (activityOpen && activityData && activityData.id === d._id && activityData.data && !activityData.data.error) ? activityData.data : null;
                                    const actSeries = act ? [...(act.points || []), ...(act.openPoint ? [act.openPoint] : [])] : [];
                                    const curve = (chartOpen && open) ? payoffCurve(pos, unitToRupee) : null;
                                    const curSpot = pos.lastSpot || pos.entrySpot || null;
                                    // backend risk-graph (expiry + live T+0 curves); client curve is the instant fallback
                                    const pg = (chartOpen && depPayoff && depPayoff.id === d._id && depPayoff.data && !depPayoff.data.error && !depPayoff.data.empty) ? depPayoff.data : null;
                                    const chartData = pg ? pg.curve : (curve ? curve.points.map(p => ({ spot: p.spot, expiry: p.pnl })) : []);
                                    const chartBEs = pg ? pg.breakevens : (curve ? curve.breakevens : []);
                                    const chartStrikes = pg ? pg.strikes : [...new Set((pos.legs || []).map(l => l.strike).filter(Boolean))];
                                    const chartSpot = pg ? pg.spot : curSpot;
                                    const chartNowPnl = pg ? pg.currentMtm : (pos.lastMtmRupees ?? null);
                                    const chartMaxP = pg ? pg.maxProfit : (curve ? Math.max(...curve.points.map(p => p.pnl)) : null);
                                    const chartMaxL = pg ? pg.maxLoss : (curve ? Math.min(...curve.points.map(p => p.pnl)) : null);
                                    const tpRupee = (tpUnit != null && unitToRupee) ? Math.round(tpUnit * unitToRupee) : null;
                                    const slRupee = (slUnit != null && unitToRupee) ? Math.round(slUnit * unitToRupee) : null;
                                    const mtmHist = mlDeps.mtmHistory?.[d._id] || null;    // intraday sparkline
                                    const feed = d._feed || null;                          // signal-feed health (IDLE deployments)
                                    const isLive = d.trade_mode === 'LIVE';
                                    const busy = Object.keys(pending).some(k => k.endsWith(`:${d._id}`));
                                    // MTM is only live during market hours; flag a stale mark so an
                                    // after-hours frozen number isn't read as a live P&L.
                                    const mtmAgeMs = pos.lastMtmAt ? Date.now() - new Date(pos.lastMtmAt).getTime() : null;
                                    const mtmStale = open && mtmAgeMs != null && mtmAgeMs > 3 * 60000;
                                    return (
                                        <div key={d._id} className={`rounded-lg border p-3 relative ${isLive ? 'border-red-600 bg-red-950/20 ring-1 ring-red-800/40' : 'border-slate-700 bg-slate-900/40'} ${busy ? 'opacity-70' : ''}`}>
                                            {isLive && <div className="absolute -top-2 left-3 text-[8px] font-bold px-1.5 py-0.5 rounded bg-red-700 text-white tracking-wider">● REAL MONEY</div>}
                                            <div className="flex items-center justify-between mb-1">
                                                <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">{d.name}{busy && <RefreshCw className="w-3 h-3 animate-spin text-slate-400" />}</div>
                                                <div className="flex gap-1">
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${d.trade_mode === 'LIVE' ? 'border-red-700 text-red-300' : 'border-sky-700 text-sky-300'}`}>{d.trade_mode}</span>
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${d.status === 'ACTIVE' ? 'border-emerald-700 text-emerald-300' : 'border-slate-600 text-slate-400'}`}>{d.status}</span>
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${open ? 'border-amber-600 text-amber-300' : 'border-slate-700 text-slate-500'}`}>{st}</span>
                                                    {open && <button onClick={() => setDepChart(depChart === d._id ? null : d._id)}
                                                        className={`text-[10px] px-1.5 py-0.5 rounded border ${depChart === d._id ? 'border-sky-600 text-sky-300' : 'border-slate-600 text-slate-400'} hover:text-white`}
                                                        title="Live payoff diagram — the spread's P&L-at-expiry curve with a 'you are here' marker at the current spot">📈 chart</button>}
                                                    {(d.totals?.trades > 0 || open) && <button onClick={() => setDepActivity(depActivity === d._id ? null : d._id)}
                                                        className={`text-[10px] px-1.5 py-0.5 rounded border ${depActivity === d._id ? 'border-violet-600 text-violet-300' : 'border-slate-600 text-slate-400'} hover:text-white`}
                                                        title="P&L activity — the cumulative equity curve of every booked trade, plus the live unrealized MTM of the current open structure">📊 activity</button>}
                                                    <button onClick={() => setDepDetail(detailOpen ? null : d._id)}
                                                        className={`text-[10px] px-1.5 py-0.5 rounded border ${detailOpen ? 'border-amber-600 text-amber-300' : 'border-slate-600 text-slate-400'} hover:text-white`}
                                                        title="Full order detail — legs, prices, SL/TP levels, exit deadlines">{detailOpen ? '▲' : '▾'} details</button>
                                                </div>
                                            </div>
                                            <div className="text-[11px] text-slate-400 mb-1 flex flex-wrap items-center gap-x-1">
                                                <span>{templates.find(t => t.key === d.template)?.name || d.template} · {shortSym(d.symbol)} · {d.lots} lot(s)
                                                    {d.entry_mode === 'signal' ? ` · signal: ${d.signal_strategy}` : ' · time entry'}</span>
                                                {feed && d.entry_mode === 'signal' && !open && (
                                                    <span className={`ml-1 ${feed.ok ? 'text-emerald-500' : 'text-amber-400'}`} title={`Feed: ${feed.note}${feed.bars != null ? ` · ${feed.bars} bars` : ''} · last check ${istTimeSec(feed.at)} IST`}>
                                                        ● {feed.ok ? 'feed ok' : feed.note}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="grid grid-cols-3 gap-1 text-[11px] mb-2">
                                                {/* NET is the headline number: gross premium difference flatters a
                                                    multi-leg structure by the whole round-trip cost (~₹230 on a 4-leg
                                                    index fly), which is often larger than the MTM itself. */}
                                                <div title={mtmStale
                                                    ? `Mark is STALE — last updated ${istTime(pos.lastMtmAt)} IST (market likely closed). Not a live P&L; option quotes are frozen at their last trade.`
                                                    : `NET = what actually lands in the account if you close now: gross premium difference MINUS estimated round-trip charges (brokerage + STT + exchange + GST + stamp).\n\ngross ₹${fmt(pos.lastMtmRupees ?? 0)}  −  charges ₹${fmt(pos.lastMtmChargesEst ?? 0)}  =  net ₹${fmt(pos.lastMtmNetRupees ?? 0)}\n\nYour broker's unrealised PnL usually excludes charges — compare it to GROSS, and your ledger to NET.`}>
                                                    <Tile label={mtmStale ? '⚠ MTM net (stale)' : 'MTM net (after charges)'}
                                                        value={pos.lastMtmNetRupees != null
                                                            ? `₹${fmt(pos.lastMtmNetRupees)}`
                                                            : (pos.lastMtm != null ? `₹${fmt(pos.lastMtmRupees ?? 0)} gross` : '—')}
                                                        good={!mtmStale && pos.lastMtmNetRupees > 0} bad={!mtmStale && pos.lastMtmNetRupees < 0} />
                                                    {pos.lastMtmNetRupees != null && (
                                                        <div className="text-[9px] text-slate-500 mt-0.5 font-mono">
                                                            gross ₹{fmt(pos.lastMtmRupees)} · chg ₹{fmt(pos.lastMtmChargesEst)} · {fmt(pos.lastMtm, 1)}/u
                                                        </div>
                                                    )}
                                                </div>
                                                <Tile label="Today" value={`₹${fmt(d.daily?.pnlToday)}`} good={d.daily?.pnlToday > 0} bad={d.daily?.pnlToday < 0} />
                                                <Tile label={`Total (${d.totals?.trades || 0})`} value={`₹${fmt(d.totals?.netPnl)}`} good={d.totals?.netPnl > 0} bad={d.totals?.netPnl < 0} />
                                            </div>
                                            {open && mtmHist && mtmHist.length > 1 && (
                                                <div className="flex items-center gap-2 mb-2 text-[9px] text-slate-500" title="Intraday MTM path (₹) since the engine started tracking">
                                                    <span>MTM today</span><Sparkline data={mtmHist} />
                                                    <span className={mtmHist[mtmHist.length - 1].pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>₹{fmt(mtmHist[mtmHist.length - 1].pnl)}</span>
                                                </div>
                                            )}
                                            {open && d.position?.greeks && (
                                                <div className="text-[10px] font-mono mb-2 flex gap-3"
                                                    title="Live book greeks — Δ: ₹ per 1pt spot move · V: ₹ per 1 IV point · Θ: ₹ per day. IVP = vol percentile at entry.">
                                                    <span className={d.position.greeks.delta < 0 ? 'text-red-300' : 'text-emerald-300'}>Δ ₹{fmt(d.position.greeks.delta, 1)}/pt</span>
                                                    <span className={d.position.greeks.vega < 0 ? 'text-amber-300' : 'text-sky-300'}>V ₹{fmt(d.position.greeks.vega, 1)}/IVpt</span>
                                                    <span className={d.position.greeks.theta > 0 ? 'text-emerald-300' : 'text-red-300'}>Θ ₹{fmt(d.position.greeks.theta, 1)}/day</span>
                                                    {d.position.ivpAtEntry != null && <span className="text-slate-500">IVP@in {fmt(d.position.ivpAtEntry, 0)}</span>}
                                                </div>
                                            )}
                                            {/* Live RISK GRAPH — expiry payoff + current T+0 MTM curve, every level marked */}
                                            {chartOpen && chartData.length > 0 && (
                                                <div className="mb-2 border-t border-slate-800 pt-2">
                                                    <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1 flex-wrap gap-x-3">
                                                        <span className="flex items-center gap-2">
                                                            <span className="text-emerald-300">━ expiry</span>
                                                            {pg && <span className="text-sky-300">┅ now (T+0)</span>}
                                                            {pg && <span className="text-violet-300/70">▨ ±1σ move</span>}
                                                            <span className="text-sky-300 font-semibold">spot {fmt(chartSpot)}</span>
                                                            <span className="text-slate-500">entry {fmt(pos.entrySpot)}</span>
                                                            {pg && <span className="text-slate-500">IV {pg.ivAvgPct}% · {pg.dte}DTE</span>}
                                                            {pg && pg.pop != null && <span className={pg.pop >= 50 ? 'text-emerald-300' : 'text-amber-300'} title="Probability of finishing profitable (lognormal, from IV)">POP {pg.pop}%</span>}
                                                        </span>
                                                        <span title="break-even spot levels">BE {chartBEs.length ? chartBEs.map(b => fmt(b)).join(' / ') : '—'}</span>
                                                    </div>
                                                    <ResponsiveContainer width="100%" height={230}>
                                                        <LineChart data={chartData} margin={{ top: 8, right: 10, bottom: 2, left: 8 }}>
                                                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                                            {pg && pg.expectedMove > 0 && <ReferenceArea x1={pg.spot - pg.expectedMove} x2={pg.spot + pg.expectedMove} fill="#8b5cf6" fillOpacity={0.08} stroke="#8b5cf6" strokeOpacity={0.25} />}
                                                            <XAxis dataKey="spot" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 9, fill: '#64748b' }}
                                                                ticks={[...new Set([...chartStrikes, ...(pos.entrySpot ? [Math.round(pos.entrySpot)] : []), ...(chartSpot ? [Math.round(chartSpot)] : [])])].sort((a, b) => a - b)} />
                                                            <YAxis tick={{ fontSize: 9, fill: '#64748b' }} width={54} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
                                                            <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 11 }} cursor={{ stroke: '#38bdf8', strokeDasharray: '3 3' }}
                                                                formatter={(v, n) => [`₹${fmt(v)}`, n === 'now' ? 'P&L now' : 'P&L @ expiry']} labelFormatter={(l) => `spot ${fmt(l)}`} />
                                                            <Legend wrapperStyle={{ fontSize: 9 }} />
                                                            <ReferenceLine y={0} stroke="#64748b" />
                                                            {tpRupee != null && <ReferenceLine y={tpRupee} stroke="#34d399" strokeDasharray="5 4" label={{ value: `TP ₹${fmt(tpRupee)}`, fontSize: 8, fill: '#34d399', position: 'right' }} />}
                                                            {slRupee != null && <ReferenceLine y={slRupee} stroke="#f87171" strokeDasharray="5 4" label={{ value: `SL ₹${fmt(slRupee)}`, fontSize: 8, fill: '#f87171', position: 'right' }} />}
                                                            {chartStrikes.map(k => <ReferenceLine key={k} x={k} stroke="#334155" strokeDasharray="2 2" label={{ value: k, fontSize: 8, fill: '#475569', position: 'insideBottom' }} />)}
                                                            {pos.entrySpot && <ReferenceLine x={Math.round(pos.entrySpot)} stroke="#94a3b8" strokeDasharray="4 3" label={{ value: 'entry', fontSize: 8, fill: '#94a3b8', position: 'insideTopLeft' }} />}
                                                            {chartSpot && <ReferenceLine x={Math.round(chartSpot)} stroke="#38bdf8" strokeWidth={2} label={{ value: 'now', fontSize: 9, fill: '#38bdf8', position: 'top' }} />}
                                                            <Line type="monotone" name="expiry" dataKey="expiry" stroke="#34d399" dot={false} strokeWidth={2} />
                                                            {pg && <Line type="monotone" name="now" dataKey="now" stroke="#38bdf8" dot={false} strokeWidth={1.5} strokeDasharray="5 3" />}
                                                            {pg && chartSpot && chartNowPnl != null && <ReferenceDot x={Math.round(chartSpot)} y={pg.currentNowRupees} r={4} fill="#38bdf8" stroke="#0f172a" />}
                                                        </LineChart>
                                                    </ResponsiveContainer>
                                                    <div className="text-[10px] text-slate-500 mt-0.5">
                                                        {pg ? '● dot = your P&L right now. ' : ''}MTM now <span className={!mtmStale && pos.lastMtm > 0 ? 'text-emerald-300' : !mtmStale && pos.lastMtm < 0 ? 'text-red-300' : ''}>₹{fmt(chartNowPnl ?? 0)}</span> · max profit ₹{fmt(chartMaxP)} · max loss ₹{fmt(chartMaxL)}
                                                        {!pg && <span className="text-slate-600"> · loading live T+0 curve…</span>}
                                                        {pg && pg.stale && <span className="text-amber-400"> · ⚠ mark {pg.mtmAgeMin}m old (market closed — quotes frozen, not live)</span>}
                                                    </div>
                                                </div>
                                            )}
                                            {/* P&L ACTIVITY — cumulative equity curve of every booked trade + live open MTM */}
                                            {activityOpen && (
                                                <div className="mb-2 border-t border-slate-800 pt-2">
                                                    {!act ? (
                                                        <div className="text-[10px] text-slate-500 py-3 text-center">{activityData?.data?.error ? 'could not load activity' : 'loading activity…'}</div>
                                                    ) : actSeries.length === 0 ? (
                                                        <div className="text-[10px] text-slate-500 py-3 text-center">No booked trades yet — the equity curve appears after the first exit.</div>
                                                    ) : (<>
                                                        <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1 flex-wrap gap-x-3">
                                                            <span className="flex items-center gap-2">
                                                                <span className="text-violet-300">━ cumulative P&L</span>
                                                                <span className="text-slate-500">{act.summary.trades} trades · {act.summary.winRate}% win</span>
                                                                <span className={act.summary.realized >= 0 ? 'text-emerald-300' : 'text-red-300'}>realized ₹{fmt(act.summary.realized)}</span>
                                                                {act.summary.openMtm != null && <span className={act.summary.openMtm >= 0 ? 'text-emerald-300' : 'text-red-300'}>+ open ₹{fmt(act.summary.openMtm)} → ₹{fmt(act.summary.withOpen)}</span>}
                                                            </span>
                                                            <span className="text-slate-500">best ₹{fmt(act.summary.best)} · worst ₹{fmt(act.summary.worst)}</span>
                                                        </div>
                                                        <ResponsiveContainer width="100%" height={230}>
                                                            <LineChart data={actSeries} margin={{ top: 8, right: 12, bottom: 2, left: 8 }}>
                                                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                                                <XAxis dataKey="i" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 9, fill: '#64748b' }} tickFormatter={(v) => `#${v}`} />
                                                                <YAxis tick={{ fontSize: 9, fill: '#64748b' }} width={54} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
                                                                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 11 }} cursor={{ stroke: '#a78bfa', strokeDasharray: '3 3' }}
                                                                    formatter={(v, n, p) => [`₹${fmt(v)}`, 'cumulative']}
                                                                    labelFormatter={(l, pl) => { const pt = pl && pl[0] && pl[0].payload; return pt ? `trade #${pt.i} · ${istStr(pt.t, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${pt.open ? 'OPEN' : pt.reason} · this ₹${fmt(pt.net)}` : `#${l}`; }} />
                                                                <ReferenceLine y={0} stroke="#64748b" />
                                                                <Line type="monotone" dataKey="cum" stroke="#a78bfa" strokeWidth={2}
                                                                    dot={(props) => { const { cx, cy, payload } = props; const col = payload.open ? '#38bdf8' : (payload.net >= 0 ? '#34d399' : '#f87171'); return <circle key={payload.i} cx={cx} cy={cy} r={payload.open ? 4 : 3} fill={col} stroke="#0f172a" strokeWidth={1} />; }} />
                                                            </LineChart>
                                                        </ResponsiveContainer>
                                                        <div className="text-[10px] text-slate-500 mt-0.5">Each dot = one booked structure (green win / red loss); the line is running net P&L. {act.openPoint ? <span className="text-sky-300">Blue dot = current open structure’s unrealized MTM.</span> : ''}</div>
                                                    </>)}
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
                                                                <thead><tr className="text-slate-500 text-left"><th>Leg</th><th>Strike</th><th className="text-right">Qty</th><th className="text-right">Entry ₹</th><th className="text-right">Now/Exit</th><th>Filled</th><th>Status</th>{d.trade_mode === 'LIVE' && <th>OrderId</th>}</tr></thead>
                                                                <tbody>
                                                                    {pos.legs.map((l, i) => (
                                                                        <tr key={i} className="border-t border-slate-800/60">
                                                                            <td className={l.action === 'BUY' ? 'text-emerald-300' : 'text-red-300'}>{l.action} {l.type}</td>
                                                                            <td>{l.strike}{l.ratio > 1 ? ` ×${l.ratio}` : ''}</td>
                                                                            <td className="text-right">{l.qty}</td>
                                                                            <td className="text-right">{fmt(l.entryPrice, 2)}</td>
                                                                            <td className="text-right text-slate-500">{l.exitPrice ? fmt(l.exitPrice, 2) : '—'}</td>
                                                                            <td className="text-slate-600 whitespace-nowrap" title={l.filledAt ? `${istDateTimeSec(l.filledAt)} IST` : ''}>{l.filledAt ? istSmartSec(l.filledAt, pos.entryAt) : '—'}</td>
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
                                                                            <td className="text-slate-600 whitespace-nowrap" title={l.filledAt ? `${istDateTimeSec(l.filledAt)} IST` : ''}>{l.filledAt ? istSmartSec(l.filledAt, pos.entryAt) : '—'}</td>
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

                                                    {/* ── BROKER RECONCILIATION (LIVE only) ───────────────────
                                                        Does our book match the broker's? Per-leg: our recorded fill
                                                        vs trade-book VWAP vs net-position avg. Then PnL restated
                                                        gross (what the broker's unrealised P&L shows) vs net after
                                                        charges (what the ledger shows). */}
                                                    {isLive && open && depRecon?.id === d._id && (() => {
                                                        const R = depRecon.data || {};
                                                        if (R.error) return <div className="text-[10px] text-red-400 border-t border-slate-800 pt-1.5">Reconcile failed: {R.error}</div>;
                                                        if (R.notApplicable || R.empty) return null;
                                                        return (
                                                            <div className="border-t border-slate-800 pt-2 space-y-1">
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <span className="text-[10px] font-semibold text-slate-300">Broker reconciliation</span>
                                                                    {R.priceReconciled
                                                                        ? <span className="text-[9px] px-1.5 py-0.5 rounded border border-emerald-700 text-emerald-300">✓ fills match broker</span>
                                                                        : <span className="text-[9px] px-1.5 py-0.5 rounded border border-amber-600 text-amber-300">⚠ {R.mismatches || 0} leg(s) differ</span>}
                                                                    {R.mtmAgeMinutes != null && R.mtmAgeMinutes > 5 && <span className="text-[9px] text-slate-500">mark {R.mtmAgeMinutes}m old</span>}
                                                                </div>
                                                                <div className="overflow-x-auto">
                                                                    <table className="w-full text-[9px] font-mono text-slate-300">
                                                                        <thead><tr className="text-slate-500 text-left"><th>Leg</th><th className="text-right">Ours</th><th className="text-right">Broker VWAP</th><th className="text-right">Pos avg</th><th className="text-right">Drift</th><th>Source</th></tr></thead>
                                                                        <tbody>
                                                                            {(R.legs || []).map((l, i) => (
                                                                                <tr key={i} className="border-t border-slate-800/60">
                                                                                    <td className={l.action === 'BUY' ? 'text-emerald-300' : 'text-red-300'}>{l.action} {l.strike}</td>
                                                                                    <td className="text-right">{fmt(l.ourEntryPrice, 2)}</td>
                                                                                    <td className="text-right">{l.brokerVwap != null ? fmt(l.brokerVwap, 2) : '—'}</td>
                                                                                    <td className="text-right text-slate-500">{l.brokerAvgPrice != null ? fmt(l.brokerAvgPrice, 2) : '—'}</td>
                                                                                    <td className={`text-right ${l.material ? 'text-amber-300 font-bold' : 'text-slate-500'}`}>{l.drift != null ? `${l.drift > 0 ? '+' : ''}${fmt(l.drift, 2)}` : '—'}</td>
                                                                                    <td className={l.priceSource === 'broker_vwap' ? 'text-emerald-500' : 'text-amber-400'}>{l.priceSource === 'broker_vwap' ? 'broker' : l.priceSource}</td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                                <div className="font-mono text-slate-400">
                                                                    PnL at our prices: gross <span className={R.grossRupees >= 0 ? 'text-emerald-300' : 'text-red-300'}>₹{fmt(R.grossRupees)}</span>
                                                                    {' '}− charges ₹{fmt(R.chargesRupees)} = net <span className={R.netRupees >= 0 ? 'text-emerald-300' : 'text-red-300'}>₹{fmt(R.netRupees)}</span>
                                                                </div>
                                                                <div className="text-[9px] text-slate-600">Broker unrealised P&L excludes charges → compare it to <span className="text-slate-400">gross</span>; compare your ledger to <span className="text-slate-400">net</span>.</div>
                                                                {(R.warnings || []).map((w, i) => <div key={i} className="text-[9px] text-amber-400">⚠ {w}</div>)}
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            )}
                                            {d.lastError && <div className="text-[10px] text-red-400 mb-2">⚠ {d.lastError}</div>}
                                            <div className="flex gap-1 flex-wrap">
                                                {d.status === 'ACTIVE'
                                                    ? <button onClick={() => depAction(d, open ? 'stop-close' : 'stop')} disabled={busy} aria-label={open ? `Stop and close ${d.name}` : `Stop ${d.name}`} className="px-2 py-0.5 rounded border border-amber-700/50 bg-amber-900/20 text-amber-300 text-[11px] hover:bg-amber-900/40 disabled:opacity-40"><StopCircle className="w-3 h-3 inline mr-0.5" />{open ? 'Stop + close' : 'Stop'}</button>
                                                    : <button onClick={() => depAction(d, 'start')} disabled={busy} aria-label={`Resume ${d.name}`} className="px-2 py-0.5 rounded border border-emerald-700/50 bg-emerald-900/20 text-emerald-300 text-[11px] hover:bg-emerald-900/40 disabled:opacity-40"><Play className="w-3 h-3 inline mr-0.5" />Resume</button>}
                                                {st === 'OPEN' && <button onClick={() => depAction(d, 'close')} disabled={busy} aria-label={`Close ${d.name} now`} className="px-2 py-0.5 rounded border border-red-700/50 bg-red-900/20 text-red-300 text-[11px] hover:bg-red-900/40 disabled:opacity-40"><Square className="w-3 h-3 inline mr-0.5" />Close now</button>}
                                                {!open && <button onClick={() => depAction(d, 'delete')} disabled={busy} aria-label={`Delete ${d.name}`} className="px-2 py-0.5 rounded border border-slate-700 bg-slate-800 text-slate-400 text-[11px] hover:text-red-300 disabled:opacity-40"><Trash2 className="w-3 h-3 inline mr-0.5" />Delete</button>}
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
                                            <span className="text-slate-600 whitespace-nowrap" title={istDateTimeSec(e.at) + ' IST'}>
                                                <span className="text-slate-700">{istDate(e.at)}</span> {istTimeSec(e.at)}
                                            </span>
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
                                    <thead><tr className="text-slate-500 text-left"><th>Entry</th><th>Exit</th><th>Name</th><th>Mode</th><th>Reason</th><th className="text-right">Gross ₹</th><th className="text-right">Charges</th><th className="text-right">Net ₹</th></tr></thead>
                                    <tbody>
                                        {mlTrades.map((t, i) => (
                                            <tr key={i} className="border-t border-slate-800">
                                                <td className="whitespace-nowrap" title="Entry (IST)">{istDateTime(t.entryAt)}</td>
                                                <td className="whitespace-nowrap" title="Exit (IST) — date shown when it differs from entry">{istSmart(t.exitAt, t.entryAt)}<DayGap from={t.entryAt} to={t.exitAt} /></td>
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
                                        <th></th><th>Entry → Exit</th><th>Structure</th><th>Sym</th><th>Mode</th><th>Reason</th>
                                        <th className="text-right">Credit/u</th><th className="text-right">IVP@in</th><th className="text-right">Gross ₹</th><th className="text-right">Chg</th><th className="text-right">Net ₹</th>
                                    </tr></thead>
                                    <tbody>
                                        {[...resFiltered].sort((a, b) => new Date(b.exitAt) - new Date(a.exitAt)).map((t, i) => {
                                            const tid = t._id || `${t.deploymentId}-${t.entryAt}`;
                                            const openT = resTradeOpen === tid;
                                            const allLegs = [...(t.legs || []), ...(t.closedLegs || [])];
                                            return (
                                            <React.Fragment key={tid}>
                                            <tr className="border-t border-slate-800 hover:bg-slate-800/40 cursor-pointer" onClick={() => setResTradeOpen(openT ? null : tid)}>
                                                <td className="text-slate-500 w-4">{openT ? '▲' : '▾'}</td>
                                                <td className="whitespace-nowrap" title={`Entry ${istDateTimeSec(t.entryAt)} → Exit ${istDateTimeSec(t.exitAt)} IST`}>{istSpan(t.entryAt, t.exitAt)}<DayGap from={t.entryAt} to={t.exitAt} /></td>
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
                                            {openT && (
                                                <tr className="bg-slate-900/60"><td colSpan={11} className="p-2">
                                                    <div className="text-[10px] text-slate-400 mb-1">Held {t.holdDays != null ? `${t.holdDays}d` : fmtDur(t.entryAt)} · spot {fmt(t.entrySpot)} → {fmt(t.exitSpot)} · net credit at entry ₹{fmt(t.origCredit, 1)}/u{t.lots ? ` · ${t.lots} lot(s)` : ''}</div>
                                                    {allLegs.length > 0 ? (
                                                        <table className="w-full text-[10px] font-mono text-slate-300">
                                                            <thead><tr className="text-slate-500 text-left"><th>Leg</th><th>Strike</th><th className="text-right">Entry ₹</th><th className="text-right">Exit ₹</th><th>Close</th></tr></thead>
                                                            <tbody>{allLegs.map((l, j) => (
                                                                <tr key={j} className="border-t border-slate-800/60">
                                                                    <td className={l.action === 'BUY' ? 'text-emerald-300' : 'text-red-300'}>{l.action} {l.type}</td>
                                                                    <td>{l.strike}{l.ratio > 1 ? ` ×${l.ratio}` : ''}</td>
                                                                    <td className="text-right">{fmt(l.entryPrice, 2)}</td>
                                                                    <td className="text-right">{l.exitPrice != null ? fmt(l.exitPrice, 2) : '—'}</td>
                                                                    <td className="text-slate-500">{l.closeReason || l.reason || l.status || '—'}</td>
                                                                </tr>
                                                            ))}</tbody>
                                                        </table>
                                                    ) : <div className="text-[10px] text-slate-500">No leg detail stored for this trade.</div>}
                                                </td></tr>
                                            )}
                                            </React.Fragment>
                                            );
                                        })}
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

// ── Reusable UI primitives (pro-desk polish) ─────────────────────────────
// Persist a bit of UI state (open panels, filters, sort) across refreshes.
function useLocalStorage(key, initial) {
    const [v, setV] = React.useState(() => {
        try { const s = localStorage.getItem(key); return s != null ? JSON.parse(s) : initial; } catch { return initial; }
    });
    React.useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* quota */ } }, [key, v]);
    return [v, setV];
}

// Tiny inline SVG sparkline for the intraday MTM path (no chart lib overhead).
function Sparkline({ data, width = 68, height = 20 }) {
    if (!data || data.length < 2) return <span className="text-slate-600 text-[9px]">—</span>;
    const ys = data.map(d => d.pnl);
    const min = Math.min(...ys, 0), max = Math.max(...ys, 0), rng = (max - min) || 1;
    const step = width / (data.length - 1);
    const pts = ys.map((y, i) => `${(i * step).toFixed(1)},${(height - ((y - min) / rng) * height).toFixed(1)}`).join(' ');
    const last = ys[ys.length - 1];
    const zeroY = (height - ((0 - min) / rng) * height).toFixed(1);
    return (
        <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
            <line x1="0" y1={zeroY} x2={width} y2={zeroY} stroke="#334155" strokeWidth="0.5" strokeDasharray="2 2" />
            <polyline points={pts} fill="none" stroke={last >= 0 ? '#34d399' : '#f87171'} strokeWidth="1.2" />
        </svg>
    );
}

// Toast notifications — non-blocking, dismissible, colored by kind.
function useToasts() {
    const [toasts, setToasts] = React.useState([]);
    const push = React.useCallback((msg, kind = 'info', ms = 5000) => {
        const id = Math.random().toString(36).slice(2);
        setToasts(t => [...t, { id, msg, kind }]);
        if (ms) setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), ms);
        return id;
    }, []);
    const dismiss = React.useCallback((id) => setToasts(t => t.filter(x => x.id !== id)), []);
    return { toasts, push, dismiss };
}
function Toasts({ toasts, dismiss }) {
    return (
        <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm" role="status" aria-live="polite">
            {toasts.map(t => (
                <div key={t.id} className={`flex items-start gap-2 px-3 py-2 rounded-lg border shadow-lg text-xs ${t.kind === 'error' ? 'bg-red-950/90 border-red-700 text-red-200' : t.kind === 'success' ? 'bg-emerald-950/90 border-emerald-700 text-emerald-200' : t.kind === 'warn' ? 'bg-amber-950/90 border-amber-700 text-amber-200' : 'bg-slate-900/95 border-slate-600 text-slate-200'}`}>
                    <span className="flex-1 whitespace-pre-wrap">{t.msg}</span>
                    <button onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-white" aria-label="Dismiss">✕</button>
                </div>
            ))}
        </div>
    );
}

// Confirmation modal with optional type-to-confirm + a risk-summary body.
function ConfirmModal({ open, title, danger, confirmLabel = 'Confirm', requireText, onConfirm, onCancel, children }) {
    const [typed, setTyped] = React.useState('');
    React.useEffect(() => { if (open) setTyped(''); }, [open]);
    if (!open) return null;
    const ok = !requireText || typed.trim() === requireText;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" onKeyDown={e => e.key === 'Escape' && onCancel()}>
            <div className={`w-full max-w-md rounded-xl border p-4 ${danger ? 'border-red-700 bg-slate-900' : 'border-slate-600 bg-slate-900'}`}>
                <div className={`text-sm font-bold mb-2 ${danger ? 'text-red-300' : 'text-white'}`}>{title}</div>
                <div className="text-xs text-slate-300 space-y-2 mb-3">{children}</div>
                {requireText && (
                    <label className="block text-[11px] text-slate-400 mb-3">Type <span className="font-mono text-slate-200">{requireText}</span> to confirm
                        <input autoFocus value={typed} onChange={e => setTyped(e.target.value)}
                            className="w-full mt-1 bg-slate-800 border border-slate-700 rounded p-1.5 text-slate-200 font-mono" />
                    </label>
                )}
                <div className="flex justify-end gap-2">
                    <button onClick={onCancel} className="px-3 py-1.5 rounded border border-slate-600 bg-slate-800 text-slate-300 text-xs hover:text-white">Cancel</button>
                    <button onClick={() => ok && onConfirm()} disabled={!ok}
                        className={`px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40 ${danger ? 'bg-red-700 hover:bg-red-600 text-white' : 'bg-emerald-700 hover:bg-emerald-600 text-white'}`}>{confirmLabel}</button>
                </div>
            </div>
        </div>
    );
}

// Pre-deploy RISK PREVIEW modal — live legs/credit/max-loss/margin/breakevens/
// expected-move/POP resolved before any order; LIVE requires type-to-confirm.
// Hoisted OUT of PreviewModal: a component created during render gets a new
// identity every pass, so React remounts it and any state it holds resets.
function Row({ k, v, cls }) {
    return (<div className="flex justify-between"><span className="text-slate-500">{k}</span><span className={`font-mono ${cls || 'text-slate-200'}`}>{v}</span></div>);
}

function PreviewModal({ preview, deployLots, onConfirm, onCancel }) {
    const [typed, setTyped] = React.useState('');
    React.useEffect(() => { setTyped(''); }, [preview?.strategy?._id]);
    if (!preview) return null;
    const { strategy: s, data, loading } = preview;
    const need = s?.name || '';
    const ok = typed.trim() === need;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
            <div className="w-full max-w-lg rounded-xl border border-red-700 bg-slate-900 p-4">
                <div className="text-sm font-bold text-red-300 mb-1">🔴 Deploy “{need}” LIVE — confirm risk</div>
                <div className="text-[11px] text-slate-400 mb-3">Real broker orders · {deployLots} lot(s) · marketable-limit, hedges first. Review before confirming.</div>
                {loading ? <div className="text-xs text-slate-400 py-6 text-center">Pricing the structure at the live chain…</div>
                    : data?.error ? <div className="text-xs text-red-400 py-4">Preview failed: {data.error}<div className="text-slate-500 mt-1">(needs live market hours + a valid chain). You can still deploy, but you’ll be doing so blind.</div></div>
                    : data ? (
                        <div className="space-y-2 text-xs">
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                <Row k="Structure" v={data.name} />
                                <Row k="Spot" v={fmt(data.spot)} />
                                <Row k="Net credit" v={`₹${fmt(data.creditRupees)} (${fmt(data.creditPerUnit, 1)}/u)`} cls={data.creditRupees >= 0 ? 'text-emerald-300' : 'text-amber-300'} />
                                <Row k="Margin (est)" v={`₹${fmt(data.marginEst)}${data.marginBasis === 'span' ? ' (SPAN)' : ''}`} cls={data.fundsOk === false ? 'text-red-300' : ''} />
                                <Row k="Max profit" v={data.maxProfit != null ? `₹${fmt(data.maxProfit)}` : '∞'} cls="text-emerald-300" />
                                <Row k="Max loss" v={data.maxLoss != null ? `₹${fmt(data.maxLoss)}` : 'UNLIMITED'} cls={data.maxLoss != null ? 'text-red-300' : 'text-red-400 font-bold'} />
                                <Row k="Break-evens" v={data.breakevens?.length ? data.breakevens.map(b => fmt(b)).join(' / ') : '—'} />
                                <Row k="Prob. of profit" v={data.pop != null ? `${data.pop}%` : '—'} cls={data.pop >= 50 ? 'text-emerald-300' : 'text-amber-300'} />
                                <Row k="Expected move (±1σ)" v={`±${fmt(data.expectedMove)} (${data.dte}DTE)`} />
                                <Row k="ATM IV" v={`${data.ivAtmPct}%`} />
                            </div>
                            {data.unbounded && <div className="text-[11px] text-red-400 border border-red-800 rounded p-1.5">⚠ UNDEFINED tail risk — this structure can lose without limit unless leg-SL / structure-SL are set.</div>}
                            {data.fundsOk === false && <div className="text-[11px] text-red-400 border border-red-800 rounded p-1.5">⛔ Insufficient funds — needs ₹{fmt(data.marginEst)} margin but only ₹{fmt(data.fundsAvailable)} available. A LIVE deploy will be refused.</div>}
                            {Array.isArray(data.lint) && data.lint.length > 0 && (
                                <div className="space-y-1">
                                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Pre-deploy review</div>
                                    {data.lint.map((l, i) => (
                                        <div key={i} className={`text-[11px] rounded px-1.5 py-1 border ${l.level === 'danger' ? 'text-red-300 border-red-800 bg-red-950/20' : l.level === 'warn' ? 'text-amber-300 border-amber-800/60 bg-amber-950/10' : 'text-slate-400 border-slate-700 bg-slate-800/30'}`}>
                                            {l.level === 'danger' ? '⛔' : l.level === 'warn' ? '⚠' : 'ℹ'} {l.msg}
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="text-[10px] font-mono text-slate-500">{data.legs?.map((l, i) => <span key={i} className={l.action === 'BUY' ? 'text-emerald-400' : 'text-red-400'}>{l.action} {l.strike}{l.type} @{fmt(l.premium, 1)}{i < data.legs.length - 1 ? ' · ' : ''}</span>)}</div>
                        </div>
                    ) : null}
                <label className="block text-[11px] text-slate-400 mt-3 mb-3">Type <span className="font-mono text-slate-200">{need}</span> to place LIVE orders
                    <input autoFocus value={typed} onChange={e => setTyped(e.target.value)} className="w-full mt-1 bg-slate-800 border border-slate-700 rounded p-1.5 text-slate-200 font-mono" />
                </label>
                <div className="flex justify-end gap-2">
                    <button onClick={onCancel} className="px-3 py-1.5 rounded border border-slate-600 bg-slate-800 text-slate-300 text-xs hover:text-white">Cancel</button>
                    <button onClick={() => ok && onConfirm()} disabled={!ok} className="px-3 py-1.5 rounded bg-red-700 hover:bg-red-600 text-white text-xs font-semibold disabled:opacity-40">Deploy LIVE</button>
                </div>
            </div>
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
const istDate = (v) => istStr(v, { day: '2-digit', month: 'short' });                                         // "21 Jul"
const istDateTimeSec = (v) => istStr(v, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }); // "21 Jul 13:42:27"
function fmtClock(iso) { return istDateTime(iso); }

// ── Overnight-aware timestamps ───────────────────────────────────────────────
// Unlike the intraday engine, multileg structures routinely hold across sessions
// (see holdDays on multilegTrade), so a bare "15:20" is genuinely ambiguous — you
// cannot tell a same-day exit from one three days later. These helpers drop the
// date only when it is unambiguous (same IST calendar day as the reference) and
// show it whenever it differs.
function istDayKey(v) {                    // "2026-08-05" in IST, or null
    if (!v) return null;
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    try { return d.toLocaleDateString('en-CA', { timeZone: IST_TZ }); }
    catch { return null; }
}
const sameIstDay = (a, b) => { const k = istDayKey(a); return k != null && k === istDayKey(b); };
const istSmart = (v, ref) => (ref && sameIstDay(v, ref) ? istTime(v) : istDateTime(v));
const istSmartSec = (v, ref) => (ref && sameIstDay(v, ref) ? istTimeSec(v) : istDateTimeSec(v));
// "21 Jul 13:42 → 15:20" same day · "21 Jul 13:42 → 24 Jul 15:20" across days
const istSpan = (from, to) => `${istDateTime(from)} → ${istSmart(to, from)}`;
// Whole IST calendar days spanned, for the "+2d" overnight marker. Counts date
// boundaries crossed, not elapsed hours, so a 15:20→09:20 hold reads as +1d.
function istDayGap(from, to) {
    const a = istDayKey(from), b = istDayKey(to);
    if (!a || !b) return 0;
    const diff = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
    return Number.isFinite(diff) && diff > 0 ? diff : 0;
}
// Amber "+Nd" chip — the at-a-glance answer to "did this exit on a later day?"
function DayGap({ from, to }) {
    const n = istDayGap(from, to);
    if (!n) return null;
    return <span className="text-amber-400 ml-1" title={`Held across ${n} calendar day${n > 1 ? 's' : ''} — exit is NOT the same day as entry`}>+{n}d</span>;
}
// Expiry-payoff curve of the CURRENTLY-OPEN legs (computed from actual fills,
// so it's correct even for a partially-closed structure — closed-leg PnL folds
// in via realizedLegPnl). Returns { points:[{spot,pnl}], breakevens[], from, to }.
function payoffCurve(pos, unitToRupee) {
    const legs = (pos?.legs || []).filter(l => l && l.strike && l.status !== 'CLOSED');
    if (!legs.length) return null;
    const mult = unitToRupee || 1;
    const strikes = legs.map(l => l.strike);
    const lo = Math.min(...strikes), hi = Math.max(...strikes);
    const span = Math.max(hi - lo, 100);
    const from = lo - span, to = hi + span;              // show the wings + both tails
    const step = Math.max(1, Math.round((to - from) / 90));
    const intr = (type, k, S) => type === 'CE' ? Math.max(0, S - k) : Math.max(0, k - S);
    const at = (S) => {
        let u = pos.realizedLegPnl || 0;
        for (const l of legs) {
            const iv = intr(l.type, l.strike, S);
            u += (l.action === 'SELL' ? (l.entryPrice - iv) : (iv - l.entryPrice)) * (l.ratio || 1);
        }
        return u * mult;
    };
    const points = [];
    for (let S = from; S <= to; S += step) points.push({ spot: Math.round(S), pnl: Math.round(at(S)) });
    // breakevens: sign changes between adjacent points (linear interp)
    const breakevens = [];
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        if ((a.pnl <= 0 && b.pnl > 0) || (a.pnl >= 0 && b.pnl < 0)) {
            const t = a.pnl / (a.pnl - b.pnl);
            breakevens.push(Math.round(a.spot + t * (b.spot - a.spot)));
        }
    }
    return { points, breakevens, from, to };
}

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

// Market Read — fuses price momentum with option-seller positioning (OI / PCR /
// max-pain / walls) into a directional bias for the selected symbol, with a
// one-click "load the fitting structure" button. On-demand (hits the broker).
const BIAS_STYLE = { bullish: 'text-emerald-300 border-emerald-700/50 bg-emerald-950/20', bearish: 'text-red-300 border-red-700/50 bg-red-950/20', neutral: 'text-amber-300 border-amber-700/50 bg-amber-950/10' };
function MarketRead({ symbol, presets, onApplyPreset }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState(null);
    const load = async () => {
        setLoading(true); setErr(null);
        try { const r = await axios.get(`${API_URL}/multileg/market-context`, { params: { symbol } }); setData(r.data); }
        catch (e) { setErr(e.response?.data?.error || e.message); }
        finally { setLoading(false); }
    };
    useEffect(() => { setData(null); setErr(null); }, [symbol]);
    const preset = data && presets.find(p => p.key === data.suggested?.preset);
    return (
        <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-2.5 mb-3">
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">🧭 Market read <span className="text-slate-500 font-normal">— momentum + where the sellers are</span></span>
                <button onClick={load} disabled={loading} className="text-[10px] px-2 py-0.5 rounded border border-slate-600 bg-slate-800 text-slate-300 hover:text-white disabled:opacity-40">{loading ? 'reading…' : data ? 'refresh' : 'read now'}</button>
            </div>
            {err && <div className="text-[11px] text-red-400 mt-1.5">{err}</div>}
            {data && (
                <div className="mt-2 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap text-[11px]">
                        <span className={`px-2 py-0.5 rounded border font-semibold uppercase ${BIAS_STYLE[data.bias] || ''}`}>{data.bias} · {data.confidence}</span>
                        <span className="text-slate-500">{data.summary}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-[10px]">
                        <Tile label="Momentum" value={data.momentum?.dir || '—'} small good={data.momentum?.dir === 'up'} bad={data.momentum?.dir === 'down'} />
                        <Tile label="Sellers (PCR)" value={data.sellers?.pcr != null ? `${data.sellers.tilt} · ${data.sellers.pcr}` : (data.sellers?.tilt || '—')} small />
                        <Tile label="Support / Resist" value={`${data.support ?? '—'} / ${data.resistance ?? '—'}`} small />
                        <Tile label="Max pain / spot" value={`${data.sellers?.maxPain ?? '—'} / ${data.spot ?? '—'}`} small />
                    </div>
                    {data.suggested && (
                        <div className="flex items-center gap-2 text-[11px] text-slate-400">
                            <span>→ {data.suggested.note}</span>
                            {preset && <button onClick={() => onApplyPreset(preset)} className="text-[10px] px-2 py-0.5 rounded border border-primary/40 bg-primary/15 text-primary hover:bg-primary/25">Load {preset.name}</button>}
                        </div>
                    )}
                    <div className="text-[9px] text-slate-600">A read, not a guarantee — momentum can flip and OI is a snapshot. Confirm with a backtest before deploying.</div>
                </div>
            )}
        </div>
    );
}
