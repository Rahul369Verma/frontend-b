import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot, ReferenceArea, Legend,
} from 'recharts';
import { Layers, Play, Pause, SlidersHorizontal, RefreshCw, Radar, Zap, FlaskConical, Rocket, Save, Trash2, Square, StopCircle, Activity, TrendingUp, Wallet } from 'lucide-react';
import StructureAttributionPanel from '../components/viz/StructureAttributionPanel';
import StrategyBuilder from '../components/multileg/StrategyBuilder';
import ResultsAnalytics from '../components/multileg/ResultsAnalytics';
import TradePathChart from '../components/viz/TradePathChart';
import DayEquityCurves from '../components/viz/DayEquityCurves';
import { normalizeMultilegTrade, buildDayCurves } from '../utils/dayCurves';
import AutoRunProgress from '../components/multileg/AutoRunProgress';
import { estimateStageSizes, sizesForRequest, runSummary, useRunTracker } from '../components/multileg/runProgress';
import ZoomableChart from '../components/charts/ZoomableChart';
import { PageHeader, Tabs } from '../components/viz/primitives';
import { ROUTES } from '../config/routes.js';
import { riskOpenMin, riskCloseMin } from '../config/marketSession.js';
import { HELP } from '../data/multilegHelp';
import { useChartTheme } from '../theme/chartTheme.js';
import { pollInterval } from '../hooks/usePolling.js';
import { API_URL } from '../config/api.js';
import { pnlTone } from '../components/viz/tokens';
import { spotMove, pfText, pfValue } from '../components/multileg/builderFormat';
import SavedStrategiesPanel from '../components/multileg/SavedStrategiesPanel';


// Static fallback — replaced by /api/config/instruments (same source as Backtest).
const FALLBACK_SYMBOLS = [
    { v: 'NSE:NIFTY50-INDEX', label: 'NIFTY', spot: 24000 },
    { v: 'NSE:NIFTYBANK-INDEX', label: 'BANKNIFTY', spot: 57000 },
    { v: 'NSE:FINNIFTY-INDEX', label: 'FINNIFTY', spot: 25500 },
    { v: 'NSE:MIDCPNIFTY-INDEX', label: 'MIDCPNIFTY', spot: 14700 },
    { v: 'BSE:SENSEX-INDEX', label: 'SENSEX', spot: 82000 },
];

const OUTLOOK_COLORS = {
    bullish: 'text-success border-emerald-700/50', 'bullish-volatile': 'text-success border-emerald-700/50',
    'bullish-target': 'text-success border-emerald-700/50', 'bullish-range': 'text-success border-emerald-700/50',
    bearish: 'text-danger border-red-700/50', 'bearish-volatile': 'text-danger border-red-700/50',
    'bearish-target': 'text-danger border-red-700/50', 'bearish-range': 'text-danger border-red-700/50',
    neutral: 'text-sky-300 border-sky-700/50', 'neutral-wide': 'text-sky-300 border-sky-700/50',
    volatile: 'text-warning border-amber-700/50',
    'neutral-slightly-bullish': 'text-sky-300 border-sky-700/50', 'neutral-slightly-bearish': 'text-sky-300 border-sky-700/50',
};
const METRICS = [
    { v: 'sharpe', label: 'Sharpe (smooth curve)' }, { v: 'sortino', label: 'Sortino (downside-safe)' },
    { v: 'netPnl', label: 'Net P&L' }, { v: 'profitFactor', label: 'Profit factor' },
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

/**
 * Scroll the page back to the top.
 *
 * NOT window.scrollTo — the shell is `h-screen overflow-hidden` with <main>
 * owning the scroll, so the document never scrolls and all five calls here were
 * silent no-ops: the buttons that promised to take you back to the builder did
 * nothing at all.
 */
const scrollPageToTop = () => {
    const main = typeof document !== 'undefined' && document.querySelector('main');
    if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
};

const fmt = (n, d = 0) => (n == null || !Number.isFinite(Number(n))) ? (n === Infinity ? '∞' : n === -Infinity ? '−∞' : '—')
    : Number(n).toLocaleString('en-IN', { maximumFractionDigits: d });
const isoDaysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
const shortSym = (s) => String(s).replace('NSE:', '').replace('BSE:', '').replace('-INDEX', '');
const resTradeId = (t) => t._id || `${t.deploymentId}-${t.entryAt}`;
// The resource guard's reason codes in plain words, for the Auto tab.
const GUARD_WORDS = {
    MARKET_OPEN: 'market is open', PRE_OPEN_GUARD: 'too close to the open/close', LOW_MEMORY: 'low memory',
    HIGH_LOAD: 'machine busy', EVENT_LOOP_LAG: 'engine busy', DISABLED: 'research switched off',
};
const guardWords = (why) => {
    const codes = String(why || '').match(/\b[A-Z][A-Z_]{3,}\b/g) || [];
    const words = [...new Set(codes.map(c => GUARD_WORDS[c] || c.toLowerCase().replace(/_/g, ' ')))];
    return words.length ? words.join(', ') : 'no headroom';
};
// Return on the margin a structure blocked. marginEst is null on some older
// trades — reject it before dividing (Number(null) is 0).
const tradeRom = (t) => (t.marginEst != null && Number(t.marginEst) > 0 && Number.isFinite(Number(t.netPnl))
    ? (Number(t.netPnl) / Number(t.marginEst)) * 100 : null);

export default function MultiLeg() {
    // Five recharts charts live on this page and every one of them needs
    // concrete colour strings — recharts writes them into SVG attributes and
    // interpolates them, so var() is not an option. Roles, not hues:
    //   mark.terminal    the payoff AT EXPIRY (the one curve that is not a forecast)
    //   mark.live        "right now" — spot, the T+0 curve, the open structure
    //   mark.projection  a modelled future state (next session's open)
    //   mark.region      the ±1σ expected-move band
    //   mark.equity      a cumulative-P&L path whose SIGN is on its dots
    //   status.good/critical  the TP / SL levels the engine acts on
    const ct = useChartTheme();
    const [templates, setTemplates] = useState([]);
    const [presets, setPresets] = useState([]);            // professional starting bundles
    const [instruments, setInstruments] = useState(FALLBACK_SYMBOLS);
    const [tplKey, setTplKey] = useState('iron_condor');
    const [symbol, setSymbol] = useState(FALLBACK_SYMBOLS[0].v);
    const [spot, setSpot] = useState(FALLBACK_SYMBOLS[0].spot);
    const [iv, setIv] = useState(0.14);
    const [params, setParams] = useState({});
    // WHY the engine is halted, and whether it will clear itself. The banner used
    // to say only THAT it was halted — which is how a daily-loss halt from 19-Aug
    // sat unnoticed for seven days with no lever to lift it.
    const [haltInfo, setHaltInfo] = useState(null);
    const [resuming, setResuming] = useState(false);
    const [preview, setPreview] = useState(null);
    const [from, setFrom] = useState(isoDaysAgo(45));
    const [to, setTo] = useState(isoDaysAgo(0));
    const [resolution, setResolution] = useState('5');
    // Which option prices the backtest runs on: 'broker' = candles + the kernel's
    // synthetic Black-Scholes chain (any date range); 'archive' = the real
    // option-chain archive (bid/ask every ~60 s, from Aug 2026).
    const [chainSource, setChainSource] = useState('broker');
    const [archiveCov, setArchiveCov] = useState(null);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState(null);
    // Active TAB, remembered across reloads. A refresh used to drop you back on
    // Backtest no matter where you were — painful when you are watching a
    // deployment or mid-way through building a structure. Validated against the
    // real tab list on read, so a renamed or removed tab can never leave the
    // page blank with nothing rendered.
    const [storedTab, setStoredTab] = useLocalStorage('ml.activeTab', 'builder');
    const TAB_IDS = ['builder', 'backtest', 'sweep', 'scan', 'auto', 'deploy', 'results'];
    // A link may name the tab — the results hub sends `/multi-leg?tab=results`.
    // The URL wins on arrival, memory wins otherwise; picking another tab
    // clears the URL's say so the new choice sticks across a refresh.
    const [searchParams, setSearchParams] = useSearchParams();
    const urlTab = searchParams.get('tab');
    const mode = TAB_IDS.includes(urlTab) ? urlTab : (TAB_IDS.includes(storedTab) ? storedTab : 'builder');
    const setMode = useCallback((t) => {
        setStoredTab(t);
        // `deployment` belongs to the Results link (?tab=results&deployment=…);
        // leaving it behind would re-scope Results on the next refresh
        if (searchParams.has('tab') || searchParams.has('deployment')) {
            setSearchParams((p) => { const q = new URLSearchParams(p); q.delete('tab'); q.delete('deployment'); return q; }, { replace: true });
        }
    }, [setStoredTab, searchParams, setSearchParams]);
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
    const [autoTrack, recordAutoProgress] = useRunTracker();
    const [autoStrategies, setAutoStrategies] = useState([]);  // [] = all optimizable
    const [autoEntryStyle, setAutoEntryStyle] = useState('both'); // both | signal-only
    // Saved strategies + live deployments (Deploy tab)
    const [savedList, setSavedList] = useState([]);
    const [savedDetail, setSavedDetail] = useState(null); // _id of the expanded saved-strategy row
    const [depDetail, setDepDetail] = useState(null);     // _id of the expanded deployment (full order detail)
    const [depChart, setDepChart] = useState(null);       // _id of the deployment showing its live payoff chart
    const [depPayoff, setDepPayoff] = useState(null);     // { id, data } — backend risk-graph (expiry + T+0 curves)
    const [depRecon, setDepRecon] = useState(null);       // { id, data } — broker fill/P&L reconciliation (LIVE only)
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
    const [resTradeOpen, setResTradeOpen] = useState(() => new Set()); // expanded trades (drill-down to legs) — a Set so "Expand all" can open every row
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
        const sizes = estimateStageSizes({ budget: B, symbols: scanSymbols.length, strategies: nStrat, directional: dir, neutral: neu, entryStyle: autoEntryStyle });
        const total = sizes[1] + sizes[2] + sizes[3] + sizes[4];
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
    useEffect(() => {
        if (chainSource !== 'archive') return undefined;
        let dead = false;
        axios.get(`${API_URL}/multileg/archive/coverage`, { params: { symbol } })
            .then(r => { if (!dead) setArchiveCov(r.data); })
            .catch(e => { if (!dead) setArchiveCov({ error: e.response?.data?.error || e.message }); });
        return () => { dead = true; };
    }, [chainSource, symbol]);

    const runBacktest = async (overrideParams = null) => {
        setRunning(true); setError(null); setResult(null);
        try {
            const p = overrideParams || { ...params, ...entryParams };
            const r = await axios.post(`${API_URL}/multileg/backtest`, { template: tplKey, symbol, from, to, resolution, params: p, chain_source: chainSource });
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
                template: templateKey, symbol: sym, from, to, resolution, params: { ...(t?.defaults || {}) }, chain_source: chainSource,
            });
            setResult(r.data);
            scrollPageToTop();
        } catch (e) { setError(e.response?.data?.error || e.message); }
        setRunning(false);
    };

    // Apply a sweep row's params on top of Setup and run the full backtest.
    const testSweepRow = async (row) => {
        const merged = { ...params, ...entryParams, ...(row.params || {}) };
        setParams(p => ({ ...p, ...(row.params || {}) }));
        setMode('backtest');
        scrollPageToTop();
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
            if (r.data?.deferred) {
                setRunning(false);
                pushToast(`Saved but not started — the resource guard is holding research (${guardWords(r.data.reason)}). It starts by itself when that clears.`, 'warning', 10000);
            }
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
        const t = pollInterval(refreshAutoJobs, 15000);
        return () => t?.();
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

    // Resume an interrupted/paused marathon from its last stage checkpoint — the
    // server re-fetches candles, rebuilds the pool, and skips finished stages.
    const resumeJob = async (j) => {
        try {
            const r = await axios.post(`${API_URL}/multileg/optimize/${j.jobId}/resume`);
            attachJob(j);        // restore its config + start polling
            refreshAutoJobs();
            // The server took the request but the resource guard would not let
            // the run start — it stays parked and restarts by itself. Without
            // this the button answered OK and the row read 'paused' again, which
            // looked like a Resume that does nothing.
            if (r.data?.deferred) {
                setRunning(false);
                pushToast(`Not resumed yet — the resource guard is holding research (${guardWords(r.data.reason)}). It restarts by itself when that clears.`, 'warning', 10000);
                return;
            }
            setRunning(true);
            setAutoJob({ jobId: j.jobId });
        } catch (e) {
            pushToast(`Resume failed: ${e.response?.data?.error || e.message}`, 'error', 8000);
        }
    };

    // Pause = stop now, keep the place. The worker pool is killed so the cores
    // come back immediately, and the run settles as 'paused' — resumable from
    // its last checkpoint. A pause is ALSO the operator's veto on automatic
    // resume: the server only restarts runs that died on their own.
    const pauseJob = async (j) => {
        try {
            const r = await axios.post(`${API_URL}/multileg/optimize/${j.jobId}/pause`);
            const d = r.data || {};
            pushToast(d.note || `Paused — Resume picks up from stage ${d.resumeFromStage}`,
                d.resumable ? 'success' : 'warn', d.resumable ? 5000 : 9000);
            if (autoJob?.jobId === j.jobId) setRunning(false);
            refreshAutoJobs();
        } catch (e) {
            pushToast(`Pause failed: ${e.response?.data?.error || e.message}`, 'error', 8000);
        }
    };

    // Forget a run (a running one is killed first). Nothing else references
    // these docs — the champions live in the run's own result blob, so deleting
    // is only ever a housekeeping loss.
    const deleteJob = (j) => setConfirmState({
        title: j.status === 'running' ? 'Kill and delete this running job?' : 'Delete this run?',
        danger: true, confirmLabel: j.status === 'running' ? 'Kill + delete' : 'Delete',
        body: <span>{j.status === 'running'
            ? 'The run is cancelled (its worker threads die immediately) and the record is removed — progress and checkpoints are lost.'
            : 'Removes the record, its checkpoint and its results. Not recoverable — Resume will no longer be possible.'}</span>,
        onConfirm: () => withPending(`deljob:${j.jobId}`, async () => {
            await axios.delete(`${API_URL}/multileg/optimize/${j.jobId}`);
            if (autoJob?.jobId === j.jobId) { setAutoJob(null); setAutoState(null); setRunning(false); }
            refreshAutoJobs();
        }, 'Run deleted'),
    });

    const clearFinishedJobs = () => setConfirmState({
        title: 'Clear all finished runs?', danger: true, confirmLabel: 'Clear finished',
        body: <span>Deletes every run that is not currently running — including paused and interrupted ones, so their checkpoints can no longer be resumed.</span>,
        onConfirm: () => withPending('deljobs', async () => {
            const r = await axios.delete(`${API_URL}/multileg/optimize`);
            const gone = r.data?.removed ?? 0;
            if (autoJob?.jobId && autoState && autoState.status !== 'running') { setAutoJob(null); setAutoState(null); setRunning(false); }
            refreshAutoJobs();
            pushToast(`Cleared ${gone} run${gone === 1 ? '' : 's'}`, 'success');
        }),
    });

    // poll the running job
    useEffect(() => {
        if (!autoJob?.jobId) return;
        let idleTicks = 0; // polls spent stopped — bounds how long we wait for an auto-resume
        const t = pollInterval(() => {
            axios.get(`${API_URL}/multileg/optimize/${autoJob.jobId}`).then(r => {
                const st = r.data.status;
                setAutoState(r.data);
                recordAutoProgress(r.data, sizesForRequest(r.data.request, templates, budgetForLevel(3)));
                setRunning(st === 'running');
                // cancelled/done/the operator's pause are final decisions.
                // 'error', 'interrupted' and a resource-guard park come BACK by
                // themselves (the server restarts what the machine stopped), so
                // keep watching. A park can outlast a whole market session, so
                // it gets no idle cap — pollInterval already sleeps while the
                // tab is hidden.
                const parked = st === 'paused' && r.data.pausedByGovernor && !r.data.pausedManually;
                if (st === 'running' || parked) idleTicks = 0;
                else if (['done', 'cancelled', 'paused'].includes(st)) t?.();
                else if (++idleTicks > 72) t?.(); // ~3 min
            }).catch(() => { /* transient poll failure — keep polling */ });
        }, 2500);
        return () => t?.();
    }, [autoJob, recordAutoProgress, templates]);

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
        scrollPageToTop();
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
        const t = pollInterval(refreshDeployments, 5000);
        return () => t?.();
    }, [mode, refreshSaved, refreshDeployments]);

    // Eligibility as a STABLE primitive — depending on mlDeps.deployments (a
    // fresh array identity every 5s poll) would re-create this effect every
    // poll, clearing the 15s interval before it ever fires.
    const reconEligible = useMemo(() => {
        if (!depDetail || mode !== 'deploy') return false;
        const d = (mlDeps.deployments || []).find(x => x._id === depDetail);
        return !!d && d.trade_mode === 'LIVE' && ['OPEN', 'EXITING'].includes(d.position?.state);
    }, [depDetail, mode, mlDeps.deployments]);

    // Broker reconciliation for the LIVE deployment whose details are open:
    // our recorded fills ⟷ broker trade-book VWAP ⟷ broker net position, plus
    // P&L restated gross vs net-of-charges. Read-only, fetched on demand.
    useEffect(() => {
        if (!reconEligible) { setDepRecon(null); return; }
        let alive = true;
        const pull = () => axios.get(`${API_URL}/multileg/deployments/${depDetail}/reconcile`)
            .then(r => { if (alive) setDepRecon({ id: depDetail, data: r.data }); })
            .catch(e => { if (alive) setDepRecon({ id: depDetail, data: { error: e.response?.data?.error || e.message } }); });
        pull();
        const t = pollInterval(pull, 15000);
        return () => { alive = false; t?.(); };
    }, [depDetail, mode, reconEligible]);   // primitive dep: mlDeps.deployments is a NEW array every 5s poll, which would tear down + refetch on every poll instead of every 15s

    // Live risk-graph (expiry + T+0 curves) for the deployment whose chart is
    // open — fetched on open and refreshed with the deploy poll so it's dynamic.
    useEffect(() => {
        if (!depChart || mode !== 'deploy') { setDepPayoff(null); return; }
        let alive = true;
        const pull = () => axios.get(`${API_URL}/multileg/deployments/${depChart}/payoff`)
            .then(r => { if (alive) setDepPayoff({ id: depChart, data: r.data }); })
            .catch(() => { if (alive) setDepPayoff({ id: depChart, data: { error: true } }); });
        pull();
        const t = pollInterval(pull, 5000);
        return () => { alive = false; t?.(); };
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
        const t = pollInterval(pull, 10000);
        return () => { alive = false; t?.(); };
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
        const t = pollInterval(refreshResults, 15000);
        return () => t?.();
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

    // ── Results scoped to ONE deployment, from a Deploy-card link ───────────
    // `?tab=results&deployment=<id>` preselects that deployment and resets the
    // other filters, so a Structure/Symbol filter left over from earlier can't
    // hide its trades. Only when the URL names a DIFFERENT deployment than the
    // one selected — picking one in the dropdown (which writes the URL too)
    // must not wipe the filters the user just set alongside it.
    const urlDeployment = searchParams.get('deployment');
    useEffect(() => {
        if (!urlDeployment) return;
        setResFilter(f => (f.deploymentId === urlDeployment ? f
            : { mode: 'all', template: 'all', symbol: 'all', deploymentId: urlDeployment }));
    }, [urlDeployment]);
    const selectResDeployment = useCallback((id) => {
        setResFilter(f => ({ ...f, deploymentId: id }));
        setSearchParams((p) => {
            const q = new URLSearchParams(p);
            if (id === 'all') q.delete('deployment'); else q.set('deployment', id);
            return q;
        }, { replace: true });
    }, [setSearchParams]);
    // Every deployment the dropdown can show: the live list PLUS any that only
    // exist in the trade history (deleted since). A deployment with no booked
    // trade yet must still be listed — preselected from its card, it would
    // otherwise render as "All deployments" while the table shows nothing.
    const resDeploymentOptions = useMemo(() => {
        const m = new Map();
        for (const d of (mlDeps.deployments || [])) if (d && d._id) m.set(String(d._id), { name: d.name || null, n: 0 });
        for (const t of resTrades) {
            const id = String(t.deploymentId);
            if (!t.deploymentId || id === 'undefined') continue;
            const e = m.get(id) || { name: null, n: 0 };
            e.n++; if (!e.name) e.name = t.name || null;
            m.set(id, e);
        }
        if (resFilter.deploymentId !== 'all' && !m.has(resFilter.deploymentId)) m.set(resFilter.deploymentId, { name: null, n: 0 });
        return [...m.entries()]
            .map(([id, e]) => ({ id, name: e.name || `deployment …${id.slice(-6)}`, n: e.n }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [mlDeps, resTrades, resFilter.deploymentId]);
    const resDeploymentName = resFilter.deploymentId === 'all' ? null
        : (resDeploymentOptions.find(o => o.id === resFilter.deploymentId)?.name || resFilter.deploymentId);

    // filtered trades + computed KPIs / equity / breakdowns (live-engine parity)
    const resFiltered = useMemo(() => {
        return resTrades.filter(t =>
            (resFilter.mode === 'all' || t.trade_mode === resFilter.mode) &&
            (resFilter.deploymentId === 'all' || String(t.deploymentId) === resFilter.deploymentId) &&
            (resFilter.template === 'all' || t.template === resFilter.template) &&
            (resFilter.symbol === 'all' || t.symbol === resFilter.symbol)
        );
    }, [resTrades, resFilter]);
    // Day-by-day P&L curves over EXACTLY the round-trips listed below. A
    // quarantined trade is excluded here as it is from every other total (it was
    // booked on a price that never existed) — and COUNTED, so the curves never
    // silently disagree with the table's row count.
    const resDayCurves = useMemo(() => {
        const norm = [];
        let quarantined = 0, unreadable = 0;
        for (const t of resFiltered) {
            if (t.quarantined) { quarantined++; continue; }
            const n = normalizeMultilegTrade(t);
            if (n) norm.push(n); else unreadable++;
        }
        const res = buildDayCurves(norm);
        return { days: res?.days || [], excluded: { ...(res?.excluded || {}), quarantined, unreadable } };
    }, [resFiltered]);
    // NOTE: the Results KPIs / equity / breakdowns are NOT computed here any
    // more — they come from GET /multileg/analytics via <ResultsAnalytics>.
    // The client aggregate summed EVERY row in `resFiltered`, quarantined
    // trades included, so it disagreed with the server by exactly the fills
    // that never happened. One source of truth, and it is the one that knows
    // which trades are fiction.

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
        scrollPageToTop();
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

    // Expanded Details of one saved strategy. Rendered inside an `@container`
    // (table row or card), so its grids reflow on the space they actually get.
    const renderSavedDetails = (s) => {
        const m = s.backtest?.metrics;
        const opt = s.optimizer || null;
        if (!m) return <div className="text-2xs text-fg-5">No backtest snapshot saved with this strategy. Load it → run a backtest → re-save to attach results.</div>;
        const pf = pfValue(m);
        return (
            <div className="space-y-3">
                {opt && (
                    <div className="space-y-1.5">
                        <div className="text-2xs text-fg-4 leading-relaxed">
                            From Auto-optimize <span className="font-mono text-fg-3 break-all">{opt.jobId}</span> · champion #{opt.rank}
                            {opt.split != null && <> · last {Math.round(opt.split * 100)}% of the window held out for validation</>}
                            {opt.robustness && (
                                <span className={opt.robustness.robust === false ? 'text-danger' : opt.robustness.robust === true ? 'text-success' : ''}>
                                    {' · '}{opt.robustness.robust === true ? '✓ Holds OOS' : opt.robustness.robust === false ? '⚠ Overfit risk' : 'OOS unknown'}
                                    {opt.robustness.ratio != null ? ` · val/train ${opt.robustness.ratio}` : ''} — {opt.robustness.note}
                                </span>
                            )}
                        </div>
                        <div className="grid grid-cols-2 @md:grid-cols-3 @3xl:grid-cols-6 gap-2">
                            <Tile label="Val net" help="oos-validation" value={`₹${fmt(opt.val?.netPnl)}`} good={opt.val?.netPnl > 0} bad={opt.val?.netPnl < 0} />
                            <Tile label="Val PF" help="oos-validation" value={pfText(opt.val)} />
                            <Tile label="Val win% · n" value={opt.val ? `${opt.val.winRate ?? '—'}% · ${opt.val.n ?? '—'}` : '—'} />
                            <Tile label="Train net" value={`₹${fmt(opt.train?.netPnl)}`} good={opt.train?.netPnl > 0} bad={opt.train?.netPnl < 0} />
                            <Tile label="Train PF" value={pfText(opt.train)} />
                            <Tile label="Train win% · n" value={opt.train ? `${opt.train.winRate ?? '—'}% · ${opt.train.n ?? '—'}` : '—'} />
                        </div>
                    </div>
                )}
                <div className="space-y-1.5">
                    <div className="text-2xs text-fg-4 leading-relaxed">
                        {opt ? 'Full window' : 'Backtest window'} <span className="text-fg-3">{s.backtest.from} → {s.backtest.to}</span> · {s.backtest.resolution || '5'}m
                        {m.exitReasons && <span> · exits: {Object.entries(m.exitReasons).map(([k, v]) => `${k}×${v}`).join(', ')}</span>}
                    </div>
                    <div className="grid grid-cols-2 @md:grid-cols-3 @3xl:grid-cols-6 gap-2">
                        <Tile label="Net P&L" value={`₹${fmt(m.netPnl)}`} good={m.netPnl > 0} bad={m.netPnl < 0} />
                        <Tile label="Trades" value={m.n ?? '—'} />
                        <Tile label="Win Rate" value={m.winRate != null ? `${m.winRate}%` : '—'} good={m.winRate >= 50} />
                        <Tile label="Profit Factor" value={pfText(m)} good={pf != null && pf >= 1.3} bad={pf != null && pf < 1} />
                        <Tile label="Max Drawdown" value={`₹${fmt(m.maxDrawdown)}`} bad={m.maxDrawdown < 0} />
                        <Tile label="ROI on margin" help="roi-on-margin" value={m.roiOnMarginPct != null ? `${fmt(m.roiOnMarginPct, 1)}%` : '—'} good={m.roiOnMarginPct > 0} />
                        <Tile label="Avg Win" value={`₹${fmt(m.avgWin)}`} good />
                        <Tile label="Avg Loss" value={`₹${fmt(m.avgLoss)}`} bad />
                        <Tile label="Avg margin (capital)" value={`₹${fmt(m.avgMargin)}`} />
                        <Tile label="Gross win" value={`₹${fmt(m.grossWin)}`} good />
                        <Tile label="Gross loss" value={`₹${fmt(m.grossLoss)}`} bad />
                        <Tile label="Wins" value={`${m.wins ?? '—'}`} />
                    </div>
                </div>
                <div>
                    <div className="text-3xs text-fg-5 mb-0.5">Structure params</div>
                    <div className="text-3xs font-mono text-fg-4 break-all">{JSON.stringify(s.params || {})}</div>
                    {s.signal_params && <><div className="text-3xs text-violet-400 mt-1.5 mb-0.5">Tuned signal params</div><div className="text-3xs font-mono text-fg-4 break-all">{JSON.stringify(s.signal_params)}</div></>}
                </div>
            </div>
        );
    };

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
    const inputCls = 'w-full mt-1 bg-slate-800 border border-line rounded p-1.5 text-fg-2';

    const DateRangeInputs = (
        <>
            <label className="text-fg-4">From<input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} /></label>
            <label className="text-fg-4">To<input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} /></label>
            <label className="text-fg-4">Candles
                <select value={resolution} onChange={e => setResolution(e.target.value)} className={inputCls}>
                    {RESOLUTIONS.map(r => <option key={r.v} value={r.v}>{r.label}</option>)}
                </select>
            </label>
        </>
    );

    const ChainSourceInputs = (
        <div className="mb-3 text-xs">
            <label className="text-fg-4" title="broker: candles from the broker + the kernel's synthetic Black-Scholes option prices (any dates; an upper bound for short premium). archive: the real option-chain archive — actual bid/ask every ~60 s, shorts sold at bid, stops and targets on the real path (from Aug 2026).">Option prices
                <select value={chainSource} onChange={e => setChainSource(e.target.value)} className={inputCls}>
                    <option value="broker">Broker candles + model chain (any dates · synthetic option prices)</option>
                    <option value="archive">Live option-chain archive (real bid/ask · from Aug 2026)</option>
                </select>
            </label>
            {chainSource === 'archive' && (
                <div className="mt-1 text-3xs text-fg-5">
                    {archiveCov?.error ? <span className="text-danger">{archiveCov.error}</span>
                        : archiveCov ? <>Archive for {archiveCov.idx}: <b className="text-fg-3">{archiveCov.sessions}</b> sessions, {archiveCov.firstDay} → {archiveCov.lastDay} ({archiveCov.snapshots} snapshots, {archiveCov.source}). Dates outside this range have no data; the candle resolution is ignored — marks are the archive's own snapshots.</>
                        : 'checking archive coverage…'}
                </div>
            )}
        </div>
    );

    const RankingInputs = (
        <>
            <label className="text-fg-4">Rank by
                <select value={metric} onChange={e => setMetric(e.target.value)} className={inputCls}>
                    {METRICS.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
                </select>
            </label>
            <label className="text-fg-4">Validation (OOS){mode === 'auto' && <span className="text-4xs text-success ml-1">enforced</span>}
                <select value={split} onChange={e => setSplit(Number(e.target.value))} className={inputCls}>
                    {mode !== 'auto' && <option value={0}>Off (full period)</option>}
                    <option value={0.2}>Hold out last 20%</option>
                    <option value={0.3}>Hold out last 30%</option>
                    <option value={0.4}>Hold out last 40%</option>
                </select>
                {mode === 'auto' && <span className="block text-4xs text-fg-5 mt-0.5">Always on in Auto — you only choose how much to hold out.</span>}
            </label>
        </>
    );

    const [presetKey, setPresetKey] = useState('');
    const activePreset = presets.find(p => p.key === presetKey);
    const TemplatePicker = (
        <>
            {presets.length > 0 && (
                <div className="mb-3 p-2.5 rounded-lg border border-amber-800/40 bg-amber-950/10">
                    <label className="flex flex-wrap items-center gap-2 text-xs text-warning">
                        <span className="font-semibold">⭐ Professional preset</span>
                        <select value={presetKey}
                            onChange={e => { setPresetKey(e.target.value); const p = presets.find(x => x.key === e.target.value); if (p) applyPreset(p); }}
                            className="bg-slate-800 border border-line rounded p-1 text-fg-2 text-xs">
                            <option value="">— pick a trader-grade starting bundle —</option>
                            {presets.map(p => <option key={p.key} value={p.key}>{p.name} · {p.tag}</option>)}
                        </select>
                        {presetKey && <button onClick={() => setPresetKey('')} className="text-3xs text-fg-5 hover:text-fg-3">clear</button>}
                    </label>
                    {activePreset && <div className="text-2xs text-fg-4 mt-1.5 leading-snug">{activePreset.note}</div>}
                    <div className="text-3xs text-fg-5 mt-1">Loads the template + a full, self-consistent param set. Edit anything before deploying — the pre-deploy review will flag risks.</div>
                </div>
            )}
            <div className="flex flex-wrap gap-2 mb-4">
                {templates.map(t => (
                    <button key={t.key} onClick={() => { selectTemplate(t.key); setPresetKey(''); }}
                        className={`px-3 py-1.5 rounded border text-xs ${t.key === tplKey ? 'bg-primary/20 border-primary text-primary-ink' : `bg-slate-800 hover:bg-slate-700 ${OUTLOOK_COLORS[t.outlook] || 'text-fg-3 border-line'}`}`}
                        title={t.notes}>
                        {t.name}
                    </button>
                ))}
            </div>
        </>
    );

    const SetupCard = (
        <div className="bg-surface rounded-xl border border-line p-4">
            <div className="text-sm font-semibold text-fg mb-3 flex items-center gap-2"><SlidersHorizontal className="w-4 h-4 text-primary-ink" /> Setup — {tpl?.name || tplKey}</div>
            <MarketRead symbol={symbol} presets={presets} onApplyPreset={applyPreset} />
            <BookCost symbol={symbol} />
            <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="text-fg-4">Symbol
                    <select value={symbol} onChange={e => { setSymbol(e.target.value); const s = instruments.find(x => x.v === e.target.value); if (s?.spot) setSpot(s.spot); }}
                        className={inputCls}>
                        {instruments.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                    </select>
                </label>
                <label className="text-fg-4">Spot (preview)
                    <input type="number" value={spot} onChange={e => setSpot(Number(e.target.value))} className={inputCls} />
                </label>
                <label className="text-fg-4">IV (preview)
                    <input type="number" step="0.01" value={iv} onChange={e => setIv(Number(e.target.value))} className={inputCls} />
                </label>
                <label className="text-fg-4">Lots
                    <input type="number" value={params.lots || 1} onChange={e => setParams(p => ({ ...p, lots: Number(e.target.value) }))} className={inputCls} />
                </label>
            </div>

            <div className="text-xs text-fg-4 mt-3 mb-1 font-semibold">Entry trigger</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="text-fg-4">Mode
                    <select value={entryMode} onChange={e => { setEntryMode(e.target.value); setSignalParams(null); }} className={inputCls}>
                        <option value="time">Time-based (entry_time)</option>
                        <option value="signal">Strategy signal</option>
                    </select>
                </label>
                {entryMode === 'signal' && (
                    <label className="text-fg-4">Signal strategy
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
                        <span className="text-3xs text-violet-300 font-semibold">TUNED signal params (from champion/save)</span>
                        <button onClick={() => setSignalParams(null)} className="text-3xs text-fg-5 hover:text-danger" title="Discard tuned params — run the strategy at its defaults">✕ use defaults</button>
                    </div>
                    <div className="text-3xs font-mono text-fg-5 break-all">{JSON.stringify(signalParams)}</div>
                </div>
            )}
            {entryMode === 'signal' && (
                <>
                    <label className="flex items-center gap-2 mt-2 text-2xs text-fg-3 cursor-pointer"
                        title="Exit early when the strategy REVERSES (fires the opposite direction) or its own checkExit says the thesis broke — before the structure SL. Directional structures honor both; neutral ones (condor/fly) honor only a thesis-break (an opposite edge-fade inside a range is normal).">
                        <input type="checkbox" checked={useSignalExit} onChange={e => setUseSignalExit(e.target.checked)} className="accent-amber-500" />
                        Strategy early exit <span className="text-fg-5">— close on reverse / thesis-break before SL</span>
                    </label>
                    <div className="text-3xs text-fg-5 mt-1">
                        Entries fire only when {signalStrategy} signals — {String(tpl?.outlook || '').startsWith('bullish') ? 'CE signals only (bullish structure)' : String(tpl?.outlook || '').startsWith('bearish') ? 'PE signals only (bearish structure)' : 'any direction (neutral structure = volatility trigger)'} — still one entry/day.
                        {useSignalExit ? ' Early exit ON: TP still wins first, then a reverse/thesis-break closes before the structure SL.' : ''}
                    </div>
                </>
            )}

            <div className="text-xs text-fg-4 mt-4 mb-1 font-semibold">Deployment risk (engine underwriting — saved with the strategy)</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="text-fg-5">size_mode
                    <select value={params.size_mode || 'fixed'} onChange={e => setParams(p => ({ ...p, size_mode: e.target.value }))}
                        className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2">
                        <option value="fixed">fixed (use Lots)</option>
                        <option value="risk">risk (₹ budget / worst case)</option>
                    </select>
                </label>
                {(params.size_mode === 'risk') && (
                    <label className="text-fg-5" title="₹ risked per structure — lots = floor(budget ÷ worst-case loss per lot)">risk_per_trade ₹
                        <input type="number" value={params.risk_per_trade ?? 10000} onChange={e => setParams(p => ({ ...p, risk_per_trade: Number(e.target.value) }))}
                            className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2" />
                    </label>
                )}
                <label className="text-fg-5" title="hard ceiling on sized lots">max_lots
                    <input type="number" value={params.max_lots ?? 10} onChange={e => setParams(p => ({ ...p, max_lots: Number(e.target.value) }))}
                        className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2" />
                </label>
                <label className="text-fg-5" title="deployment stops entering for the day after this realized loss">max_loss_per_day ₹
                    <input type="number" value={params.max_loss_per_day ?? ''} placeholder="off" onChange={e => setParams(p => ({ ...p, max_loss_per_day: e.target.value === '' ? undefined : Number(e.target.value) }))}
                        className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2" />
                </label>
                <label className="text-fg-5" title="Refuse a structure whose SHORT-vol exposure exceeds this. ₹ lost per 1 IV point. Blank = off. Now enforced in BOTH the backtest and the live engine, so a backtest can no longer approve a structure production would reject.">max_entry_vega ₹/IVpt
                    <input type="number" value={params.max_entry_vega_rupees ?? ''} placeholder="off" onChange={e => setParams(p => ({ ...p, max_entry_vega_rupees: e.target.value === '' ? undefined : Number(e.target.value) }))}
                        className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2" />
                </label>
                <label className="text-fg-5" title="Refuse a structure BORN directional: per-unit |delta| above this is rejected at entry. A neutral fly/condor sits near 0.01-0.02 when freshly struck. Blank = off. Mirrored in the live engine.">max_entry_|Δ|/unit
                    <input type="number" step="0.01" value={params.max_entry_abs_delta_units ?? ''} placeholder="off" onChange={e => setParams(p => ({ ...p, max_entry_abs_delta_units: e.target.value === '' ? undefined : Number(e.target.value) }))}
                        className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2" />
                </label>
                <label className="text-fg-5" title="LIVE entries are limit orders capped this % from the quote — a gapping wing can't fill arbitrarily far away">entry_slippage_cap_pct
                    <input type="number" step="0.1" value={params.entry_slippage_cap_pct ?? 1.5} onChange={e => setParams(p => ({ ...p, entry_slippage_cap_pct: Number(e.target.value) }))}
                        className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2" />
                </label>
            </div>

            <div className="text-xs text-fg-4 mt-4 mb-1 font-semibold">Strike placement (how the SHORT strikes are chosen at entry)</div>
            <div className="grid grid-cols-3 gap-2 text-xs">
                <label className="text-fg-5" title="offset = the template's steps from ATM (plus any offset_* overrides — now honoured live AND in backtest). zone = the zone finder places the shorts on the live chain by expected P&L per rupee of tail under the market's own distribution, and DECLINES when nothing clears zero after charges. Same picker in the backtest (synthetic chain) and live. docs/ZONE_FINDER.md">strike_mode
                    <select value={params.strike_mode || (tpl?.strikeMode === 'zone' ? 'zone' : 'offset')} onChange={e => setParams(p => ({ ...p, strike_mode: e.target.value }))}
                        className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2">
                        <option value="offset">offset (template steps)</option>
                        <option value="zone">zone (market-implied strikes)</option>
                    </select>
                </label>
                {(params.strike_mode || tpl?.strikeMode) === 'zone' && params.strike_mode !== 'offset' && (
                    <>
                        <label className="text-fg-5" title="ratio = expected P&L per rupee of 5% tail (default; positive at every entry time tested, smallest tails). ev = max expected P&L (leans to the money). ev_cvar = max EV with the tail capped at 2× credit. pop = max probability of profit.">zone_objective
                            <select value={params.zone_objective || 'ratio'} onChange={e => setParams(p => ({ ...p, zone_objective: e.target.value }))} className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2">
                                <option value="ratio">ratio (EV ÷ tail)</option><option value="ev">ev</option><option value="ev_cvar">ev_cvar</option><option value="pop">pop</option>
                            </select>
                        </label>
                        <label className="text-fg-5" title="realised/implied tilt of the horizon distribution. 0.85 reproduced realised P&L AND win rate on the Aug–Sep 2026 archive (the measured 0.55 overstates EV 3× because ATM IV drifts up into the close). 1.0 = take the market at its word.">zone_rho
                            <input type="number" step="0.05" min="0.4" max="1.5" value={params.zone_rho ?? 0.85} onChange={e => setParams(p => ({ ...p, zone_rho: Number(e.target.value) }))} className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2" />
                        </label>
                        <label className="text-fg-5" title="each short strike must have |delta| at least this">zone_min_delta
                            <input type="number" step="0.01" min="0.02" max="0.5" value={params.zone_min_delta ?? 0.08} onChange={e => setParams(p => ({ ...p, zone_min_delta: Number(e.target.value) }))} className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2" />
                        </label>
                        <label className="text-fg-5" title="each short strike must have |delta| at most this (0.45 keeps the finder off the ATM straddle, which lost after friction)">zone_max_delta
                            <input type="number" step="0.01" min="0.05" max="0.6" value={params.zone_max_delta ?? 0.45} onChange={e => setParams(p => ({ ...p, zone_max_delta: Number(e.target.value) }))} className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2" />
                        </label>
                        {tpl?.legs?.some(l => l.action === 'BUY') && (
                            <label className="text-fg-5" title="wings this many strike steps beyond each short (wing DISTANCE is the whole variable — far wings won on return-on-margin)">zone_wing_steps
                                <input type="number" step="1" min="1" max="30" value={params.zone_wing_steps ?? 10} onChange={e => setParams(p => ({ ...p, zone_wing_steps: Number(e.target.value) }))} className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2" />
                            </label>
                        )}
                        <label className="text-fg-5" title="off = no AI. shadow = an AI second opinion (event risk, directional tilt, data quality) is fetched in the background and stored beside the pick — it never changes the entry. gate = wait ≤8 s and skip on 'skip'. Shadow first: the single-leg AI confirm measured anti-predictive in production.">ai_zone_review
                            <select value={params.ai_zone_review || 'off'} onChange={e => setParams(p => ({ ...p, ai_zone_review: e.target.value }))} className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2">
                                <option value="off">off</option><option value="shadow">shadow (store, never gate)</option><option value="gate">gate (waits, can skip)</option>
                            </select>
                        </label>
                    </>
                )}
            </div>

            <div className="text-xs text-fg-4 mt-4 mb-1 font-semibold">Vol edge & realism (IV-percentile gate · greeks · spread model)</div>
            <div className="grid grid-cols-3 gap-2 text-xs">
                <label className="text-fg-5" title="sell premium ONLY when the symbol's realized-vol percentile ≥ this (0/blank = off). Same math in backtest and live.">min_ivp
                    <input type="number" value={params.min_ivp ?? ''} placeholder="off" onChange={e => setParams(p => ({ ...p, min_ivp: e.target.value === '' ? undefined : Number(e.target.value) }))}
                        className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2" />
                </label>
                <label className="text-fg-5" title="buy premium ONLY when the vol percentile ≤ this (blank = off)">max_ivp
                    <input type="number" value={params.max_ivp ?? ''} placeholder="off" onChange={e => setParams(p => ({ ...p, max_ivp: e.target.value === '' ? undefined : Number(e.target.value) }))}
                        className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2" />
                </label>
                <label className="text-fg-5" title="trailing days the percentile ranks against">ivp_lookback
                    <input type="number" value={params.ivp_lookback ?? 120} onChange={e => setParams(p => ({ ...p, ivp_lookback: Number(e.target.value) }))}
                        className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2" />
                </label>
                <label className="text-fg-5" title="LIVE alert when |structure delta per unit| exceeds this band — a neutral structure gone directional (blank = off)">delta_alert
                    <input type="number" step="0.05" value={params.delta_alert ?? ''} placeholder="off" onChange={e => setParams(p => ({ ...p, delta_alert: e.target.value === '' ? undefined : Number(e.target.value) }))}
                        className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2" />
                </label>
                <label className="text-fg-5" title="BACKTEST: minimum ₹ cost per side per leg (real spreads have an absolute floor — a ₹4 wing costs ~2.5%/side, not 0.5%)">spread_floor ₹
                    <input type="number" step="0.05" value={params.spread_floor ?? 0.10} onChange={e => setParams(p => ({ ...p, spread_floor: Number(e.target.value) }))}
                        className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2" />
                </label>
                <label className="text-fg-5" title="BACKTEST: spreads widen this % per strike-step away from ATM (books thin out off the money)">spread_step_pct
                    <input type="number" step="1" value={params.spread_step_pct ?? 5} onChange={e => setParams(p => ({ ...p, spread_step_pct: Number(e.target.value) }))}
                        className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2" />
                </label>
            </div>

            {/* IV LEVEL calibration — the biggest backtest↔live parity lever. */}
            <div className="mt-3 p-2 rounded border border-line-0 bg-slate-900/40">
                <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-2xs text-fg-5" title="Backtest prices legs from realizedVol × iv_mult. 1.15 is a guess; calibrate it to the live chain so backtest premium LEVEL (and %-of-credit SL/TP) matches what the deployed engine sees.">iv_mult
                        <input type="number" step="0.01" value={params.iv_mult ?? 1.15} onChange={e => setParams(p => ({ ...p, iv_mult: Number(e.target.value) }))}
                            className="w-20 ml-1 bg-slate-800 border border-line rounded p-1 text-fg-2" />
                    </label>
                    <button onClick={calibrateIv} disabled={ivCalibBusy}
                        className="px-2 py-1 rounded border border-cyan-700/50 bg-cyan-900/20 text-cyan-300 text-2xs hover:bg-cyan-900/40 disabled:opacity-50 flex items-center gap-1">
                        <RefreshCw className={`w-3 h-3 ${ivCalibBusy ? 'animate-spin' : ''}`} /> Calibrate IV to live chain ({shortSym(symbol)})
                    </button>
                    {params.iv_mult != null && params.iv_mult !== 1.15 && (
                        <button onClick={() => { setParams(p => { const { iv_mult: _iv_mult, ...rest } = p; return rest; }); setIvCalib(null); }}
                            className="text-3xs text-fg-5 hover:text-danger" title="Revert to the default 1.15">✕ reset</button>
                    )}
                </div>
                {ivCalib && (ivCalib.error
                    ? <div className="text-3xs text-danger mt-1">Calibration failed: {ivCalib.error} (needs live market hours + a valid option chain)</div>
                    : <div className="text-3xs text-fg-4 mt-1 font-mono">
                        chain ATM IV <span className="text-cyan-300">{ivCalib.observedIvPct}%</span> vs realized {ivCalib.realizedVolPct}% → iv_mult <span className="text-cyan-300">{ivCalib.iv_mult}</span> (was 1.15) · ATM {ivCalib.atmStrike} {ivCalib.expiry} · CE ₹{ivCalib.atmCe} PE ₹{ivCalib.atmPe}
                    </div>)}
                <div className="text-3xs text-fg-5 mt-1">Aligns backtest premium LEVEL to the market. Skew / term-structure / microstructure still differ — paper-validate before LIVE.</div>
            </div>

            <div className="text-xs text-fg-4 mt-4 mb-1 font-semibold">Parameters (every one editable + sweepable)</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(params).filter(([k]) => !['lots', 'size_mode', 'risk_per_trade', 'max_lots', 'max_loss_per_day', 'entry_slippage_cap_pct', 'min_ivp', 'max_ivp', 'ivp_lookback', 'delta_alert', 'spread_floor', 'spread_step_pct', 'iv_mult'].includes(k)).map(([k, v]) => (
                    <label key={k} className="text-fg-5">{k}
                        <input value={v ?? ''} onChange={e => {
                            const raw = e.target.value;
                            setParams(p => ({ ...p, [k]: raw === '' ? '' : (isNaN(Number(raw)) ? raw : Number(raw)) }));
                        }} className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2" />
                    </label>
                ))}
            </div>

            {preview?.legs && (
                <div className="mt-4">
                    <div className="text-xs text-fg-4 font-semibold mb-1">Legs @ spot {fmt(spot)}</div>
                    <table className="w-full text-xs text-fg-3">
                        <tbody>
                            {preview.legs.map((l, i) => (
                                <tr key={i} className="border-t border-line-0">
                                    <td className={`py-1 ${l.action === 'BUY' ? 'text-success' : 'text-danger'}`}>{l.action} {l.ratio > 1 ? `${l.ratio}×` : ''}</td>
                                    <td>{l.type} {fmt(l.strike)}</td>
                                    <td className="text-fg-5">{l.expiry}</td>
                                    <td className="text-right">₹{l.premium}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {a && (
                        <div className="flex flex-wrap gap-2 mt-2 text-2xs">
                            <span className="px-2 py-0.5 rounded bg-slate-800 border border-line">net {a.netPremium >= 0 ? 'credit' : 'debit'} ₹{fmt(Math.abs(a.netPremium), 2)}</span>
                            <span className="px-2 py-0.5 rounded bg-emerald-900/30 border border-emerald-700/50 text-success">max +₹{fmt(a.maxProfit, 0)}</span>
                            <span className="px-2 py-0.5 rounded bg-red-900/30 border border-red-700/50 text-danger">max -₹{fmt(Math.abs(a.maxLoss === -Infinity ? Infinity : a.maxLoss), 0)}{a.maxLoss === -Infinity ? ' (unbounded)' : ''}</span>
                            <span className="px-2 py-0.5 rounded bg-slate-800 border border-line">BE: {(a.breakevens || []).map(b => fmt(b)).join(' / ') || '—'}</span>
                        </div>
                    )}
                    <div className="text-3xs text-fg-5 mt-2">{tpl?.notes}</div>
                </div>
            )}
        </div>
    );

    const PayoffCard = (
        <div className="bg-surface rounded-xl border border-line p-4">
            <div className="text-sm font-semibold text-fg mb-2">Payoff at expiry (per unit)</div>
            {preview?.curve ? (
                <ZoomableChart data={preview.curve} height={300}>
                    <LineChart >
                        <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                        <XAxis dataKey="S" tick={{ fill: ct.text.secondary, fontSize: ct.type['3xs'] }} domain={['dataMin', 'dataMax']} type="number" />
                        <YAxis tick={{ fill: ct.text.secondary, fontSize: ct.type['3xs'] }} />
                        <Tooltip contentStyle={ct.tooltipStyle()} labelFormatter={(v) => `Spot ${fmt(v)}`} />
                        <ReferenceLine y={0} stroke={ct.axis} />
                        <ReferenceLine x={spot} stroke={ct.mark.live} strokeDasharray="4 4" label={{ value: 'spot', fill: ct.mark.live, fontSize: ct.type['3xs'] }} />
                        <Line type="monotone" dataKey="pnl" stroke={ct.mark.terminal} dot={false} strokeWidth={2} />
                    </LineChart>
                </ZoomableChart>
            ) : (
                <div className="text-xs text-fg-5 py-12 text-center">{tpl?.multiExpiry ? 'Calendar: risk profile is computed at NEAR expiry (see numbers on the left).' : 'Loading…'}</div>
            )}
        </div>
    );

    const SymbolChips = (max) => (
        <div className="flex gap-1 flex-wrap">
            {instruments.map(s => (
                <button key={s.v} onClick={() => setScanSymbols(prev => prev.includes(s.v) ? prev.filter(x => x !== s.v) : prev.length < max ? [...prev, s.v] : prev)}
                    className={`px-2 py-1 rounded border text-2xs ${scanSymbols.includes(s.v) ? 'bg-primary/20 border-primary text-primary-ink' : 'bg-slate-800 border-line text-fg-4'}`}>
                    {s.label}
                </button>
            ))}
        </div>
    );

    const OutlookChips = (
        <div className="flex gap-1 flex-wrap">
            {['all', 'bullish', 'bearish', 'neutral', 'volatile'].map(o => (
                <button key={o} onClick={() => setScanOutlook(o)}
                    className={`px-2 py-1 rounded border text-2xs ${scanOutlook === o ? 'bg-primary/20 border-primary text-primary-ink' : 'bg-slate-800 border-line text-fg-4'}`}>
                    {o === 'all' ? `All (${templates.length})` : o}
                </button>
            ))}
        </div>
    );

    useEffect(() => {
        if (!mlStatus?.halted) { setHaltInfo(null); return; }
        let alive = true;
        axios.get(`${API_URL}/engine/halt-status`)
            .then(r => { if (alive) setHaltInfo(r.data || null); })
            .catch(() => { if (alive) setHaltInfo(null); });
        return () => { alive = false; };
    }, [mlStatus?.halted]);

    const resumeEngine = async () => {
        setResuming(true);
        try {
            const r = await axios.post(`${API_URL}/engine/resume`, { actor: 'multileg-ui' });
            pushToast(r.data?.message || 'Engine resumed', 'success', 6000);
            setHaltInfo(null);
        } catch (e) {
            pushToast(`Resume failed: ${e.response?.data?.error || e.message}`, 'error', 8000);
        } finally { setResuming(false); }
    };

    const TABS = [
        { id: 'builder', label: 'Builder', icon: Layers, desc: 'Draw ANY structure leg by leg — live payoff, greeks, POP, margin. No template.' },
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
        <div className="p-6">
            <Toasts toasts={toasts} dismiss={dismissToast} />
            <ConfirmModal open={!!confirmState} {...(confirmState || {})}
                onConfirm={() => { const c = confirmState; setConfirmState(null); c?.onConfirm?.(); }}
                onCancel={() => setConfirmState(null)} />
            <PreviewModal preview={livePreview} deployLots={deployLots} onCancel={() => setLivePreview(null)}
                onConfirm={() => { const s = livePreview.strategy; setLivePreview(null); doDeploy(s, 'LIVE'); }} />
            <PageHeader className="mb-3" icon={Layers} title="Multi-Leg Structures"
                subtitle={<>Spreads · butterflies · condors · straddles · ratio backspreads · calendars — backtest, optimize, scan, and auto-race across symbols before any deployment.</>}
                actions={(
                    <Link to={ROUTES.livePortfolioMulti}
                        className="text-2xs px-2 py-1 rounded border border-line-2 bg-card-2 text-fg-3 hover:text-fg inline-flex items-center gap-1"
                        title="Both books' results — single-leg and multi-leg — on one page">
                        <Wallet className="w-3 h-3" aria-hidden="true" /> Portfolio results
                    </Link>
                )} />

            {/* ── Tabs — one tablist for the whole app (keyboard-navigable) ── */}
            <Tabs className="mb-1" ariaLabel="Multi-leg sections"
                tabs={TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, hint: t.desc }))}
                value={mode} onChange={setMode} />
            <div className="text-2xs text-fg-5 mb-4 pl-1">{TABS.find(t => t.id === mode)?.desc}</div>

            {error && <div className="mb-4 p-2 bg-red-900/20 border border-red-700/50 rounded text-danger text-xs">{error}</div>}

            {/* ═══════════════ BACKTEST TAB ═══════════════ */}
            {mode === 'builder' && <StrategyBuilder />}

            {mode === 'backtest' && (
                <>
                    {TemplatePicker}
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                        {SetupCard}
                        {PayoffCard}
                        <div className="bg-surface rounded-xl border border-line p-4">
                            <div className="text-sm font-semibold text-fg mb-3">Run</div>
                            <div className="grid grid-cols-3 gap-2 text-xs mb-3">{DateRangeInputs}</div>
                            {ChainSourceInputs}
                            {/* text-primary-ink, not text-primary-ink, on a `bg-primary/<alpha>`
                                wash. `--color-primary` is the brand FILL — one colour, tuned
                                to carry white — so painting it as ink on a 10-30% wash of
                                itself is asking one hex to be both figure and ground: it
                                measured 2.04-4.01:1 across the 12 themes (3.55 on midnight,
                                i.e. the shipping UI failed this too). `--color-primary-ink`
                                is the same hue solved AGAINST that wash; worst case 4.97,
                                counting the heavier hover/30 state. Plain `text-primary-ink` on
                                a card is fine and is deliberately left alone. */}
                            <button onClick={() => runBacktest()} disabled={running}
                                className="w-full py-2 bg-primary/20 hover:bg-primary/30 border border-primary/50 text-primary-ink rounded font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                                {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                {running ? 'Running…' : 'Run Backtest'}
                            </button>
                            <div className="mt-3 pt-3 border-t border-line-0">
                                <div className="text-xs text-fg-4 font-semibold mb-1 flex items-center gap-1"><Save className="w-3.5 h-3.5" /> Save this configuration</div>
                                <div className="flex gap-2">
                                    <input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="strategy name"
                                        className="flex-1 bg-slate-800 border border-line rounded p-1.5 text-xs text-fg-2" />
                                    <button onClick={saveStrategy}
                                        className="px-3 py-1.5 bg-sky-900/30 hover:bg-sky-900/50 border border-sky-700/50 text-sky-300 rounded text-xs font-semibold">
                                        Save
                                    </button>
                                </div>
                                <div className="text-3xs text-fg-5 mt-1">{saveMsg || 'Saves template + all params + entry trigger to the DB — load or deploy it from the Deploy tab.'}</div>
                            </div>
                            {result?.chainSource && (
                                <div className={`mt-3 rounded border p-2 text-2xs ${result.chainSource === 'archive' ? 'border-sky-700/50 bg-sky-950/20 text-sky-200' : 'border-amber-700/50 bg-amber-950/20 text-warning'}`}>
                                    <div className="font-semibold mb-1">{result.chainSource === 'archive' ? 'Real option quotes — archive replay' : 'Synthetic option prices — read this as an UPPER BOUND, not a forecast'}</div>
                                    {(result.caveats || []).map((c, i) => <div key={i}>• {c}</div>)}
                                    {result.coverage && (
                                        <div className="mt-1 text-fg-5">
                                            Coverage: {result.coverage.sessions} sessions ({result.coverage.firstDay} → {result.coverage.lastDay}) · entered {result.coverage.entered} · finder declined {result.coverage.declinedDays} day(s)
                                            {result.coverage.truncated ? ` · truncated to the last ${result.coverage.sessions} of ${result.coverage.daysAvailable} available` : ''}
                                            {Object.keys(result.coverage.skipped || {}).length ? ` · skipped: ${Object.entries(result.coverage.skipped).map(([k, n]) => `${n} ${k}`).join(', ')}` : ''}
                                        </div>
                                    )}
                                </div>
                            )}
                            {result?.metrics && (
                                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                                    <Tile label="Trades" value={result.metrics.n} />
                                    <Tile label="Win rate" help="win-rate" value={`${result.metrics.winRate}%`} />
                                    <Tile label="Net P&L" value={`₹${fmt(result.metrics.netPnl)}`} good={result.metrics.netPnl > 0} bad={result.metrics.netPnl < 0} />
                                    <Tile label="Profit factor" help="profit-factor" value={result.metrics.profitFactor === Infinity ? '∞' : result.metrics.profitFactor} />
                                    <Tile label="Sharpe" help="sharpe" value={result.metrics.sharpe != null ? result.metrics.sharpe : '—'} good={result.metrics.sharpe >= 1} bad={result.metrics.sharpe < 0} />
                                    <Tile label="Sortino" help="sortino" value={result.metrics.sortino != null ? result.metrics.sortino : '—'} good={result.metrics.sortino >= 1.5} bad={result.metrics.sortino < 0} />
                                    <Tile label="Avg win" value={`₹${fmt(result.metrics.avgWin)}`} good />
                                    <Tile label="Avg loss" value={`₹${fmt(result.metrics.avgLoss)}`} bad />
                                    <Tile label="Max DD" help="max-drawdown" value={`₹${fmt(result.metrics.maxDrawdown)}`} bad />
                                    <Tile label="Avg margin" help="avg-margin" value={`₹${fmt(result.metrics.avgMargin)}`} />
                                    <Tile label="ROI on margin" help="roi-on-margin" value={result.metrics.roiOnMarginPct != null ? `${result.metrics.roiOnMarginPct}%` : '—'} good={result.metrics.roiOnMarginPct > 0} />
                                    {(() => {
                                        const ds = (result.trades || []).map(t => t.maxAbsDeltaUnits).filter(v => Number.isFinite(v));
                                        if (!ds.length) return null;
                                        const worst = Math.max(...ds);
                                        const avg = ds.reduce((a, b) => a + b, 0) / ds.length;
                                        return <Tile label="Worst Δ/unit" value={`${fmt(worst, 2)} (avg ${fmt(avg, 2)})`} bad={worst >= 0.5}
                                            help="delta" />;
                                    })()}
                                    <Tile label="Exits" value={Object.entries(result.metrics.exitReasons || {}).map(([k, v]) => `${k}:${v}`).join(' ')} small />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Greek attribution —- is this template a theta engine or a vol bet?
                        Net P&L cannot answer that, and the two imply opposite entry rules. */}
                    {result?.attribution && (
                        <div className="mt-4">
                            <StructureAttributionPanel data={result.attribution} />
                        </div>
                    )}

                    {result?.trades?.length > 0 && (
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
                            <div className="bg-surface rounded-xl border border-line p-4">
                                <div className="text-sm font-semibold text-fg mb-2">Equity (net, ₹)</div>
                                <ZoomableChart data={equity} height={300}>
                                    <LineChart >
                                        <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                                        <XAxis dataKey="i" tick={{ fill: ct.text.secondary, fontSize: ct.type['3xs'] }} />
                                        <YAxis tick={{ fill: ct.text.secondary, fontSize: ct.type['3xs'] }} />
                                        <Tooltip contentStyle={ct.tooltipStyle()} />
                                        <ReferenceLine y={0} stroke={ct.axis} />
                                        <Line type="monotone" dataKey="equity" stroke={ct.categorical[0]} dot={false} strokeWidth={2} />
                                    </LineChart>
                                </ZoomableChart>
                            </div>
                            <div className="bg-surface rounded-xl border border-line p-4 overflow-x-auto">
                                <div className="text-sm font-semibold text-fg mb-2">Trades ({result.trades.length})</div>
                                <div className="max-h-[21.25rem] overflow-y-auto">
                                    <table className="w-full text-2xs text-fg-3">
                                        <thead className="sticky top-0 bg-surface"><tr className="text-fg-5 text-left"><th>Entry</th><th>Exit</th><th>Hold</th><th>Reason</th><th className="text-right">Spot in→out</th><th className="text-right">Credit</th><th className="text-right" title="Position size actually taken. 'risk' basis = sized to risk_per_trade, so it varies per trade.">Lots</th><th className="text-right" title="Worst per-unit delta the structure carried at ANY point in its life. A 'neutral' structure that reaches 0.5+ was not neutral. Exit-time delta hides this because exits cluster at DTE 0 where the reading is dominated by terminal gamma.">Worst Δ/u</th><th className="text-right">Margin</th><th className="text-right">Net ₹</th></tr></thead>
                                        <tbody>
                                            {result.trades.slice().reverse().map((t, i) => (
                                                <tr key={i} className="border-t border-line-0">
                                                    <td title="IST">{istDateTime(t.entryTime)}</td>
                                                    <td title="IST">{istDateTime(t.exitTime)}</td>
                                                    <td>{t.holdDays}d</td>
                                                    <td className="text-fg-4">{t.reason}</td>
                                                    <td className="text-right text-fg-4">{fmt(t.spotEntry)}→{fmt(t.spotExit)}</td>
                                                    <td className="text-right">₹{fmt(t.credit, 1)}</td>
                                                    <td className="text-right text-fg-4">{t.lots ?? '—'}{t.sizeBasis === 'risk' ? <span className="text-sky-400" title={`risk-sized (worst case ₹${fmt(t.perLotRisk)}/lot)`}>*</span> : null}</td>
                                                    <td className={`text-right ${t.maxAbsDeltaUnits >= 0.5 ? 'text-warning font-semibold' : 'text-fg-5'}`}
                                                        title={t.greeks ? `at exit: Δ₹${fmt(t.greeks.delta,1)}/pt · V₹${fmt(t.greeks.vega,1)}/IVpt · Θ₹${fmt(t.greeks.theta,1)}/day` : ''}>
                                                        {t.maxAbsDeltaUnits != null ? fmt(t.maxAbsDeltaUnits, 2) : '—'}</td>
                                                    <td className="text-right text-fg-5">₹{fmt(t.margin)}</td>
                                                    <td className={`text-right font-semibold ${t.netPnl > 0 ? 'text-success' : 'text-danger'}`}>₹{fmt(t.netPnl)}</td>
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
                        <div className="bg-surface rounded-xl border border-line p-4">
                            <div className="text-sm font-semibold text-fg mb-3">Sweep configuration</div>
                            <div className="grid grid-cols-3 gap-2 text-xs mb-3">{DateRangeInputs}</div>
                            <div className="grid grid-cols-2 gap-2 text-xs mb-3">{RankingInputs}</div>
                            <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                                <label className="text-fg-4">Max combos
                                    <input type="number" value={sweepCap} min={10} max={1000} onChange={e => setSweepCap(Number(e.target.value) || 300)} className={inputCls} />
                                </label>
                                <label className="text-fg-4">Show top
                                    <select value={sweepTopN} onChange={e => setSweepTopN(Number(e.target.value))} className={inputCls}>
                                        <option value={25}>25 results</option>
                                        <option value={50}>50 results</option>
                                        <option value={100}>100 results</option>
                                    </select>
                                </label>
                            </div>
                            <label className="flex items-center gap-2 text-xs text-fg-4 mb-2">
                                <input type="checkbox" checked={refine} onChange={e => setRefine(e.target.checked)} />
                                Round 2: refine around the leader (midpoint grid)
                            </label>
                            <label className="text-xs text-fg-4 block mb-3">Grid (JSON — arrays expand; edited Setup params apply under every combo)
                                <textarea value={gridText} onChange={e => setGridText(e.target.value)} rows={7}
                                    className="w-full mt-1 bg-slate-800 border border-line rounded p-2 font-mono text-2xs text-fg-2" />
                            </label>
                            <button onClick={runSweep} disabled={running}
                                className="w-full py-2 bg-primary/20 hover:bg-primary/30 border border-primary/50 text-primary-ink rounded font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                                {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
                                {running ? 'Running…' : 'Run Sweep'}
                            </button>
                        </div>
                    </div>

                    {sweep?.top && (
                        <div className="bg-surface rounded-xl border border-line p-4 mt-4 overflow-x-auto">
                            <div className="text-sm font-semibold text-fg mb-1">
                                Sweep — {sweep.combos} combos over {sweep.rounds} round{sweep.rounds > 1 ? 's' : ''} ({(sweep.combosPerRound || []).join(' + ')}), ranked by {sweep.split > 0 ? 'VALIDATION' : 'full-period'} {METRICS.find(m => m.v === sweep.metric)?.label}
                            </div>
                            {sweep.window && <div className="text-2xs text-fg-5 mb-2">Train {sweep.window.trainDays}d → validate on the last {sweep.window.valDays}d (out-of-sample). Distrust combos whose train ≫ validation.</div>}
                            <table className="w-full text-2xs text-fg-3">
                                <thead><tr className="text-fg-5 text-left">
                                    <th>#</th><th>Params (grid part)</th>
                                    {sweep.split > 0 ? (<><th className="text-right">Val n</th><th className="text-right">Val win%</th><th className="text-right">Val net ₹</th><th className="text-right">Val PF</th><th className="text-right">Val Sharpe</th><th className="text-right">Val ROI%</th><th className="text-right">Train net ₹</th></>)
                                        : (<><th className="text-right">n</th><th className="text-right">Win%</th><th className="text-right">Net ₹</th><th className="text-right">PF</th><th className="text-right">Sharpe</th><th className="text-right">ROI%</th><th className="text-right">MaxDD</th></>)}
                                    <th className="text-right">Actions</th>
                                </tr></thead>
                                <tbody>
                                    {sweep.top.map((r, i) => {
                                        const v = r.val || r.metrics, tr = r.train;
                                        return (
                                            <tr key={i} className="border-t border-line-0 hover:bg-slate-800/40">
                                                <td className="text-fg-5">{i + 1}</td>
                                                <td className="font-mono text-3xs text-fg-4">{JSON.stringify(r.params)}</td>
                                                <td className="text-right">{M(v, 'n')}</td>
                                                <td className="text-right">{M(v, 'winRate')}</td>
                                                <td className={`text-right font-semibold ${(v?.netPnl ?? 0) > 0 ? 'text-success' : 'text-danger'}`}>₹{fmt(v?.netPnl)}</td>
                                                <td className="text-right">{M(v, 'profitFactor')}</td>
                                                <td className={`text-right ${(v?.sharpe ?? 0) >= 1 ? 'text-success' : (v?.sharpe ?? 0) < 0 ? 'text-danger' : ''}`}>{v?.sharpe != null ? v.sharpe : '—'}</td>
                                                <td className="text-right">{v?.roiOnMarginPct != null ? `${v.roiOnMarginPct}%` : '—'}</td>
                                                <td className="text-right">{sweep.split > 0 ? `₹${fmt(tr?.netPnl)}` : `₹${fmt(v?.maxDrawdown)}`}</td>
                                                <td className="text-right whitespace-nowrap">
                                                    <button onClick={() => testSweepRow(r)} disabled={running}
                                                        className="px-2 py-0.5 rounded border border-emerald-700/50 bg-emerald-900/20 text-success hover:bg-emerald-900/40 disabled:opacity-40"
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
                    <div className="bg-surface rounded-xl border border-line p-4 mb-4">
                        <div className="text-sm font-semibold text-fg mb-3">Scan configuration — every structure at its defaults, one leaderboard</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                            <div>
                                <div className="text-fg-4 mb-1">Structures</div>
                                {OutlookChips}
                                <div className="text-fg-4 mb-1 mt-3">Symbols (≤6)</div>
                                {SymbolChips(6)}
                            </div>
                            <div>
                                <div className="grid grid-cols-3 gap-2 mb-2">{DateRangeInputs}</div>
                                <div className="grid grid-cols-2 gap-2 mb-3">{RankingInputs}</div>
                                <button onClick={runScan} disabled={running}
                                    className="w-full py-2 bg-primary/20 hover:bg-primary/30 border border-primary/50 text-primary-ink rounded font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                                    {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
                                    {running ? 'Running…' : `Scan ${scanOutlook === 'all' ? templates.length : scanOutlook} × ${scanSymbols.length} symbols`}
                                </button>
                            </div>
                        </div>
                    </div>

                    {scan?.rows && (
                        <div className="bg-surface rounded-xl border border-line p-4 overflow-x-auto">
                            <div className="text-sm font-semibold text-fg mb-1">
                                Scan — {scan.templatesScanned} structures × {scan.symbolsScanned} symbols, ranked by {scan.split > 0 ? 'VALIDATION' : 'full-period'} {METRICS.find(m => m.v === scan.metric)?.label}
                            </div>
                            <div className="text-2xs text-fg-5 mb-2">All at template defaults — ▶ Test runs the full backtest, ⚙ Tune opens it in the Optimizer.</div>
                            <table className="w-full text-2xs text-fg-3">
                                <thead><tr className="text-fg-5 text-left">
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
                                            <tr key={i} className="border-t border-line-0 hover:bg-slate-800/40">
                                                <td className="text-fg-5">{i + 1}</td>
                                                <td>{r.name || r.template}</td>
                                                <td className={`${(OUTLOOK_COLORS[r.outlook] || '').split(' ')[0]}`}>{r.outlook}</td>
                                                <td>{shortSym(r.symbol)}</td>
                                                <td className="text-right">{M(v, 'n')}</td>
                                                <td className="text-right">{M(v, 'winRate')}</td>
                                                <td className={`text-right font-semibold ${(v?.netPnl ?? 0) > 0 ? 'text-success' : 'text-danger'}`}>₹{fmt(v?.netPnl)}</td>
                                                <td className="text-right">{M(v, 'profitFactor')}</td>
                                                <td className="text-right">{v?.roiOnMarginPct != null ? `${v.roiOnMarginPct}%` : '—'}</td>
                                                {scan.split > 0 && <td className="text-right text-fg-4">₹{fmt(r.train?.netPnl)}</td>}
                                                <td className="text-right whitespace-nowrap">
                                                    <button onClick={() => runBacktestFor(r.template, r.symbol)} disabled={running}
                                                        className="px-2 py-0.5 mr-1 rounded border border-emerald-700/50 bg-emerald-900/20 text-success hover:bg-emerald-900/40 disabled:opacity-40"
                                                        title="Full backtest (whole period) — equity curve + every trade">
                                                        ▶ Test
                                                    </button>
                                                    <button onClick={() => { selectTemplate(r.template); setSymbol(r.symbol); const inst = instruments.find(x => x.v === r.symbol); if (inst?.spot) setSpot(inst.spot); setMode('sweep'); scrollPageToTop(); }}
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
                        <div className="text-sm font-semibold text-warning mb-1 flex items-center gap-2"><Zap className="w-4 h-4" /> Auto-Optimize — the full race</div>
                        <div className="text-xs text-fg-4 mb-3">Every selected strategy (own params, random-searched) × {scanOutlook === 'all' ? 'all' : scanOutlook} structures × symbols → structure sweep + refine → OOS-ranked champions{autoAi ? ' → AI-validated' : ''}. Runs on all CPU cores.</div>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
                            <div>
                                <div className="text-fg-4 mb-1 font-semibold">Structures</div>
                                {OutlookChips}
                                <div className="text-fg-4 mb-1 mt-3 font-semibold">Symbols (≤4)</div>
                                {SymbolChips(4)}
                                <div className="text-fg-4 mb-1 mt-3 font-semibold">Signal strategies ({autoStrategies.length ? `${autoStrategies.length} selected` : 'all optimizable'})</div>
                                <div className="flex gap-1 flex-wrap max-h-28 overflow-y-auto">
                                    <button onClick={() => setAutoStrategies([])}
                                        className={`px-2 py-1 rounded border text-2xs ${!autoStrategies.length ? 'bg-primary/20 border-primary text-primary-ink' : 'bg-slate-800 border-line text-fg-4'}`}>
                                        All
                                    </button>
                                    {strategies.map(s => (
                                        <button key={s.id}
                                            onClick={() => setAutoStrategies(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])}
                                            title={s.reason || s.label}
                                            className={`px-2 py-1 rounded border text-2xs ${autoStrategies.includes(s.id) ? 'bg-primary/20 border-primary text-primary-ink' : 'bg-slate-800 border-line text-fg-4'}`}>
                                            {s.label || s.id}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <div className="grid grid-cols-3 gap-2 mb-2">{DateRangeInputs}</div>
                                <div className="grid grid-cols-2 gap-2 mb-2">{RankingInputs}</div>
                                <div className="grid grid-cols-2 gap-2">
                                    <label className="text-fg-4">Budget level
                                        <select value={budgetLevel} onChange={e => { setBudgetLevel(Number(e.target.value)); setBudgetCustom({}); }} className={inputCls}>
                                            {Array.from({ length: 20 }, (_, i) => i + 1).map(L => (
                                                <option key={L} value={L}>
                                                    Level {L}{L <= 3 ? ' · quick' : L <= 7 ? ' · thorough' : L <= 14 ? ' · deep (fine grids)' : ' · marathon (days)'}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="text-fg-4">Entries
                                        <select value={autoEntryStyle} onChange={e => setAutoEntryStyle(e.target.value)} className={inputCls}>
                                            <option value="both">Signals + time-based neutrals</option>
                                            <option value="signal-only">Strategy signals ONLY</option>
                                        </select>
                                    </label>
                                </div>
                                {autoState?.status !== 'running' && (
                                    <div className="mt-2 text-2xs text-fg-5">
                                        ≈ {fmt(autoEstimate.total)} backtests · est. {autoEstimate.dur}
                                        {budgetLevel >= 15 && <span className="text-warning"> · survives refresh (re-attach below); a server redeploy interrupts it</span>}
                                    </div>
                                )}
                                <button onClick={() => setBudgetAdv(v => !v)} className="mt-1 text-2xs text-sky-400 hover:text-sky-300">
                                    {budgetAdv ? '▾ Hide advanced budget' : '▸ Advanced budget (edit every number)'}
                                </button>
                                {budgetAdv && (
                                    <div className="grid grid-cols-2 gap-2 mt-2">
                                        {Object.keys(effBudget).map(k => (
                                            <label key={k} className="text-fg-5" title={BUDGET_HELP[k] || k}>{k}
                                                <input type="number" value={effBudget[k]}
                                                    onChange={e => setBudgetCustom(c => ({ ...c, [k]: Number(e.target.value) || 0 }))}
                                                    className="w-full mt-0.5 bg-slate-800 border border-line rounded p-1 text-fg-2" />
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div>
                                <label className="text-fg-4 flex items-center gap-2 mb-2">
                                    <input type="checkbox" checked={autoAi} onChange={e => setAutoAi(e.target.checked)} />
                                    AI-validate champions (replays each entry through the AI confirm gate)
                                </label>
                                {autoAi && (
                                    <label className="text-fg-4 block mb-2">AI confidence threshold
                                        <input type="number" step="0.05" min="0.3" max="0.9" value={aiThreshold}
                                            onChange={e => setAiThreshold(Number(e.target.value) || 0.6)} className={inputCls} />
                                    </label>
                                )}
                                <button onClick={startAuto} disabled={running}
                                    className="w-full py-2.5 mt-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/60 text-warning rounded font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                                    {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                                    {running ? 'Running…' : 'Start Auto-Optimize ⚡'}
                                </button>
                                {running && autoJob?.jobId && (
                                    <div className="grid grid-cols-2 gap-2 mt-2">
                                        <button onClick={() => pauseJob({ jobId: autoJob.jobId })}
                                            title="Stop now but keep the checkpoint — Resume continues from where it stopped"
                                            className="py-1.5 bg-slate-800 border border-line-2 text-fg-2 rounded text-xs flex items-center justify-center gap-1">
                                            <Pause className="w-3 h-3" /> Pause
                                        </button>
                                        <button onClick={cancelAuto} className="py-1.5 bg-red-900/20 border border-red-700/50 text-danger rounded text-xs">Cancel run</button>
                                    </div>
                                )}
                                {autoState && (
                                    <div className="mt-3 text-xs">
                                        <AutoRunProgress job={autoState} track={autoTrack}
                                            sizes={sizesForRequest(autoState.request, templates, budgetForLevel(3))} />
                                        {['error', 'interrupted'].includes(autoState.status) && (
                                            <div className="mt-2 text-danger">
                                                {autoState.error}
                                                {autoState.checkpoint?.stage
                                                    ? <span className="block text-sky-300/80">Resumable from stage {autoState.checkpoint.stage} — the server retries this by itself; use Resume to do it now.</span>
                                                    : <span className="block text-fg-5">No checkpoint yet — this run can only be started fresh.</span>}
                                            </div>
                                        )}
                                        {/* Three different facts share status 'paused'. Saying "by you"
                                            for all of them told the operator a run the resource guard
                                            parked would never come back. */}
                                        {autoState.status === 'paused' && (() => {
                                            const parked = autoState.pausedByGovernor && !autoState.pausedManually;
                                            return (
                                                <div className="mt-2 text-fg-3">
                                                    {parked
                                                        ? <>Parked by the resource guard — {autoState.governorReason || 'not enough headroom'}. It restarts by itself as soon as the guard sees room (checked every 30 s); Resume tries now.</>
                                                        : autoState.pausedManually ? 'Paused by you — it will NOT auto-resume.' : 'Paused — it will not restart by itself.'}
                                                    {autoState.checkpoint?.stage
                                                        ? <span className="text-success/90"> Resume continues from stage {autoState.checkpoint.stage}.</span>
                                                        : parked
                                                            ? <span className="text-fg-5"> It was parked before its first checkpoint, so it starts from the beginning.</span>
                                                            : <span className="text-fg-5"> No checkpoint was written — only a fresh start is possible.</span>}
                                                </div>
                                            );
                                        })()}
                                        {autoState.status === 'done' && autoState.result?.stages && (
                                            <div className="mt-2 text-fg-5">
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
                        <div className="bg-surface rounded-xl border border-line p-3 mb-4">
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-xs font-semibold text-fg">Recent runs (persisted — re-attach after a refresh)</div>
                                <div className="flex items-center gap-2">
                                    <span className="text-3xs text-fg-5 hidden sm:inline" title="A run that dies on its own (server restart or an error) is restarted from its last checkpoint, up to 3 times in a row. A run the resource guard parks (low memory, market hours) restarts by itself as soon as there is room again — those parks don't use up the 3 tries, because the guard parks a multi-day run every trading morning. A run YOU pause is never restarted automatically.">
                                        crash or resource guard → auto-resume · paused by you → stays paused
                                    </span>
                                    {autoJobs.some(j => j.status !== 'running') && (
                                        <button onClick={clearFinishedJobs} disabled={!!pending.deljobs}
                                            className="px-2 py-0.5 rounded border border-line bg-slate-800 text-3xs text-fg-4 hover:text-danger disabled:opacity-40">
                                            Clear finished
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="space-y-1 text-2xs">
                                {autoJobs.map(j => {
                                    const cp = j.checkpoint || {};
                                    const parked = j.status === 'paused' && j.pausedByGovernor && !j.pausedManually;
                                    // a run parked before its first checkpoint can still be started (from scratch)
                                    const canResume = (!!cp.stage && j.status !== 'running' && j.status !== 'done') || parked;
                                    return (
                                    <div key={j.jobId} className="flex items-center gap-2 border-b border-line-0/60 pb-1">
                                        <span className={`px-1.5 py-0.5 rounded border text-3xs ${j.status === 'running' ? 'border-amber-600 text-warning' : j.status === 'done' ? 'border-emerald-700 text-success' : j.status === 'paused' ? 'border-line-3 text-fg-3' : 'border-red-800 text-danger'}`}>{j.status}</span>
                                        <span className="text-fg-5" title="IST">{istDateTime(j.startedAt)}</span>
                                        <span className="text-fg-4 flex-1 truncate">
                                            {(j.request?.symbols || []).map(shortSym).join('+')} · {j.request?.strategies ?? '?'} strategies · {j.request?.entry_style || 'both'}
                                            {j.status === 'running' ? ` — ${runSummary(j, sizesForRequest(j.request, templates, budgetForLevel(3)), autoTrack)}` : ''}
                                            {j.status !== 'running' && j.status !== 'done' && cp.stage ? (
                                                cp.phase === 'partial'
                                                    ? ` — checkpoint mid-stage ${cp.stage}${cp.cursor ? ` (${cp.cursor} done)` : ''}`
                                                    : ` — checkpoint after stage ${cp.stage}`) : ''}
                                            {j.status === 'paused' && (parked
                                                ? <span className="text-sky-300/80" title={j.governorReason || undefined}> · parked by the resource guard ({guardWords(j.governorReason)}) — restarts by itself when that clears</span>
                                                : <span className="text-fg-5"> · {j.pausedManually ? 'paused by you' : 'paused'} (no auto-resume)</span>)}
                                            {j.autoResumeCount > 0 && <span className="text-sky-400/80" title="Times the server restarted this run by itself"> · auto-resumed ×{j.autoResumeCount}</span>}
                                        </span>
                                        {autoJob?.jobId !== j.jobId && ['running', 'done'].includes(j.status) && (
                                            <button onClick={() => attachJob(j)}
                                                className="px-2 py-0.5 rounded border border-sky-700/50 bg-sky-900/20 text-sky-300 hover:bg-sky-900/40">
                                                {j.status === 'running' ? 'Attach' : 'View results'}
                                            </button>
                                        )}
                                        {j.status === 'running' && (
                                            <button onClick={() => pauseJob(j)} title="Stop now, keep the checkpoint — and don't auto-resume it"
                                                className="px-2 py-0.5 rounded border border-line-2 bg-slate-800 text-fg-3 hover:text-fg flex items-center gap-1">
                                                <Pause className="w-3 h-3" /> Pause
                                            </button>
                                        )}
                                        {canResume && (
                                            <button onClick={() => resumeJob(j)}
                                                title={cp.stage ? 'Continue from the last checkpoint' : 'Parked before its first checkpoint — starts from the beginning'}
                                                className="px-2 py-0.5 rounded border border-emerald-700/50 bg-emerald-900/20 text-success hover:bg-emerald-900/40">
                                                {!cp.stage ? 'Start now ▸' : cp.phase === 'partial' ? `Resume ↻ S${cp.stage}` : `Resume ▸ S${cp.stage + 1}`}
                                            </button>
                                        )}
                                        <button onClick={() => deleteJob(j)} disabled={!!pending[`deljob:${j.jobId}`]}
                                            title={j.status === 'running' ? 'Kill this run and delete the record' : 'Delete this record (checkpoint + results)'}
                                            className="px-1.5 py-0.5 rounded border border-line bg-slate-800 text-fg-5 hover:text-danger hover:border-red-800 disabled:opacity-40">
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {autoState?.status === 'done' && autoState.result?.champions?.length > 0 && (
                        <div>
                            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                                {autoState.result.champions.map((ch, i) => (
                                    <div key={i} className={`bg-surface rounded-xl border p-4 ${i === 0 ? 'border-amber-500/60' : 'border-line'}`}>
                                        <div className="flex items-center justify-between mb-1">
                                            <div className="text-sm font-semibold text-fg">{i === 0 ? '🏆 ' : `#${i + 1} `}{ch.name}</div>
                                            <span className={`text-3xs px-2 py-0.5 rounded border ${OUTLOOK_COLORS[ch.outlook] || 'border-line text-fg-4'}`}>{ch.outlook}</span>
                                        </div>
                                        <div className="text-xs text-fg-4 mb-2">
                                            {shortSym(ch.symbol)} · {ch.signal_strategy ? `signal: ${ch.signal_strategy}` : 'time-based entries'}
                                        </div>
                                        {ch.robustness && (
                                            <div className={`text-2xs mb-2 px-2 py-1 rounded border ${ch.robustness.robust === true ? 'text-success border-emerald-800/50 bg-emerald-950/20' : ch.robustness.robust === false ? 'text-danger border-red-800/50 bg-red-950/20' : 'text-fg-4 border-line bg-slate-800/30'}`}
                                                title="Automatic out-of-sample check: how the validation-window metric held up vs the train window.">
                                                {ch.robustness.robust === true ? '✓ Holds OOS' : ch.robustness.robust === false ? '⚠ Overfit risk' : 'OOS unknown'}
                                                {ch.robustness.ratio != null ? ` · val/train ${ch.robustness.ratio}` : ''} — {ch.robustness.note}
                                            </div>
                                        )}
                                        <div className="grid grid-cols-3 gap-1 text-2xs mb-2">
                                            <Tile label="Val net" help="oos-validation" value={`₹${fmt(ch.val?.netPnl)}`} good={ch.val?.netPnl > 0} bad={ch.val?.netPnl < 0} />
                                            <Tile label="Train net" value={`₹${fmt(ch.train?.netPnl)}`} good={ch.train?.netPnl > 0} bad={ch.train?.netPnl < 0} />
                                            <Tile label="Full net" value={`₹${fmt(ch.full?.netPnl)}`} good={ch.full?.netPnl > 0} bad={ch.full?.netPnl < 0} />
                                            <Tile label="Val PF" help="oos-validation" value={ch.val?.profitFactor === Infinity ? '∞' : ch.val?.profitFactor ?? '—'} />
                                            <Tile label="Win%" value={ch.full?.winRate ?? '—'} />
                                            <Tile label="ROI/margin" help="roi-on-margin" value={ch.full?.roiOnMarginPct != null ? `${ch.full.roiOnMarginPct}%` : '—'} />
                                        </div>
                                        {ch.withAi && (
                                            <div className="text-2xs mb-2 p-2 rounded bg-violet-900/20 border border-violet-700/40 text-violet-200">
                                                🧠 With AI gate: net ₹{fmt(ch.withAi.netPnl)} over {ch.withAi.n} trades
                                                ({ch.aiStats?.permitted}/{ch.aiStats?.candidates} entries permitted, {ch.aiStats?.calls} calls)
                                                {ch.full && ch.withAi.netPnl > ch.full.netPnl ? ' — AI improved it' : ' — AI filtered it down'}
                                            </div>
                                        )}
                                        {ch.signal_params && <div className="text-3xs font-mono text-fg-5 break-all mb-1">signal: {JSON.stringify(ch.signal_params)}</div>}
                                        {ch.structure_params && <div className="text-3xs font-mono text-fg-5 break-all mb-2">structure: {JSON.stringify(ch.structure_params)}</div>}
                                        <button onClick={() => loadChampion(ch)}
                                            className="w-full py-1.5 bg-primary/15 hover:bg-primary/25 border border-primary/40 text-primary-ink rounded text-xs font-semibold">
                                            Load config → Backtest
                                        </button>
                                    </div>
                                ))}
                            </div>
                            {autoState.result.leaderboard?.length > 0 && (
                                <div className="bg-surface rounded-xl border border-line p-4 mt-4 overflow-x-auto">
                                    <div className="text-sm font-semibold text-fg mb-2">Full leaderboard (stage-3 survivors)</div>
                                    <table className="w-full text-2xs text-fg-3">
                                        <thead><tr className="text-fg-5 text-left"><th>#</th><th>Structure</th><th>Symbol</th><th>Signal</th><th className="text-right">Val net ₹</th><th className="text-right">Val PF</th><th className="text-right">Val win%</th><th className="text-right">Train net ₹</th><th className="text-right">OOS</th></tr></thead>
                                        <tbody>
                                            {autoState.result.leaderboard.map((r, i) => (
                                                <tr key={i} className="border-t border-line-0">
                                                    <td className="text-fg-5">{i + 1}</td>
                                                    <td>{r.name || r.template}</td>
                                                    <td>{shortSym(r.symbol)}</td>
                                                    <td className="text-fg-4">{r.signal_strategy || 'time'}</td>
                                                    <td className={`text-right font-semibold ${(r.val?.netPnl ?? 0) > 0 ? 'text-success' : 'text-danger'}`}>₹{fmt(r.val?.netPnl)}</td>
                                                    <td className="text-right">{r.val?.profitFactor === Infinity ? '∞' : r.val?.profitFactor ?? '—'}</td>
                                                    <td className="text-right">{r.val?.winRate ?? '—'}</td>
                                                    <td className="text-right text-fg-4">₹{fmt(r.train?.netPnl)}</td>
                                                    <td className="text-right" title={r.robustness?.note || ''}>{r.robustness?.robust === true ? <span className="text-success">✓</span> : r.robustness?.robust === false ? <span className="text-danger">⚠</span> : <span className="text-fg-5">—</span>}</td>
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
                    <SavedStrategiesPanel
                        list={savedList} templates={templates}
                        deployLots={deployLots} onDeployLots={setDeployLots} pending={pending}
                        openId={savedDetail} onToggle={setSavedDetail}
                        onLoad={loadSaved} onDeploy={deploySaved} onDelete={deleteSaved}
                        renderDetails={renderSavedDetails} />

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
                            <div className={`rounded-xl border p-3 ${tone || 'border-line bg-slate-900/40'}`}>
                                <div className="text-3xs uppercase tracking-wide text-fg-5 mb-1">{label}</div>
                                {children}
                            </div>
                        );
                        return (
                            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
                                <Card label="Combined P&L (all books)" tone={combined < 0 ? 'border-rose-800/50 bg-rose-950/10' : 'border-emerald-800/50 bg-emerald-950/10'}>
                                    <div className={`text-xl font-mono font-bold ${combined < 0 ? 'text-danger' : 'text-success'}`}>₹{fmt(combined)}</div>
                                    <div className="text-3xs text-fg-5">Realized ₹{fmt(realized)} · Open {open >= 0 ? '+' : ''}₹{fmt(open)}</div>
                                </Card>
                                <Card label="Structures closed today">
                                    <div className="text-xl font-mono font-bold text-fg-2">{mlStatus.tradesToday || 0}</div>
                                    <div className="text-3xs text-fg-5" title="Deployments that have used their one-per-day entry slot (including a structure carried in from a prior day).">{mlStatus.entriesUsed || 0}/{mlStatus.active || 0} used today’s entry slot</div>
                                </Card>
                                <Card label="Daily Loss Used" tone={lossPct >= 80 ? 'border-rose-800/50 bg-rose-950/10' : undefined}>
                                    {cap > 0 ? (
                                        <>
                                            <div className={`text-xl font-mono font-bold ${lossPct >= 80 ? 'text-danger' : 'text-fg-2'}`}>{lossPct}%</div>
                                            <div className="text-3xs text-fg-5">of ₹{fmt(cap)} cap (per book)</div>
                                        </>
                                    ) : (
                                        <><div className="text-sm font-mono text-fg-4">no cap set</div><div className="text-3xs text-fg-5">MULTILEG_DAILY_LOSS_LIMIT</div></>
                                    )}
                                </Card>
                                <Card label="Engine Status" tone={engState === 'HALTED' ? 'border-rose-800/50 bg-rose-950/10' : undefined}>
                                    <div className={`text-lg font-bold ${engState === 'RUNNING' ? 'text-success' : engState === 'HALTED' ? 'text-danger' : 'text-fg-4'}`}>{engState}</div>
                                    <div className="text-3xs text-fg-5 truncate" title={brk.map(([k, v]) => `${k} × ${v}`).join(' · ')}>
                                        {mlStatus.openStructures || 0} open{brk.length ? ' · ' + brk.map(([k, v]) => `${k} × ${v}`).join(' · ') : ''}
                                        {tickAgeS != null && tickAgeS > 30 ? ` · ⚠ loop ${tickAgeS}s ago` : ''}
                                    </div>
                                </Card>
                            </div>
                        );
                    })()}

                    {/* ── Signal Status Timeline (per deployment) ────────────────── */}
                    {mlDeps.signalStatus && Object.keys(mlDeps.signalStatus).length > 0 && (
                        <div className="bg-surface rounded-xl border border-line p-4 mb-4">
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-sm font-semibold text-fg flex items-center gap-2"><Activity className="w-4 h-4 text-warning" /> Signal Status Timeline</div>
                                <span className="text-3xs text-fg-5">newest → · 🟢 entry · ⚪ neutral · 🔵 ready · 🟡 waiting</span>
                            </div>
                            <div className="space-y-1.5">
                                {mlDeps.deployments.filter(d => mlDeps.signalStatus[d._id]).map(d => {
                                    const info = mlDeps.signalStatus[d._id];
                                    const cur = info?.current;
                                    const hist = info?.history || [];
                                    // The two neutral states are DOTS, i.e. ink-as-shape, so they belong on
                                    // the fg ramp and not on the surface ramp: neutral-500/700 are surface
                                    // shades that only happen to be visible in dark mode (on a light theme
                                    // they are L 0.70 / L 0.93 — a 2.5:1 dot and a 1.2:1 invisible one).
                                    // fg-5 is neutral-500's dark value so midnight's DONE dot is unchanged;
                                    // both now stay legible on light (5.0:1 / 3.5:1) and fg-5 > fg-6 keeps
                                    // DONE louder than "no signal", as before.
                                    const colorFor = (a) => a === 'ENTRY' ? 'bg-emerald-500' : a === 'READY' ? 'bg-blue-500/70' : a === 'WAIT' ? 'bg-amber-500/70' : a === 'DONE' ? 'bg-fg-5' : 'bg-fg-6';
                                    return (
                                        <div key={d._id} className="flex items-center gap-3 text-xs">
                                            <div className="w-40 truncate text-fg-3" title={d.name}>{d.name}</div>
                                            <div className="flex items-center gap-1.5 w-24">
                                                <span className={`w-2 h-2 rounded-full ${colorFor(cur?.action)}`} />
                                                <span className={`uppercase text-3xs font-bold ${cur?.action === 'ENTRY' ? 'text-success' : cur?.action === 'READY' ? 'text-blue-300' : cur?.action === 'WAIT' ? 'text-warning' : 'text-fg-4'}`}>{cur?.action || '—'}</span>
                                                {cur?.type && <span className="text-3xs text-fg-5">{cur.type}</span>}
                                            </div>
                                            <div className="flex-1 truncate text-2xs text-fg-5 italic" title={cur?.reason || ''}>{cur?.reason || '—'}</div>
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
                        <div className={`rounded-xl border px-4 py-2.5 mb-4 flex items-center gap-2 text-sm font-semibold ${engineHealth.level === 'halt' ? 'border-red-600 bg-red-950/40 text-danger' : engineHealth.level === 'stale' ? 'border-amber-500 bg-amber-950/40 text-warning' : 'border-line-2 bg-slate-900 text-fg-3'}`} role="alert">
                            <span className="text-lg" aria-hidden="true">{engineHealth.level === 'halt' ? '⛔' : engineHealth.level === 'stale' ? '⚠️' : '📡'}</span>
                            <span className="flex-1">
                                {engineHealth.msg}
                                {engineHealth.level === 'halt' && haltInfo && (
                                    <span className="block font-normal text-2xs mt-0.5 text-danger/90">
                                        {haltInfo.reason} · by {haltInfo.actor}
                                        {haltInfo.ageMinutes != null && ` · ${haltInfo.ageMinutes < 60 ? `${haltInfo.ageMinutes}m` : `${(haltInfo.ageMinutes / 60).toFixed(1)}h`} ago`}
                                        {' · '}
                                        {haltInfo.selfClearing
                                            ? 'automatic — clears itself on the next trading day'
                                            : 'MANUAL — it will not clear on its own'}
                                    </span>
                                )}
                            </span>
                            {engineHealth.level === 'halt' && (
                                <button onClick={resumeEngine} disabled={resuming}
                                    title="Lift the halt now. Until this existed the only way to clear a halt was restarting the container."
                                    className="shrink-0 px-2.5 py-1 rounded border border-red-500 bg-red-900/50 hover:bg-red-800 text-danger text-xs font-semibold disabled:opacity-50">
                                    {resuming ? 'Resuming…' : 'Resume engine'}
                                </button>
                            )}
                        </div>
                    )}

                    <div className="bg-surface rounded-xl border border-line p-4 mb-4">
                        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                            <div className="text-sm font-semibold text-fg flex items-center gap-2"><Rocket className="w-4 h-4 text-warning" /> Deployments ({visibleDeps.length}{visibleDeps.length !== (mlDeps.deployments || []).length ? `/${(mlDeps.deployments || []).length}` : ''})</div>
                            <div className="flex flex-wrap items-center gap-2 text-2xs">
                                {/* freshness / connection */}
                                <span className={`flex items-center gap-1 ${!lastPoll.ok ? 'text-danger' : 'text-fg-5'}`} title="Auto-refreshes every 5s">
                                    <span className={`w-1.5 h-1.5 rounded-full ${!lastPoll.ok ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'}`} />
                                    {lastPoll.at ? `updated ${istTime(lastPoll.at)}` : '…'}{!lastPoll.ok ? ' (offline)' : ''}
                                </span>
                                <select value={depFilter} onChange={e => setDepFilter(e.target.value)} className="bg-slate-800 border border-line rounded p-1 text-fg-3" aria-label="Filter deployments">
                                    <option value="all">All books</option><option value="LIVE">LIVE</option><option value="PAPER">PAPER</option><option value="open">Open only</option>
                                </select>
                                <select value={depSort} onChange={e => setDepSort(e.target.value)} className="bg-slate-800 border border-line rounded p-1 text-fg-3" aria-label="Sort deployments">
                                    <option value="state">Sort: state</option><option value="mtm">Sort: MTM</option><option value="pnl">Sort: total P&L</option><option value="name">Sort: name</option>
                                </select>
                                <button onClick={() => bulkAction('stop-all')} disabled={pending.bulk} className="px-2 py-1 rounded border border-amber-700/50 bg-amber-900/20 text-warning hover:bg-amber-900/40 disabled:opacity-40">Stop all</button>
                                <button onClick={() => bulkAction('close-all')} disabled={pending.bulk} className="px-2 py-1 rounded border border-red-700/50 bg-red-900/25 text-danger hover:bg-red-900/45 disabled:opacity-40">Close all</button>
                            </div>
                        </div>
                        {mlStatus && (
                            <div className="flex flex-wrap gap-3 text-2xs font-mono mb-3 px-2 py-1.5 rounded border border-line-0 bg-slate-900/40"
                                title="Whole-book exposure vs engine limits. Greeks: Δ ₹/spot-pt · V ₹/IV-pt · Θ ₹/day. Short vega is what the vega cap gates on.">
                                <span className="text-fg-4">book:</span>
                                <span className={mlStatus.openMtmRupees < 0 ? 'text-danger' : 'text-success'}>MTM ₹{fmt(mlStatus.openMtmRupees)}</span>
                                <span className="text-fg-3">margin ₹{fmt(mlStatus.openMarginRupees)}{mlStatus.limits?.maxMargin > 0 ? `/${fmt(mlStatus.limits.maxMargin)}` : ''}</span>
                                <span className="text-fg-3">short-prem ₹{fmt(mlStatus.openShortPremiumRupees)}</span>
                                <span className={mlStatus.openShortVegaRupees > 0 ? 'text-warning' : 'text-fg-5'}>short-vega ₹{fmt(mlStatus.openShortVegaRupees)}/IVpt{mlStatus.limits?.maxVega > 0 ? `/${fmt(mlStatus.limits.maxVega)}` : ''}</span>
                                {mlStatus.bookGreeks && (mlStatus.bookGreeks.delta !== 0 || mlStatus.bookGreeks.vega !== 0) && (
                                    <span className="text-sky-300">Δ₹{fmt(mlStatus.bookGreeks.delta, 1)} V₹{fmt(mlStatus.bookGreeks.vega, 1)} Θ₹{fmt(mlStatus.bookGreeks.theta, 1)}</span>
                                )}
                                <span className="text-fg-5">LIVE day ₹{fmt(mlStatus.dayPnl?.LIVE)} · PAPER day ₹{fmt(mlStatus.dayPnl?.PAPER)}</span>
                            </div>
                        )}
                        {mlDeps.deployments.length === 0 ? (
                            <div className="text-xs text-fg-5 py-4 text-center">No structure runners yet — deploy a saved strategy above (Paper first, always).</div>
                        ) : visibleDeps.length === 0 ? (
                            <div className="text-xs text-fg-5 py-4 text-center">No deployments match this filter.</div>
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
                                    // the TEMPLATE decides whether square_off is an exit rule at all
                                    const depTpl = templates.find(t => t.key === d.template) || null;
                                    // what the engine is managing this structure TO (its exit config)
                                    const exitBits = [];
                                    if (P.tp_pct_credit) exitBits.push(`TP ${P.tp_pct_credit}% credit`);
                                    if (P.tp_pct_max_profit) exitBits.push(`TP ${P.tp_pct_max_profit}% maxP`);
                                    if (P.sl_x_credit) exitBits.push(`SL ${P.sl_x_credit}×`);
                                    if (P.sl_pct_debit) exitBits.push(`SL ${P.sl_pct_debit}%`);
                                    if (P.leg_sl_x) exitBits.push(`legSL ${P.leg_sl_x}×`);
                                    if (P.dte_exit != null) exitBits.push(`DTE≤${P.dte_exit}`);
                                    if (P.hold_days > 0) exitBits.push(`hold ≤${P.hold_days}d`);
                                    if (P.tp_x_debit) exitBits.push(`TP ${P.tp_x_debit}× debit`);
                                    if (P.use_signal_exit) exitBits.push('early-exit');
                                    if (P.square_off) exitBits.push(depTpl && !depTpl.intraday ? `sq-off ${P.square_off} (entry window only)` : `sq-off ${P.square_off}`);
                                    // the "if nothing moves" close date — knowable at entry, so show it
                                    const proj = open ? projectExit(pos, P, expiry, { intraday: !!depTpl?.intraday }) : null;
                                    const heldSessions = open ? sessionsBetween(new Date(pos.entryAt).getTime(), Date.now()) : null;
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
                                    // Use curveMaxProfit, NOT maxProfit. The plotted expiry curve
                                    // starts from pos.realizedLegPnl (server.js: `let expU = realized`),
                                    // so on a structure with a leg already stopped out it INCLUDES that
                                    // realized loss — while pg.maxProfit comes from payoff.analyze()
                                    // over the still-open legs and does not. Reading maxProfit made the
                                    // caption contradict the curve directly above it (₹5,636 printed
                                    // over a curve topping out at ₹4,518).
                                    const chartMaxP = pg ? (pg.curveMaxProfit ?? pg.maxProfit) : (curve ? Math.max(...curve.points.map(p => p.pnl)) : null);
                                    const chartNetPnl = pg && pg.currentMtmNet != null ? pg.currentMtmNet : (pos.lastMtmNetRupees ?? null);
                                    const chartCharges = pg && pg.currentMtmCharges != null ? pg.currentMtmCharges : null;
                                    // TRUE tail, not the plot window. `pg.maxLoss` is now the
                                    // analyzer's verdict and is NULL when the tail is undefined —
                                    // an uncovered short must never render a comforting finite
                                    // number (a narrow window could even make it positive).
                                    const chartUnbounded = pg ? !!pg.unbounded : (pos.legs || []).some(l => l.action === 'SELL')
                                        && !(pos.legs || []).some(b2 => b2.action === 'BUY' && b2.type === (pos.legs || []).find(x => x.action === 'SELL')?.type);
                                    const chartMaxL = pg ? pg.maxLoss : (curve ? Math.min(...curve.points.map(p => p.pnl)) : null);
                                    const tpRupee = (tpUnit != null && unitToRupee) ? Math.round(tpUnit * unitToRupee) : null;
                                    const slRupee = (slUnit != null && unitToRupee) ? Math.round(slUnit * unitToRupee) : null;
                                    // Y-DOMAIN — driven by the CURVES ACTUALLY PLOTTED, not by
                                    // theoretical extremes.
                                    //
                                    // Framing it on max-profit and the stop level looks reasonable and
                                    // is wrong: those are often unreachable inside the plotted spot
                                    // window. A FINNIFTY strangle plotted between its break-evens spans
                                    // +Rs753..+Rs45,507 and never goes negative, yet its SL sits at
                                    // -Rs45,507 — including that level stretched the axis to +-68k and
                                    // squeezed the live P&L of Rs832 into 0.6% of the height.
                                    //
                                    // So: fit the curve, then admit TP/SL only if they land near it.
                                    // A level that is off-scale is reported in the footer instead of
                                    // silently flattening the thing you came to look at.
                                    const chartYDomain = (() => {
                                        const vals = [];
                                        for (const p of (chartData || [])) {
                                            for (const k of ['expiry', 'now', 'tPlus', 'whatif']) {
                                                const v = Number(p?.[k]);
                                                if (Number.isFinite(v)) vals.push(v);
                                            }
                                        }
                                        [chartNowPnl, chartNetPnl].forEach(v => { if (Number.isFinite(v)) vals.push(v); });
                                        if (vals.length < 2) return ['auto', 'auto'];
                                        let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
                                        const span = Math.max(hi - lo, 1);
                                        // a TP/SL within half a span of the curve is worth showing to scale
                                        [tpRupee, slRupee].forEach(v => {
                                            if (!Number.isFinite(v)) return;
                                            if (v > lo - span * 0.5 && v < hi + span * 0.5) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
                                        });
                                        const pad = Math.max((hi - lo) * 0.12, 200);
                                        return [Math.round(lo - pad), Math.round(hi + pad)];
                                    })();
                                    // levels that could not be shown to scale — named in the footer
                                    const offScale = [
                                        Number.isFinite(tpRupee) && (tpRupee < chartYDomain[0] || tpRupee > chartYDomain[1]) ? `TP ₹${fmt(tpRupee)}` : null,
                                        Number.isFinite(slRupee) && (slRupee < chartYDomain[0] || slRupee > chartYDomain[1]) ? `SL ₹${fmt(slRupee)}` : null,
                                    ].filter(Boolean);
                                    const mtmHist = mlDeps.mtmHistory?.[d._id] || null;    // intraday sparkline
                                    const feed = d._feed || null;                          // signal-feed health (IDLE deployments)
                                    const isLive = d.trade_mode === 'LIVE';
                                    const busy = Object.keys(pending).some(k => k.endsWith(`:${d._id}`));
                                    // MTM is only live during market hours; flag a stale mark so an
                                    // after-hours frozen number isn't read as a live P&L.
                                    const mtmAgeMs = pos.lastMtmAt ? Date.now() - new Date(pos.lastMtmAt).getTime() : null;
                                    const mtmStale = open && mtmAgeMs != null && mtmAgeMs > 3 * 60000;
                                    // A STALE mark must never headline while a FRESH one exists lower on
                                    // the same card. Observed live: the tile showed net −₹64 from 15:15
                                    // yesterday (8.6h old) while the reconciliation panel three rows down
                                    // showed the true current net +₹161 — two authoritative-looking numbers
                                    // ₹224 apart. Prefer the freshly-marked value when we have one.
                                    const freshRecon = (depRecon?.id === d._id && depRecon.data && !depRecon.data.error && depRecon.data.netRupees != null) ? depRecon.data : null;
                                    // NOT a freshness signal. The payoff endpoint returns
                                    // `currentMtm: pos.lastMtmRupees` — literally the same stored
                                    // number the tile already shows; live quotes there drive only the
                                    // curve SHAPE and spot, and the T+0 level is anchored to
                                    // pos.lastMtm. Treating its presence as "live" relabelled an
                                    // 8-hour-stale mark green the moment the chart was opened, and
                                    // because the endpoint's own `stale` flag uses the SAME 3-minute
                                    // threshold as mtmStale, the contradiction was guaranteed rather
                                    // than occasional. Only a genuine recompute (freshRecon) counts.
                                    const shownNet = freshRecon ? freshRecon.netRupees : pos.lastMtmNetRupees;
                                    const shownGross = freshRecon ? freshRecon.grossRupees : pos.lastMtmRupees;
                                    const shownChg = freshRecon ? freshRecon.chargesRupees : pos.lastMtmChargesEst;
                                    // If a recon ran, the number ON SCREEN is that recompute, so it is
                                    // fresh whatever the stored mark's age. Otherwise we are showing
                                    // pos.lastMtmNetRupees and its freshness IS the stored mark's age.
                                    const shownIsFresh = freshRecon ? true : !mtmStale;
                                    const ageTxt = mtmAgeMs == null ? '' : mtmAgeMs < 90 * 60000 ? `${Math.round(mtmAgeMs / 60000)}m old` : `${(mtmAgeMs / 3600000).toFixed(1)}h old`;
                                    return (
                                        <div key={d._id} className={`rounded-lg border p-3 relative ${isLive ? 'border-red-600 bg-red-950/20 ring-1 ring-red-800/40' : 'border-line bg-slate-900/40'} ${busy ? 'opacity-70' : ''}`}>
                                            {isLive && <div className="absolute -top-2 left-3 text-5xs font-bold px-1.5 py-0.5 rounded bg-red-700 text-white tracking-wider">● REAL MONEY</div>}
                                            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-1">
                                                <div className="min-w-0 break-words text-xs font-semibold text-fg-2 flex items-center gap-1.5">{d.name}{busy && <RefreshCw className="w-3 h-3 animate-spin text-fg-4" />}</div>
                                                <div className="flex flex-wrap gap-1">
                                                    <span className={`text-3xs px-1.5 py-0.5 rounded border ${d.trade_mode === 'LIVE' ? 'border-red-700 text-danger' : 'border-sky-700 text-sky-300'}`}>{d.trade_mode}</span>
                                                    <span className={`text-3xs px-1.5 py-0.5 rounded border ${d.status === 'ACTIVE' ? 'border-emerald-700 text-success' : 'border-line-2 text-fg-4'}`}>{d.status}</span>
                                                    <span className={`text-3xs px-1.5 py-0.5 rounded border ${open ? 'border-amber-600 text-warning' : 'border-line text-fg-5'}`}>{st}</span>
                                                    {open && <button onClick={() => setDepChart(depChart === d._id ? null : d._id)}
                                                        className={`text-3xs px-1.5 py-0.5 rounded border ${depChart === d._id ? 'border-sky-600 text-sky-300' : 'border-line-2 text-fg-4'} hover:text-fg`}
                                                        title="Live payoff diagram — the spread's P&L-at-expiry curve with a 'you are here' marker at the current spot">📈 chart</button>}
                                                    {(d.totals?.trades > 0 || open) && <button onClick={() => setDepActivity(depActivity === d._id ? null : d._id)}
                                                        className={`text-3xs px-1.5 py-0.5 rounded border ${depActivity === d._id ? 'border-violet-600 text-violet-300' : 'border-line-2 text-fg-4'} hover:text-fg`}
                                                        title="P&L activity — the cumulative equity curve of every booked trade, plus the live unrealized MTM of the current open structure">📊 activity</button>}
                                                    {/* A LINK, not a button: it is navigation — middle-click opens it
                                                        in a new tab, Back returns here, a refresh keeps the scope. */}
                                                    <Link to={{ search: `?tab=results&deployment=${encodeURIComponent(String(d._id))}` }} onClick={scrollPageToTop}
                                                        className="text-3xs px-1.5 py-0.5 rounded border border-line-2 text-fg-4 hover:text-fg"
                                                        title={d.totals?.trades > 0
                                                            ? `Open Results for ${d.name} only — every booked trade with its P&L, margin and legs, plus the breakdowns and curves`
                                                            : `Open Results for ${d.name} only — nothing booked yet, so it fills in after the first exit`}>🧾 results</Link>
                                                    <button onClick={() => setDepDetail(detailOpen ? null : d._id)}
                                                        className={`text-3xs px-1.5 py-0.5 rounded border ${detailOpen ? 'border-amber-600 text-warning' : 'border-line-2 text-fg-4'} hover:text-fg`}
                                                        title="Full order detail — legs, prices, SL/TP levels, exit deadlines">{detailOpen ? '▲' : '▾'} details</button>
                                                </div>
                                            </div>
                                            <div className="text-2xs text-fg-4 mb-1 flex flex-wrap items-center gap-x-1">
                                                <span>{templates.find(t => t.key === d.template)?.name || d.template} · {shortSym(d.symbol)} · {d.lots} lot(s)
                                                    {d.entry_mode === 'signal' ? ` · signal: ${d.signal_strategy}` : ' · time entry'}</span>
                                                {feed && d.entry_mode === 'signal' && !open && (
                                                    <span className={`ml-1 ${feed.ok ? 'text-success' : 'text-warning'}`} title={`Feed: ${feed.note}${feed.bars != null ? ` · ${feed.bars} bars` : ''} · last check ${istTimeSec(feed.at)} IST`}>
                                                        ● {feed.ok ? 'feed ok' : feed.note}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="grid grid-cols-3 gap-1 text-2xs mb-2">
                                                {/* NET is the headline number: gross premium difference flatters a
                                                    multi-leg structure by the whole round-trip cost (~₹230 on a 4-leg
                                                    index fly), which is often larger than the MTM itself. */}
                                                <div title={mtmStale
                                                    ? `Mark is STALE — last updated ${istTime(pos.lastMtmAt)} IST (market likely closed). Not a live P&L; option quotes are frozen at their last trade.`
                                                    : `NET = what actually lands in the account if you close now: gross premium difference MINUS estimated round-trip charges (brokerage + STT + exchange + GST + stamp).\n\ngross ₹${fmt(pos.lastMtmRupees ?? 0)}  −  charges ₹${fmt(pos.lastMtmChargesEst ?? 0)}  =  net ₹${fmt(pos.lastMtmNetRupees ?? 0)}\n\nYour broker's unrealised P&L usually excludes charges — compare it to GROSS, and your ledger to NET.`}>
                                                    {/* A STALE tile is not just old, it can be WRONG. The engine's
                                                        final mark of the session is taken a second after the bell
                                                        and can still carry pre-settlement prices (measured on prod:
                                                        stamped 15:30:58, priced ~15:25, off by ₹179). Say so, and
                                                        point at the one action that re-prices from the broker. */}
                                                    <Tile help="mtm-net"
                                                        title={shownIsFresh
                                                            ? 'Re-priced from the broker just now.'
                                                            : (mtmStale
                                                                ? `Last marked ${ageTxt}. The market has been shut since, so this is the engine's final in-session mark — which can pre-date the closing prints. Open Details to re-price from the broker; that number is authoritative.`
                                                                : 'Marked by the engine within the last few minutes.')}
                                                        label={shownIsFresh ? 'MTM net (after charges)' : (mtmStale ? `⚠ MTM net · ${ageTxt}` : 'MTM net (after charges)')}
                                                        value={shownNet != null
                                                            ? `₹${fmt(shownNet)}`
                                                            : (pos.lastMtm != null ? `₹${fmt(pos.lastMtmRupees ?? 0)} gross` : '—')}
                                                        good={(shownIsFresh || !mtmStale) && shownNet > 0} bad={(shownIsFresh || !mtmStale) && shownNet < 0} />
                                                    {!shownIsFresh && mtmStale && (
                                                        <div className="text-4xs text-warning/80 mt-0.5">
                                                            may pre-date the close — open Details to re-price
                                                        </div>
                                                    )}
                                                    {shownNet != null && (
                                                        <div className="text-4xs text-fg-5 mt-0.5 font-mono">
                                                            gross ₹{fmt(shownGross)} · chg ₹{fmt(shownChg)}
                                                            {/* emerald-400, not -600: 600 is a solid-bg/border shade and
                                                                as ink it was already under 3:1 on the dark themes. */}
                                                            {shownIsFresh ? <span className="text-success"> · live</span>
                                                                          : <span className="text-warning"> · {ageTxt}</span>}
                                                        </div>
                                                    )}
                                                </div>
                                                <Tile label="Today" value={`₹${fmt(d.daily?.pnlToday)}`} good={d.daily?.pnlToday > 0} bad={d.daily?.pnlToday < 0} />
                                                <Tile label={`Total (${d.totals?.trades || 0})`} value={`₹${fmt(d.totals?.netPnl)}`} good={d.totals?.netPnl > 0} bad={d.totals?.netPnl < 0} />
                                            </div>
                                            {open && mtmHist && mtmHist.length > 1 && (
                                                <div className="flex items-center gap-2 mb-2 text-4xs text-fg-5" title="Intraday MTM path (₹) since the engine started tracking">
                                                    <span>MTM today</span><Sparkline data={mtmHist} />
                                                    <span className={pnlTone(mtmHist[mtmHist.length - 1].pnl)}>₹{fmt(mtmHist[mtmHist.length - 1].pnl)}</span>
                                                </div>
                                            )}
                                            {open && d.position?.greeks && (
                                                <div className="text-3xs font-mono mb-2 flex flex-wrap gap-x-3 gap-y-0.5"
                                                    title="Live book greeks — Δ: ₹ per 1pt spot move · V: ₹ per 1 IV point · Θ: ₹ per day. IVP = vol percentile at entry.">
                                                    <span className={d.position.greeks.delta < 0 ? 'text-danger' : 'text-success'}>Δ ₹{fmt(d.position.greeks.delta, 1)}/pt</span>
                                                    <span className={d.position.greeks.vega < 0 ? 'text-warning' : 'text-sky-300'} title="Live vega of the legs still OPEN, per 1 IV point. A leg closed by its leg-SL drops out of this, so it can differ from vega@in — which is a frozen snapshot over ALL legs at entry.">V ₹{fmt(d.position.greeks.vega, 1)}/IVpt<span className="text-fg-5"> open</span></span>
                                                    <span className={d.position.greeks.theta > 0 ? 'text-success' : 'text-danger'}>Θ ₹{fmt(d.position.greeks.theta, 1)}/day</span>
                                                    {d.position.ivpAtEntry != null && <span className="text-fg-5">IVP@in {fmt(d.position.ivpAtEntry, 0)}</span>}
                                                </div>
                                            )}
                                            {/* Live RISK GRAPH — expiry payoff + current T+0 MTM curve, every level marked */}
                                            {chartOpen && chartData.length > 0 && (
                                                <div className="mb-2 border-t border-line-0 pt-2">
                                                    <div className="flex items-center justify-between text-3xs text-fg-4 mb-1 flex-wrap gap-x-3">
                                                        <span className="flex items-center gap-2">
                                                            <span className="text-success">━ expiry</span>
                                                            {pg && <span className="text-sky-300">┅ now (T+0)</span>}
                                                            {pg && <span className="text-violet-300/70">▨ ±1σ move</span>}
                                                            <span className="text-sky-300 font-semibold">spot {fmt(chartSpot)}</span>
                                                            <span className="text-fg-5">entry {fmt(pos.entrySpot)}</span>
                                                            {pg && <span className="text-fg-5">IV {pg.ivAvgPct}% · {pg.dte}DTE</span>}
                                                            {pg && pg.pop != null && <span className={pg.pop >= 50 ? 'text-success' : 'text-warning'} title="Probability of finishing profitable (lognormal, from IV)">POP {pg.pop}%</span>}
                                                        </span>
                                                        <span title="break-even spot levels">BE {chartBEs.length ? chartBEs.map(b => fmt(b)).join(' / ') : '—'}</span>
                                                    </div>
                                                    <ZoomableChart data={chartData} height={230}>
                                                        <LineChart margin={{ top: 8, right: 62, bottom: 2, left: 8 }}>
                                                            <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                                                            {pg && pg.expectedMove > 0 && <ReferenceArea x1={pg.spot - pg.expectedMove} x2={pg.spot + pg.expectedMove} fill={ct.mark.region} fillOpacity={0.08} stroke={ct.mark.region} strokeOpacity={0.25} />}
                                                            <XAxis dataKey="spot" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: ct.type['4xs'], fill: ct.text.secondary }}
                                                                ticks={[...new Set([...chartStrikes, ...(pos.entrySpot ? [Math.round(pos.entrySpot)] : []), ...(chartSpot ? [Math.round(chartSpot)] : [])])].sort((a, b) => a - b)} />
                                                            <YAxis tick={{ fontSize: ct.type['4xs'], fill: ct.text.secondary }} width={54} domain={chartYDomain} allowDataOverflow tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
                                                            {/* Name every series explicitly: an `else 'P&L @ expiry'` fallback
                                                                printed the next-open curve as a second "P&L @ expiry" row. */}
                                                            <Tooltip contentStyle={ct.tooltipStyle({ fontSize: ct.type['2xs'] })} cursor={{ stroke: ct.mark.live, strokeDasharray: '3 3' }}
                                                                formatter={(v, n) => [`₹${fmt(v)}`, n === 'now' ? 'P&L now' : n === 'next open' ? 'P&L @ next open' : n === 'expiry' ? 'P&L @ expiry' : n]}
                                                                labelFormatter={(l) => {
                                                                    // Distance from BOTH marked lines: from entry is how far the
                                                                    // index has run since you got in, from now is how far it
                                                                    // still has to run to reach the hovered level.
                                                                    const fromEntry = spotMove(l, pos.entrySpot);
                                                                    const fromNow = spotMove(l, chartSpot);
                                                                    // "now" sitting on entry (fresh fill, or no live spot yet)
                                                                    // would only repeat the entry line
                                                                    const nowOnEntry = spotMove(chartSpot, pos.entrySpot)?.at;
                                                                    return (<>
                                                                        <span className="block">spot {fmt(l)}</span>
                                                                        {fromEntry && <span className="block">{fromEntry.at ? 'at the entry spot' : `${fromEntry.label} from entry ${fmt(pos.entrySpot)}`}</span>}
                                                                        {fromNow && !nowOnEntry && <span className="block">{fromNow.at ? 'at the current spot' : `${fromNow.label} from now ${fmt(chartSpot)}`}</span>}
                                                                    </>);
                                                                }} />
                                                            <Legend wrapperStyle={{ fontSize: ct.type['4xs'] }} />
                                                            <ReferenceLine y={0} stroke={ct.axis} />
                                                            {tpRupee != null && <ReferenceLine y={tpRupee} stroke={ct.status.good} strokeDasharray="5 4" ifOverflow="extendDomain" label={{ value: `TP ₹${fmt(tpRupee)}`, fontSize: ct.type['5xs'], fill: ct.status.good, position: 'right' }} />}
                                                            {slRupee != null && <ReferenceLine y={slRupee} stroke={ct.status.critical} strokeDasharray="5 4" ifOverflow="extendDomain" label={{ value: `SL ₹${fmt(slRupee)}`, fontSize: ct.type['5xs'], fill: ct.status.critical, position: 'right' }} />}
                                                            {chartStrikes.map(k => <ReferenceLine key={k} x={k} stroke={ct.grid} strokeDasharray="2 2" label={{ value: k, fontSize: ct.type['5xs'], fill: ct.text.muted, position: 'insideBottom' }} />)}
                                                            {pos.entrySpot && <ReferenceLine x={Math.round(pos.entrySpot)} stroke={ct.text.secondary} strokeDasharray="4 3" label={{ value: 'entry', fontSize: ct.type['5xs'], fill: ct.text.secondary, position: 'insideTopLeft' }} />}
                                                            {chartSpot && <ReferenceLine x={Math.round(chartSpot)} stroke={ct.mark.live} strokeWidth={2} label={{ value: 'now', fontSize: ct.type['4xs'], fill: ct.mark.live, position: 'top' }} />}
                                                            <Line type="monotone" name="expiry" dataKey="expiry" stroke={ct.mark.terminal} dot={false} strokeWidth={2} />
                                                            {pg && <Line type="monotone" name="now" dataKey="now" stroke={ct.mark.live} dot={false} strokeWidth={1.5} strokeDasharray="5 3" />}
                                                            {pg?.tPlus && <Line type="monotone" name="next open" dataKey="tPlus" stroke={ct.mark.projection} dot={false} strokeWidth={1.5} strokeDasharray="2 3" />}
                                                            {pg && chartSpot && chartNowPnl != null && <ReferenceDot x={Math.round(chartSpot)} y={pg.currentNowRupees} r={4} fill={ct.mark.live} stroke={ct.background} />}
                                                        </LineChart>
                                                    </ZoomableChart>
                                                    <div className="text-3xs text-fg-5 mt-0.5">
                                                        {pg ? '● dot = your P&L right now. ' : ''}MTM now <span className={!mtmStale && pos.lastMtm > 0 ? 'text-success' : !mtmStale && pos.lastMtm < 0 ? 'text-danger' : ''}>₹{fmt(chartNowPnl ?? 0)}</span>
                                                        {/* Every number on this chart is GROSS — say so, and put the net
                                                            beside it. The headline tile above shows NET, so an unlabelled
                                                            gross figure here reads as a contradiction. */}
                                                        <span className="text-fg-5"> gross</span>
                                                        {chartNetPnl != null && <> · net <span className={chartNetPnl > 0 ? 'text-success' : chartNetPnl < 0 ? 'text-danger' : ''}>₹{fmt(chartNetPnl)}</span>{chartCharges != null ? <span className="text-fg-5"> (chg ₹{fmt(chartCharges)})</span> : null}</>}
                                                        {offScale.length > 0 && (
                                                            <span className="text-warning/80" title="Outside the plotted range, so not drawn — showing it to scale would flatten the curve you came to read.">
                                                                {' · '}off-scale: {offScale.join(', ')}
                                                            </span>
                                                        )}
                                                        {' · '}max profit ₹{fmt(chartMaxP)}<span className="text-fg-5"> gross</span> · max loss {chartUnbounded || chartMaxL == null
                                                            ? <span className="text-danger font-bold">UNBOUNDED</span>
                                                            : <>₹{fmt(chartMaxL)}</>}
                                                        {!pg && <span className="text-fg-5"> · loading live T+0 curve…</span>}
                                                        {pg && pg.stale && <span className="text-warning"> · ⚠ mark {pg.mtmAgeMin}m old (market closed — quotes frozen, not live)</span>}
                                                    </div>
                                                    {/* ── NEXT-OPEN DECAY PROJECTION ────────────────────────
                                                        Deliberately shows the vega counterweight on the same
                                                        line as the theta number. For anything past ~2 DTE one
                                                        IV point outweighs a full day of decay, so a theta
                                                        projection printed alone is a misleading number. */}
                                                    {pg?.tPlus && (
                                                        <div className="mt-1 rounded border border-purple-800/40 bg-purple-950/20 p-1.5 text-3xs leading-relaxed">
                                                            <div className="text-purple-200">
                                                                <span className="font-semibold">If nothing moves</span>, at the next open
                                                                (<span className="text-fg-3">{pg.tPlus.dayKey}</span>
                                                                {pg.tPlus.skipped?.length ? <span className="text-fg-5"> · skips {pg.tPlus.skipped.map(x => x.why).join(' + ')}</span> : null})
                                                                {' → '}
                                                                <span className={pg.tPlus.decayRupees >= 0 ? 'text-success font-semibold' : 'text-danger font-semibold'}>
                                                                    {pg.tPlus.decayRupees >= 0 ? '+' : '−'}₹{fmt(Math.abs(pg.tPlus.decayRupees))}
                                                                </span>
                                                                <span className="text-fg-5"> from time decay alone</span>
                                                            </div>
                                                            <div className="text-fg-4">
                                                                But a <span className="text-warning" title="Vega of the still-open legs repriced AT THE NEXT TRADING OPEN, so it is smaller than the live vega shown on the card above — an option has less time value left after the gap. Same legs, same scale, different moment.">1-point IV move is worth ₹{fmt(Math.abs(pg.tPlus.bookVegaRupeesPerIvPt))} <span className="text-fg-5">at that open</span></span>
                                                                {Math.abs(pg.tPlus.bookVegaRupeesPerIvPt) > Math.abs(pg.tPlus.decayRupees)
                                                                    ? <span className="text-warning"> — more than this whole projection.</span>
                                                                    : '.'}
                                                                {' '}Overnight the index typically moves ±{fmt(pg.tPlus.sigmaOvernight)} pts, which this number ignores.
                                                            </div>
                                                            <div className="text-fg-5">
                                                                Decay counted as {pg.tPlus.businessDaysEquivalent} trading-days-equivalent, not {pg.tPlus.calendarDaysAhead} calendar days
                                                                (weekends decay slower than the clock). Gross, before charges. Only true at today&apos;s spot — the dotted purple line shows every other spot.
                                                                {pg.tPlus.multiExpiry && <span className="text-warning"> ⚠ multi-expiry structure: legs decay at different rates.</span>}
                                                                {pg.tPlus.calendarStale && <span className="text-warning"> ⚠ holiday calendar out of date — weekends only.</span>}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {/* P&L ACTIVITY — cumulative equity curve of every booked trade + live open MTM */}
                                            {activityOpen && (
                                                <div className="mb-2 border-t border-line-0 pt-2">
                                                    {!act ? (
                                                        <div className="text-3xs text-fg-5 py-3 text-center">{activityData?.data?.error ? 'could not load activity' : 'loading activity…'}</div>
                                                    ) : actSeries.length === 0 ? (
                                                        <div className="text-3xs text-fg-5 py-3 text-center">No booked trades yet — the equity curve appears after the first exit.</div>
                                                    ) : (<>
                                                        <div className="flex items-center justify-between text-3xs text-fg-4 mb-1 flex-wrap gap-x-3">
                                                            <span className="flex items-center gap-2">
                                                                <span className="text-violet-300">━ cumulative P&L</span>
                                                                <span className="text-fg-5">{act.summary.trades} trades · {act.summary.winRate}% win</span>
                                                                <span className={pnlTone(act.summary.realized)}>realized ₹{fmt(act.summary.realized)}</span>
                                                                {act.summary.openMtm != null && <span className={pnlTone(act.summary.openMtm)}>+ open ₹{fmt(act.summary.openMtm)} → ₹{fmt(act.summary.withOpen)}</span>}
                                                            </span>
                                                            <span className="text-fg-5">best ₹{fmt(act.summary.best)} · worst ₹{fmt(act.summary.worst)}</span>
                                                        </div>
                                                        <ZoomableChart data={actSeries} height={230}>
                                                            <LineChart margin={{ top: 8, right: 12, bottom: 2, left: 8 }}>
                                                                <CartesianGrid strokeDasharray="3 3" stroke={ct.gridSoft} />
                                                                <XAxis dataKey="i" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: ct.type['4xs'], fill: ct.text.secondary }} tickFormatter={(v) => `#${v}`} />
                                                                <YAxis tick={{ fontSize: ct.type['4xs'], fill: ct.text.secondary }} width={54} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
                                                                <Tooltip contentStyle={ct.tooltipStyle({ fontSize: ct.type['2xs'] })} cursor={{ stroke: ct.mark.equity, strokeDasharray: '3 3' }}
                                                                    formatter={(v, _n, _p) => [`₹${fmt(v)}`, 'cumulative']}
                                                                    labelFormatter={(l, pl) => { const pt = pl && pl[0] && pl[0].payload; return pt ? `trade #${pt.i} · ${istStr(pt.t, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${pt.open ? 'OPEN' : pt.reason} · this ₹${fmt(pt.net)}` : `#${l}`; }} />
                                                                <ReferenceLine y={0} stroke={ct.axis} />
                                                                <Line type="monotone" dataKey="cum" stroke={ct.mark.equity} strokeWidth={2}
                                                                    dot={(props) => { const { cx, cy, payload } = props; const col = payload.open ? ct.mark.live : (payload.net >= 0 ? ct.diverging.positive : ct.diverging.negative); return <circle key={payload.i} cx={cx} cy={cy} r={payload.open ? 4 : 3} fill={col} stroke={ct.background} strokeWidth={1} />; }} />
                                                            </LineChart>
                                                        </ZoomableChart>
                                                        <div className="text-3xs text-fg-5 mt-0.5">Each dot = one booked structure (green win / red loss); the line is running net P&L. {act.openPoint ? <span className="text-sky-300">Blue dot = current open structure’s unrealized MTM.</span> : ''}</div>
                                                    </>)}
                                                </div>
                                            )}
                                            {/* Entry timing + position detail (the trade's story) */}
                                            {open && pos.entryAt && (
                                                <div className="text-3xs font-mono text-fg-4 mb-2 space-y-0.5 border-t border-line-0 pt-1.5">
                                                    <div title={heldSessions != null ? `held = CALENDAR elapsed since entry (what the hold_days cap counts). ${heldSessions} trading session(s) touched — weekends/holidays age the position without a single tick.` : undefined}>
                                                        ⏱ <span className="text-fg-3">Entered {fmtClock(pos.entryAt)}</span> · held {fmtDur(pos.entryAt)}
                                                        {heldSessions != null && <span className="text-fg-5"> ({heldSessions} sess)</span>}
                                                        {pos.entryDir ? ` · dir ${pos.entryDir}` : ''}
                                                    </div>
                                                    <div>
                                                        spot@in {fmt(pos.entrySpot)}
                                                        {pos.origCredit != null && <> · net {pos.origCredit > 0 ? 'credit' : 'debit'} <span className="text-fg-3">₹{fmt(Math.abs(pos.origCredit), 1)}/u</span></>}
                                                        {Number.isFinite(pos.maxProfit) && pos.maxProfit != null && <> · maxP ₹{fmt(pos.maxProfit, 1)}/u</>}
                                                        {pos.marginEst > 0 && <> · margin ₹{fmt(pos.marginEst)}</>}
                                                    </div>
                                                    {expiry && <div>expiry {expiry}{dte != null ? ` · ${dte} DTE` : ''} · {pos.lots || d.lots} lot(s){pos.vegaEst != null ? ` · vega@in ₹${fmt(pos.vegaEst, 0)} (all legs, frozen)` : ''}</div>}
                                                    {exitBits.length > 0 && <div className="text-fg-5">manages to: {exitBits.join(' · ')}</div>}
                                                </div>
                                            )}
                                            {st === 'OPEN' && d.position?.legs?.length > 0 && (
                                                <div className="text-3xs font-mono text-fg-5 mb-2">
                                                    {d.position.legs.map((l, i) => <div key={i}>{l.action} {l.symbol?.split(':')[1]} @ ₹{l.entryPrice}{l.exitPrice ? ` → ₹${l.exitPrice}` : ''}</div>)}
                                                </div>
                                            )}
                                            {/* IDLE deployments: show what it's waiting for + config summary */}
                                            {!open && d.status === 'ACTIVE' && (
                                                <div className="text-3xs font-mono text-fg-5 mb-2 border-t border-line-0 pt-1.5">
                                                    flat — waiting for {d.entry_mode === 'signal' ? `a ${d.signal_strategy} signal` : `the ${P.entry_time || '09:20'} entry`}
                                                    {d.daily?.entered ? ' · already entered today' : ''}{exitBits.length ? ` · exits: ${exitBits.slice(0, 3).join(' · ')}` : ''}
                                                </div>
                                            )}
                                            {/* ── Full order detail (professional view) ── */}
                                            {detailOpen && (
                                                <div className="text-3xs mb-2 border-t border-line-0 pt-2 space-y-2">
                                                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-fg-4">
                                                        <div>Deployment <span className="text-fg-3">{d.name}</span></div>
                                                        <div>Created <span className="text-fg-3">{istDateTime(d.createdAt)}</span></div>
                                                        <div>Mode <span className={d.trade_mode === 'LIVE' ? 'text-danger' : 'text-sky-300'}>{d.trade_mode}</span> · {d.status}</div>
                                                        <div>Entry <span className="text-fg-3">{d.entry_mode === 'signal' ? `${d.signal_strategy}${P.use_signal_exit ? ' +exit' : ''}` : `time ${P.entry_time || '09:20'}`}</span></div>
                                                        {open && <><div>Entered <span className="text-fg-3">{istDateTime(pos.entryAt)}</span> · held {fmtDur(pos.entryAt)}{heldSessions != null ? ` (${heldSessions} sess)` : ''}</div>
                                                        <div>Entry spot <span className="text-fg-3">{fmt(pos.entrySpot)}</span>{pos.entryDir ? ` · dir ${pos.entryDir}` : ''}</div></>}
                                                    </div>
                                                    {open && pos.legs?.length > 0 && (
                                                        <div className="overflow-x-auto">
                                                            <table className="w-full font-mono text-fg-3">
                                                                <thead><tr className="text-fg-5 text-left"><th>Leg</th><th>Strike</th><th className="text-right">Qty</th><th className="text-right">Entry ₹</th><th className="text-right">Now/Exit</th><th>Filled</th><th>Status</th>{d.trade_mode === 'LIVE' && <th>OrderId</th>}</tr></thead>
                                                                <tbody>
                                                                    {pos.legs.map((l, i) => (
                                                                        <tr key={i} className="border-t border-line-0/60">
                                                                            <td className={l.action === 'BUY' ? 'text-success' : 'text-danger'}>{l.action} {l.type}</td>
                                                                            <td>{l.strike}{l.ratio > 1 ? ` ×${l.ratio}` : ''}</td>
                                                                            <td className="text-right">{l.qty}</td>
                                                                            <td className="text-right">{fmt(l.entryPrice, 2)}</td>
                                                                            <td className="text-right text-fg-5">{l.exitPrice ? fmt(l.exitPrice, 2) : '—'}</td>
                                                                            <td className="text-fg-5 whitespace-nowrap" title={l.filledAt ? `${istDateTimeSec(l.filledAt)} IST` : ''}>{l.filledAt ? istSmartSec(l.filledAt, pos.entryAt) : '—'}</td>
                                                                            <td className="text-fg-5">{l.status}</td>
                                                                            {d.trade_mode === 'LIVE' && <td className="text-fg-5 truncate max-w-[5.625rem]" title={l.orderId}>{l.orderId || '—'}</td>}
                                                                        </tr>
                                                                    ))}
                                                                    {pos.closedLegs?.map((l, i) => (
                                                                        <tr key={`c${i}`} className="border-t border-line-0/60 opacity-60">
                                                                            <td className={l.action === 'BUY' ? 'text-success' : 'text-danger'}>{l.action} {l.type}</td>
                                                                            <td>{l.strike}</td><td className="text-right">{l.qty}</td>
                                                                            <td className="text-right">{fmt(l.entryPrice, 2)}</td>
                                                                            <td className="text-right">{fmt(l.exitPrice, 2)}</td>
                                                                            <td className="text-fg-5 whitespace-nowrap" title={l.filledAt ? `${istDateTimeSec(l.filledAt)} IST` : ''}>{l.filledAt ? istSmartSec(l.filledAt, pos.entryAt) : '—'}</td>
                                                                            <td className="text-fg-5">{l.closeReason || l.status}</td>
                                                                            {d.trade_mode === 'LIVE' && <td className="text-fg-5">closed</td>}
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    )}
                                                    {open && (
                                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-0.5 font-mono text-fg-4">
                                                            <div>Net {isCredit ? 'credit' : 'debit'}<Help k="net-credit-debit" /> <span className="text-fg-3">₹{fmt(Math.abs(pos.origCredit), 1)}/u</span>{unitToRupee ? ` (₹${fmt(Math.abs(pos.origCredit) * unitToRupee)})` : ''}</div>
                                                            {Number.isFinite(pos.maxProfit) && <div>Max profit ₹{fmt(pos.maxProfit, 1)}/u{unitToRupee ? ` (₹${fmt(pos.maxProfit * unitToRupee)})` : ''}</div>}
                                                            <div>Margin<Help k="margin" /> <span className="text-fg-3">₹{fmt(pos.marginEst || 0)}</span></div>
                                                            <div className="text-success">TP level<Help k="tp-level" /> {rup(tpUnit)}{tpUnit != null && unitToRupee ? ` (${fmt(tpUnit,1)}/u)` : ''}</div>
                                                            <div className="text-danger">SL level<Help k="sl-level" /> {rup(slUnit)}{slUnit != null && unitToRupee ? ` (${fmt(slUnit,1)}/u)` : ''}</div>
                                                            {P.leg_sl_x > 0 && <div className="text-warning">leg-SL<Help k="leg-sl" /> @ entry ×{P.leg_sl_x}</div>}
                                                            <div>MTM now <span className={pos.lastMtm > 0 ? 'text-success' : pos.lastMtm < 0 ? 'text-danger' : 'text-fg-3'}>₹{fmt(pos.lastMtmRupees ?? 0)}</span></div>
                                                            {expiry && <div>Expiry {expiry} · {dte} DTE<Help k="dte" /></div>}
                                                            {proj ? (
                                                                <div className={`col-span-2 md:col-span-3 ${proj.overdue ? 'text-warning' : 'text-fg-4'}`}
                                                                    title={`Time-based close if price does nothing. Binding rule: ${proj.rule} (${proj.why}), due ${istDateTime(new Date(proj.at).toISOString())}.`
                                                                        + (proj.fires !== proj.at ? ` The engine only acts on a tick, so it fires at the next session open: ${istDateTime(new Date(proj.fires).toISOString())}.` : '')
                                                                        + (proj.others.length ? ` Then: ${proj.others.map(o => `${o.why} ${istDateTime(new Date(o.at).toISOString())}`).join(' · ')}.` : '')
                                                                        + ' TP/SL/early-exit can close it sooner.'}>
                                                                    Closes<Help k="projected-close" /> <span className={proj.overdue ? 'text-warning font-semibold' : 'text-fg-3'}>{istDateTime(new Date(proj.fires).toISOString())}</span>
                                                                    <span className="text-fg-5"> · {proj.why}</span>
                                                                    {proj.overdue
                                                                        ? <span className="text-warning"> · already tripped — closes at the next tick</span>
                                                                        : <span className="text-fg-5"> · in {fmtDurTo(proj.fires)}</span>}
                                                                    {proj.others.length > 0 && <span className="text-fg-5"> · then {proj.others[0].why}</span>}
                                                                </div>
                                                            ) : null}
                                                            {proj?.none && (
                                                                <div className="col-span-2 md:col-span-3 text-fg-5">Closes: no time-based rule that can fire — TP/SL only</div>
                                                            )}
                                                            {!proj && (
                                                                <div className="col-span-2 md:col-span-3 text-fg-5">Exit by: no time-based rule — TP/SL only</div>
                                                            )}
                                                            {/* Params that are SET but cannot close this structure. Shown because
                                                                the alternative is a card that quietly implies they can. */}
                                                            {proj?.noops?.length > 0 && (
                                                                <div className="col-span-2 md:col-span-3 text-warning/80">
                                                                    {proj.noops.map((t, i) => <div key={i}>⚠ {t}</div>)}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                    {!open && <div className="font-mono text-fg-5">Flat. Last daily P&L ₹{fmt(d.daily?.pnlToday)} · lifetime {d.totals?.trades || 0} trades ₹{fmt(d.totals?.netPnl)}. Config → {exitBits.join(' · ') || 'defaults'}.</div>}

                                                    {/* ── BROKER RECONCILIATION (LIVE only) ───────────────────
                                                        Does our book match the broker's? Per-leg: our recorded fill
                                                        vs trade-book VWAP vs net-position avg. Then P&L restated
                                                        gross (what the broker's unrealised P&L shows) vs net after
                                                        charges (what the ledger shows). */}
                                                    {isLive && open && depRecon?.id === d._id && (() => {
                                                        const R = depRecon.data || {};
                                                        if (R.error) return <div className="text-3xs text-danger border-t border-line-0 pt-1.5">Reconcile failed: {R.error}</div>;
                                                        if (R.notApplicable || R.empty) return null;
                                                        return (
                                                            <div className="border-t border-line-0 pt-2 space-y-1">
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <span className="text-3xs font-semibold text-fg-3">Broker reconciliation</span>
                                                                    {R.priceReconciled
                                                                        ? <span className="text-4xs px-1.5 py-0.5 rounded border border-emerald-700 text-success">✓ fills match broker</span>
                                                                        : <span className="text-4xs px-1.5 py-0.5 rounded border border-amber-600 text-warning">⚠ {R.mismatches || 0} leg(s) differ</span>}
                                                                    {R.mtmAgeMinutes != null && R.mtmAgeMinutes > 5 && <span className="text-4xs text-fg-5">mark {R.mtmAgeMinutes}m old</span>}
                                                                </div>
                                                                <div className="overflow-x-auto">
                                                                    <table className="w-full text-4xs font-mono text-fg-3">
                                                                        <thead><tr className="text-fg-5 text-left"><th>Leg</th><th className="text-right">Ours</th><th className="text-right">Broker VWAP</th><th className="text-right">Pos avg</th><th className="text-right">Drift</th><th>Source</th></tr></thead>
                                                                        <tbody>
                                                                            {(R.legs || []).map((l, i) => (
                                                                                <tr key={i} className="border-t border-line-0/60">
                                                                                    <td className={l.action === 'BUY' ? 'text-success' : 'text-danger'}>{l.action} {l.strike}</td>
                                                                                    <td className="text-right">{fmt(l.ourEntryPrice, 2)}</td>
                                                                                    <td className="text-right">{l.brokerVwap != null ? fmt(l.brokerVwap, 2) : '—'}</td>
                                                                                    <td className="text-right text-fg-5">{l.brokerAvgPrice != null ? fmt(l.brokerAvgPrice, 2) : '—'}</td>
                                                                                    <td className={`text-right ${l.material ? 'text-warning font-bold' : 'text-fg-5'}`}>{l.drift != null ? `${l.drift > 0 ? '+' : ''}${fmt(l.drift, 2)}` : '—'}</td>
                                                                                    <td className={l.priceSource === 'broker_vwap' ? 'text-success' : 'text-warning'} title={l.qtyMatch === false ? `qty/direction mismatch: broker net ${l.brokerNetQty}, expected ${l.action === 'BUY' ? '+' : '−'}${l.qty}` : ''}>{l.priceSource === 'broker_vwap' ? 'broker' : l.priceSource}{l.qtyMatch === false ? ' ⚠qty' : ''}</td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                                <div className="font-mono text-fg-4">
                                                                    {R.netRupees == null ? (
                                                                        <span className="text-warning">P&L restatement unavailable — no live marks for every leg (₹0 would read as “flat”, so nothing is shown).</span>
                                                                    ) : (<>
                                                                        P&L at our prices: gross <span className={R.grossRupees > 0 ? 'text-success' : R.grossRupees < 0 ? 'text-danger' : 'text-fg-3'}>₹{fmt(R.grossRupees)}</span>
                                                                        {' '}− charges ₹{fmt(R.chargesRupees)} = net <span className={R.netRupees > 0 ? 'text-success' : R.netRupees < 0 ? 'text-danger' : 'text-fg-3'}>₹{fmt(R.netRupees)}</span>
                                                                        {R.realizedLegRupees_informational ? <span className="text-fg-5" title="Realized P&L of legs already closed (e.g. a leg stop-loss). Shown for context — it is ALREADY inside the gross figure, not added to it.">{' '}(incl. ₹{fmt(R.realizedLegRupees_informational)} booked legs)</span> : null}
                                                                    </>)}
                                                                </div>
                                                                <div className="text-4xs text-fg-5">Broker unrealised P&L excludes charges → compare it to <span className="text-fg-4">gross</span>; compare your ledger to <span className="text-fg-4">net</span>.</div>
                                                                {(R.warnings || []).map((w, i) => <div key={i} className="text-4xs text-warning">⚠ {w}</div>)}
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            )}
                                            {d.lastError && <div className="text-3xs text-danger mb-2">⚠ {d.lastError}</div>}
                                            <div className="flex gap-1 flex-wrap">
                                                {d.status === 'ACTIVE'
                                                    ? <button onClick={() => depAction(d, open ? 'stop-close' : 'stop')} disabled={busy} aria-label={open ? `Stop and close ${d.name}` : `Stop ${d.name}`} className="px-2 py-0.5 rounded border border-amber-700/50 bg-amber-900/20 text-warning text-2xs hover:bg-amber-900/40 disabled:opacity-40"><StopCircle className="w-3 h-3 inline mr-0.5" />{open ? 'Stop + close' : 'Stop'}</button>
                                                    : <button onClick={() => depAction(d, 'start')} disabled={busy} aria-label={`Resume ${d.name}`} className="px-2 py-0.5 rounded border border-emerald-700/50 bg-emerald-900/20 text-success text-2xs hover:bg-emerald-900/40 disabled:opacity-40"><Play className="w-3 h-3 inline mr-0.5" />Resume</button>}
                                                {st === 'OPEN' && <button onClick={() => depAction(d, 'close')} disabled={busy} aria-label={`Close ${d.name} now`} className="px-2 py-0.5 rounded border border-red-700/50 bg-red-900/20 text-danger text-2xs hover:bg-red-900/40 disabled:opacity-40"><Square className="w-3 h-3 inline mr-0.5" />Close now</button>}
                                                {!open && <button onClick={() => depAction(d, 'delete')} disabled={busy} aria-label={`Delete ${d.name}`} className="px-2 py-0.5 rounded border border-line bg-slate-800 text-fg-4 text-2xs hover:text-danger disabled:opacity-40"><Trash2 className="w-3 h-3 inline mr-0.5" />Delete</button>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/*
                      Both cards are flex columns that FILL their grid cell, and the
                      scrolling region inside each is `flex-1 min-h-0`.

                      Before: the grid stretched both cards to the taller one (default
                      align-items: stretch), but the events list was capped at a fixed
                      300px, so it could not grow into the space it had been given —
                      leaving a large dead gap under it whenever the trades table was
                      long. The table meanwhile had no cap at all, so it set the row
                      height: 23 trades made it ~800px, and 200 would have made the page
                      unusable.

                      `min-h-0` is the load-bearing part — a flex item defaults to
                      min-height:auto, which floors it at content height and defeats
                      overflow. The cap is in `rem`, not px, so it scales with the Text
                      Size axis instead of clipping more rows as text grows.
                    */}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">
                        <div className="bg-surface rounded-xl border border-line p-4 flex flex-col max-h-[32rem]">
                            <div className="text-sm font-semibold text-fg mb-2">Engine events</div>
                            {mlDeps.events.length === 0 ? <div className="text-xs text-fg-5">No events yet.</div> : (
                                <div className="flex-1 min-h-0 overflow-y-auto text-2xs space-y-1">
                                    {mlDeps.events.map((e, i) => (
                                        <div key={i} className="flex flex-wrap gap-x-2 border-b border-line-0/60 pb-1">
                                            <span className="text-fg-5 whitespace-nowrap" title={istDateTimeSec(e.at) + ' IST'}>
                                                <span className="text-fg-5">{istDate(e.at)}</span> {istTimeSec(e.at)}
                                            </span>
                                            <span className={`font-semibold whitespace-nowrap ${/FAIL|ERROR|SKIP/.test(e.type) ? 'text-danger' : /ENTRY|EXIT/.test(e.type) ? 'text-success' : 'text-sky-300'}`}>{e.type}</span>
                                            <span className="text-fg-4 min-w-0 break-words">{e.name ? `[${e.name}] ` : ''}{e.message}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="bg-surface rounded-xl border border-line p-4 flex flex-col max-h-[32rem]">
                            <div className="text-sm font-semibold text-fg mb-2">Structure trades ({mlTrades.length})</div>
                            {mlTrades.length === 0 ? <div className="text-xs text-fg-5">No completed structure round-trips yet.</div> : (
                              <div className="flex-1 min-h-0 overflow-auto">
                                <table className="w-full text-2xs text-fg-3">
                                    {/* The header sticks now that the body scrolls — a
                                        column of bare rupee figures with the labels
                                        scrolled off is unreadable. */}
                                    <thead className="sticky top-0 z-10 bg-surface"><tr className="text-fg-5 text-left"><th>Entry</th><th>Exit</th><th>Name</th><th>Mode</th><th>Reason</th><th className="text-right">Gross ₹</th><th className="text-right">Charges</th><th className="text-right">Net ₹</th></tr></thead>
                                    <tbody>
                                        {mlTrades.map((t, i) => (
                                            /* A quarantined trade is shown, struck through, NOT hidden — it was
                                               booked on a price that never existed (an LTP carried over from
                                               another session on a contract with zero OI and zero volume), so
                                               its P&L is excluded from every total. Hiding it would make the
                                               correction invisible. */
                                            <tr key={i} className={`border-t border-line-0 ${t.quarantined ? 'opacity-45 line-through' : ''}`}
                                                title={t.quarantined ? `EXCLUDED from all totals — ${t.quarantineReason || 'untrustworthy fill price'}` : undefined}>
                                                <td className="whitespace-nowrap" title="Entry (IST)">{istDateTime(t.entryAt)}</td>
                                                <td className="whitespace-nowrap" title="Exit (IST) — date shown when it differs from entry">{istSmart(t.exitAt, t.entryAt)}<DayGap from={t.entryAt} to={t.exitAt} /></td>
                                                <td>{t.name}</td>
                                                <td className={t.trade_mode === 'LIVE' ? 'text-danger' : 'text-sky-300'}>{t.trade_mode}</td>
                                                <td className="text-fg-4">{t.exitReason}</td>
                                                <td className="text-right">₹{fmt(t.grossPnl)}</td>
                                                <td className="text-right text-fg-5">₹{fmt(t.charges)}</td>
                                                <td className={`text-right font-semibold ${t.quarantined ? 'text-fg-5' : t.netPnl > 0 ? 'text-success' : 'text-danger'}`}>
                                                    ₹{fmt(t.netPnl)}
                                                    {t.quarantined && <span className="ml-1 text-4xs text-warning no-underline" title="fake fill — not counted">⚠ void</span>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                              </div>
                            )}
                        </div>
                    </div>
                </>
            )}

            {mode === 'results' && (
                <div className="space-y-4">
                    {/* Filters */}
                    <div className="bg-surface rounded-xl border border-line p-4 flex flex-wrap items-end gap-3">
                        <div>
                            <div className="text-3xs text-fg-5 mb-0.5">Book</div>
                            <select value={resFilter.mode} onChange={e => setResFilter(f => ({ ...f, mode: e.target.value }))} className="bg-slate-800 border border-line rounded p-1 text-xs text-fg-2">
                                <option value="all">All books</option><option value="LIVE">LIVE only</option><option value="PAPER">PAPER only</option>
                            </select>
                        </div>
                        <div>
                            <div className="text-3xs text-fg-5 mb-0.5">Deployment</div>
                            <div className="flex items-center gap-1">
                                <select value={resFilter.deploymentId} onChange={e => selectResDeployment(e.target.value)}
                                    className={`bg-slate-800 border rounded p-1 text-xs text-fg-2 max-w-[11.25rem] ${resFilter.deploymentId !== 'all' ? 'border-primary' : 'border-line'}`}>
                                    <option value="all">All deployments</option>
                                    {resDeploymentOptions.map(o => <option key={o.id} value={o.id}>{o.name}{o.n ? '' : ' — no trades yet'}</option>)}
                                </select>
                                {resFilter.deploymentId !== 'all' && (
                                    <button onClick={() => selectResDeployment('all')} title="Show every deployment again"
                                        className="px-1.5 py-1 rounded border border-line bg-slate-800 text-3xs text-fg-4 hover:text-fg">✕ all</button>
                                )}
                            </div>
                        </div>
                        <div>
                            <div className="text-3xs text-fg-5 mb-0.5">Structure</div>
                            <select value={resFilter.template} onChange={e => setResFilter(f => ({ ...f, template: e.target.value }))} className="bg-slate-800 border border-line rounded p-1 text-xs text-fg-2">
                                <option value="all">All structures</option>
                                {[...new Set(resTrades.map(t => t.template))].filter(Boolean).map(k => <option key={k} value={k}>{templates.find(t => t.key === k)?.name || k}</option>)}
                            </select>
                        </div>
                        <div>
                            <div className="text-3xs text-fg-5 mb-0.5">Symbol</div>
                            <select value={resFilter.symbol} onChange={e => setResFilter(f => ({ ...f, symbol: e.target.value }))} className="bg-slate-800 border border-line rounded p-1 text-xs text-fg-2">
                                <option value="all">All symbols</option>
                                {[...new Set(resTrades.map(t => t.symbol))].filter(Boolean).map(s => <option key={s} value={s}>{shortSym(s)}</option>)}
                            </select>
                        </div>
                        <button onClick={refreshResults} className="ml-auto px-2 py-1 rounded border border-line bg-slate-800 text-xs text-fg-3 hover:text-fg flex items-center gap-1">
                            <RefreshCw className={`w-3 h-3 ${resLoading ? 'animate-spin' : ''}`} /> Refresh
                        </button>
                    </div>

                    {resFiltered.length === 0 ? (
                        <div className="bg-surface rounded-xl border border-line p-8 text-center text-sm text-fg-5">
                            {resLoading ? 'Loading…' : resDeploymentName ? (
                                <>
                                    No booked round-trips yet for <span className="text-fg-3">{resDeploymentName}</span>
                                    {(resFilter.mode !== 'all' || resFilter.template !== 'all' || resFilter.symbol !== 'all') ? ' with the current Book / Structure / Symbol filters' : ''}
                                    {' '}— its trades appear here after the first exit.{' '}
                                    <button onClick={() => selectResDeployment('all')} className="underline text-fg-4 hover:text-fg">Show all deployments</button>
                                </>
                            ) : 'No completed structure round-trips yet for this filter. Deploy a strategy (PAPER first) — booked structures show here.'}
                        </div>
                    ) : (
                        <>
                            {/* Server-computed analytics — KPIs, daily P&L, equity+drawdown
                                and every breakdown. See ResultsAnalytics for why the
                                arithmetic (quarantine exclusion, expectancy) lives on the
                                server and not here. */}
                            <ResultsAnalytics
                                tradeMode={resFilter.mode}
                                deploymentId={resFilter.deploymentId}
                                symbol={resFilter.symbol}
                                templateFilter={resFilter.template}
                                templates={templates} />

                            {/* How each day went, minute by minute — built from the
                                round-trips' own recorded paths, same filter as the table. */}
                            <div className="bg-surface rounded-xl border border-line p-4">
                                <DayEquityCurves days={resDayCurves.days} excluded={resDayCurves.excluded} markBasis="net-of-estimated-costs"
                                    emptyText="No booked round-trip in this filter to draw." />
                            </div>

                            {/* Trades table */}
                            <div className="bg-surface rounded-xl border border-line p-4 overflow-x-auto">
                                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                                    <div className="text-sm font-semibold text-fg">Structure round-trips ({resFiltered.length})</div>
                                    {(() => {
                                        const allOpen = resFiltered.every(t => resTradeOpen.has(resTradeId(t)));
                                        const anyOpen = resFiltered.some(t => resTradeOpen.has(resTradeId(t)));
                                        const btn = 'px-2 py-0.5 rounded border border-line bg-slate-800 text-3xs text-fg-3 hover:text-fg disabled:opacity-40';
                                        return (
                                            <div className="flex items-center gap-1">
                                                <button className={btn} disabled={allOpen} title="Open the legs, path chart and details of every round-trip below"
                                                    onClick={() => setResTradeOpen(new Set(resFiltered.map(resTradeId)))}>Expand all</button>
                                                <button className={btn} disabled={!anyOpen} onClick={() => setResTradeOpen(new Set())}>Collapse all</button>
                                            </div>
                                        );
                                    })()}
                                </div>
                                <table className="w-full text-2xs text-fg-3">
                                    <thead><tr className="text-fg-5 text-left">
                                        {/* Deployment is the SAME key the Deployment breakdown above
                                            groups on — without it a row here could not be matched to
                                            its line up there (Structure is only the template). */}
                                        <th></th><th>Entry → Exit</th><th>Deployment</th><th>Structure</th><th>Sym</th><th>Mode</th><th>Reason</th>
                                        <th className="text-right">Credit/u</th><th className="text-right">IVP@in</th>
                                        <th className="text-right" title="₹ blocked when the structure was opened. ~ = estimated (heuristic), no ~ = the broker's SPAN figure">Margin ₹</th>
                                        <th className="text-right">Gross ₹</th><th className="text-right">Chg</th><th className="text-right">Net ₹</th>
                                        <th className="text-right" title="Net P&L ÷ margin at entry — the return on the capital this structure tied up">Net ÷ margin</th>
                                    </tr></thead>
                                    <tbody>
                                        {[...resFiltered].sort((a, b) => new Date(b.exitAt) - new Date(a.exitAt)).map((t, _i) => {
                                            const tid = resTradeId(t);
                                            const openT = resTradeOpen.has(tid);
                                            const allLegs = [...(t.legs || []), ...(t.closedLegs || [])];
                                            const hasMargin = t.marginEst != null && Number(t.marginEst) > 0;
                                            const rom = tradeRom(t);
                                            return (
                                            <React.Fragment key={tid}>
                                            {/* A quarantined round-trip is STRUCK THROUGH, not filtered
                                                out: it was booked on a price that never existed, and hiding
                                                the correction would make this history a lie by omission.
                                                Every figure in the Analytics panel above already excludes it. */}
                                            <tr className={`border-t border-line-0 hover:bg-slate-800/40 cursor-pointer ${t.quarantined ? 'opacity-45 line-through' : ''}`}
                                                title={t.quarantined ? `EXCLUDED from all totals — ${t.quarantineReason || 'untrustworthy fill price'}` : undefined}
                                                onClick={() => setResTradeOpen(s => { const n = new Set(s); if (n.has(tid)) n.delete(tid); else n.add(tid); return n; })}>
                                                <td className="text-fg-5 w-4 no-underline">{openT ? '▲' : '▾'}</td>
                                                <td className="whitespace-nowrap" title={`Entry ${istDateTimeSec(t.entryAt)} → Exit ${istDateTimeSec(t.exitAt)} IST`}>{istSpan(t.entryAt, t.exitAt)}<DayGap from={t.entryAt} to={t.exitAt} /></td>
                                                <td className="truncate max-w-[12rem]" title={t.name || undefined}>{t.name || '—'}</td>
                                                <td className="truncate max-w-[7.5rem]" title={t.template}>{templates.find(x => x.key === t.template)?.name || t.template}</td>
                                                <td>{shortSym(t.symbol)}</td>
                                                <td className={t.trade_mode === 'LIVE' ? 'text-danger' : 'text-sky-300'}>{t.trade_mode}</td>
                                                <td className="text-fg-4">{t.exitReason}</td>
                                                <td className="text-right">{t.origCredit != null ? `₹${fmt(t.origCredit, 1)}` : '—'}</td>
                                                <td className="text-right text-fg-5"
                                                    title={t.ivpAtEntry != null ? 'IV percentile at entry (0-100) — the realized-vol rank the IV gate uses'
                                                        : 'Not recorded. Until 28-Sep the engine computed IV percentile only for deployments with an IV gate (min_ivp / max_ivp); every trade records it from then on.'}>
                                                    {t.ivpAtEntry != null ? fmt(t.ivpAtEntry, 0) : '—'}
                                                </td>
                                                <td className="text-right text-fg-4"
                                                    title={!hasMargin ? 'No margin was recorded for this trade'
                                                        : t.marginBasis === 'span' ? "The broker's SPAN margin when the structure was opened"
                                                            : "Estimated (heuristic) — the broker's SPAN figure was not available at entry"}>
                                                    {hasMargin ? `${t.marginBasis === 'span' ? '' : '~'}₹${fmt(t.marginEst)}` : '—'}
                                                </td>
                                                <td className="text-right">₹{fmt(t.grossPnl)}</td>
                                                <td className="text-right text-fg-5">₹{fmt(t.charges)}</td>
                                                <td className={`text-right font-semibold ${t.quarantined ? 'text-fg-5' : t.netPnl > 0 ? 'text-success' : 'text-danger'}`}>
                                                    ₹{fmt(t.netPnl)}
                                                    {t.quarantined && <span className="ml-1 text-4xs text-warning no-underline" title="fake fill — not counted">⚠ void</span>}
                                                </td>
                                                <td className={`text-right ${t.quarantined || rom == null ? 'text-fg-5' : rom > 0 ? 'text-success' : rom < 0 ? 'text-danger' : 'text-fg-4'}`}>
                                                    {rom == null ? '—' : `${fmt(rom, 2)}%`}
                                                </td>
                                            </tr>
                                            {openT && (
                                                <tr className="bg-slate-900/60"><td colSpan={14} className="p-2">
                                                    <div className="text-3xs text-fg-4 mb-1">Held {t.holdDays != null ? `${t.holdDays}d` : fmtDur(t.entryAt)} · spot {fmt(t.entrySpot)} → {fmt(t.exitSpot)} · net credit at entry ₹{fmt(t.origCredit, 1)}/u{t.lots ? ` · ${t.lots} lot(s)` : ''}</div>
                                                    {/* What it DID while open — MAE/MFE and the gave-back number.
                                                        Renders its own explanation for pre-feature trades. */}
                                                    <div className="mb-2"><TradePathChart trade={t} istTime={istTime} istDateTime={istDateTime} istSpan={istSpan} /></div>
                                                    {allLegs.length > 0 ? (
                                                        <table className="w-full text-3xs font-mono text-fg-3">
                                                            <thead><tr className="text-fg-5 text-left"><th>Leg</th><th>Strike</th><th className="text-right">Entry ₹</th><th className="text-right">Exit ₹</th><th>Close</th></tr></thead>
                                                            <tbody>{allLegs.map((l, j) => (
                                                                <tr key={j} className="border-t border-line-0/60">
                                                                    <td className={l.action === 'BUY' ? 'text-success' : 'text-danger'}>{l.action} {l.type}</td>
                                                                    <td>{l.strike}{l.ratio > 1 ? ` ×${l.ratio}` : ''}</td>
                                                                    <td className="text-right">{fmt(l.entryPrice, 2)}</td>
                                                                    <td className="text-right">{l.exitPrice != null ? fmt(l.exitPrice, 2) : '—'}</td>
                                                                    <td className="text-fg-5">{l.closeReason || l.reason || l.status || '—'}</td>
                                                                </tr>
                                                            ))}</tbody>
                                                        </table>
                                                    ) : <div className="text-3xs text-fg-5">No leg detail stored for this trade.</div>}
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
    // Hand-built SVG, so the same rule applies as for recharts: `stroke` is an
    // attribute, not a CSS property. Sign is carried by colour ALONE here (there
    // is no room for a label), which is exactly why it takes the CVD-safe
    // diverging pair rather than green/red.
    const ct = useChartTheme();
    if (!data || data.length < 2) return <span className="text-fg-5 text-4xs">—</span>;
    const ys = data.map(d => d.pnl);
    const min = Math.min(...ys, 0), max = Math.max(...ys, 0), rng = (max - min) || 1;
    const step = width / (data.length - 1);
    const pts = ys.map((y, i) => `${(i * step).toFixed(1)},${(height - ((y - min) / rng) * height).toFixed(1)}`).join(' ');
    const last = ys[ys.length - 1];
    const zeroY = (height - ((0 - min) / rng) * height).toFixed(1);
    return (
        <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
            <line x1="0" y1={zeroY} x2={width} y2={zeroY} stroke={ct.grid} strokeWidth="0.5" strokeDasharray="2 2" />
            <polyline points={pts} fill="none" stroke={last >= 0 ? ct.diverging.positive : ct.diverging.negative} strokeWidth="1.2" />
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
                <div key={t.id} className={`flex items-start gap-2 px-3 py-2 rounded-lg border shadow-lg text-xs ${t.kind === 'error' ? 'bg-red-950/90 border-red-700 text-danger' : t.kind === 'success' ? 'bg-emerald-950/90 border-emerald-700 text-success' : t.kind === 'warn' ? 'bg-amber-950/90 border-amber-700 text-warning' : 'bg-slate-900/95 border-line-2 text-fg-2'}`}>
                    <span className="flex-1 whitespace-pre-wrap">{t.msg}</span>
                    <button onClick={() => dismiss(t.id)} className="text-fg-4 hover:text-fg" aria-label="Dismiss">✕</button>
                </div>
            ))}
        </div>
    );
}

// Confirmation modal with optional type-to-confirm + a risk-summary body.
// NOTE: `body` must stay in this signature. Every call site passes the warning
// text as `body` (spread via {...confirmState}); it was missing from the
// destructure, so the entire risk disclosure — "sends REAL market exit orders",
// the shorts-bought-back-first ordering note, the PAPER-vs-LIVE sentence —
// rendered as an EMPTY div on every destructive dialog.
function ConfirmModal({ open, title, danger, confirmLabel = 'Confirm', requireText, onConfirm, onCancel, body, children }) {
    const [typed, setTyped] = React.useState('');
    React.useEffect(() => { if (open) setTyped(''); }, [open]);
    if (!open) return null;
    const ok = !requireText || typed.trim() === requireText;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" onKeyDown={e => e.key === 'Escape' && onCancel()}>
            <div className={`w-full max-w-md rounded-xl border p-4 ${danger ? 'border-red-700 bg-slate-900' : 'border-line-2 bg-slate-900'}`}>
                <div className={`text-sm font-bold mb-2 ${danger ? 'text-danger' : 'text-fg'}`}>{title}</div>
                <div className="text-xs text-fg-3 space-y-2 mb-3">{body || children}</div>
                {requireText && (
                    <label className="block text-2xs text-fg-4 mb-3">Type <span className="font-mono text-fg-2">{requireText}</span> to confirm
                        <input autoFocus value={typed} onChange={e => setTyped(e.target.value)}
                            className="w-full mt-1 bg-slate-800 border border-line rounded p-1.5 text-fg-2 font-mono" />
                    </label>
                )}
                <div className="flex justify-end gap-2">
                    <button onClick={onCancel} className="px-3 py-1.5 rounded border border-line-2 bg-slate-800 text-fg-3 text-xs hover:text-fg">Cancel</button>
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
    return (<div className="flex justify-between"><span className="text-fg-5">{k}</span><span className={`font-mono ${cls || 'text-fg-2'}`}>{v}</span></div>);
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
                <div className="text-sm font-bold text-danger mb-1">🔴 Deploy “{need}” LIVE — confirm risk</div>
                <div className="text-2xs text-fg-4 mb-3">Real broker orders · {deployLots} lot(s) · marketable-limit, hedges first. Review before confirming.</div>
                {loading ? <div className="text-xs text-fg-4 py-6 text-center">Pricing the structure at the live chain…</div>
                    : data?.error ? <div className="text-xs text-danger py-4">Preview failed: {data.error}<div className="text-fg-5 mt-1">(needs live market hours + a valid chain). You can still deploy, but you’ll be doing so blind.</div></div>
                    : data ? (
                        <div className="space-y-2 text-xs">
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                <Row k="Structure" v={data.name} />
                                <Row k="Spot" v={fmt(data.spot)} />
                                <Row k="Net credit" v={`₹${fmt(data.creditRupees)} (${fmt(data.creditPerUnit, 1)}/u)`} cls={data.creditRupees >= 0 ? 'text-success' : 'text-warning'} />
                                <Row k="Margin (est)" v={`₹${fmt(data.marginEst)}${data.marginBasis === 'span' ? ' (SPAN)' : ''}`} cls={data.fundsOk === false ? 'text-danger' : ''} />
                                <Row k="Max profit" v={data.maxProfit != null ? `₹${fmt(data.maxProfit)}` : '∞'} cls="text-success" />
                                <Row k="Max loss" v={data.maxLoss != null ? `₹${fmt(data.maxLoss)}` : 'UNLIMITED'} cls={data.maxLoss != null ? 'text-danger' : 'text-danger font-bold'} />
                                <Row k="Break-evens" v={data.breakevens?.length ? data.breakevens.map(b => fmt(b)).join(' / ') : '—'} />
                                <Row k="Prob. of profit" v={data.pop != null ? `${data.pop}%` : '—'} cls={data.pop >= 50 ? 'text-success' : 'text-warning'} />
                                <Row k="Expected move (±1σ)" v={`±${fmt(data.expectedMove)} (${data.dte}DTE)`} />
                                <Row k="ATM IV" v={`${data.ivAtmPct}%`} />
                            </div>
                            {data.unbounded && <div className="text-2xs text-danger border border-red-800 rounded p-1.5">⚠ UNDEFINED tail risk — this structure can lose without limit unless leg-SL / structure-SL are set.</div>}
                            {data.fundsOk === false && <div className="text-2xs text-danger border border-red-800 rounded p-1.5">⛔ Insufficient funds — needs ₹{fmt(data.marginEst)} margin but only ₹{fmt(data.fundsAvailable)} available. A LIVE deploy will be refused.</div>}
                            {Array.isArray(data.lint) && data.lint.length > 0 && (
                                <div className="space-y-1">
                                    <div className="text-3xs uppercase tracking-wide text-fg-5">Pre-deploy review</div>
                                    {data.lint.map((l, i) => (
                                        <div key={i} className={`text-2xs rounded px-1.5 py-1 border ${l.level === 'danger' ? 'text-danger border-red-800 bg-red-950/20' : l.level === 'warn' ? 'text-warning border-amber-800/60 bg-amber-950/10' : 'text-fg-4 border-line bg-slate-800/30'}`}>
                                            {l.level === 'danger' ? '⛔' : l.level === 'warn' ? '⚠' : 'ℹ'} {l.msg}
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="text-3xs font-mono text-fg-5">{data.legs?.map((l, i) => <span key={i} className={l.action === 'BUY' ? 'text-success' : 'text-danger'}>{l.action} {l.strike}{l.type} @{fmt(l.premium, 1)}{i < data.legs.length - 1 ? ' · ' : ''}</span>)}</div>
                        </div>
                    ) : null}
                <label className="block text-2xs text-fg-4 mt-3 mb-3">Type <span className="font-mono text-fg-2">{need}</span> to place LIVE orders
                    <input autoFocus value={typed} onChange={e => setTyped(e.target.value)} className="w-full mt-1 bg-slate-800 border border-line rounded p-1.5 text-fg-2 font-mono" />
                </label>
                <div className="flex justify-end gap-2">
                    <button onClick={onCancel} className="px-3 py-1.5 rounded border border-line-2 bg-slate-800 text-fg-3 text-xs hover:text-fg">Cancel</button>
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
    return <span className="text-warning ml-1" title={`Held across ${n} calendar day${n > 1 ? 's' : ''} — exit is NOT the same day as entry`}>+{n}d</span>;
}
// Expiry-payoff curve of the CURRENTLY-OPEN legs (computed from actual fills,
// so it's correct even for a partially-closed structure — closed-leg P&L folds
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

/** Same shape as fmtDur but forward-looking (time UNTIL a future instant). */
function fmtDurTo(ms) {
    if (!Number.isFinite(ms)) return '';
    const d = ms - Date.now();
    if (d <= 0) return 'now';
    const m = Math.floor(d / 60000);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
}

// ── HOLD / EXIT-DEADLINE PROJECTION ──────────────────────────────────────────
// `held` is CALENDAR elapsed time (that is also exactly what the engine's
// hold_days cap counts: `(now - entryAt)/86400e3 >= hold_days`). Over a weekend
// those two diverge sharply from what a trader feels — a Wednesday entry reads
// "2d" on Friday morning and "4d" on Sunday without a single session passing.
// So we show the session count next to it: a 4-calendar-day-old position that
// has only traded 2 sessions is NOT the same risk, but it IS equally aged-out
// as far as hold_days is concerned. Weekends only (no NSE holiday calendar on
// the client) — holidays make the real session count a touch lower.

const IST_MS = 5.5 * 3600e3;
/** IST calendar-day index (days since epoch, IST). */
const istDay = (ms) => Math.floor((ms + IST_MS) / 86400e3);
/** 0=Sun … 6=Sat, in IST. */
const istDow = (ms) => new Date(ms + IST_MS).getUTCDay();
/** IST midnight (as a UTC ms instant) of the day containing `ms`. */
const istMidnight = (ms) => istDay(ms) * 86400e3 - IST_MS;
/** Trading sessions (Mon–Fri) touched between two instants, inclusive of both ends. */
function sessionsBetween(aMs, bMs) {
    if (!Number.isFinite(aMs) || !Number.isFinite(bMs) || bMs < aMs) return null;
    let n = 0;
    for (let d = istDay(aMs); d <= istDay(bMs); d++) {
        const dow = istDow(d * 86400e3 - IST_MS);
        if (dow !== 0 && dow !== 6) n++;
    }
    return n;
}
/**
 * The engine only acts on a tick, and ticks only happen inside a session. A
 * deadline that lands on a Saturday/Sunday/after-hours does NOT fire then — it
 * fires at the first tick of the next session. Snap forward so the projected
 * close is the instant the engine will actually pull the trigger.
 */
// Derived, so the projection can never claim the engine has stopped ticking
// while it is still managing risk. The engine's bound is the DERIVATIVES close
// (15:40 since 3-Aug-2026); a hard-coded 15:30 pushed any 15:30-15:40 deadline
// to the following day.
const SESSION_OPEN_MIN = riskOpenMin('NSE') + 1;   // isSessionOpen() lower bound, IST
const SESSION_CLOSE_MIN = riskCloseMin('NSE');
function nextTickAfter(ms) {
    if (!Number.isFinite(ms)) return null;
    let t = ms;
    for (let guard = 0; guard < 10; guard++) {
        const dow = istDow(t), mins = Math.floor((t - istMidnight(t)) / 60000);
        if (dow === 0 || dow === 6) { t = istMidnight(t) + 86400e3; continue; }   // weekend → next day 00:00
        if (mins < SESSION_OPEN_MIN) return istMidnight(t) + SESSION_OPEN_MIN * 60000;
        if (mins > SESSION_CLOSE_MIN) { t = istMidnight(t) + 86400e3; continue; } // after close → next day
        return t;
    }
    return t;
}
/**
 * When will this structure close if NOTHING moves? Mirrors the time-based exits
 * in exits.js `_monitor` (hold_days / dte_exit / expiry-day 15:00 / square_off)
 * and returns the EARLIEST — the one that actually binds. TP/SL can of course
 * close it sooner; this is the "no further price action" deadline, which is
 * knowable the moment we enter and so should never be a mystery on the card.
 */
function projectExit(pos, P, expiry, { intraday = false } = {}) {
    if (!pos?.entryAt) return null;
    const entry = new Date(pos.entryAt).getTime();
    if (!Number.isFinite(entry)) return null;
    const cands = [];
    // Params that are SET but cannot close this structure. Printing one of them
    // as a deadline is the worst kind of wrong: it names a date and a time.
    const noops = [];
    const sqMins = (() => {
        const [h, m] = String(P.square_off || '').split(':').map(Number);
        return Number.isFinite(h) ? (h * 60 + (m || 0)) * 60000 : null;
    })();

    // hold_days is CALENDAR days from entry (exits.js heldDays), so a weekend
    // ages it out; nextTickAfter() rolls the firing instant to the next open.
    if (P.hold_days > 0) cands.push({ at: entry + Number(P.hold_days) * 86400e3, rule: 'HOLD_CAP', why: `hold cap ${P.hold_days}d` });
    if (expiry) {
        const expClose = new Date(expiry + 'T15:30:00+05:30').getTime();   // exits.js minDte reference
        // dte_exit ≈ 0 is UNREACHABLE: DTE only decays to 0 at 15:30, but the
        // expiry-day close fires at 15:00 first. The engine warns about it with
        // a CONFIG event; the card must not quote it as a deadline either.
        if (P.dte_exit != null && Number(P.dte_exit) >= 0.03) {
            cands.push({ at: expClose - Number(P.dte_exit) * 86400e3, rule: 'DTE_EXIT', why: `DTE≤${P.dte_exit}` });
        } else if (P.dte_exit != null) {
            noops.push(`DTE≤${P.dte_exit} can never fire — DTE reaches 0 only at 15:30, but the expiry-day close is 15:00`);
        }
        cands.push({ at: new Date(expiry + 'T15:00:00+05:30').getTime(), rule: 'EXPIRY_DAY', why: 'expiry-day 15:00' });
        // clamp_hold_to_expiry (opt-in): the hold ends at the square-off on the
        // day BEFORE expiry instead of riding into the expiry-day 15:00 close.
        if (P.clamp_hold_to_expiry === true && !intraday && sqMins != null) {
            const dayBefore = istMidnight(new Date(expiry + 'T12:00:00+05:30').getTime() - 86400e3);
            cands.push({ at: dayBefore + sqMins, rule: 'HOLD_CAP_EXPIRY', why: `clamp to expiry (sq-off ${P.square_off} the day before)` });
        }
    }
    // SQUARE_OFF closes the structure ONLY for intraday templates — exits.js
    // gates it on `tpl.intraday`. On a positional structure the same param only
    // bounds the ENTRY window and supplies the time-of-day for the clamp above.
    // Measured 4-Sep-2026: this card told a LIVE iron butterfly it would close
    // at 15:10 that day; the engine had no such rule, and the rule that did
    // bind (hold cap) landed on a Sunday.
    if (sqMins != null) {
        if (intraday) cands.push({ at: istMidnight(Date.now()) + sqMins, rule: 'SQUARE_OFF', why: `sq-off ${P.square_off}` });
        else noops.push(`sq-off ${P.square_off} does not close this structure — it is positional, so the square-off only bounds the entry window`);
    }

    const valid = cands.filter(c => Number.isFinite(c.at));
    if (!valid.length) return noops.length ? { none: true, noops } : null;
    const win = valid.reduce((a, b) => (b.at < a.at ? b : a));
    const fires = nextTickAfter(win.at);
    // "overdue" = the DEADLINE has passed, even though the engine cannot act
    // until the next tick. That gap is exactly what a weekend creates, and it
    // is the state a trader most needs flagged: the close is already decided.
    return { ...win, at: win.at, fires, overdue: win.at <= Date.now(), noops, others: valid.filter(c => c !== win).sort((a, b) => a.at - b.at) };
}

/**
 * Inline "?" help. Click to open a plain-language explanation of the number it
 * sits next to — what it means, how THIS system computes it, and the way it is
 * most often misread. Copy lives in ../data/multilegHelp.js.
 *
 * Deliberately click-to-open rather than hover-only: hover tooltips are
 * unreachable on touch and vanish while you are still reading them.
 */
function Help({ k, className = '' }) {
    const [open, setOpen] = React.useState(false);
    const h = HELP[k];
    if (!h) return null;
    return (
        <span className={`relative inline-block align-middle ${className}`}>
            <button type="button"
                onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
                onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
                aria-label={`What does "${h.label}" mean?`}
                aria-expanded={open}
                className="hit-target ml-1 w-3.5 h-3.5 rounded-full border border-line-2 text-fg-5 hover:text-sky-300 hover:border-sky-500 text-4xs leading-none align-middle">?</button>
            {open && (
                <>
                    <span className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
                    <span role="tooltip"
                        className="absolute z-50 left-0 top-5 w-72 rounded-lg border border-line-2 bg-slate-900 p-2.5 shadow-xl text-left normal-case font-normal tracking-normal block">
                        <span className="block text-2xs font-semibold text-sky-200 mb-1">{h.label}</span>
                        <span className="block text-2xs text-fg-2 mb-1.5">{h.short}</span>
                        <span className="block text-3xs text-fg-4 leading-relaxed">{h.detail}</span>
                        {h.gotcha && (
                            <span className="block text-3xs text-warning/90 leading-relaxed mt-1.5 pt-1.5 border-t border-line">
                                <span className="font-semibold">Watch out: </span>{h.gotcha}
                            </span>
                        )}
                    </span>
                </>
            )}
        </span>
    );
}

function Tile({ label, value, good, bad, small, help, title }) {
    return (
        <div className="bg-slate-800/60 border border-line rounded p-2" title={title}>
            <div className="text-3xs text-fg-5">{label}{help ? <Help k={help} /> : null}</div>
            <div className={`${small ? 'text-3xs' : 'text-sm font-semibold'} ${good ? 'text-success' : bad ? 'text-danger' : 'text-fg-2'}`}>{value}</div>
        </div>
    );
}

// Book cost — the REAL bid/ask spread you pay on this symbol, measured from
// 106k+ archived quotes rather than assumed. This exists because the backtester
// used to price every symbol at a flat 0.50% half-spread: that flattered BANKEX
// so badly (real ATM 2.78%, real 1-2% wing 17.54%) that a -₹739/trade strangle
// backtested at +₹4,473. Loads automatically — an invisible cost is the whole
// problem, so it must not be behind a button.
const GRADE_STYLE = {
    good: 'text-success border-emerald-700/50 bg-emerald-950/20',
    fair: 'text-sky-300 border-sky-700/50 bg-sky-950/20',
    poor: 'text-warning border-amber-700/50 bg-amber-950/10',
    untradeable: 'text-danger border-red-700/50 bg-red-950/25',
    unknown: 'text-fg-4 border-line-2 bg-slate-800/40',
};
const GRADE_NOTE = {
    good: 'tight book — spread costs are negligible here',
    fair: 'workable, but wings cost real money',
    poor: 'wide book — the spread eats a meaningful slice of every credit',
    untradeable: 'the market maker takes more than the strategy makes — do not trade short premium here',
    unknown: 'not measured yet — costs fall back to the old flat 0.50% assumption',
};
function BookCost({ symbol }) {
    // The result carries the symbol it belongs to, so switching instruments
    // DERIVES an empty panel rather than clearing it with a synchronous setState
    // inside the effect (which lints as a cascading render, and would briefly
    // paint the previous symbol's cost against the new symbol's name).
    const [res, setRes] = useState({ sym: null, data: null, err: null });
    useEffect(() => {
        let dead = false;
        axios.get(`${API_URL}/multileg/liquidity`, { params: { symbol, live: 1 } })
            .then(r => { if (!dead) setRes({ sym: symbol, data: r.data?.symbols?.[0] || null, err: null }); })
            .catch(e => { if (!dead) setRes({ sym: symbol, data: null, err: e.response?.data?.error || e.message }); });
        return () => { dead = true; };
    }, [symbol]);
    const fresh = res.sym === symbol;
    const d = fresh ? res.data : null;
    const err = fresh ? res.err : null;
    if (err || !d) return null;
    const g = d.grade || 'unknown';
    const bad = g === 'untradeable' || g === 'poor';
    return (
        <div className={`rounded-lg border p-2.5 mb-3 ${bad ? 'border-red-800/60 bg-red-950/15' : 'border-line bg-slate-800/30'}`}>
            <div className="flex items-center justify-between flex-wrap gap-1">
                <span className="text-xs font-semibold text-fg-2">
                    💸 Book cost<Help k="book-cost" /> <span className="text-fg-5 font-normal">— what the market maker takes before you make anything</span>
                </span>
                <span className={`text-3xs px-2 py-0.5 rounded border font-semibold uppercase ${GRADE_STYLE[g]}`}>{g}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-3xs mt-2">
                <Tile label="Spread at ATM" value={`${d.atmPct?.toFixed(2)}%`} small good={d.atmPct <= 0.20} bad={d.atmPct > 1.5} />
                <Tile label="Spread on wings" value={`${d.wingPct?.toFixed(2)}%`} small good={d.wingPct <= 0.35} bad={d.wingPct > 2} />
                <Tile label="Round trip cost" value={`${d.roundTripPctOfPremium}% of premium`} small bad={d.roundTripPctOfPremium > 5} />
                <Tile label="Live ATM now" value={d.live?.cePct != null ? `${d.live.cePct}% / ${d.live.pePct ?? '—'}%` : '—'} small />
            </div>
            <div className={`text-3xs mt-1.5 ${bad ? 'text-danger' : 'text-fg-5'}`}>
                {bad ? '⚠ ' : ''}{GRADE_NOTE[g]}
                {d.live?.ageSec != null && <span className="text-fg-5"> · live quote {Math.round(d.live.ageSec / 60)}m old</span>}
            </div>
            {!d.measured && <div className="text-4xs text-fg-5 mt-1">No archived quotes for this symbol yet — backtests use the 0.50% fallback, which may be badly wrong in either direction.</div>}
        </div>
    );
}

// Market Read — fuses price momentum with option-seller positioning (OI / PCR /
// max-pain / walls) into a directional bias for the selected symbol, with a
// one-click "load the fitting structure" button. On-demand (hits the broker).
const BIAS_STYLE = { bullish: 'text-success border-emerald-700/50 bg-emerald-950/20', bearish: 'text-danger border-red-700/50 bg-red-950/20', neutral: 'text-warning border-amber-700/50 bg-amber-950/10' };
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
        <div className="rounded-lg border border-line bg-slate-800/30 p-2.5 mb-3">
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-fg-2">🧭 Market read <span className="text-fg-5 font-normal">— momentum + where the sellers are</span></span>
                <button onClick={load} disabled={loading} className="text-3xs px-2 py-0.5 rounded border border-line-2 bg-slate-800 text-fg-3 hover:text-fg disabled:opacity-40">{loading ? 'reading…' : data ? 'refresh' : 'read now'}</button>
            </div>
            {err && <div className="text-2xs text-danger mt-1.5">{err}</div>}
            {data && (
                <div className="mt-2 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap text-2xs">
                        <span className={`px-2 py-0.5 rounded border font-semibold uppercase ${BIAS_STYLE[data.bias] || ''}`}>{data.bias} · {data.confidence}</span>
                        <span className="text-fg-5">{data.summary}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-3xs">
                        <Tile label="Momentum" value={data.momentum?.dir || '—'} small good={data.momentum?.dir === 'up'} bad={data.momentum?.dir === 'down'} />
                        <Tile label="Sellers (PCR)" value={data.sellers?.pcr != null ? `${data.sellers.tilt} · ${data.sellers.pcr}` : (data.sellers?.tilt || '—')} small />
                        <Tile label="Support / Resist" value={`${data.support ?? '—'} / ${data.resistance ?? '—'}`} small />
                        <Tile label="Max pain / spot" value={`${data.sellers?.maxPain ?? '—'} / ${data.spot ?? '—'}`} small />
                    </div>
                    {data.suggested && (
                        <div className="flex items-center gap-2 text-2xs text-fg-4">
                            <span>→ {data.suggested.note}</span>
                            {preset && <button onClick={() => onApplyPreset(preset)} className="text-3xs px-2 py-0.5 rounded border border-primary/40 bg-primary/15 text-primary-ink hover:bg-primary/25">Load {preset.name}</button>}
                        </div>
                    )}
                    <div className="text-4xs text-fg-5">A read, not a guarantee — momentum can flip and OI is a snapshot. Confirm with a backtest before deploying.</div>
                </div>
            )}
        </div>
    );
}
