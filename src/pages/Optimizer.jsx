import React, { useState, useRef, useMemo, useId } from 'react';
import { PageHeader, Segmented } from '../components/viz/primitives';
import DeltaInstrumentPicker from '../components/delta/DeltaInstrumentPicker';
import DeltaParams from '../components/delta/DeltaParams';
import { isDeltaSymbol } from '../components/delta/deltaFormat.js';
import { useNavigate } from 'react-router-dom';
import { Activity, Play, TrendingUp, AlertTriangle, Code, ChevronDown, ChevronRight, Check, Trophy, Square, PanelLeftClose, PanelLeftOpen, Copy } from 'lucide-react';
import { copyStrategyJson, resultsFromRow } from '../components/optimizer/copyStrategy.js';
import { useGlobalState } from '../context/GlobalContext';
import { io } from 'socket.io-client';
import { INSTRUMENT_CONFIG } from '../constants';
import { sizesByLots, currentLot, withCurrentLot, lotText } from '../utils/lots.js';
import { fetchExpiriesForSymbol } from '../utils/expiryUtils';
import { pollInterval } from '../hooks/usePolling.js';
import { API_ORIGIN } from '../config/api.js';
import { pnlTone } from '../components/viz/tokens';
import IndexChips from '../components/optimizer/IndexChips';
import DataCheckPanel from '../components/optimizer/DataCheckPanel';
import ProgressGrid from '../components/optimizer/ProgressGrid';
import CrossIndexResults from '../components/optimizer/CrossIndexResults';
import RecentRuns from '../components/optimizer/RecentRuns';
import { useConfirm } from '../components/confirmContext.js';
import { INDEX_SYMBOLS, PRESETS, plannedBacktests, defaultK, nameOf } from '../components/optimizer/crossIndex';
import DocLink from '../components/DocLink.jsx';
import MemberBuilder from '../components/combiner/MemberBuilder.jsx';
import CombinerCrownPanel, { CombinerGates } from '../components/optimizer/CombinerGatesPanel.jsx';
import { consistencyText, consistencyVerdict } from '../components/viz/consistencyFormat.js';

// Signal combiner (stage 2): the candidate members a draw picks from when none are chosen —
// the council's validated nine, so the two can be compared.
const DEFAULT_COMBINER_POOL = 'wyckoff_spring,smc_ob,liquidity_sweep,volume_surge,apex_confluence,intraday_momentum,ichimoku_kumo,rsi2_reversion,gap_edge';



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

// Humanize a millisecond duration for the ETA readout. Returns null for
// missing/invalid input so callers can fall back to "Estimating…".
//   <1m → "Ns" · <1h → "Mm Ss"/"Mm" · ≥1h → "Hh Mm"
const formatDuration = (ms) => {
  if (ms == null || !isFinite(ms) || ms < 0) return null;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${Math.max(1, totalSec)}s`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  const s = totalSec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
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
  'rank_metric', 'min_consistency', 'member_pool', 'combiner_null_runs',
  // multi-index run orchestration
  'symbols', 'preset', 'budget', 'seed', 'cross_index', 'minSlU', 'optimizer_workers', 'optimizer_block', 'jobId', 'iterations',
]);
// The aligned spot archive's coverage (backend data_archives/SPOT) and the default multi-index window.
const SPOT_ARCHIVE_FROM = '2025-06-02', SPOT_ARCHIVE_TO = '2026-02-19';
const MULTI_DEFAULT_WINDOW = { start_date: '2025-06-16', end_date: '2026-02-19' };

// Why a strategy has no set to show — from the run's own drop counts, never a guess.
const FAIL_WORDS = { trades: 'too few trades', winRate: 'win rate below the filter', drawdown: 'drawdown above the filter', sharpe: 'Sharpe below the filter', consistency: 'consistency below the filter', loss: 'lost money' };
function noSetReason(g) {
  const d = g.drop_stats || {};
  const tried = g.trials || null;
  if (d.capital && tried && d.capital >= tried) return `No set: all ${tried} settings made 0 trades — the capital couldn't afford one lot of this contract.`;
  const fails = Object.entries(FAIL_WORDS).map(([k, w]) => [w, d[k] || (d.fail && d.fail[k]) || 0]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const extra = d.capital ? ` · ${d.capital} made 0 trades for lack of capital` : '';
  return fails.length
    ? `No profitable set found${tried ? ` in ${tried} settings` : ''} — ${fails.slice(0, 3).map(([w, n]) => `${n} ${w}`).join(', ')}${extra}`
    : `No profitable set found${extra}`;
}

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
  // Stable, collision-free id for the OOS switch's visible label.
  const oosLabelId = useId();
  const navigate = useNavigate();
  const confirm = useConfirm();
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
  // Wall-clock tick (1s) so the ETA counts down smoothly BETWEEN backend ticks.
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);
  // Multi-index run state: the live strategy × index grid (from /status), a 409
  // conflict (another run in progress → offer Attach), the data check, Recent runs.
  const [cells, setCells] = useState(null);
  const [conflictJobId, setConflictJobId] = useState(null);
  const [refusal, setRefusal] = useState(null);   // 503 reasons
  const [dataCheckResult, setDataCheckResult] = useState(null);
  const [recentRuns, setRecentRuns] = useState(null);
  const [pausing, setPausing] = useState(false);
  const [resumingJobId, setResumingJobId] = useState(null);
  // A paused (or crashed) run shown on the page: offers Resume.
  const [pausedJobId, setPausedJobId] = useState(null);
  // Ranking mode: ON (default) = "deflated" anti-data-mining ranking (penalize
  // IS→OOS degradation + the best-of-N selection bias). OFF = raw robust score.
  // Both keys are precomputed by the backend, so this just re-sorts — no re-run.
  const [deflateRank, setDeflateRank] = useState(() => {
    try { return localStorage.getItem('optimizer:deflateRank') !== '0'; } catch { return true; }
  });
  const toggleDeflateRank = () => setDeflateRank(prev => {
    const next = !prev;
    try { localStorage.setItem('optimizer:deflateRank', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });
  const jobIdRef = useRef(null);
  const pollTimerRef = useRef(null);   // active /status poll timer
  const runTokenRef = useRef(0);       // invalidates stale pollers when a new run/resume starts
  const lastSocketTsRef = useRef(0);   // last time a live progress event arrived (socket-detected runs)

  const [instrumentConfig, setInstrumentConfig] = useState({});

  // Tick once a second WHILE running so the ETA counts down smoothly between
  // backend progress events. No timer when idle (avoids a leaked interval).
  React.useEffect(() => {
    if (!running) return undefined;
    const t = pollInterval(() => setNowTs(Date.now()), 1000);
    return () => t?.();
  }, [running]);
  const [expiryDates, setExpiryDates] = useState([]); // For Options/Futures Expiry Selection
  const [catalog, setCatalog] = useState([]); // [{ id, label, optimizable }]
  const [stratOpen, setStratOpen] = useState(false);
  const [expandedStrategy, setExpandedStrategy] = useState(null);
  const stratRef = useRef(null);

  const selectedStrategies = Array.isArray(config.strategies) && config.strategies.length
    ? config.strategies
    : (config.strategy ? [config.strategy] : []);
  // One symbol = today's page; two or more indexes = a multi-index run.
  const symbols = (Array.isArray(config.symbols) && config.symbols.length ? config.symbols : [config.symbol]).filter(Boolean);
  const isMulti = symbols.length > 1;
  const preset = PRESETS[config.preset] ? config.preset : 'quick';
  const budget = config.budget && Number(config.budget.d1) > 0 ? config.budget : PRESETS[preset];

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
    const socket = io(API_ORIGIN, { withCredentials: true });

    socket.on('optimization_progress', (data) => {
      // Only OUR run's progress (a second tab's run must not take this page over).
      if (data && data.jobId && jobIdRef.current && data.jobId !== jobIdRef.current) return;
      setProgress(data);
      lastSocketTsRef.current = Date.now();
      // Live progress is arriving but THIS tab isn't tracking a job (e.g. the
      // run was started elsewhere, the connection had dropped, or the backend
      // predates the /active endpoint). Surface it from the socket stream.
      if (!jobIdRef.current) setRunning(true);
    });

    // Watchdog: socket-detected runs have no completion event, so if progress
    // stops arriving for a while, assume the run ended and drop the spinner.
    const watchdog = pollInterval(() => {
      if (!jobIdRef.current && lastSocketTsRef.current && (Date.now() - lastSocketTsRef.current > 60000)) {
        lastSocketTsRef.current = 0;
        setRunning(false);
      }
    }, 10000);

    // Use static instruments
    setInstrumentConfig(INSTRUMENT_CONFIG);

    // Fetch strategy catalog (id + label + optimizable flag) — drives the
    // multi-select so we never hard-code the strategy list.
    fetch(`${API_ORIGIN}/api/config/strategies/catalog`)
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setCatalog(data); })
      .catch(err => console.error('Failed to fetch strategy catalog', err));

    return () => { socket.disconnect(); watchdog?.(); };
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
      // A multi-index result is large and saved on the server: keep only a pointer.
      const stored = data && data.type === 'multi_index_optimization_result'
        ? { type: 'multi_index_ref', jobId: data.jobId, summary: { symbols: data.symbols, winner: data.sharedWinner && data.sharedWinner.label } }
        : data;
      try { localStorage.setItem(OPT_RESULT_KEY, JSON.stringify(stored)); } catch { /* quota/private mode */ }
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
      if (parsed && parsed.type === 'multi_index_ref' && parsed.jobId) {
        fetch(`${API_ORIGIN}/api/engine/optimizer/jobs/${encodeURIComponent(parsed.jobId)}`)
          .then(r => r.json()).then(d => { if (d && d.result && d.result.type) applyResultData({ ...d.result, jobId: d.result.jobId || parsed.jobId }, false); })
          .catch(() => { /* saved run unavailable */ });
      } else if (parsed && (parsed.strategies || parsed.best_parameters)) applyResultData(parsed, false);
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

  const finishJob = (state, payload, jobId = null) => {
    stopPolling();
    setRunning(false);
    setStopping(false);
    setPausing(false);
    jobIdRef.current = null;
    try { localStorage.removeItem(OPT_JOB_KEY); } catch { /* ignore */ }
    if (state === 'done' && payload) { setPausedJobId(null); applyResultData(payload); }
    else if (state === 'paused' || state === 'interrupted') {
      // Resumable: keep its partial result on screen and offer Resume.
      setPausedJobId(jobId);
      if (payload && payload.type) applyResultData({ ...payload, jobId: payload.jobId || jobId }, false);
    }
    else if (state === 'error') setError(payload || 'Optimization failed');
    loadRecentRuns();
  };

  const loadRecentRuns = () => {
    fetch(`${API_ORIGIN}/api/engine/optimizer/jobs?limit=20`)
      .then(r => r.json()).then(d => setRecentRuns(d && Array.isArray(d.jobs) ? d : { jobs: [] }))
      .catch(() => setRecentRuns({ jobs: [], warning: 'Recent runs unavailable.' }));
  };
  React.useEffect(() => { loadRecentRuns(); }, []);

  const openRecentRun = (jobId) => {
    fetch(`${API_ORIGIN}/api/engine/optimizer/jobs/${encodeURIComponent(jobId)}`)
      .then(r => r.json()).then(d => {
        if (d && d.result && d.result.type) {
          setPausedJobId(d.status === 'paused' ? jobId : null);
          applyResultData({ ...d.result, jobId: d.result.jobId || jobId });
        } else setError(d.error || 'That run has no saved result.');
      })
      .catch(e => setError(`Could not load the run: ${e.message}`));
  };

  // Resume a paused / stopped / crashed run from its checkpoint, then follow it.
  const resumeJob = async (jobId) => {
    setResumingJobId(jobId);
    setError(null);
    try {
      const r = await fetch(`${API_ORIGIN}/api/engine/optimizer/jobs/${encodeURIComponent(jobId)}/resume`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409 && d.activeJobId) { setConflictJobId(d.activeJobId); return; }
      if (!r.ok) { setError(d.error || `Resume failed (HTTP ${r.status})`); return; }
      setPausedJobId(null);
      setResults(null);
      attachToJob(jobId);
    } catch (e) {
      setError(`Resume failed: ${e.message}`);
    } finally { setResumingJobId(null); }
  };
  const deleteJob = async (jobId) => {
    const ok = await confirm('Delete this optimizer run? Its results and checkpoint are removed permanently.');
    if (!ok) return;
    const r = await fetch(`${API_ORIGIN}/api/engine/optimizer/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (!r || !r.ok) setError(d.error || 'Delete failed');
    if (pausedJobId === jobId) setPausedJobId(null);
    loadRecentRuns();
  };
  const clearFinishedJobs = async () => {
    const ok = await confirm('Delete every finished run (done, stopped, error)? Paused and interrupted runs are kept so they can still resume.');
    if (!ok) return;
    await fetch(`${API_ORIGIN}/api/engine/optimizer/jobs`, { method: 'DELETE' }).catch(() => null);
    loadRecentRuns();
  };
  // Pause: stop handing out work; finished backtests are checkpointed and the run resumes from here.
  const pauseOptimization = async () => {
    if (!jobIdRef.current || pausing) return;
    setPausing(true);
    try {
      const r = await fetch(`${API_ORIGIN}/api/engine/optimizer/pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: jobIdRef.current }) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); console.warn('Pause request:', d.error || r.statusText); setPausing(false); }
    } catch (e) { console.error('Failed to send pause request:', e); setPausing(false); }
  };

  // Rejoin a run started elsewhere (offered after a 409).
  const attachToJob = (jobId) => {
    const token = ++runTokenRef.current;
    stopPolling();
    setConflictJobId(null);
    setError(null);
    try { localStorage.setItem(OPT_JOB_KEY, jobId); } catch { /* ignore */ }
    setRunning(true);
    pollJob(jobId, token);
  };

  const pollJob = (jobId, token) => {
    jobIdRef.current = jobId;
    let notFound = 0;
    const tick = async () => {
      if (token !== runTokenRef.current) return; // superseded by a newer run/mount
      try {
        const r = await fetch(`${API_ORIGIN}/api/engine/optimizer/status/${jobId}`);
        const d = await r.json();
        if (token !== runTokenRef.current) return;
        if (d.status === 'running') {
          notFound = 0;
          setRunning(true);
          jobIdRef.current = jobId;
          if (d.progress) setProgress(p => ({ ...p, ...d.progress }));
          if (d.cells) setCells(d.cells);
          pollTimerRef.current = setTimeout(tick, 2000); // socket also streams live progress
        } else if (d.status === 'done') {
          finishJob('done', d.result);
        } else if (d.status === 'paused' || d.status === 'interrupted') {
          finishJob(d.status, d.result || null, jobId);
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
    setConflictJobId(null);
    setRefusal(null);
    setCells(null);
    setResults(null);
    setSelectedResult(null);
    setExpandedStrategy(null);
    setProgress({
      current: 0,
      total: isMulti ? plannedBacktests(budget, selectedStrategies.length, symbols.length) : (Number(config.iterations) || 0) * selectedStrategies.length,
      matches: 0,
      totalStrategies: selectedStrategies.length,
      totalSymbols: symbols.length,
      strategyIndex: 0,
      jobId,
    });

    // Fire the run but DON'T await it for the result — the poller drives
    // progress + completion, so a dropped connection never loses the job.
    fetch(`${API_ORIGIN}/api/engine/optimizer/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...config,
        jobId,
        symbol: config.symbol,
        lot_size: (sizesByLots(config.symbol) && currentLot(config.symbol)) || config.lot_size || 15,
        lots: Math.max(1, parseInt(config.lots, 10) || 1),
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
        futures_expiry: isMulti ? undefined : config.futures_expiry,
        oos_enabled: isMulti ? true : !!config.oos_enabled,
        oos_fraction: config.oos_fraction ?? 0.3,
        // Multi-index: the indexes and the search budget (preset or advanced d1/s2/d2).
        symbols,
        // Several indexes: a preset (or advanced d1/s2/d2). One index: the Iterations field only.
        ...(isMulti
          ? { preset, budget: config.budget && Number(config.budget.d1) > 0 ? config.budget : undefined, iterations: undefined }
          : { preset: undefined, budget: undefined, crossK: undefined }),
      })
    }).then(async (response) => {
      if (token !== runTokenRef.current) return;
      // Surface only IMMEDIATE failures (validation 400 / run 500 / 409 / 503).
      // A normal completion is picked up by the poller from /status.
      if (!response.ok) {
        const d = await response.json().catch(() => ({}));
        if (response.status === 409 && d.activeJobId) {
          stopPolling(); setRunning(false); jobIdRef.current = null;
          try { localStorage.removeItem(OPT_JOB_KEY); } catch { /* ignore */ }
          setConflictJobId(d.activeJobId);
          return;
        }
        if (response.status === 503) setRefusal(Array.isArray(d.reasons) ? d.reasons : []);
        finishJob('error', d.error || `Request failed (${response.status})`);
      } else {
        // 200 can still carry a refusal ({error}) — show it, don't swallow it.
        const d = await response.clone().json().catch(() => null);
        if (d && d.error && !d.type) finishJob('error', d.error);
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
      const res = await fetch(`${API_ORIGIN}/api/engine/optimizer/cancel`, {
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
      fetch(`${API_ORIGIN}/api/engine/optimizer/active`)
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
    'symbols', 'preset', 'budget', 'seed', 'cross_index', 'minSlU', 'optimizer_workers', 'optimizer_block',
    'minTrades', 'minWinRate', 'maxDrawdown', 'minSharpeRatio',
    'min_trades', 'min_win_rate', 'max_drawdown', 'min_sharpe_ratio', 'signal',
    'rank_metric', 'min_consistency', 'combiner_null_runs',
    // run-context (set explicitly + normalized below)
    'symbol', 'strategy', 'resolution', 'start_date', 'end_date', 'startDate', 'endDate',
    'capital', 'lot_size', 'lots', 'dataSource', 'backtest_mode', 'futures_expiry',
    'slippage_percent', 'brokerage_per_order', 'use_ai_prediction',
  ]);

  // Navigate to the Backtester with exactly these params (shared by both result views).
  const goTest = (newBacktestParams, strat) => {
    setBacktestParams(newBacktestParams);
    navigate('/backtest', {
      state: {
        symbol: newBacktestParams.symbol,
        strategy: strat,
        resolution: newBacktestParams.resolution,
        dataSource: newBacktestParams.dataSource,
        backtest_mode: newBacktestParams.backtest_mode,
        params: newBacktestParams,
      },
    });
  };
  // Multi-index "Save": one saved-strategy doc per index (never the global defaults).
  const saveSettings = async (bodies) => {
    for (const b of bodies) {
      const r = await fetch(`${API_ORIGIN}/api/config/strategies/saved`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `HTTP ${r.status}`); }
    }
  };

  // Chips: switching to several indexes moves the form to the multi-index rules
  // (aligned spot source, OOS on, a window the archive covers).
  const setSymbols = (next) => {
    const list = next.length ? next : [config.symbol];
    setConfig(c => {
      const multiNow = list.length > 1;
      const out = { ...c, symbols: list, symbol: list[0], lot_size: instrumentConfig[list[0]]?.lotSize || c.lot_size };
      if (multiNow) {
        if (!['ARCHIVE_SPOT', 'SPOT'].includes(c.dataSource)) out.dataSource = 'ARCHIVE_SPOT';
        out.oos_enabled = true;
        out.backtest_mode = 'Simulated Premium';
        if ((out.dataSource === 'ARCHIVE_SPOT') && (!c.start_date || !c.end_date || c.start_date < SPOT_ARCHIVE_FROM || c.end_date > SPOT_ARCHIVE_TO)) Object.assign(out, MULTI_DEFAULT_WINDOW);
      }
      return out;
    });
  };

  // The exact Backtester settings for a single-index result — Test sends them, Copy JSON copies them.
  const buildSingleTest = (result, strategyId) => {
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
    // One lot TODAY for the symbol (the same rule as every multi-index hand-off), never a
    // stored run's lot: each trade still takes the lot listed on its own day.
    return { newBacktestParams: withCurrentLot(newBacktestParams), tuned, strat, symbol };
  };

  const copyResultJson = (result, strategyId) => {
    const { newBacktestParams, strat } = buildSingleTest(result, strategyId);
    return copyStrategyJson(newBacktestParams, {
      strategy: strat, results: resultsFromRow(result, result.robust === false ? 'overfit' : result.robust ? 'held up' : null),
    });
  };

  const handleTestClick = (result, strategyId) => {
    const { newBacktestParams, tuned, strat, symbol } = buildSingleTest(result, strategyId);
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

  // Out-of-sample columns + robust ranking apply only when this run used OOS.
  const hasOos = !!(results?.runConfig?.oos_enabled);
  // The active ranking key. Backend precomputes BOTH on every result.
  const rankKey = deflateRank ? 'rankScoreDeflated' : 'rankScore';
  const activeRank = (x) => (x && Number.isFinite(x[rankKey]) ? x[rankKey] : null);

  // ── Normalize + RE-RANK result shape (multi vs legacy single) ───────────
  // The toggle just picks which precomputed key orders everything — instant,
  // no re-run, no scoring logic duplicated in JS.
  const strategyGroups = useMemo(() => {
    if (!results) return [];
    const rk = (x) => (x && Number.isFinite(x[rankKey]) ? x[rankKey] : -Infinity);
    const fullPnl = (x) => (x?.full?.totalPnL ?? x?.metrics?.totalPnL ?? 0);
    // -Infinity-safe comparator: overfit (−∞) always sinks below robust sets.
    const cmp = (a, b) => {
      const ra = rk(a), rb = rk(b);
      if (ra !== rb) { if (ra === -Infinity) return 1; if (rb === -Infinity) return -1; return rb - ra; }
      if (!!a?.robust !== !!b?.robust) return a?.robust ? -1 : 1;
      return fullPnl(b) - fullPnl(a);
    };
    const sortSets = (arr) => [...(arr || [])].sort(cmp);

    let groups;
    if (Array.isArray(results.strategies)) {
      groups = results.strategies.map(g => {
        const sets = sortSets(g.best_parameters);
        return { ...g, best_parameters: sets, best: sets[0] || g.best || null };
      });
    } else {
      // Legacy single-strategy shape → wrap into one group.
      const sid = results.strategy || config.strategy || (config.strategies && config.strategies[0]);
      const sets = sortSets(results.best_parameters || []);
      groups = [{
        strategy: sid,
        label: labelFor(sid),
        best_parameters: sets,
        best: sets[0] || null,
        summary: sets[0] ? {
          matches: sets.length,
          score: sets[0].score,
          totalPnL: sets[0].metrics?.totalPnL,
          winRate: sets[0].metrics?.winRate,
          totalTrades: sets[0].metrics?.totalTrades,
          maxDrawdown: sets[0].metrics?.maxDrawdown,
          sharpeRatio: sets[0].metrics?.sharpeRatio,
          profitFactor: sets[0].metrics?.profitFactor,
        } : { matches: 0 },
      }];
    }
    groups.sort((a, b) => cmp(a.best, b.best));
    return groups;
  }, [results, config.strategy, config.strategies, catalog, rankKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Winner = the top-ranked group under the ACTIVE key — but only if it actually
  // held up out-of-sample (robust). Otherwise no trophy (honest "nothing robust").
  // Re-derived client-side so it follows the toggle without a re-run.
  const bestStrategyId = (() => {
    // A signal combiner that failed its crown gates stays listed but is never the winner
    // (the server applies the same rule — see pooledRun.runCombinerGates).
    const top = strategyGroups.find(g => !g.crownBlocked);
    if (!top || !top.best) return null;
    if (!hasOos) return top.strategy;
    return top.best.robust ? top.strategy : null;
  })();
  const totalMatches = strategyGroups.reduce((s, g) => s + (g.best_parameters?.length || 0), 0);

  const overallPct = Math.round((progress.current / (progress.total || 1)) * 100);
  const stratPct = progress.strategyTotal
    ? Math.round((progress.strategyCurrent / (progress.strategyTotal || 1)) * 100)
    : null;

  // ── ETA readout ──────────────────────────────────────────────────────
  // Backend sends raw ms + a confidence flag. We subtract the time elapsed
  // since the snapshot (nowTs - serverNow, clamped ≥0, client clock used only
  // for the delta — never trusted absolutely) so the number ticks down live.
  const etaDrift = progress.serverNow ? Math.max(0, nowTs - progress.serverNow) : 0;
  const liveEtaTotal = progress.etaMsTotal != null ? Math.max(0, progress.etaMsTotal - etaDrift) : null;
  const liveEtaStrategy = progress.etaMsStrategy != null ? Math.max(0, progress.etaMsStrategy - etaDrift) : null;
  // OVERALL (whole-run, all strategies) ETA — the headline.
  let overallEtaLabel = null;
  if (progress.etaConfidence === 'ok') {
    const d = formatDuration(liveEtaTotal);
    overallEtaLabel = d ? `~${d} left` : null;
  } else if (progress.etaConfidence === 'lowerBound') {
    const d = formatDuration(liveEtaTotal);
    overallEtaLabel = d ? `≥ ${d} left` : null;
  }
  if (running && !overallEtaLabel) overallEtaLabel = 'estimating…';
  // PER-STRATEGY "time left" for the current strategy (shown on the strategy line).
  const stratEtaLabel = (liveEtaStrategy != null) ? formatDuration(liveEtaStrategy) : null;

  const renderParamChips = (params) => {
    const entries = Object.entries(params || {}).filter(([k, v]) =>
      !NOISE_PARAM_KEYS.has(k) && v !== undefined && v !== null && v !== '');
    if (!entries.length) return <span className="text-fg-5 text-xs">No tunable params</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {entries.map(([k, v]) => (
          <span key={k} className="text-2xs bg-slate-800 border border-line px-1.5 py-0.5 rounded">
            <span className="text-fg-4">{prettify(k)}:</span>{' '}
            <span className="text-fg-2 font-mono">
              {typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}
            </span>
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader docs="optimizer#overview" icon={Activity} title="Strategy Optimizer"
        subtitle="Grid-search a strategy's parameters with out-of-sample ranking, then bake the winner as its default." />

      <div className={`grid grid-cols-1 gap-8 ${configCollapsed ? 'lg:grid-cols-[3rem_1fr]' : 'lg:grid-cols-3'}`}>
        {configCollapsed ? (
          <div className="bg-surface rounded-xl border border-line flex flex-col items-center py-4 h-fit sticky top-4">
            <button
              onClick={toggleConfigCollapsed}
              title="Expand Parameters"
              className="text-fg-4 hover:text-fg hover:bg-slate-800 rounded p-2 transition-colors"
            >
              <PanelLeftOpen className="w-5 h-5" />
            </button>
            <div
              className="mt-4 text-3xs text-fg-5 font-semibold tracking-widest"
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
            >
              PARAMETERS
            </div>
          </div>
        ) : (
        <div className="bg-surface p-6 rounded-xl border border-line space-y-6 h-fit">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold flex items-center gap-2">Parameters <DocLink to="optimizer#setup" /></h2>
            <button
              onClick={toggleConfigCollapsed}
              title="Collapse Parameters"
              className="text-fg-4 hover:text-fg hover:bg-slate-800 rounded p-1.5 transition-colors"
            >
              <PanelLeftClose className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-4">
            {/* ── Multi-select Strategies ───────────────────────────── */}
            <div ref={stratRef} className="relative">
              <label className="block text-sm font-medium text-fg-4 mb-1">
                Strategies <span className="text-fg-5">({selectedStrategies.length} selected)</span>
              </label>
              <button
                type="button"
                onClick={() => setStratOpen(o => !o)}
                className="w-full bg-slate-900 border border-line rounded p-2 text-fg text-left flex items-center justify-between gap-2 hover:border-line-3"
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
                <div className="absolute z-20 mt-1 w-full bg-slate-900 border border-line rounded-lg shadow-xl max-h-72 overflow-y-auto">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-line-0 sticky top-0 bg-slate-900">
                    <button onClick={selectAllStrategies} className="text-xs text-primary-ink hover:underline">Select all</button>
                    <button onClick={clearStrategies} className="text-xs text-fg-4 hover:underline">Clear</button>
                  </div>
                  {catalog.length === 0 && <div className="px-3 py-2 text-sm text-fg-5">Loading…</div>}
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
                          checked ? 'bg-primary border-primary' : 'border-line-2'
                        }`}>
                          {checked && <Check className="w-3 h-3 text-fg" />}
                        </span>
                        <span className="text-fg-2 flex-1">{c.label}</span>
                        {disabled && (
                          <span className="text-3xs text-fg-5">{needsModel ? 'needs model' : 'not tunable'}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="text-2xs text-fg-5 mt-1">
                {isMulti
                  ? `Every selected strategy is tried on all ${symbols.length} indexes with the same settings, then ranked by how many indexes it holds up on.`
                  : `Each selected strategy is optimized separately (${config.iterations || 0} iterations each) on this symbol, then ranked to find the best.`}
              </p>
              {selectedStrategies.includes('signal_combiner') && (
                <div className="mt-3 rounded-lg border border-line p-3 space-y-2">
                  <p className="text-xs text-fg-3 font-medium">Signal combiner — candidate members <DocLink to="signal-combiner#optimizer" /></p>
                  <p className="text-2xs text-fg-5">
                    Each draw picks 2–6 of these, a rule and its settings; the members' own parameters are never changed by the search.
                    After the run, the best setting on each index must beat every member run alone and random picks from the same members, or it is not crowned.
                  </p>
                  <MemberBuilder value={config.member_pool || DEFAULT_COMBINER_POOL} resolution={config.resolution || '5'}
                    onChange={(pool) => setConfig(c => ({ ...c, member_pool: pool }))} />
                  <label className="flex flex-wrap items-center gap-2 text-2xs text-fg-4">
                    Random-selection runs per index (≥ 19 for p ≤ 0.05)
                    <input type="number" min="5" step="1" className="w-[5rem] bg-slate-900 border border-line rounded p-1 text-fg"
                      value={config.combiner_null_runs ?? 19} onChange={e => setConfig(c => ({ ...c, combiner_null_runs: Number(e.target.value) || 19 }))} />
                  </label>
                </div>
              )}
            </div>

            <div>
              <div className="block text-sm font-medium text-fg-4 mb-1">Exchange</div>
              <Segmented
                options={[{ v: 'FYERS', label: 'NSE / BSE / MCX' }, { v: 'DELTA', label: 'Delta Exchange' }]}
                value={isDeltaSymbol(config.symbol) ? 'DELTA' : 'FYERS'}
                onChange={(v) => {
                  if (v === 'DELTA' && !isDeltaSymbol(config.symbol)) {
                    setConfig({ ...config, symbol: 'DELTA:BTCUSD', symbols: ['DELTA:BTCUSD'], lots: config.lots || 1, delta_leverage: config.delta_leverage ?? 10, holding_enabled: true, trade_start_time: '00:00', trade_end_time: '23:59' });
                  } else if (v === 'FYERS' && isDeltaSymbol(config.symbol)) {
                    const first = Object.keys(instrumentConfig).find(k => k.endsWith('-INDEX')) || 'NSE:NIFTY50-INDEX';
                    setConfig({ ...config, symbol: first, symbols: [first], lot_size: instrumentConfig[first]?.lotSize });
                  }
                }}
              />
              {isDeltaSymbol(config.symbol) && <p className="text-3xs text-fg-5 mt-1">Delta runs one contract at a time (the multi-index pool covers NSE/BSE indexes).</p>}
            </div>

            {isDeltaSymbol(config.symbol) && (
              <div className="space-y-3">
                <DeltaInstrumentPicker id="optimizer-delta-symbol" value={config.symbol} onChange={(sym) => setConfig({ ...config, symbol: sym, symbols: [sym] })} />
                <label htmlFor="optimizer-delta-contracts" className="block text-xs text-fg-4">Contracts
                  <input id="optimizer-delta-contracts" type="number" min="1" step="1" className="w-full bg-slate-900 border border-line rounded p-2 text-fg text-sm"
                    value={config.lots || 1} onChange={e => setConfig({ ...config, lots: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
                </label>
                <DeltaParams symbol={config.symbol} params={config} onChange={setConfig} idPrefix="optimizer-delta" />
              </div>
            )}

            {!isDeltaSymbol(config.symbol) && <IndexChips
              selected={symbols.filter(s => INDEX_SYMBOLS.includes(s))}
              onChange={setSymbols}
              badges={dataCheckResult ? Object.fromEntries(Object.entries(dataCheckResult.symbols || {}).map(([sym, v]) => [sym, {
                ok: !!v.eligible, text: v.eligible ? `✓ ${v.days}d` : `⚠ ${v.days ?? 0}d`, title: v.eligible ? `${v.days} sessions, data OK` : (v.reasons || []).join('; '),
              }])) : {}}
            />}

            {!isMulti && !isDeltaSymbol(config.symbol) && (
            <div>
              <label htmlFor="optimizer-symbol-1" className="block text-sm font-medium text-fg-4 mb-1">Symbol</label>
              <select id="optimizer-symbol-1"
                className="w-full bg-slate-900 border border-line rounded p-2 text-fg"
                value={config.symbol}
                onChange={e => {
                  const newSymbol = e.target.value;
                  const result = instrumentConfig[newSymbol];
                  const newLotSize = result ? result.lotSize : 30;
                  setConfig({ ...config, symbol: newSymbol, symbols: [newSymbol], lot_size: newLotSize });
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
            )}

            {isMulti ? (
              <div>
                <span className="block text-sm font-medium text-fg-4 mb-1">One lot (today)</span>
                <ul className="text-2xs text-fg-3 space-y-0.5" data-testid="multi-lots">
                  {symbols.map(s => {
                    const dc = dataCheckResult?.symbols?.[s];
                    return <li key={s}>{nameOf(s)} {lotText(currentLot(s) ?? dc?.lotSize, dc?.lotWindow)}</li>;
                  })}
                </ul>
                <p className="text-2xs text-fg-5">Each trade uses the exchange lot listed on its own day, so a window that crosses a lot revision is sized correctly on both sides. Not editable here.</p>
              </div>
            ) : isDeltaSymbol(config.symbol) ? null : sizesByLots(config.symbol) ? (
            <div>
              <label htmlFor="optimizer-lots-2" className="block text-sm font-medium text-fg-4 mb-1">Lots</label>
              <input id="optimizer-lots-2" type="number" min="1" step="1"
                className="w-full bg-slate-900 border border-line rounded p-2 text-fg"
                value={Math.max(1, parseInt(config.lots, 10) || 1)}
                onChange={e => setConfig({ ...config, lots: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              />
              <p className="text-2xs text-fg-5 mt-1" data-testid="single-lot">1 lot = {currentLot(config.symbol) ?? '—'} today. Each trade uses the lot listed on its own day.</p>
            </div>
            ) : (
            <div>
              <label htmlFor="optimizer-lot-size-2" className="block text-sm font-medium text-fg-4 mb-1">Lot Size</label>
              <input id="optimizer-lot-size-2"
                type="number"
                className="w-full bg-slate-900 border border-line rounded p-2 text-fg"
                value={config.lot_size || ''}
                onChange={e => setConfig({ ...config, lot_size: e.target.value === '' ? '' : parseInt(e.target.value) })}
              />
            </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="optimizer-start-date-3" className="block text-sm font-medium text-fg-4 mb-1">Start Date</label>
                <input id="optimizer-start-date-3" type="date" className="w-full bg-slate-900 border border-line rounded p-2 text-fg"
                  value={config.start_date} onChange={e => setConfig({ ...config, start_date: e.target.value })} />
              </div>
              <div>
                <label htmlFor="optimizer-end-date-4" className="block text-sm font-medium text-fg-4 mb-1">End Date</label>
                <input id="optimizer-end-date-4" type="date" className="w-full bg-slate-900 border border-line rounded p-2 text-fg"
                  value={config.end_date} onChange={e => setConfig({ ...config, end_date: e.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div>
                <label htmlFor="optimizer-backtest-mode-5" className="block text-sm font-medium text-fg-4 mb-1">Backtest Mode</label>
                <select id="optimizer-backtest-mode-5" className="w-full bg-slate-900 border border-line rounded p-2 text-fg"
                  value={config.backtest_mode || 'Simulated Premium'}
                  onChange={e => setConfig({ ...config, backtest_mode: e.target.value })}>
                  <option value="Simulated Premium">Simulated Premium (Fast & Approx - 0.5 Delta)</option>
                  {!isMulti && <option value="Real Option Data">Real Option Data (Slow & Accurate)</option>}
                </select>
                {isMulti && <p className="text-3xs text-fg-5 mt-1">Real Option Data isn't offered for several indexes: it fetches option history for every trade on every index.</p>}
                {config.backtest_mode === 'Real Option Data' && (
                  <div className="text-3xs text-warning mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    <span>Warning: Extremely slow! Fetches option history for every trade.</span>
                  </div>
                )}
              </div>
              <div>
                <label htmlFor="optimizer-data-source-6" className="block text-sm font-medium text-blue-400 mb-1">Data Source</label>
                <select id="optimizer-data-source-6" className="w-full bg-slate-900 border border-blue-900 rounded p-2 text-fg"
                  value={config.dataSource || 'AUTO'}
                  onChange={e => setConfig({ ...config, dataSource: e.target.value })}>
                  {!isMulti && <option value="AUTO">Auto (Smart Switch)</option>}
                  <option value="SPOT">Spot Data (API)</option>
                  {!isMulti && <option value="FUT">Current Month Future</option>}
                  {!isMulti && <option value="ARCHIVE">📂 Local Archive (Fast)</option>}
                  <option value="ARCHIVE_SPOT">📂 Local archive – spot, all indexes aligned</option>
                  {!isMulti && <option value="SPOT_ARCHIVE">🔁 Spot API + Archive Options</option>}
                </select>
                {isMulti && <p className="text-3xs text-fg-5 mt-1">Several indexes need one clean price basis: the aligned spot archive ({SPOT_ARCHIVE_FROM} → {SPOT_ARCHIVE_TO}) or the broker's spot data.</p>}
              </div>

              {!isMulti && (config.dataSource === 'FUT' || config.backtest_mode === 'Real Option Data') && (
                <div>
                  <label className="block text-sm font-medium text-purple-400 mb-1">
                    {config.backtest_mode === 'Real Option Data' ? 'Options Expiry Date' : 'Futures Expiry Date'}
                  </label>
                  <select className="w-full bg-slate-900 border border-purple-900 rounded p-2 text-fg"
                    value={config.futures_expiry || ''}
                    onChange={e => setConfig({ ...config, futures_expiry: e.target.value })}>
                    <option value="">-- Auto (Match Start Date) --</option>
                    {expiryDates.map((exp) => (<option key={exp.date} value={exp.date}>{exp.label}</option>))}
                  </select>
                  <div className="text-3xs text-fg-5 mt-1">
                    Force a specific contract (e.g. 26FEB) regardless of backtest dates.
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="optimizer-resolution-timeframe-7" className="block text-sm font-medium text-fg-4 mb-1">Resolution (Timeframe)</label>
                <select id="optimizer-resolution-timeframe-7" className="w-full bg-slate-900 border border-line rounded p-2 text-fg"
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
                <p className="text-2xs text-fg-5 mt-1">Applied to every selected strategy.</p>
              </div>
            </div>

            <div>
              <label htmlFor="optimizer-starting-capital-8" className="block text-sm font-medium text-fg-4 mb-1">Starting Capital (₹)</label>
              <input id="optimizer-starting-capital-8" type="number" className="w-full bg-slate-900 border border-line rounded p-2 text-fg"
                value={config.capital || ''}
                onChange={e => setConfig({ ...config, capital: e.target.value === '' ? '' : parseInt(e.target.value) })} />
            </div>

            {isMulti ? (
              <fieldset>
                <legend className="block text-sm font-medium text-fg-4 mb-1">Search depth</legend>
                <div role="radiogroup" aria-label="Search depth" className="grid grid-cols-3 gap-1">
                  {Object.entries(PRESETS).map(([key, p]) => (
                    <button key={key} type="button" role="radio" aria-checked={preset === key && !(config.budget && Number(config.budget.d1) > 0)}
                      onClick={() => setConfig({ ...config, preset: key, budget: null })}
                      className={`text-xs py-1.5 rounded border ${preset === key && !(config.budget && Number(config.budget.d1) > 0) ? 'bg-primary/15 border-primary/50 text-primary-ink' : 'border-line text-fg-3'}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <p className="text-2xs text-fg-5 mt-1">
                  {budget.d1} settings per strategy on every index, then {budget.d2} more for the best {Math.min(budget.s2, selectedStrategies.length || budget.s2)} —
                  about {plannedBacktests(budget, selectedStrategies.length, symbols.length).toLocaleString('en-IN')} backtests in all.
                </p>
                <details className="mt-1">
                  <summary className="text-2xs text-fg-4 cursor-pointer">Advanced</summary>
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    {[['d1', 'Screening settings'], ['s2', 'Strategies kept'], ['d2', 'Extra settings']].map(([k, lbl]) => (
                      <div key={k}>
                        <label htmlFor={`optimizer-budget-${k}`} className="block text-3xs text-fg-5">{lbl}</label>
                        <input id={`optimizer-budget-${k}`} type="number" min="0" className="w-full bg-slate-900 border border-line rounded p-1 text-fg text-xs"
                          value={budget[k]}
                          onChange={e => setConfig({ ...config, budget: { ...budget, [k]: Math.max(0, parseInt(e.target.value) || 0) } })} />
                      </div>
                    ))}
                  </div>
                </details>
              </fieldset>
            ) : (
            <div>
              <label htmlFor="optimizer-iterations-per-strategy-9" className="block text-sm font-medium text-fg-4 mb-1">Iterations per Strategy</label>
              <input id="optimizer-iterations-per-strategy-9" type="number" className="w-full bg-slate-900 border border-line rounded p-2 text-fg"
                value={config.iterations || ''}
                onChange={e => setConfig({ ...config, iterations: e.target.value === '' ? '' : parseInt(e.target.value) })} />
              {selectedStrategies.length > 1 && (
                <p className="text-2xs text-fg-5 mt-1">
                  Total runs: {(Number(config.iterations) || 0) * selectedStrategies.length} ({selectedStrategies.length} strategies × {config.iterations || 0})
                </p>
              )}
            </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="optimizer-min-trades-10" className="block text-sm font-medium text-fg-4 mb-1">Min Trades</label>
                <input id="optimizer-min-trades-10" type="number" className="w-full bg-slate-900 border border-line rounded p-2 text-fg"
                  value={config.minTrades || ''}
                  onChange={e => setConfig({ ...config, minTrades: e.target.value === '' ? '' : parseInt(e.target.value) })} />
              </div>
              <div>
                <label htmlFor="optimizer-min-win-rate-11" className="block text-sm font-medium text-fg-4 mb-1">Min Win Rate %</label>
                <input id="optimizer-min-win-rate-11" type="number" className="w-full bg-slate-900 border border-line rounded p-2 text-fg"
                  value={config.minWinRate || ''}
                  onChange={e => setConfig({ ...config, minWinRate: e.target.value === '' ? '' : parseInt(e.target.value) })} />
              </div>
              <div>
                <label htmlFor="optimizer-max-drawdown-12" className="block text-sm font-medium text-fg-4 mb-1">Max Drawdown %</label>
                <input id="optimizer-max-drawdown-12" type="number" className="w-full bg-slate-900 border border-line rounded p-2 text-fg"
                  value={config.maxDrawdown || ''}
                  onChange={e => setConfig({ ...config, maxDrawdown: e.target.value === '' ? '' : parseInt(e.target.value) })} />
              </div>
              <div>
                <label htmlFor="optimizer-min-sharpe-ratio-13" className="block text-sm font-medium text-fg-4 mb-1">Min Sharpe Ratio</label>
                <input id="optimizer-min-sharpe-ratio-13" type="number" step="0.1" className="w-full bg-slate-900 border border-line rounded p-2 text-fg"
                  value={config.minSharpeRatio !== undefined ? config.minSharpeRatio : ''}
                  onChange={e => setConfig({ ...config, minSharpeRatio: e.target.value === '' ? '' : parseFloat(e.target.value) })} />
              </div>
              <div>
                <label htmlFor="optimizer-min-consistency" className="block text-sm font-medium text-fg-4 mb-1" title="0–100: profitable months × how straight the equity line is, on the training window. 0 = off.">Min Consistency</label>
                <input id="optimizer-min-consistency" type="number" min="0" max="100" step="5" placeholder="off" className="w-full bg-slate-900 border border-line rounded p-2 text-fg"
                  value={config.min_consistency ?? ''}
                  onChange={e => setConfig({ ...config, min_consistency: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </div>
              <div className="col-span-2">
                <span className="block text-sm font-medium text-fg-4 mb-1">Rank settings for <DocLink to="optimizer#consistency" /></span>
                <Segmented size="md" value={config.rank_metric || 'standard'}
                  onChange={v => setConfig(c => ({ ...c, rank_metric: v === 'standard' ? undefined : v }))}
                  options={[
                    { v: 'standard', label: 'Best risk-adjusted', hint: 'The usual score: Sharpe, profit factor, per-trade edge, drawdown, out-of-sample discount' },
                    { v: 'consistency', label: 'Steady across the range', hint: 'The same score plus a strong reward for making money in most months with a straight equity line' },
                  ]} />
                <p className="text-2xs text-fg-5 mt-1">
                  {config.rank_metric === 'consistency'
                    ? 'Settings that make money in most months with a straight equity line rank higher; ones whose profit comes from one stretch rank lower. Settings must still hold up out-of-sample.'
                    : 'Sharpe and total P&L summarise the whole range, so a setting that is flat for a year and jumps at the end can rank high. Pick “Steady” to prefer settings that earn throughout.'}
                </p>
              </div>
              <div>
                <label htmlFor="optimizer-slippage-14" className="block text-sm font-medium text-fg-4 mb-1">Slippage (%)</label>
                <input id="optimizer-slippage-14" type="number" step="0.01" className="w-full bg-slate-900 border border-line rounded p-2 text-fg"
                  value={config.slippage_percent !== undefined ? config.slippage_percent : 0.05}
                  onChange={e => setConfig({ ...config, slippage_percent: e.target.value })} />
              </div>
              <div>
                <label htmlFor="optimizer-brokerage-15" className="block text-sm font-medium text-fg-4 mb-1">Brokerage (₹)</label>
                <input id="optimizer-brokerage-15" type="number" className="w-full bg-slate-900 border border-line rounded p-2 text-fg"
                  value={config.brokerage_per_order !== undefined ? config.brokerage_per_order : 20}
                  onChange={e => setConfig({ ...config, brokerage_per_order: e.target.value })} />
              </div>
            </div>

            {/* Switch recipe (knob ring, role="switch", aria-labelledby) is documented on the OOS switch below. */}
            {/* ── Out-of-sample (walk-forward) validation ─────────────── */}
            <div className="p-3 bg-slate-800 rounded-lg border border-line space-y-2">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={isMulti ? true : !!config.oos_enabled}
                  aria-labelledby={oosLabelId}
                  aria-disabled={isMulti ? true : undefined}
                  onClick={() => { if (!isMulti) setConfig({ ...config, oos_enabled: !config.oos_enabled }); }}
                  className={`w-10 h-6 shrink-0 rounded-full p-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${(isMulti || config.oos_enabled) ? 'bg-success' : 'bg-slate-600'} ${isMulti ? 'cursor-not-allowed' : ''}`}
                >
                  {/* The knob keeps `bg-white` but carries a gray-300 hairline: on light themes the
                      ring, not the face, delineates it. A real <button role="switch"> (keyboard +
                      announced state), named by aria-labelledby — a <label> can't point at a button. */}
                  <span className={`block w-4 h-4 bg-white border border-gray-300 rounded-full transition-transform ${(isMulti || config.oos_enabled) ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
                <span id={oosLabelId} className="text-sm font-medium text-fg-3">Out-of-Sample Validation 🛡️{isMulti && <span className="text-2xs text-fg-5 font-normal"> — on, required to judge across indexes</span>}</span>
              </div>
              <p className="text-2xs text-fg-5">
                Optimizes on the earlier part of the range and <span className="text-fg-3">validates on a held-out tail</span> it never saw — so overfit sets (great in-sample, bad out-of-sample) are flagged, not picked.
              </p>
              {(isMulti || config.oos_enabled) && (
                <div className="flex items-center gap-2">
                  <label htmlFor="optimizer-test-held-out-16" className="text-xs text-fg-4">Test (held-out) %</label>
                  <input id="optimizer-test-held-out-16" type="number" min={isMulti ? 20 : 10} max="60" step="5"
                    className="w-20 bg-slate-900 border border-line rounded p-1 text-fg text-sm"
                    value={Math.round((config.oos_fraction ?? 0.3) * 100)}
                    onChange={e => {
                      const pct = Math.min(60, Math.max(isMulti ? 20 : 10, parseInt(e.target.value) || 30));
                      setConfig({ ...config, oos_fraction: pct / 100 });
                    }} />
                  <span className="text-2xs text-fg-5">
                    train {100 - Math.round((config.oos_fraction ?? 0.3) * 100)}% / test {Math.round((config.oos_fraction ?? 0.3) * 100)}%
                  </span>
                </div>
              )}
            </div>

            {isMulti && (
              <DataCheckPanel symbols={symbols} dataSource={config.dataSource || 'ARCHIVE_SPOT'} start={config.start_date} end={config.end_date}
                oosFraction={config.oos_fraction ?? 0.3} onResult={setDataCheckResult} />
            )}

            <button onClick={startOptimization} disabled={running || selectedStrategies.length === 0}
              className="w-full bg-primary hover:bg-blue-600 text-on-primary font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {running ? 'Optimizing...' : <><Play className="w-4 h-4" /> Optimize {selectedStrategies.length || 0} Strateg{selectedStrategies.length === 1 ? 'y' : 'ies'}{isMulti ? ` on ${symbols.length} indexes` : ''}</>}
            </button>

            {conflictJobId && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/40 rounded text-warning text-sm space-y-2" role="alert">
                <p>A run is already in progress — only one optimizer run at a time.</p>
                <button type="button" onClick={() => attachToJob(conflictJobId)} className="text-xs bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 px-3 py-1 rounded">Attach to the running job</button>
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/50 rounded text-danger text-sm" role="alert">
                <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />{error}</span>
                {refusal && refusal.length > 0 && <ul className="mt-1 text-2xs list-disc pl-6">{refusal.map((r, i) => <li key={i}>{r}</li>)}</ul>}
              </div>
            )}
          </div>
        </div>
        )}

        <div className={`${configCollapsed ? '' : 'lg:col-span-2'} bg-surface p-6 rounded-xl border border-line min-h-[400px]`}>
          {running && (isMulti || (progress.totalSymbols || 0) > 1) ? (
            <ProgressGrid progress={progress} cells={cells} symbols={symbols.length > 1 ? symbols : (Object.keys(cells || {}).map(k => k.split('::')[0]).filter((v, i, a) => a.indexOf(v) === i))}
              strategies={selectedStrategies} labelFor={labelFor} etaLabel={overallEtaLabel} onStop={stopOptimization} stopping={stopping}
              onPause={pauseOptimization} pausing={pausing} resumedFrom={progress.resumedFrom}
              kDefault={defaultK(symbols.length)} />
          ) : running ? (
            <div className="h-full flex flex-col items-center justify-center space-y-6">
              <div className="relative w-32 h-32">
                {/* Progress ring. The groove was `stroke="#1e293b"` (neutral-800) — the card's
                    OWN shade, so on a light theme it would be a white groove on a white card.
                    `stroke-line` is the hairline role and is visible in all 12 themes. The arc
                    stays blue-500 because shades 700/600/500 keep their saturated mid-tone in
                    both modes (spec 2c), so it needs no inversion. */}
                <svg className="w-full h-full" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="45" fill="none" className="stroke-line" strokeWidth="8" />
                  <circle cx="50" cy="50" r="45" fill="none" strokeWidth="8"
                    strokeDasharray="283"
                    strokeDashoffset={283 - (283 * progress.current / (progress.total || 1))}
                    className="stroke-blue-500 transition-all duration-300 ease-out" transform="rotate(-90 50 50)" />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center flex-col">
                  <span className="text-2xl font-bold text-fg">{overallPct}%</span>
                </div>
              </div>

              <div className="text-center space-y-2">
                <p className="text-xl font-bold text-fg">Running Optimization...</p>
                {overallEtaLabel && (
                  <p className="text-sm text-warning font-semibold" title="Estimated time for the WHOLE run — the current strategy's remaining time plus every strategy still queued.">
                    ⏳ Overall ETA: {overallEtaLabel}
                    {progress.totalStrategies > 1 && (
                      <span className="text-warning/60 font-normal"> · all {progress.totalStrategies} strategies</span>
                    )}
                  </p>
                )}
                {progress.totalStrategies > 1 && progress.strategyLabel && (
                  <p className="text-fg-3">
                    Strategy {(progress.strategyIndex ?? 0) + 1} / {progress.totalStrategies}:{' '}
                    <span className="text-primary-ink font-semibold">{progress.strategyLabel}</span>
                    {stratPct != null && <span className="text-fg-4"> ({stratPct}%)</span>}
                    {stratEtaLabel && <span className="text-fg-5"> · this strategy ~{stratEtaLabel}</span>}
                  </p>
                )}
                <p className="text-fg-4">Overall {progress.current} of {progress.total}</p>
                <p className="text-success font-medium">Found {progress.matches} sets that pass the filters{progress.strategyLabel ? ' in the current strategy' : ' so far'}</p>
                {(progress.current || 0) >= 20 && progress.tradesSeen === 0 && (
                  <p className="text-sm text-warning max-w-md" role="status">
                    ⚠ {progress.current} settings tried and not one has made a single trade. Usually the capital can't afford one lot of this contract,
                    or the date range has no data the strategy can trade — consider stopping and checking the capital and dates.
                  </p>
                )}
              </div>

              {progress.resumedFrom > 0 && <p className="text-2xs text-fg-4">♻️ Resumed from a checkpoint — {progress.resumedFrom} backtests were already done.</p>}
              <div className="flex flex-wrap gap-2 justify-center">
                <button
                  type="button"
                  onClick={pauseOptimization}
                  disabled={pausing || stopping}
                  className="mt-2 bg-slate-700 hover:bg-slate-600 text-fg font-semibold py-2 px-5 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {pausing ? 'Pausing — saving checkpoint…' : 'Pause'}
                </button>
                <button
                  onClick={stopOptimization}
                  disabled={stopping || pausing}
                  className="mt-2 bg-red-600/90 hover:bg-red-600 text-white font-semibold py-2 px-5 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Square className="w-4 h-4" />
                  {stopping ? 'Stopping — collecting results…' : 'Stop & Keep Results'}
                </button>
              </div>
              <p className="text-2xs text-fg-5 max-w-xs text-center">
                Pause keeps a checkpoint and continues later from exactly here. Stop shows the best found so far (it can still be continued from Recent runs).
              </p>
            </div>
          ) : !results && pausedJobId ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
              <p className="text-lg font-bold text-fg">Run paused</p>
              <p className="text-sm text-fg-4">Finished backtests are saved. Resume continues from the checkpoint.</p>
              <button type="button" onClick={() => resumeJob(pausedJobId)} disabled={resumingJobId === pausedJobId}
                className="bg-primary hover:bg-blue-600 text-on-primary font-semibold py-2 px-5 rounded-lg disabled:opacity-60">
                {resumingJobId === pausedJobId ? 'Resuming…' : 'Resume'}
              </button>
            </div>
          ) : results && results.type === 'multi_index_optimization_result' ? (
            <div className="space-y-3">
              {pausedJobId && (
                <div className="p-3 rounded border bg-amber-500/10 border-amber-500/40 text-warning text-sm flex flex-wrap items-center gap-3" role="status">
                  <span>Paused — these are partial results. Resume continues from the checkpoint.</span>
                  <button type="button" onClick={() => resumeJob(pausedJobId)} disabled={resumingJobId === pausedJobId} className="text-xs bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 px-3 py-1 rounded">
                    {resumingJobId === pausedJobId ? 'Resuming…' : 'Resume'}
                  </button>
                </div>
              )}
              <CrossIndexResults result={results} onTest={goTest} onSave={saveSettings} onClear={clearResults} noise={NOISE_PARAM_KEYS} />
              <CombinerCrownPanel result={results} />
            </div>
          ) : results ? (
            <div className="space-y-6">
              {pausedJobId && (
                <div className="p-3 rounded border bg-amber-500/10 border-amber-500/40 text-warning text-sm flex flex-wrap items-center gap-3" role="status">
                  <span>Paused — these are partial results. Resume continues from the checkpoint.</span>
                  <button type="button" onClick={() => resumeJob(pausedJobId)} disabled={resumingJobId === pausedJobId} className="text-xs bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 px-3 py-1 rounded">
                    {resumingJobId === pausedJobId ? 'Resuming…' : 'Resume'}
                  </button>
                </div>
              )}
              <div className="flex justify-between items-start gap-3">
                <div>
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-success" />
                    Optimization Results
                    <DocLink to="optimizer#results" />
                  </h2>
                  {/* Run context — what these results were optimized on (from the
                      self-describing result, so it stays correct after refresh). */}
                  {(() => {
                    const rc = results.runConfig || {};
                    const sym = rc.symbol || results.symbol;
                    const symLabel = (sym && instrumentConfig[sym]?.underlying) || sym;
                    const resLabel = rc.resolution != null ? (RESOLUTION_LABELS[String(rc.resolution)] || `${rc.resolution}m`) : null;
                    if (!sym) return null;
                    return (
                      <div className="text-2xs text-fg-5 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-fg-3">{symLabel}</span>
                        {resLabel && <span>· {resLabel}</span>}
                        {rc.start_date && rc.end_date && <span>· {rc.start_date} → {rc.end_date}</span>}
                        {rc.capital != null && <span>· ₹{Number(rc.capital).toLocaleString('en-IN')}</span>}
                        {rc.backtest_mode && <span>· {rc.backtest_mode}</span>}
                        {rc.oos_enabled && rc.oos_split_date && (
                          <span className="text-success">· 🛡️ OOS: train→{rc.oos_split_date}, test after ({Math.round((rc.oos_fraction ?? 0.3) * 100)}%)</span>
                        )}
                        {Array.isArray(rc.warnings) && rc.warnings.length > 0 && (
                          <ul className="w-full mt-1 space-y-0.5 text-warning" aria-label="Data warnings for this run">
                            {rc.warnings.map((w, i) => <li key={i} className="flex gap-1"><AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" /><span>{w}</span></li>)}
                          </ul>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className="text-sm text-fg-4 flex items-center gap-2">
                    {results.stopped && (
                      <span className="text-2xs px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-warning">
                        ⏹ Stopped early{results.completed_strategies != null ? ` · ${results.completed_strategies}/${progress.totalStrategies || results.completed_strategies} strategies` : ''}
                      </span>
                    )}
                    {strategyGroups.length} strateg{strategyGroups.length === 1 ? 'y' : 'ies'} · {totalMatches} profitable sets
                  </span>
                  {hasOos && (
                    <button
                      onClick={toggleDeflateRank}
                      title={"Anti data-mining ranking. Penalizes the in-sample→out-of-sample performance gap (overfitting) and the best-of-N selection bias from trying thousands of param-sets (López de Prado / Bailey, 'Deflated Sharpe'). ON is recommended — it re-ranks instantly, no re-run. OFF ranks by the raw robust score."}
                      className={`text-2xs px-2.5 py-1 rounded-full border transition-colors ${deflateRank
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-success hover:bg-emerald-500/25'
                        : 'bg-slate-700/60 border-line-2 text-fg-3 hover:bg-slate-700'}`}
                    >
                      {deflateRank ? '🛡️ Anti-overfit ranking: ON' : 'Anti-overfit ranking: OFF'}
                    </button>
                  )}
                  <button
                    onClick={clearResults}
                    className="text-xs bg-slate-700 hover:bg-red-600/80 text-fg-2 px-3 py-1 rounded transition-colors"
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
                  // Distinguish "nothing profitable at all" from "things looked good
                  // in-sample but ALL failed the held-out window" (overfit) — the
                  // latter is the honest, important signal when OOS is on.
                  const overfitOnly = hasOos && totalMatches > 0;
                  return (
                    <div className="p-4 bg-yellow-500/10 border border-yellow-500/40 rounded-lg text-warning text-sm flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      {overfitOnly
                        ? 'No strategy held up out-of-sample. Every candidate that looked good on the training window failed on the held-out window — i.e. overfit. Nothing here is safe to trade as-is; widen the date range, loosen the filters, or try other strategies. (Sets are still listed below for inspection, dimmed.)'
                        : 'No profitable parameter set met the criteria for any strategy. Try loosening the filters or widening the date range.'}
                    </div>
                  );
                }
                const m = winner.best.metrics || {};
                return (
                  <div className="p-4 bg-gradient-to-r from-amber-500/10 to-slate-900/0 border border-amber-500/40 rounded-lg">
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <Trophy className="w-5 h-5 text-warning" />
                      <span className="text-warning font-bold">Best Strategy: {winner.label}</span>
                      <span className="text-xs text-fg-4">(score {fmtScore(hasOos && winner.best.robust ? activeRank(winner.best) : winner.best.score)})</span>
                      {hasOos && winner.best.oos && (
                        winner.best.robust
                          ? <span className="text-2xs px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-success">🛡️ Holds up out-of-sample</span>
                          : <span className="text-2xs px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/40 text-danger">⚠ Overfit — fails out-of-sample</span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center">
                      <div><div className="text-2xs text-fg-4">P&L{hasOos ? ' (IS)' : ''}</div><div className="font-mono text-success">{fmtPnL(m.totalPnL)}</div></div>
                      <div><div className="text-2xs text-fg-4">Win Rate</div><div className="text-success">{m.winRate}%</div></div>
                      <div><div className="text-2xs text-fg-4">Trades</div><div>{m.totalTrades}</div></div>
                      <div><div className="text-2xs text-fg-4">Max DD</div><div className="text-danger">{m.maxDrawdown}%</div></div>
                      <div><div className="text-2xs text-fg-4">Sharpe</div><div className="text-blue-400">{m.sharpeRatio}</div></div>
                      <div><div className="text-2xs text-fg-4">Profit Factor</div><div className="text-purple-300">{fmtPF(m.profitFactor)}</div></div>
                    </div>
                    {hasOos && winner.best.oos && (
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center mt-2 pt-2 border-t border-amber-500/20">
                        <div><div className="text-2xs text-success">OOS P&L</div><div className={`font-mono ${(winner.best.oos.totalPnL ?? 0) > 0 ? 'text-success' : 'text-danger'}`}>{fmtPnL(winner.best.oos.totalPnL)}</div></div>
                        <div><div className="text-2xs text-success">OOS Win%</div><div className="text-success">{winner.best.oos.winRate}%</div></div>
                        <div><div className="text-2xs text-success">OOS Trades</div><div>{winner.best.oos.totalTrades}</div></div>
                        <div><div className="text-2xs text-success">OOS Max DD</div><div className="text-danger">{winner.best.oos.maxDrawdown}%</div></div>
                        <div><div className="text-2xs text-success">OOS Sharpe</div><div className="text-blue-400">{winner.best.oos.sharpeRatio}</div></div>
                        <div><div className="text-2xs text-success">OOS PF</div><div className="text-purple-300">{fmtPF(winner.best.oos.profitFactor)}</div></div>
                      </div>
                    )}
                    {/* FULL-RANGE reconciliation — the single most-confusing thing
                        about OOS results: the headline P&L above is the in-sample
                        (train, ~70%) window, but the Backtester runs the WHOLE range.
                        Execution is parity-clean (proven by backend/scripts/parityHarness.js),
                        so the Backtester reproduces THESE full-range numbers 1:1. */}
                    {hasOos && winner.best.full && (
                      <div className="mt-3 pt-2 border-t border-amber-500/20 text-2xs flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-fg-3 font-medium">📐 Full range (what the Backtester reproduces 1:1):</span>
                        <span className="text-fg-4">P&L <span className={`font-mono ${pnlTone((winner.best.full.totalPnL ?? 0))}`}>{fmtPnL(winner.best.full.totalPnL)}</span></span>
                        <span className="text-fg-4">Win <span className="text-fg-2">{winner.best.full.winRate}%</span></span>
                        <span className="text-fg-4">Trades <span className="text-fg-2">{winner.best.full.totalTrades}{winner.best.full.tradingDays ? ` (${(winner.best.full.totalTrades / winner.best.full.tradingDays).toFixed(1)}/day)` : ''}</span></span>
                        <span className="text-fg-4">Max DD <span className="text-danger">{winner.best.full.maxDrawdown}%</span></span>
                        <span className="text-fg-5 w-full">↳ The “P&L (IS)” above is the in-sample {Math.round((1 - (results.runConfig?.oos_fraction ?? 0.3)) * 100)}% window used for selection — it is intentionally NOT what a full backtest shows.</span>
                      </div>
                    )}
                    <button
                      className="mt-3 text-xs bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-warning px-3 py-1.5 rounded"
                      title={winner.best.full ? `Replays the exact recorded params over the full range — expect ≈ ${fmtPnL(winner.best.full.totalPnL)} P&L · ${winner.best.full.winRate}% win · ${winner.best.full.totalTrades} trades` : 'Replays the exact recorded params over the full range'}
                      onClick={() => handleTestClick(winner.best, winner.strategy)}>
                      Test best on Backtester →
                    </button>
                    <button type="button"
                      className="mt-3 ml-2 text-xs bg-slate-700 hover:bg-slate-600 text-fg px-3 py-1.5 rounded inline-flex items-center gap-1"
                      title="Copy the best settings as strategy JSON — paste in Backtest → Import JSON"
                      onClick={() => copyResultJson(winner.best, winner.strategy)}>
                      <Copy className="w-3 h-3" aria-hidden="true" />Copy JSON
                    </button>
                  </div>
                );
              })()}

              {/* ── Strategy leaderboard ──────────────────────────── */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-fg-4 border-b border-line text-sm">
                      <th className="p-2 w-6"></th>
                      <th className="p-2">#</th>
                      <th className="p-2">Strategy</th>
                      <th className="p-2">Score</th>
                      <th className="p-2">Win Rate</th>
                      <th className="p-2">Best P&L</th>
                      <th className="p-2">Trades</th>
                      <th className="p-2">Max DD</th>
                      <th className="p-2">Sharpe</th>
                      <th className="p-2">PF</th>
                      <th className="p-2" title="0–100: profitable months × straightness of the equity line (full window)">Consistency</th>
                      {hasOos && <th className="p-2 text-success">Out-of-Sample</th>}
                      <th className="p-2">Sets</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {strategyGroups.map((g, idx) => {
                      // Under OOS, headline columns show the REPRODUCIBLE full-range
                      // metrics (what "Test" shows + what ranking aligns to), not the
                      // train-only 70% window. OOS columns still show the held-out view.
                      const m = (hasOos && g.best?.full) ? g.best.full : (g.best?.metrics || {});
                      const isWinner = g.strategy === bestStrategyId && g.best;
                      const isOpen = expandedStrategy === g.strategy;
                      return (
                        <React.Fragment key={g.strategy}>
                          <tr
                            className={`border-b border-line-0 hover:bg-slate-800/50 cursor-pointer transition-colors ${isOpen ? 'bg-slate-800/60' : ''}`}
                            onClick={() => setExpandedStrategy(isOpen ? null : g.strategy)}>
                            <td className="p-2 text-fg-5">
                              {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </td>
                            <td className="p-2 font-bold text-primary-ink">#{idx + 1}</td>
                            <td className="p-2 font-medium text-fg-2">
                              <span className="flex items-center gap-1.5">
                                {isWinner && <Trophy className="w-3.5 h-3.5 text-warning" />}
                                {g.label}
                              </span>
                            </td>
                            {g.best ? (
                              <>
                                <td className="p-2 font-mono text-warning">
                                  {hasOos
                                    ? (g.best.robust
                                        ? fmtScore(activeRank(g.best))
                                        : <span className="text-danger/70 text-2xs">overfit</span>)
                                    : fmtScore(g.best.score)}
                                </td>
                                <td className="p-2 text-success">{m.winRate}%</td>
                                <td className="p-2 font-mono">{fmtPnL(m.totalPnL)}</td>
                                <td className="p-2">{m.totalTrades}{m.tradingDays ? <span className="text-fg-5" title="trades per trading day"> ({(m.totalTrades / m.tradingDays).toFixed(1)}/d)</span> : null}</td>
                                <td className="p-2 text-danger">{m.maxDrawdown}%</td>
                                <td className="p-2 text-blue-400">{m.sharpeRatio}</td>
                                <td className="p-2 text-purple-300">{fmtPF(m.profitFactor)}</td>
                                <td className="p-2" title={consistencyVerdict(m.consistency?.score)}>{consistencyText(m.consistency?.score)}</td>
                                {hasOos && (
                                  <td className="p-2">
                                    {g.best.oos ? (
                                      <span className="flex items-center gap-1.5">
                                        <span className={`font-mono ${(g.best.oos.totalPnL ?? 0) > 0 ? 'text-success' : 'text-danger'}`}>{fmtPnL(g.best.oos.totalPnL)}</span>
                                        {g.best.robust
                                          ? <span className="text-3xs px-1 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-success">Robust ✓</span>
                                          : <span className="text-3xs px-1 py-0.5 rounded bg-red-500/15 border border-red-500/40 text-danger">Overfit ⚠</span>}
                                      </span>
                                    ) : <span className="text-fg-5">—</span>}
                                  </td>
                                )}
                                <td className="p-2 text-fg-4">{g.best_parameters?.length || 0}</td>
                              </>
                            ) : (
                              <td className="p-2 text-fg-5 italic" colSpan={hasOos ? 10 : 9}>
                                {g.error ? `Error: ${g.error}` : noSetReason(g)}
                              </td>
                            )}
                          </tr>
                          {g.combinerGates && (
                            <tr className="border-b border-line-0">
                              <td colSpan={hasOos ? 13 : 12} className="p-3 bg-slate-900/30">
                                <CombinerGates gates={g.combinerGates} />
                              </td>
                            </tr>
                          )}

                          {/* Expanded: this strategy's top parameter sets */}
                          {isOpen && g.best_parameters?.length > 0 && (
                            <tr className="bg-slate-900/40">
                              <td colSpan={hasOos ? 13 : 12} className="p-3">
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left border-collapse">
                                    <thead>
                                      <tr className="text-fg-5 text-xs border-b border-line-0">
                                        <th className="p-2">Rank</th>
                                        <th className="p-2">Score</th>
                                        <th className="p-2">{hasOos ? 'Win% (IS)' : 'Win Rate'}</th>
                                        <th className="p-2">{hasOos ? 'P&L (IS)' : 'P&L'}</th>
                                        <th className="p-2">Trades</th>
                                        <th className="p-2">Max DD</th>
                                        <th className="p-2">Sharpe</th>
                                        <th className="p-2">PF</th>
                                        <th className="p-2" title="0–100, full window">Consistency</th>
                                        {hasOos && <th className="p-2 text-success">OOS P&L</th>}
                                        {hasOos && <th className="p-2 text-success">OOS Win%</th>}
                                        {hasOos && <th className="p-2">Verdict</th>}
                                        <th className="p-2">Params</th>
                                        <th className="p-2">Action</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {g.best_parameters.slice(0, 25).map((res, ridx) => {
                                        // Full-range (reproducible) metrics under OOS; train metrics otherwise.
                                        const rm = (hasOos && res.full) ? res.full : (res.metrics || {});
                                        // Stable key from the (deduped) param set so row
                                        // selection survives re-renders/reordering.
                                        const rowKey = `${g.strategy}::${JSON.stringify(res.params)}`;
                                        return (
                                          <tr key={rowKey}
                                            className={`border-b border-line-0/60 hover:bg-slate-800/40 cursor-pointer ${selectedResult === res ? 'bg-slate-800/70' : ''}`}
                                            onClick={() => setSelectedResult(res)}>
                                            <td className="p-2 font-bold text-primary-ink">#{ridx + 1}</td>
                                            <td className="p-2 font-mono text-warning">
                                              {hasOos
                                                ? (res.robust
                                                    ? fmtScore(activeRank(res))
                                                    : <span className="text-danger/70 text-2xs">overfit</span>)
                                                : fmtScore(res.score)}
                                            </td>
                                            <td className="p-2 text-success">{rm.winRate}%</td>
                                            <td className="p-2 font-mono">{fmtPnL(rm.totalPnL)}</td>
                                            <td className="p-2">{rm.totalTrades}{rm.tradingDays ? <span className="text-fg-5" title="trades per trading day"> ({(rm.totalTrades / rm.tradingDays).toFixed(1)}/d)</span> : null}</td>
                                            <td className="p-2 text-danger">{rm.maxDrawdown}%</td>
                                            <td className="p-2 text-blue-400">{rm.sharpeRatio}</td>
                                            <td className="p-2 text-purple-300">{fmtPF(rm.profitFactor)}</td>
                                            <td className="p-2" title={consistencyVerdict(rm.consistency?.score)}>{consistencyText(rm.consistency?.score)}{res.oos?.consistency ? <span className="text-fg-5"> · test {consistencyText(res.oos.consistency.score)}</span> : null}</td>
                                            {hasOos && (
                                              <td className={`p-2 font-mono ${(res.oos?.totalPnL ?? 0) > 0 ? 'text-success' : 'text-danger'}`}>
                                                {res.oos ? fmtPnL(res.oos.totalPnL) : '—'}
                                                {res.oos != null && <span className="text-fg-5"> ({res.oos.totalTrades}t)</span>}
                                              </td>
                                            )}
                                            {hasOos && <td className="p-2 text-success">{res.oos ? `${res.oos.winRate}%` : '—'}</td>}
                                            {hasOos && (
                                              <td className="p-2">
                                                {res.robust
                                                  ? <span className="text-3xs px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-success">Robust ✓</span>
                                                  : <span className="text-3xs px-1.5 py-0.5 rounded bg-red-500/15 border border-red-500/40 text-danger">Overfit ⚠</span>}
                                              </td>
                                            )}
                                            <td className="p-2 max-w-md">{renderParamChips(res.params)}</td>
                                            <td className="p-2">
                                              <div className="flex gap-1">
                                                <button className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-fg"
                                                  title={res.full ? `Backtester (full range) reproduces ≈ ${fmtPnL(res.full.totalPnL)} · ${res.full.winRate}% win · ${res.full.totalTrades} trades${hasOos ? ' (the columns above are in-sample/OOS, not full-range)' : ''}` : 'Replays the exact recorded params'}
                                                  onClick={(e) => { e.stopPropagation(); handleTestClick(res, g.strategy); }}>
                                                  Test
                                                </button>
                                                <button type="button" className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-fg inline-flex items-center gap-1"
                                                  onClick={(e) => { e.stopPropagation(); copyResultJson(res, g.strategy); }}
                                                  title="Copy as strategy JSON — paste in Backtest → Import JSON" aria-label={`Copy strategy JSON for ${g.strategy}`}>
                                                  <Copy className="w-3 h-3" aria-hidden="true" />JSON
                                                </button>
                                                <button className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-fg"
                                                  onClick={(e) => { e.stopPropagation(); setSelectedResult(res); }} title="View the raw result (not importable — use Copy JSON for that)">
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
                                    <p className="text-2xs text-fg-5 mt-2">Showing top 25 of {g.best_parameters.length} sets.</p>
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

              {/* Entries the account couldn't afford (counted by the engine, never silent). */}
              {(() => {
                const n = strategyGroups.reduce((a, g) => a + ((g.drop_stats && (g.drop_stats.capitalSkippedEntries ?? g.drop_stats.capitalSkips)) || 0), 0);
                return n > 0 ? (
                  <div className="text-2xs text-warning" role="status">
                    ⚠ {n.toLocaleString('en-IN')} entry signals across all settings weren't traded because the balance couldn't afford one lot at the time
                    {results.runConfig?.capital != null ? ` (starting capital ₹${Number(results.runConfig.capital).toLocaleString('en-IN')})` : ''}. Results above only include the trades that could be paid for — raise capital or pick a smaller contract to see the rest.
                  </div>
                ) : null;
              })()}

              {/* Skipped strategies note */}
              {results.skipped_strategies?.length > 0 && (
                <div className="text-2xs text-fg-5">
                  Skipped (no tunable parameters): {results.skipped_strategies.map(labelFor).join(', ')}
                </div>
              )}

              {selectedResult && (
                <div className="p-4 bg-slate-900/50 rounded-lg border border-line-0">
                  <h3 className="font-bold mb-2 text-fg-3 flex items-center gap-2">
                    <Code className="w-4 h-4 text-primary-ink" />
                    Selected Parameters JSON
                    {selectedResult.strategy && <span className="text-xs text-fg-5">({labelFor(selectedResult.strategy)})</span>}
                    <button type="button" className="ml-auto text-xs bg-slate-700 hover:bg-slate-600 text-fg px-2 py-1 rounded inline-flex items-center gap-1 font-normal"
                      onClick={() => copyResultJson(selectedResult, selectedResult.strategy)} title="Copy as strategy JSON — paste in Backtest → Import JSON">
                      <Copy className="w-3 h-3" aria-hidden="true" />Copy importable JSON
                    </button>
                  </h3>
                  <p className="text-2xs text-fg-5 mb-2">Below are this result's raw parameters. Copy importable JSON adds the run context (index, dates, data source, costs) so the Backtester can load it.</p>
                  {/* bg-bg-2 (the sunken-surface role), not bg-black: `--color-black` is pinned
                      to #000 in every theme by design, so text-fg-5 on it drops to 1.7:1 on the
                      light themes. bg-2 is #0e1117-dark / near-white-light and keeps the ink
                      readable in all 12. */}
                  <pre className="text-xs text-fg-5 overflow-x-auto p-2 bg-bg-2 rounded">
                    {JSON.stringify(selectedResult.params, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col gap-6">
              <p className="text-fg-5 text-center pt-8">Select one or more strategies and run optimization to see the best parameters.</p>
              <RecentRuns runs={recentRuns} onOpen={openRecentRun} onResume={resumeJob} onDelete={deleteJob}
                onClearFinished={clearFinishedJobs} onAttach={attachToJob} busyJobId={resumingJobId} />
            </div>
          )}
        </div>
      </div>
      {(results || running) && recentRuns && (
        <details className="bg-surface p-4 rounded-xl border border-line">
          <summary className="text-sm text-fg-3 cursor-pointer">Recent runs ({(recentRuns.jobs || []).length})</summary>
          <div className="mt-3">
            <RecentRuns runs={recentRuns} onOpen={openRecentRun} onResume={resumeJob} onDelete={deleteJob}
              onClearFinished={clearFinishedJobs} onAttach={attachToJob} busyJobId={resumingJobId} />
          </div>
        </details>
      )}
    </div>
  );
}
