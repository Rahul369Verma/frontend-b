import React, { useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Play, TrendingUp, AlertTriangle, Code, ChevronDown, ChevronRight, Check, Trophy, Square, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useGlobalState } from '../context/GlobalContext';
import { io } from 'socket.io-client';
import { INSTRUMENT_CONFIG } from '../constants';
import { fetchExpiriesForSymbol } from '../utils/expiryUtils';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// localStorage key holding the jobId of an in-flight optimization, so a page
// refresh can rejoin the run (or pick up its result if it finished meanwhile).
const OPT_JOB_KEY = 'optimizerActiveJobId';
// localStorage key holding the LAST completed optimizer result, so it survives a
// refresh indefinitely (until the user clicks Clear) — independent of the
// backend's short-lived job retention.
const OPT_RESULT_KEY = 'optimizerLastResult';

// Friendly resolution labels for display.
const RESOLUTION_LABELS = {
  '1': '1 Min', '3': '3 Min', '5': '5 Min', '15': '15 Min', '30': '30 Min', '60': '1 Hour', 'D': 'Daily',
};

// Param keys that are universal/noise and should NOT be shown as a strategy's
// "tuned" parameters in the results view.
const NOISE_PARAM_KEYS = new Set([
  'isOptimizer', 'strategy', 'strategies', 'symbol', 'start_date', 'end_date', 'startDate', 'endDate',
  'capital', 'lots', 'lot_size', 'resolution', 'backtest_mode', 'dataSource', 'futures_expiry',
  'slippage_percent', 'brokerage_per_order', 'max_slippage_percent',
  'trade_start_time', 'trade_end_time', 'max_daily_loss', 'max_trades_per_day',
  'minTrades', 'minWinRate', 'maxDrawdown', 'minSharpeRatio',
  'min_trades', 'min_win_rate', 'max_drawdown', 'min_sharpe_ratio', 'stop_on_match',
  'use_ai_prediction', 'DISABLE_RANDOMIZATION', 'signal',
]);

const prettify = (key) =>
  String(key).split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const fmtPnL = (v) => {
  const n = Number(v || 0);
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};
const fmtScore = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(2));
const fmtPF = (v) => {
  // Infinity (all-wins) serializes to null over JSON.
  if (v == null) return '∞';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : '∞';
};

export default function Optimizer() {
  const navigate = useNavigate();
  const {
    optimizerParams: config,
    setOptimizerParams: setConfig,
    optimizerResult: results,
    setOptimizerResult: setResults,
    setBacktestParams
  } = useGlobalState();

  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  // Collapse the left Parameters panel so the results table takes full width.
  const [configCollapsed, setConfigCollapsed] = useState(() => {
    try { return localStorage.getItem('optimizer:configCollapsed') === '1'; }
    catch { return false; }
  });
  const toggleConfigCollapsed = () => {
    setConfigCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('optimizer:configCollapsed', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };
  const [selectedResult, setSelectedResult] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, matches: 0 });
  const [stopOnMatch, setStopOnMatch] = useState(false);
  const [stopping, setStopping] = useState(false);
  const jobIdRef = useRef(null);
  const pollTimerRef = useRef(null);   // active /status poll timer
  const runTokenRef = useRef(0);       // invalidates stale pollers when a new run/resume starts
  const lastSocketTsRef = useRef(0);   // last time a live progress event arrived (socket-detected runs)

  const [instrumentConfig, setInstrumentConfig] = useState({});
  const [expiryDates, setExpiryDates] = useState([]); // For Options/Futures Expiry Selection
  const [catalog, setCatalog] = useState([]); // [{ id, label, optimizable }]
  const [stratOpen, setStratOpen] = useState(false);
  const [expandedStrategy, setExpandedStrategy] = useState(null);
  const stratRef = useRef(null);

  const selectedStrategies = Array.isArray(config.strategies) && config.strategies.length
    ? config.strategies
    : (config.strategy ? [config.strategy] : []);

  const catalogMap = useMemo(() => {
    const m = {};
    catalog.forEach(c => { m[c.id] = c; });
    return m;
  }, [catalog]);

  const labelFor = (id) => catalogMap[id]?.label || prettify(id);

  React.useEffect(() => {
    if (!config.symbol) return;
    let cancelled = false;

    const loadExpiries = async () => {
      const expiries = await fetchExpiriesForSymbol(config.symbol, 4, 1);
      if (cancelled) return;
      setExpiryDates(expiries);
      if (expiries.length > 0) {
        setConfig(c => ({ ...c, futures_expiry: expiries.find(e => !e.isPast)?.date || expiries[0].date }));
      }
    };

    loadExpiries();
    return () => { cancelled = true; };
  }, [config.symbol]);

  React.useEffect(() => {
    // withCredentials sends the dash_session cookie on the WS handshake so
    // the server-side io.use() auth middleware accepts the connection.
    const socket = io(API_URL, { withCredentials: true });

    socket.on('optimization_progress', (data) => {
      setProgress(data);
      lastSocketTsRef.current = Date.now();
      // Live progress is arriving but THIS tab isn't tracking a job (e.g. the
      // run was started elsewhere, the connection had dropped, or the backend
      // predates the /active endpoint). Surface it from the socket stream.
      if (!jobIdRef.current) setRunning(true);
    });

    // Watchdog: socket-detected runs have no completion event, so if progress
    // stops arriving for a while, assume the run ended and drop the spinner.
    const watchdog = setInterval(() => {
      if (!jobIdRef.current && lastSocketTsRef.current && (Date.now() - lastSocketTsRef.current > 60000)) {
        lastSocketTsRef.current = 0;
        setRunning(false);
      }
    }, 10000);

    // Use static instruments
    setInstrumentConfig(INSTRUMENT_CONFIG);

    // Fetch strategy catalog (id + label + optimizable flag) — drives the
    // multi-select so we never hard-code the strategy list.
    fetch(`${API_URL}/api/config/strategies/catalog`)
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setCatalog(data); })
      .catch(err => console.error('Failed to fetch strategy catalog', err));

    return () => { socket.disconnect(); clearInterval(watchdog); };
  }, []);

  // Close the strategy dropdown on outside click.
  React.useEffect(() => {
    const onClick = (e) => {
      if (stratRef.current && !stratRef.current.contains(e.target)) setStratOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const optimizableCatalog = catalog.filter(c => c.optimizable);

  const toggleStrategy = (id) => {
    setConfig(c => {
      const cur = Array.isArray(c.strategies) ? c.strategies : (c.strategy ? [c.strategy] : []);
      const next = cur.includes(id) ? cur.filter(s => s !== id) : [...cur, id];
      return { ...c, strategies: next, strategy: next[0] || c.strategy };
    });
  };

  const selectAllStrategies = () => {
    const all = optimizableCatalog.map(c => c.id);
    setConfig(c => ({ ...c, strategies: all, strategy: all[0] || c.strategy }));
  };
  const clearStrategies = () => setConfig(c => ({ ...c, strategies: [], strategy: undefined }));

  // Render a result payload (from a live run OR a resumed/refreshed one):
  // store it, then auto-expand + select the winning strategy's best set.
  // persist=true also writes it to localStorage so it survives a refresh.
  const applyResultData = (data, persist = true) => {
    setResults(data);
    if (persist) {
      try { localStorage.setItem(OPT_RESULT_KEY, JSON.stringify(data)); } catch { /* quota/private mode */ }
    }
    const groups = Array.isArray(data.strategies) ? data.strategies : null;
    if (groups && groups.length) {
      const winner = data.best_strategy
        ? groups.find(g => g.strategy === data.best_strategy)
        : groups[0];
      if (winner) {
        setExpandedStrategy(winner.strategy);
        if (winner.best) setSelectedResult(winner.best);
      }
    } else if (data.best_parameters && data.best_parameters.length > 0) {
      setSelectedResult(data.best_parameters[0]);
    }
  };

  // Clear the saved/displayed results (the only way results go away).
  const clearResults = () => {
    setResults(null);
    setSelectedResult(null);
    setExpandedStrategy(null);
    setError(null);
    try { localStorage.removeItem(OPT_RESULT_KEY); } catch { /* ignore */ }
  };

  // Hydrate the last result from localStorage on mount (after a refresh the
  // in-memory context is empty). Skip if a result is already in memory (e.g.
  // returning from another page) to avoid clobbering it.
  React.useEffect(() => {
    if (results) return; // already have one in context
    let saved = null;
    try { saved = localStorage.getItem(OPT_RESULT_KEY); } catch { /* ignore */ }
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (parsed && (parsed.strategies || parsed.best_parameters)) applyResultData(parsed, false);
    } catch { /* corrupt → ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Job polling (single source of truth for progress + completion) ────
  // The /analyze HTTP request can stay open for HOURS and WILL drop on long
  // runs (browser/proxy timeouts). So we never depend on it for the result —
  // we poll /status until the job reaches a terminal state. This makes a run
  // survive connection drops, refreshes, and even a different browser
  // (rejoined via the /active discovery endpoint).
  const stopPolling = () => {
    if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
  };

  const finishJob = (state, payload) => {
    stopPolling();
    setRunning(false);
    setStopping(false);
    jobIdRef.current = null;
    try { localStorage.removeItem(OPT_JOB_KEY); } catch { /* ignore */ }
    if (state === 'done' && payload) applyResultData(payload);
    else if (state === 'error') setError(payload || 'Optimization failed');
  };

  const pollJob = (jobId, token) => {
    jobIdRef.current = jobId;
    let notFound = 0;
    const tick = async () => {
      if (token !== runTokenRef.current) return; // superseded by a newer run/mount
      try {
        const r = await fetch(`${API_URL}/api/engine/optimizer/status/${jobId}`);
        const d = await r.json();
        if (token !== runTokenRef.current) return;
        if (d.status === 'running') {
          notFound = 0;
          setRunning(true);
          jobIdRef.current = jobId;
          if (d.progress) setProgress(p => ({ ...p, ...d.progress }));
          pollTimerRef.current = setTimeout(tick, 2000); // socket also streams live progress
        } else if (d.status === 'done') {
          finishJob('done', d.result);
        } else if (d.status === 'error') {
          finishJob('error', d.error);
        } else {
          // not_found — tolerate a brief registration race / backend blip; only
          // give up after a few consecutive misses.
          if (++notFound >= 3) finishJob('gone');
          else pollTimerRef.current = setTimeout(tick, 2000);
        }
      } catch {
        if (token === runTokenRef.current) pollTimerRef.current = setTimeout(tick, 3000); // retry
      }
    };
    tick();
  };

  const startOptimization = () => {
    if (!selectedStrategies.length) {
      setError('Select at least one strategy to optimize.');
      return;
    }
    // Unique id so Stop can cancel it and ANY page can rejoin it.
    const jobId = (window.crypto && window.crypto.randomUUID)
      ? window.crypto.randomUUID()
      : `opt_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const token = ++runTokenRef.current; // invalidate any prior poller
    stopPolling();
    jobIdRef.current = jobId;
    try { localStorage.setItem(OPT_JOB_KEY, jobId); } catch { /* private mode */ }

    setRunning(true);
    setStopping(false);
    setError(null);
    setResults(null);
    setSelectedResult(null);
    setExpandedStrategy(null);
    setProgress({
      current: 0,
      total: (Number(config.iterations) || 0) * selectedStrategies.length,
      matches: 0,
      totalStrategies: selectedStrategies.length,
      strategyIndex: 0,
    });

    // Fire the run but DON'T await it for the result — the poller drives
    // progress + completion, so a dropped connection never loses the job.
    fetch(`${API_URL}/api/engine/optimizer/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...config,
        jobId,
        symbol: config.symbol,
        lot_size: config.lot_size || 15,
        start_date: config.start_date,
        end_date: config.end_date,
        capital: config.capital,
        iterations: config.iterations,
        // Multi-strategy: array of strategy ids. `strategy` kept for back-compat.
        strategies: selectedStrategies,
        strategy: selectedStrategies[0],
        min_trades: config.minTrades,
        min_win_rate: config.minWinRate,
        max_drawdown: config.maxDrawdown || 20,
        min_sharpe_ratio: config.minSharpeRatio,
        stop_on_match: stopOnMatch,
        futures_expiry: config.futures_expiry,
        oos_enabled: !!config.oos_enabled,
        oos_fraction: config.oos_fraction ?? 0.3,
      })
    }).then(async (response) => {
      if (token !== runTokenRef.current) return;
      // Surface only IMMEDIATE failures (validation 400 / run 500). A normal
      // completion is picked up by the poller from /status.
      if (!response.ok) {
        const d = await response.json().catch(() => ({}));
        finishJob('error', d.error || `Request failed (${response.status})`);
      }
    }).catch(() => {
      // Connection dropped on a long run — ignore; the poller keeps tracking it.
    });

    // Poll from the start: progress while running, result on completion.
    pollJob(jobId, token);
  };

  // Safely stop the running optimization. The backend signals its workers to
  // finish the current iteration and return everything computed so far, so the
  // poller then receives the partial results (no data lost).
  const stopOptimization = async () => {
    if (!jobIdRef.current || stopping) return;
    setStopping(true);
    try {
      const res = await fetch(`${API_URL}/api/engine/optimizer/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: jobIdRef.current })
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        console.warn('Stop request:', d.error || res.statusText);
        // If it already finished, the poller will surface the result.
      }
    } catch (err) {
      console.error('Failed to send stop request:', err);
      setStopping(false);
    }
  };

  // ── Reconnect on mount ───────────────────────────────────────────────
  // Rejoin a run in progress: first try this browser's stored jobId, then ask
  // the backend what's running RIGHT NOW (covers a different browser, a dropped
  // connection, or cleared localStorage).
  React.useEffect(() => {
    const token = ++runTokenRef.current;
    let stored = null;
    try { stored = localStorage.getItem(OPT_JOB_KEY); } catch { /* ignore */ }

    if (stored) {
      pollJob(stored, token);
    } else {
      // Discover any active run and adopt it.
      fetch(`${API_URL}/api/engine/optimizer/active`)
        .then(r => r.json())
        .then(d => {
          if (token !== runTokenRef.current) return;
          const job = Array.isArray(d.jobs) && d.jobs.length ? d.jobs[0] : null;
          if (job && job.jobId) {
            try { localStorage.setItem(OPT_JOB_KEY, job.jobId); } catch { /* ignore */ }
            pollJob(job.jobId, token);
          }
        })
        .catch(() => { /* no backend / nothing running */ });
    }

    return () => { stopPolling(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keys that must NOT leak from a result into a backtest config:
  //  • optimizer-orchestration noise, and
  //  • run-context fields we set explicitly (normalized) below.
  // NOTE: strategy *execution* params like trade_start_time / max_daily_loss are
  // intentionally KEPT so the backtest reproduces the run faithfully.
  const TEST_OMIT_KEYS = new Set([
    // optimizer orchestration
    'jobId', 'strategies', 'iterations', 'stop_on_match', 'isOptimizer', 'DISABLE_RANDOMIZATION',
    'minTrades', 'minWinRate', 'maxDrawdown', 'minSharpeRatio',
    'min_trades', 'min_win_rate', 'max_drawdown', 'min_sharpe_ratio', 'signal',
    // run-context (set explicitly + normalized below)
    'symbol', 'strategy', 'resolution', 'start_date', 'end_date', 'startDate', 'endDate',
    'capital', 'lot_size', 'lots', 'dataSource', 'backtest_mode', 'futures_expiry',
    'slippage_percent', 'brokerage_per_order', 'use_ai_prediction',
  ]);

  const handleTestClick = (result, strategyId) => {
    // The per-row strategy MUST win (a multi-strategy result row may not be the
    // first selected strategy). result.params carries the original request's
    // `strategy`, so we strip it and set the correct one explicitly.
    const strat = strategyId || result.strategy || results?.best_strategy || (results?.runConfig && results.runConfig.strategy);

    // Tuned strategy params actually used for this result (refresh-safe — they
    // live in the result, not the live form).
    const tuned = {};
    for (const [k, v] of Object.entries(result.params || {})) {
      if (!TEST_OMIT_KEYS.has(k)) tuned[k] = v;
    }

    // Run context: prefer the result's self-describing runConfig (survives
    // refresh), then the result's own params, then the live form as a fallback.
    const rc = results?.runConfig || {};
    const pick = (key, dflt) =>
      (rc[key] != null ? rc[key]
        : (result.params && result.params[key] != null ? result.params[key]
          : (config[key] != null ? config[key] : dflt)));

    const symbol = rc.symbol || results?.symbol || (result.params && result.params.symbol) || config.symbol;

    const newBacktestParams = {
      symbol,
      strategy: strat,
      resolution: pick('resolution', '1'),
      start_date: pick('start_date'),
      end_date: pick('end_date'),
      capital: pick('capital'),
      lot_size: pick('lot_size', 35),
      dataSource: pick('dataSource', 'AUTO'),
      backtest_mode: pick('backtest_mode', 'Simulated Premium'),
      futures_expiry: pick('futures_expiry'),
      slippage_percent: pick('slippage_percent', 0.05),
      brokerage_per_order: pick('brokerage_per_order', 20),
      use_ai_prediction: (result.params && result.params.use_ai_prediction) || config.use_ai_prediction || false,
      // Strategy-specific optimized params (after context so they can't be lost,
      // but symbol/strategy already stripped from `tuned`).
      ...tuned,
    };

    setBacktestParams(newBacktestParams);
    // Also pass navigation state so Backtest's location.state handler runs its
    // strategy-name normalization + critical-param merge.
    navigate('/backtest', {
      state: {
        symbol,
        strategy: strat,
        resolution: newBacktestParams.resolution,
        dataSource: newBacktestParams.dataSource,
        backtest_mode: newBacktestParams.backtest_mode,
        params: tuned,
      },
    });
  };

  // ── Normalize result shape (multi vs legacy single) ──────────────────
  const strategyGroups = useMemo(() => {
    if (!results) return [];
    if (Array.isArray(results.strategies)) return results.strategies;
    // Legacy single-strategy shape → wrap into one group. Read config.strategies
    // (a stable reference) rather than the per-render selectedStrategies array.
    const sid = results.strategy || config.strategy || (config.strategies && config.strategies[0]);
    const list = results.best_parameters || [];
    return [{
      strategy: sid,
      label: labelFor(sid),
      best_parameters: list,
      best: list[0] || null,
      summary: list[0] ? {
        matches: list.length,
        score: list[0].score,
        totalPnL: list[0].metrics?.totalPnL,
        winRate: list[0].metrics?.winRate,
        totalTrades: list[0].metrics?.totalTrades,
        maxDrawdown: list[0].metrics?.maxDrawdown,
        sharpeRatio: list[0].metrics?.sharpeRatio,
        profitFactor: list[0].metrics?.profitFactor,
      } : { matches: 0 },
    }];
  }, [results, config.strategy, config.strategies, catalog]); // eslint-disable-line react-hooks/exhaustive-deps

  const bestStrategyId = results?.best_strategy || (strategyGroups[0]?.best ? strategyGroups[0].strategy : null);
  const totalMatches = strategyGroups.reduce((s, g) => s + (g.best_parameters?.length || 0), 0);
  // Out-of-sample columns are shown only when this run used OOS validation.
  const hasOos = !!(results?.runConfig?.oos_enabled);

  const overallPct = Math.round((progress.current / (progress.total || 1)) * 100);
  const stratPct = progress.strategyTotal
    ? Math.round((progress.strategyCurrent / (progress.strategyTotal || 1)) * 100)
    : null;

  const renderParamChips = (params) => {
    const entries = Object.entries(params || {}).filter(([k, v]) =>
      !NOISE_PARAM_KEYS.has(k) && v !== undefined && v !== null && v !== '');
    if (!entries.length) return <span className="text-slate-500 text-xs">No tunable params</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {entries.map(([k, v]) => (
          <span key={k} className="text-[11px] bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded">
            <span className="text-slate-400">{prettify(k)}:</span>{' '}
            <span className="text-slate-200 font-mono">
              {typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}
            </span>
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="p-8 space-y-8">
      <h1 className="text-3xl font-bold text-white flex items-center gap-3">
        <Activity className="w-8 h-8 text-primary" />
        Strategy Optimizer
      </h1>

      <div className={`grid grid-cols-1 gap-8 ${configCollapsed ? 'lg:grid-cols-[3rem_1fr]' : 'lg:grid-cols-3'}`}>
        {configCollapsed ? (
          <div className="bg-surface rounded-xl border border-slate-700 flex flex-col items-center py-4 h-fit sticky top-4">
            <button
              onClick={toggleConfigCollapsed}
              title="Expand Parameters"
              className="text-slate-400 hover:text-white hover:bg-slate-800 rounded p-2 transition-colors"
            >
              <PanelLeftOpen className="w-5 h-5" />
            </button>
            <div
              className="mt-4 text-[10px] text-slate-500 font-semibold tracking-widest"
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
            >
              PARAMETERS
            </div>
          </div>
        ) : (
        <div className="bg-surface p-6 rounded-xl border border-slate-700 space-y-6 h-fit">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold">Parameters</h3>
            <button
              onClick={toggleConfigCollapsed}
              title="Collapse Parameters"
              className="text-slate-400 hover:text-white hover:bg-slate-800 rounded p-1.5 transition-colors"
            >
              <PanelLeftClose className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-4">
            {/* ── Multi-select Strategies ───────────────────────────── */}
            <div ref={stratRef} className="relative">
              <label className="block text-sm font-medium text-slate-400 mb-1">
                Strategies <span className="text-slate-500">({selectedStrategies.length} selected)</span>
              </label>
              <button
                type="button"
                onClick={() => setStratOpen(o => !o)}
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-left flex items-center justify-between gap-2 hover:border-slate-500"
              >
                <span className="truncate text-sm">
                  {selectedStrategies.length === 0
                    ? 'Select strategies…'
                    : selectedStrategies.length === 1
                      ? labelFor(selectedStrategies[0])
                      : `${selectedStrategies.length} strategies selected`}
                </span>
                <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${stratOpen ? 'rotate-180' : ''}`} />
              </button>

              {stratOpen && (
                <div className="absolute z-20 mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg shadow-xl max-h-72 overflow-y-auto">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 sticky top-0 bg-slate-900">
                    <button onClick={selectAllStrategies} className="text-xs text-primary hover:underline">Select all</button>
                    <button onClick={clearStrategies} className="text-xs text-slate-400 hover:underline">Clear</button>
                  </div>
                  {catalog.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">Loading…</div>}
                  {catalog.map(c => {
                    const checked = selectedStrategies.includes(c.id);
                    const disabled = !c.optimizable;
                    const needsModel = c.reason && /model/i.test(c.reason);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => !disabled && toggleStrategy(c.id)}
                        title={disabled ? (c.reason || 'Not optimizable') : ''}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                          disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-800 cursor-pointer'
                        }`}
                      >
                        <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                          checked ? 'bg-primary border-primary' : 'border-slate-600'
                        }`}>
                          {checked && <Check className="w-3 h-3 text-white" />}
                        </span>
                        <span className="text-slate-200 flex-1">{c.label}</span>
                        {disabled && (
                          <span className="text-[10px] text-slate-500">{needsModel ? 'needs model' : 'not tunable'}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="text-[11px] text-slate-500 mt-1">
                Each selected strategy is optimized separately ({config.iterations || 0} iterations each) on this symbol, then ranked to find the best.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Symbol</label>
              <select
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                value={config.symbol}
                onChange={e => {
                  const newSymbol = e.target.value;
                  const result = instrumentConfig[newSymbol];
                  const newLotSize = result ? result.lotSize : 30;
                  setConfig({ ...config, symbol: newSymbol, lot_size: newLotSize });
                }}
              >
                {Object.keys(instrumentConfig).length === 0 && <option>Loading...</option>}

                <optgroup label="Indices">
                  {Object.entries(instrumentConfig)
                    .filter(([k]) => !k.includes('-EQ') && !k.startsWith('MCX:'))
                    .map(([key, c]) => (<option key={key} value={key}>{c.underlying}</option>))}
                </optgroup>
                <optgroup label="Commodities (MCX)">
                  {Object.entries(instrumentConfig)
                    .filter(([k]) => k.startsWith('MCX:'))
                    .map(([key, c]) => (<option key={key} value={key}>{c.underlying}</option>))}
                </optgroup>
                <optgroup label="Stocks">
                  {Object.entries(instrumentConfig)
                    .filter(([k]) => k.includes('-EQ'))
                    .map(([key, c]) => (<option key={key} value={key}>{c.underlying}</option>))}
                </optgroup>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Lot Size</label>
              <input
                type="number"
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                value={config.lot_size || ''}
                onChange={e => setConfig({ ...config, lot_size: e.target.value === '' ? '' : parseInt(e.target.value) })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Start Date</label>
                <input type="date" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                  value={config.start_date} onChange={e => setConfig({ ...config, start_date: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">End Date</label>
                <input type="date" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                  value={config.end_date} onChange={e => setConfig({ ...config, end_date: e.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Backtest Mode</label>
                <select className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                  value={config.backtest_mode || 'Simulated Premium'}
                  onChange={e => setConfig({ ...config, backtest_mode: e.target.value })}>
                  <option value="Simulated Premium">Simulated Premium (Fast & Approx - 0.5 Delta)</option>
                  <option value="Real Option Data">Real Option Data (Slow & Accurate)</option>
                </select>
                {config.backtest_mode === 'Real Option Data' && (
                  <div className="text-[10px] text-orange-400 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    <span>Warning: Extremely slow! Fetches option history for every trade.</span>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-blue-400 mb-1">Data Source</label>
                <select className="w-full bg-slate-900 border border-blue-900 rounded p-2 text-white"
                  value={config.dataSource || 'AUTO'}
                  onChange={e => setConfig({ ...config, dataSource: e.target.value })}>
                  <option value="AUTO">Auto (Smart Switch)</option>
                  <option value="SPOT">Spot Data (API)</option>
                  <option value="FUT">Current Month Future</option>
                  <option value="ARCHIVE">📂 Local Archive (Fast)</option>
                  <option value="SPOT_ARCHIVE">🔁 Spot API + Archive Options</option>
                </select>
              </div>

              {(config.dataSource === 'FUT' || config.backtest_mode === 'Real Option Data') && (
                <div>
                  <label className="block text-sm font-medium text-purple-400 mb-1">
                    {config.backtest_mode === 'Real Option Data' ? 'Options Expiry Date' : 'Futures Expiry Date'}
                  </label>
                  <select className="w-full bg-slate-900 border border-purple-900 rounded p-2 text-white"
                    value={config.futures_expiry || ''}
                    onChange={e => setConfig({ ...config, futures_expiry: e.target.value })}>
                    <option value="">-- Auto (Match Start Date) --</option>
                    {expiryDates.map((exp) => (<option key={exp.date} value={exp.date}>{exp.label}</option>))}
                  </select>
                  <div className="text-[10px] text-gray-500 mt-1">
                    Force a specific contract (e.g. 26FEB) regardless of backtest dates.
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Resolution (Timeframe)</label>
                <select className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                  value={config.resolution || '1'}
                  onChange={e => {
                    const val = e.target.value;
                    const numVal = Number(val);
                    setConfig({ ...config, resolution: isNaN(numVal) ? val : numVal });
                  }}>
                  <option value="1">1 Minute</option>
                  <option value="3">3 Minutes</option>
                  <option value="5">5 Minutes</option>
                  <option value="15">15 Minutes</option>
                  <option value="30">30 Minutes</option>
                  <option value="60">1 Hour</option>
                  <option value="D">Daily</option>
                </select>
                <p className="text-[11px] text-slate-500 mt-1">Applied to every selected strategy.</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Starting Capital (₹)</label>
              <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                value={config.capital || ''}
                onChange={e => setConfig({ ...config, capital: e.target.value === '' ? '' : parseInt(e.target.value) })} />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Iterations per Strategy</label>
              <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                value={config.iterations || ''}
                onChange={e => setConfig({ ...config, iterations: e.target.value === '' ? '' : parseInt(e.target.value) })} />
              {selectedStrategies.length > 1 && (
                <p className="text-[11px] text-slate-500 mt-1">
                  Total runs: {(Number(config.iterations) || 0) * selectedStrategies.length} ({selectedStrategies.length} strategies × {config.iterations || 0})
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Min Trades</label>
                <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                  value={config.minTrades || ''}
                  onChange={e => setConfig({ ...config, minTrades: e.target.value === '' ? '' : parseInt(e.target.value) })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Min Win Rate %</label>
                <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                  value={config.minWinRate || ''}
                  onChange={e => setConfig({ ...config, minWinRate: e.target.value === '' ? '' : parseInt(e.target.value) })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Max Drawdown %</label>
                <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                  value={config.maxDrawdown || ''}
                  onChange={e => setConfig({ ...config, maxDrawdown: e.target.value === '' ? '' : parseInt(e.target.value) })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Min Sharpe Ratio</label>
                <input type="number" step="0.1" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                  value={config.minSharpeRatio !== undefined ? config.minSharpeRatio : ''}
                  onChange={e => setConfig({ ...config, minSharpeRatio: e.target.value === '' ? '' : parseFloat(e.target.value) })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Slippage (%)</label>
                <input type="number" step="0.01" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                  value={config.slippage_percent !== undefined ? config.slippage_percent : 0.05}
                  onChange={e => setConfig({ ...config, slippage_percent: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Brokerage (₹)</label>
                <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                  value={config.brokerage_per_order !== undefined ? config.brokerage_per_order : 20}
                  onChange={e => setConfig({ ...config, brokerage_per_order: e.target.value })} />
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-slate-800 rounded-lg border border-slate-700">
              <div className={`w-10 h-6 rounded-full p-1 cursor-pointer transition-colors ${stopOnMatch ? 'bg-green-500' : 'bg-slate-600'}`}
                onClick={() => setStopOnMatch(!stopOnMatch)}>
                <div className={`w-4 h-4 bg-white rounded-full transition-transform ${stopOnMatch ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
              <span className="text-sm font-medium text-slate-300">Stop on First Match (per strategy)</span>
            </div>

            {/* ── Out-of-sample (walk-forward) validation ─────────────── */}
            <div className="p-3 bg-slate-800 rounded-lg border border-slate-700 space-y-2">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-6 rounded-full p-1 cursor-pointer transition-colors ${config.oos_enabled ? 'bg-emerald-500' : 'bg-slate-600'}`}
                  onClick={() => setConfig({ ...config, oos_enabled: !config.oos_enabled })}>
                  <div className={`w-4 h-4 bg-white rounded-full transition-transform ${config.oos_enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                </div>
                <span className="text-sm font-medium text-slate-300">Out-of-Sample Validation 🛡️</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Optimizes on the earlier part of the range and <span className="text-slate-300">validates on a held-out tail</span> it never saw — so overfit sets (great in-sample, bad out-of-sample) are flagged, not picked.
              </p>
              {config.oos_enabled && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-400">Test (held-out) %</label>
                  <input type="number" min="10" max="60" step="5"
                    className="w-20 bg-slate-900 border border-slate-700 rounded p-1 text-white text-sm"
                    value={Math.round((config.oos_fraction ?? 0.3) * 100)}
                    onChange={e => {
                      const pct = Math.min(60, Math.max(10, parseInt(e.target.value) || 30));
                      setConfig({ ...config, oos_fraction: pct / 100 });
                    }} />
                  <span className="text-[11px] text-slate-500">
                    train {100 - Math.round((config.oos_fraction ?? 0.3) * 100)}% / test {Math.round((config.oos_fraction ?? 0.3) * 100)}%
                  </span>
                </div>
              )}
            </div>

            <button onClick={startOptimization} disabled={running || selectedStrategies.length === 0}
              className="w-full bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {running ? 'Optimizing...' : <><Play className="w-4 h-4" /> Optimize {selectedStrategies.length || 0} Strateg{selectedStrategies.length === 1 ? 'y' : 'ies'}</>}
            </button>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/50 rounded text-red-400 text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {error}
              </div>
            )}
          </div>
        </div>
        )}

        <div className={`${configCollapsed ? '' : 'lg:col-span-2'} bg-surface p-6 rounded-xl border border-slate-700 min-h-[400px]`}>
          {running ? (
            <div className="h-full flex flex-col items-center justify-center space-y-6">
              <div className="relative w-32 h-32">
                <svg className="w-full h-full" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="45" fill="none" stroke="#1e293b" strokeWidth="8" />
                  <circle cx="50" cy="50" r="45" fill="none" stroke="#3b82f6" strokeWidth="8"
                    strokeDasharray="283"
                    strokeDashoffset={283 - (283 * progress.current / (progress.total || 1))}
                    className="transition-all duration-300 ease-out" transform="rotate(-90 50 50)" />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center flex-col">
                  <span className="text-2xl font-bold text-white">{overallPct}%</span>
                </div>
              </div>

              <div className="text-center space-y-2">
                <p className="text-xl font-bold text-white">Running Optimization...</p>
                {progress.totalStrategies > 1 && progress.strategyLabel && (
                  <p className="text-slate-300">
                    Strategy {(progress.strategyIndex ?? 0) + 1} / {progress.totalStrategies}:{' '}
                    <span className="text-primary font-semibold">{progress.strategyLabel}</span>
                    {stratPct != null && <span className="text-slate-400"> ({stratPct}%)</span>}
                  </p>
                )}
                <p className="text-slate-400">Overall {progress.current} of {progress.total}</p>
                <p className="text-green-400 font-medium">Found {progress.matches} matches in current strategy</p>
              </div>

              <button
                onClick={stopOptimization}
                disabled={stopping}
                className="mt-2 bg-red-600/90 hover:bg-red-600 text-white font-semibold py-2 px-5 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Square className="w-4 h-4" />
                {stopping ? 'Stopping — collecting results…' : 'Stop & Keep Results'}
              </button>
              <p className="text-[11px] text-slate-500 max-w-xs text-center">
                Safely halts after the current iteration and shows the best parameters found so far — nothing computed is lost.
              </p>
            </div>
          ) : results ? (
            <div className="space-y-6">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-green-400" />
                    Optimization Results
                  </h3>
                  {/* Run context — what these results were optimized on (from the
                      self-describing result, so it stays correct after refresh). */}
                  {(() => {
                    const rc = results.runConfig || {};
                    const sym = rc.symbol || results.symbol;
                    const symLabel = (sym && instrumentConfig[sym]?.underlying) || sym;
                    const resLabel = rc.resolution != null ? (RESOLUTION_LABELS[String(rc.resolution)] || `${rc.resolution}m`) : null;
                    if (!sym) return null;
                    return (
                      <div className="text-[11px] text-slate-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-slate-300">{symLabel}</span>
                        {resLabel && <span>· {resLabel}</span>}
                        {rc.start_date && rc.end_date && <span>· {rc.start_date} → {rc.end_date}</span>}
                        {rc.capital != null && <span>· ₹{Number(rc.capital).toLocaleString('en-IN')}</span>}
                        {rc.backtest_mode && <span>· {rc.backtest_mode}</span>}
                        {rc.oos_enabled && rc.oos_split_date && (
                          <span className="text-emerald-400">· 🛡️ OOS: train→{rc.oos_split_date}, test after ({Math.round((rc.oos_fraction ?? 0.3) * 100)}%)</span>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className="text-sm text-slate-400 flex items-center gap-2">
                    {results.stopped && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300">
                        ⏹ Stopped early{results.completed_strategies != null ? ` · ${results.completed_strategies}/${progress.totalStrategies || results.completed_strategies} strategies` : ''}
                      </span>
                    )}
                    {strategyGroups.length} strateg{strategyGroups.length === 1 ? 'y' : 'ies'} · {totalMatches} profitable sets
                  </span>
                  <button
                    onClick={clearResults}
                    className="text-xs bg-slate-700 hover:bg-red-600/80 text-slate-200 px-3 py-1 rounded transition-colors"
                    title="Clear saved results"
                  >
                    Clear Results
                  </button>
                </div>
              </div>

              {/* ── Winner banner ─────────────────────────────────── */}
              {(() => {
                const winner = bestStrategyId ? strategyGroups.find(g => g.strategy === bestStrategyId) : null;
                if (!winner || !winner.best) {
                  return (
                    <div className="p-4 bg-yellow-500/10 border border-yellow-500/40 rounded-lg text-yellow-300 text-sm flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      No profitable parameter set met the criteria for any strategy. Try loosening the filters or widening the date range.
                    </div>
                  );
                }
                const m = winner.best.metrics || {};
                return (
                  <div className="p-4 bg-gradient-to-r from-amber-500/10 to-slate-900/0 border border-amber-500/40 rounded-lg">
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <Trophy className="w-5 h-5 text-amber-400" />
                      <span className="text-amber-300 font-bold">Best Strategy: {winner.label}</span>
                      <span className="text-xs text-slate-400">(score {fmtScore(winner.best.score)})</span>
                      {hasOos && winner.best.oos && (
                        winner.best.robust
                          ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300">🛡️ Holds up out-of-sample</span>
                          : <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/40 text-red-300">⚠ Overfit — fails out-of-sample</span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center">
                      <div><div className="text-[11px] text-slate-400">PnL{hasOos ? ' (IS)' : ''}</div><div className="font-mono text-green-400">{fmtPnL(m.totalPnL)}</div></div>
                      <div><div className="text-[11px] text-slate-400">Win Rate</div><div className="text-green-400">{m.winRate}%</div></div>
                      <div><div className="text-[11px] text-slate-400">Trades</div><div>{m.totalTrades}</div></div>
                      <div><div className="text-[11px] text-slate-400">Max DD</div><div className="text-red-400">{m.maxDrawdown}%</div></div>
                      <div><div className="text-[11px] text-slate-400">Sharpe</div><div className="text-blue-400">{m.sharpeRatio}</div></div>
                      <div><div className="text-[11px] text-slate-400">Profit Factor</div><div className="text-purple-300">{fmtPF(m.profitFactor)}</div></div>
                    </div>
                    {hasOos && winner.best.oos && (
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center mt-2 pt-2 border-t border-amber-500/20">
                        <div><div className="text-[11px] text-emerald-400">OOS PnL</div><div className={`font-mono ${(winner.best.oos.totalPnL ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPnL(winner.best.oos.totalPnL)}</div></div>
                        <div><div className="text-[11px] text-emerald-400">OOS Win%</div><div className="text-emerald-300">{winner.best.oos.winRate}%</div></div>
                        <div><div className="text-[11px] text-emerald-400">OOS Trades</div><div>{winner.best.oos.totalTrades}</div></div>
                        <div><div className="text-[11px] text-emerald-400">OOS Max DD</div><div className="text-red-400">{winner.best.oos.maxDrawdown}%</div></div>
                        <div><div className="text-[11px] text-emerald-400">OOS Sharpe</div><div className="text-blue-400">{winner.best.oos.sharpeRatio}</div></div>
                        <div><div className="text-[11px] text-emerald-400">OOS PF</div><div className="text-purple-300">{fmtPF(winner.best.oos.profitFactor)}</div></div>
                      </div>
                    )}
                    <button
                      className="mt-3 text-xs bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 px-3 py-1.5 rounded"
                      onClick={() => handleTestClick(winner.best, winner.strategy)}>
                      Test best on Backtester →
                    </button>
                  </div>
                );
              })()}

              {/* ── Strategy leaderboard ──────────────────────────── */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-700 text-sm">
                      <th className="p-2 w-6"></th>
                      <th className="p-2">#</th>
                      <th className="p-2">Strategy</th>
                      <th className="p-2">Score</th>
                      <th className="p-2">Win Rate</th>
                      <th className="p-2">Best PnL</th>
                      <th className="p-2">Trades</th>
                      <th className="p-2">Max DD</th>
                      <th className="p-2">Sharpe</th>
                      <th className="p-2">PF</th>
                      {hasOos && <th className="p-2 text-emerald-400">Out-of-Sample</th>}
                      <th className="p-2">Sets</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {strategyGroups.map((g, idx) => {
                      const m = g.best?.metrics || {};
                      const isWinner = g.strategy === bestStrategyId && g.best;
                      const isOpen = expandedStrategy === g.strategy;
                      return (
                        <React.Fragment key={g.strategy}>
                          <tr
                            className={`border-b border-slate-800 hover:bg-slate-800/50 cursor-pointer transition-colors ${isOpen ? 'bg-slate-800/60' : ''}`}
                            onClick={() => setExpandedStrategy(isOpen ? null : g.strategy)}>
                            <td className="p-2 text-slate-500">
                              {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </td>
                            <td className="p-2 font-bold text-primary">#{idx + 1}</td>
                            <td className="p-2 font-medium text-slate-200">
                              <span className="flex items-center gap-1.5">
                                {isWinner && <Trophy className="w-3.5 h-3.5 text-amber-400" />}
                                {g.label}
                              </span>
                            </td>
                            {g.best ? (
                              <>
                                <td className="p-2 font-mono text-amber-300">{fmtScore(g.best.score)}</td>
                                <td className="p-2 text-green-400">{m.winRate}%</td>
                                <td className="p-2 font-mono">{fmtPnL(m.totalPnL)}</td>
                                <td className="p-2">{m.totalTrades}</td>
                                <td className="p-2 text-red-400">{m.maxDrawdown}%</td>
                                <td className="p-2 text-blue-400">{m.sharpeRatio}</td>
                                <td className="p-2 text-purple-300">{fmtPF(m.profitFactor)}</td>
                                {hasOos && (
                                  <td className="p-2">
                                    {g.best.oos ? (
                                      <span className="flex items-center gap-1.5">
                                        <span className={`font-mono ${(g.best.oos.totalPnL ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPnL(g.best.oos.totalPnL)}</span>
                                        {g.best.robust
                                          ? <span className="text-[10px] px-1 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300">Robust ✓</span>
                                          : <span className="text-[10px] px-1 py-0.5 rounded bg-red-500/15 border border-red-500/40 text-red-300">Overfit ⚠</span>}
                                      </span>
                                    ) : <span className="text-slate-500">—</span>}
                                  </td>
                                )}
                                <td className="p-2 text-slate-400">{g.best_parameters?.length || 0}</td>
                              </>
                            ) : (
                              <td className="p-2 text-slate-500 italic" colSpan={hasOos ? 9 : 8}>
                                {g.error ? `Error: ${g.error}` : 'No profitable set found'}
                              </td>
                            )}
                          </tr>

                          {/* Expanded: this strategy's top parameter sets */}
                          {isOpen && g.best_parameters?.length > 0 && (
                            <tr className="bg-slate-900/40">
                              <td colSpan={hasOos ? 12 : 11} className="p-3">
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left border-collapse">
                                    <thead>
                                      <tr className="text-slate-500 text-xs border-b border-slate-800">
                                        <th className="p-2">Rank</th>
                                        <th className="p-2">Score</th>
                                        <th className="p-2">{hasOos ? 'Win% (IS)' : 'Win Rate'}</th>
                                        <th className="p-2">{hasOos ? 'PnL (IS)' : 'PnL'}</th>
                                        <th className="p-2">Trades</th>
                                        <th className="p-2">Max DD</th>
                                        <th className="p-2">Sharpe</th>
                                        <th className="p-2">PF</th>
                                        {hasOos && <th className="p-2 text-emerald-400">OOS PnL</th>}
                                        {hasOos && <th className="p-2 text-emerald-400">OOS Win%</th>}
                                        {hasOos && <th className="p-2">Verdict</th>}
                                        <th className="p-2">Params</th>
                                        <th className="p-2">Action</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {g.best_parameters.slice(0, 25).map((res, ridx) => {
                                        const rm = res.metrics || {};
                                        // Stable key from the (deduped) param set so row
                                        // selection survives re-renders/reordering.
                                        const rowKey = `${g.strategy}::${JSON.stringify(res.params)}`;
                                        return (
                                          <tr key={rowKey}
                                            className={`border-b border-slate-800/60 hover:bg-slate-800/40 cursor-pointer ${selectedResult === res ? 'bg-slate-800/70' : ''}`}
                                            onClick={() => setSelectedResult(res)}>
                                            <td className="p-2 font-bold text-primary">#{ridx + 1}</td>
                                            <td className="p-2 font-mono text-amber-300">{fmtScore(res.score)}</td>
                                            <td className="p-2 text-green-400">{rm.winRate}%</td>
                                            <td className="p-2 font-mono">{fmtPnL(rm.totalPnL)}</td>
                                            <td className="p-2">{rm.totalTrades}</td>
                                            <td className="p-2 text-red-400">{rm.maxDrawdown}%</td>
                                            <td className="p-2 text-blue-400">{rm.sharpeRatio}</td>
                                            <td className="p-2 text-purple-300">{fmtPF(rm.profitFactor)}</td>
                                            {hasOos && (
                                              <td className={`p-2 font-mono ${(res.oos?.totalPnL ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {res.oos ? fmtPnL(res.oos.totalPnL) : '—'}
                                                {res.oos != null && <span className="text-slate-500"> ({res.oos.totalTrades}t)</span>}
                                              </td>
                                            )}
                                            {hasOos && <td className="p-2 text-emerald-300">{res.oos ? `${res.oos.winRate}%` : '—'}</td>}
                                            {hasOos && (
                                              <td className="p-2">
                                                {res.robust
                                                  ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300">Robust ✓</span>
                                                  : <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 border border-red-500/40 text-red-300">Overfit ⚠</span>}
                                              </td>
                                            )}
                                            <td className="p-2 max-w-md">{renderParamChips(res.params)}</td>
                                            <td className="p-2">
                                              <div className="flex gap-1">
                                                <button className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-white"
                                                  onClick={(e) => { e.stopPropagation(); handleTestClick(res, g.strategy); }}>
                                                  Test
                                                </button>
                                                <button className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-white"
                                                  onClick={(e) => { e.stopPropagation(); setSelectedResult(res); }} title="View JSON">
                                                  <Code className="w-3 h-3" />
                                                </button>
                                              </div>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                  {g.best_parameters.length > 25 && (
                                    <p className="text-[11px] text-slate-500 mt-2">Showing top 25 of {g.best_parameters.length} sets.</p>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Skipped strategies note */}
              {results.skipped_strategies?.length > 0 && (
                <div className="text-[11px] text-slate-500">
                  Skipped (no tunable parameters): {results.skipped_strategies.map(labelFor).join(', ')}
                </div>
              )}

              {selectedResult && (
                <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-800">
                  <h4 className="font-bold mb-2 text-slate-300 flex items-center gap-2">
                    <Code className="w-4 h-4 text-primary" />
                    Selected Parameters JSON
                    {selectedResult.strategy && <span className="text-xs text-slate-500">({labelFor(selectedResult.strategy)})</span>}
                  </h4>
                  <pre className="text-xs text-slate-500 overflow-x-auto p-2 bg-black rounded">
                    {JSON.stringify(selectedResult.params, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-500">
              Select one or more strategies and run optimization to see the best parameters.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
