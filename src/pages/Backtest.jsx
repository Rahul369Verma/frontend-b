import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { Play, Activity, ChevronDown, ChevronUp, Bot, Copy, Check } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useGlobalState } from '../context/GlobalContext';

const API_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;

// LOT_SIZES moved to Backend API

import { useLocation } from 'react-router-dom';
import { INSTRUMENT_CONFIG, MARKET_TIMINGS } from '../constants';
import { fetchExpiriesForSymbol } from '../utils/expiryUtils';

// Fallback model list — used only if /api/ai-confirmation/models fails.
// Live list comes from Python's MODEL_REGISTRY via the API.
const FALLBACK_GEMINI_MODELS = [
    { id: 'gemini-3-flash-preview',         label: 'Gemini 3 Flash Preview ⭐',  quota: '1.5K/day', group: '⭐ Recommended (1.5K RPD + JSON)' },
    { id: 'gemini-3.1-flash-lite-preview',  label: 'Gemini 3.1 Flash Lite ⭐',   quota: '1.5K/day', group: '⭐ Recommended (1.5K RPD + JSON)' },
    { id: 'gemini-2.5-flash',               label: 'Gemini 2.5 Flash ⭐',        quota: '1.5K/day', group: '⭐ Recommended (1.5K RPD + JSON)' },
    { id: 'gemma-4-31b-it',                 label: 'Gemma 4 31B IT',             quota: '132/day',  group: '🔥 Gemma 4 (verbose JSON)' },
    { id: 'claude-haiku-4-5-20251001',      label: 'Claude Haiku 4.5 ⚡',        quota: 'unlimited', group: '🤖 Claude (Anthropic)' },
    { id: 'claude-sonnet-4-6',              label: 'Claude Sonnet 4.6 ⭐',       quota: 'unlimited', group: '🤖 Claude (Anthropic)' },
    { id: 'claude-opus-4-7',               label: 'Claude Opus 4.7 🎯',          quota: 'unlimited', group: '🤖 Claude (Anthropic)' },
];

// Group resolver — maps model ID prefix → user-friendly group label.
function modelGroupFor(id) {
    if (id.startsWith('claude-')) return '🤖 Claude (Anthropic)';
    if (id === 'gemini-3-flash-preview' || id === 'gemini-3.1-flash-lite-preview' || id === 'gemini-2.5-flash') {
        return '⭐ Recommended (1.5K RPD + JSON)';
    }
    if (id.endsWith('-latest')) return '🔄 Alias models';
    if (id.startsWith('gemma-4')) return '🔥 Gemma 4 (verbose JSON)';
    if (id.startsWith('gemini-3.1-pro') || id.startsWith('gemini-2.5-pro')) return '🎯 Pro (low RPM)';
    if (id.startsWith('gemini-3')) return '🚀 Gemini 3';
    if (id.startsWith('gemini-2.5')) return '✨ Gemini 2.5';
    if (id.startsWith('gemini-2.0')) return '💎 Gemini 2.0';
    return '📦 Other';
}

export default function Backtest() {
  const { backtestParams: params, setBacktestParams: setParams, backtestResult: result, setBacktestResult: setResult } = useGlobalState();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [instrumentConfig, setInstrumentConfig] = useState({});
  const [strategyDefaults, setStrategyDefaults] = useState({});
  const [savedConfigs, setSavedConfigs] = useState([]);
  const [liveConfigs, setLiveConfigs] = useState([]);
  const [aiModels, setAiModels] = useState([]); // List of available models
  const [rlModels, setRlModels] = useState([]); // List of available RL Models
  const [geminiModels, setGeminiModels] = useState(FALLBACK_GEMINI_MODELS); // AI confirmation models
  const [marketTimings, setMarketTimings] = useState({});
  const [expiryDates, setExpiryDates] = useState([]); // For Futures Expiry Selection
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  const [aiJobId, setAiJobId] = useState(null);
  const [aiPolling, setAiPolling] = useState(false);
  const aiPollActiveJobRef = useRef(null); // prevents duplicate poll loops (StrictMode / HMR)
  const [aiProgress, setAiProgress] = useState({ done: 0, total: 0 });
  const [showSpotView, setShowSpotView] = useState(false);
  const [showAiSim, setShowAiSim] = useState(false);
  const [backtestResultId, setBacktestResultId] = useState(null);
  // Server-calculated accurate AI resim: Map of tradeIdx → { ai_pnl, ai_exit }
  const [aiResimMap, setAiResimMap] = useState(null);
  // Alternative resim with the opposite followAiSlTp setting (populated on demand)
  const [aiResimAltMap, setAiResimAltMap] = useState(null);
  const [aiResimAltLoading, setAiResimAltLoading] = useState(false);
  // 'main' = use aiResimMap (matches params setting), 'alt' = use aiResimAltMap
  const [aiSlTpView, setAiSlTpView] = useState('main');
  // Preserved AI decisions for on-demand alt resim (populated when AI job completes)
  const allAiDecisionsRef = useRef({});
  // Re-entry second AI pass
  const [aiReentryJobId, setAiReentryJobId] = useState(null);
  const [aiReentryPolling, setAiReentryPolling] = useState(false);
  const [aiReentryProgress, setAiReentryProgress] = useState({ done: 0, total: 0 });
  // Maps position-in-reentry-signals-array → original trade index (set when job starts)
  const [aiReentryIndexMap, setAiReentryIndexMap] = useState([]);
  // Re-entry Black-Scholes resim results: Map<tradeIdx, {exit_time, exit_spot, exit_pnl, exit_reason, entry_time, entry_spot}>
  const [aiReentryResimMap, setAiReentryResimMap] = useState(null);
  // Prompt copy feedback: key = 'first_<idx>' or 'reentry_<idx>', value = 'copying'|'done'|'error'
  const [promptCopyState, setPromptCopyState] = useState({});

  // Build aiSimData from server-accurate resim results (aiResimMap) when available.
  // Falls back to delta approximation only if server hasn't responded yet.
  const aiSimData = useMemo(() => {
    if (!showAiSim || !result?.trades?.length) return null;
    const trades = result.trades;
    const hasAiData = trades.some(t => t.aiConfirmation?.suggested_sl);
    if (!hasAiData) return null;

    const allPnl = trades.reduce((s, t) => s + (t.pnl || 0), 0);
    const startBal = (result.finalBalance || 0) - allPnl;

    const activeResimMap = aiSlTpView === 'alt' ? aiResimAltMap : aiResimMap;
    const simTrades = trades.map((trade, idx) => {
      const serverSim = activeResimMap?.get(idx);
      if (serverSim) {
        // REJECT trades are not taken in the AI scenario → equity curve uses 0.
        // We still keep ai_sim_exit so the table can show the "what-if" exit spot/reason.
        const isReject = trade.ai_decision === 'REJECT';
        return {
          ...trade,
          ai_sim_exit: serverSim.ai_exit,
          ai_sim_pnl: isReject ? 0 : serverSim.ai_pnl,
        };
      }
      // REJECT → trade not taken in AI scenario (contributes 0 to equity curve)
      if (trade.ai_decision === 'REJECT') {
        return { ...trade, ai_sim_exit: null, ai_sim_pnl: 0 };
      }
      // CONFIRM but no resim data yet → keep original P&L as placeholder
      return { ...trade, ai_sim_exit: null, ai_sim_pnl: trade.pnl };
    });

    let origBal = startBal, aiBal = startBal;
    const curve = simTrades.map((t, idx) => {
      origBal += trades[idx].pnl;
      aiBal += t.ai_sim_pnl;
      return { t: idx + 1, date: t.exitTime, original: +origBal.toFixed(2), ai_sim: +aiBal.toFixed(2) };
    });

    const totalAiPnl = simTrades.reduce((s, t) => s + t.ai_sim_pnl, 0);
    const confirmedTrades = simTrades.filter(t => t.ai_decision === 'CONFIRM');
    const wins = confirmedTrades.filter(t => t.ai_sim_pnl > 0).length;

    // Max drawdown on AI equity curve
    let ddPeak = startBal, maxDD = 0;
    for (const p of curve) {
      if (p.ai_sim > ddPeak) ddPeak = p.ai_sim;
      if (ddPeak > 0) { const dd = ((ddPeak - p.ai_sim) / ddPeak) * 100; if (dd > maxDD) maxDD = dd; }
    }

    // Sharpe from daily AI equity (annualised, zero risk-free rate)
    const dailyMap = new Map();
    for (const p of curve) { const d = (p.date || '').slice(0, 10); if (d) dailyMap.set(d, p.ai_sim); }
    const dailyVals = [...dailyMap.values()];
    let sharpe = 0;
    if (dailyVals.length > 1) {
      const dr = dailyVals.slice(1).map((v, i) => v - dailyVals[i]);
      const mean = dr.reduce((s, r) => s + r, 0) / dr.length;
      const std = Math.sqrt(dr.reduce((s, r) => s + (r - mean) ** 2, 0) / dr.length);
      sharpe = std > 0 ? +(mean / std * Math.sqrt(252)).toFixed(2) : 0;
    }

    const rejectedCount = simTrades.length - confirmedTrades.length;
    return {
      trades: simTrades,
      curve,
      totalPnl: +totalAiPnl.toFixed(2),
      originalPnl: +trades.reduce((s, t) => s + t.pnl, 0).toFixed(2),
      totalTrades: confirmedTrades.length,
      rejectedCount,
      wins,
      winRate: confirmedTrades.length > 0 ? +((wins / confirmedTrades.length) * 100).toFixed(1) : 0,
      maxDrawdown: +maxDD.toFixed(1),
      sharpe,
    };
  }, [result, showAiSim, aiResimMap, aiResimAltMap, aiSlTpView]);

  // Run the alt resim on demand (opposite followAiSlTp to the one used for the main resim)
  const runAltResim = async () => {
    if (aiResimAltMap || aiResimAltLoading || !backtestResultId) return;
    const decisions = allAiDecisionsRef.current;
    if (!Object.keys(decisions).length) return;
    setAiResimAltLoading(true);
    try {
      const mainFollowAiSlTp = params?.ai_follow_sl_tp !== false;
      const altFollowAiSlTp  = !mainFollowAiSlTp; // opposite of current setting
      const followStrategyExits = params?.ai_follow_strategy_exits === true;
      const totalTrades = result?.trades?.length ?? 0;
      const chronIdx = (displayIdx) => totalTrades - 1 - displayIdx;
      const aiDecisions = Object.entries(decisions)
        .filter(([, d]) => altFollowAiSlTp ? (d.suggested_sl && d.suggested_tp) : d.decision === 'CONFIRM')
        .map(([ci, d]) => ({ tradeIdx: chronIdx(parseInt(ci)), suggested_sl: d.suggested_sl, suggested_tp: d.suggested_tp }));
      if (!aiDecisions.length) { setAiResimAltLoading(false); return; }
      const res = await axios.post(`${API_URL}/backtest/ai-resim`, {
        resultId: backtestResultId, aiDecisions, followAiSlTp: altFollowAiSlTp, followStrategyExits,
      });
      const map = new Map();
      for (const s of res.data.simTrades) map.set(s.tradeIdx, s);
      setAiResimAltMap(map);
    } catch (err) {
      console.error('Alt AI resim failed:', err.message);
    } finally {
      setAiResimAltLoading(false);
    }
  };

  useEffect(() => {
    if (!params.symbol) return;
    let cancelled = false;

    const loadExpiries = async () => {
      const expiries = await fetchExpiriesForSymbol(params.symbol, 4, 1);
      if (cancelled) return;
      setExpiryDates(expiries);
      if (expiries.length > 0) {
        setParams(p => ({ ...p, futures_expiry: expiries.find(e => !e.isPast)?.date || expiries[0].date }));
      }
    };

    loadExpiries();
    return () => { cancelled = true; };
  }, [params.symbol]);

  const fetchModels = async () => {
      try {
          // Fetch List of Static ML Models
          const modelsRes = await axios.get(`${API_URL}/ai/models`);
          setAiModels(modelsRes.data);

          // Fetch List of RL Models
          const rlRes = await axios.get(`${API_URL}/rl/models/info`);
          setRlModels(rlRes.data);
      } catch (err) {
          console.error("Failed to fetch models", err);
      }

      // Fetch AI Confirmation models from Python MODEL_REGISTRY
      try {
          const aiConfRes = await axios.get(`${API_URL}/ai-confirmation/models`);
          const dynamicModels = (aiConfRes.data?.models || []).map(m => ({
              id: m.id,
              label: m.display || m.id,
              quota: m.daily_limit ? `${m.daily_limit}/day` : 'Unlimited',
              rpm: m.rpm,
              group: modelGroupFor(m.id),
          }));
          if (dynamicModels.length > 0) {
              setGeminiModels(dynamicModels);
          }
      } catch (err) {
          console.error("Failed to fetch AI confirmation models — using fallback", err);
      }
  };

  useEffect(() => {
      fetchModels(); // Fetch on mount
      
      // Use static constants instead of fetching
      setMarketTimings(MARKET_TIMINGS);
      setInstrumentConfig(INSTRUMENT_CONFIG);

      axios.get(`${API_URL}/config/strategies/defaults`)
        .then(res => setStrategyDefaults(res.data))
        .catch(err => console.error("Failed to fetch strategy defaults", err));
        
      axios.get(`${API_URL}/config/strategies/saved`) // Use Saved Strategies (Backtest Only)
         .then(res => setSavedConfigs(res.data))
         .catch(err => console.error("Failed to fetch saved strategies", err));

      axios.get(`${API_URL}/config/symbols`) // Live Bot Strategies
         .then(res => setLiveConfigs(res.data))
         .catch(err => console.error("Failed to fetch live configs", err));
  }, []);

  // Handle incoming params from Dashboard/Optimizer
  useEffect(() => {
      if (location.state) {
          console.log("📥 Received Params via Navigation:", location.state);
          
          setParams(prevParams => {
              const newParams = { ...prevParams };
              
              if (location.state.symbol) newParams.symbol = location.state.symbol;
              
              // Normalize Strategy Name (Class Name -> Internal ID)
              let strategyId = location.state.strategy;
              const STRATEGY_MAPPING = {
                  'MultiTimeframeStrategy': 'mta_ema_crossover',
                  'VwapMomentumStrategy': 'vwap_momentum',
                  'BollingerBandStrategy': 'bb_reversion',
                  'InsideBarStrategy': 'inside_bar',
                  'FalseInsideBarStrategy': 'false_inside_bar',
                  'HybridInsideBarStrategy': 'hybrid_inside_bar',
                  'OrbStrategy': 'orb_breakout',
                  'SuperTrendStrategy': 'supertrend_adx',
                  'UniversalStrategy': 'universal',
                  'CandlestickPatternStrategy': 'candlestick_pattern',
                  'BreakoutRangeStrategy': 'breakout_range',
                  'PowerOfStocks5EmaStrategy': 'pos_5ema_scalp',
                  'VwapScalpStrategy': 'vwap_scalp',
                  'MomentumScalpStrategy': 'momentum_scalp',
                  'RlStrategy': 'rl_agent'
              };
              if (STRATEGY_MAPPING[strategyId]) {
                  strategyId = STRATEGY_MAPPING[strategyId];
              }
              newParams.strategy = strategyId;

              if (location.state.params) {
                  Object.keys(location.state.params).forEach(key => {
                      newParams[key] = location.state.params[key];
                  });
              }
              
              // Merge Top-level critical params (Explicitly passed from Optimizer)
              if (location.state.dataSource) newParams.dataSource = location.state.dataSource;
              if (location.state.broker) newParams.broker = location.state.broker;
              if (location.state.backtest_mode) newParams.backtest_mode = location.state.backtest_mode;
              if (location.state.resolution) newParams.resolution = location.state.resolution;

              return newParams;
          });
          
          // Clear state to avoid re-triggering on refresh (optional but good context cleanup)
          window.history.replaceState({}, document.title);
      }
  }, [location.state, setParams]);


  // Keys to exclude from Strategy Params (System/Backtest Config)
  const IGNORED_PARAMS = ['startDate', 'endDate', 'interval', 'period'];

  const handleSaveDefault = async () => {
    if (!params.strategy) return alert("Please select a strategy first.");
    const confirm = window.confirm(`Are you sure you want to update GLOBAL DEFAULTS for ${params.strategy}? This will affect all new backtests.`);
    if (!confirm) return;

    // Filter out system params
    const strategyParams = {};
    Object.keys(params).forEach(key => {
        if (!IGNORED_PARAMS.includes(key)) {
            strategyParams[key] = params[key];
        }
    });

    try {
        await axios.post(`${API_URL}/config/strategies/defaults`, {
            strategy: params.strategy,
            params: strategyParams
        });
        alert("✅ Global Defaults Saved!");
        // Update local state to reflect new defaults
        setStrategyDefaults(prev => ({ ...prev, [params.strategy]: strategyParams }));
    } catch (err) {
        alert("❌ Save Failed: " + (err.response?.data?.error || err.message));
    }
  };

  const handleSaveConfig = async () => {
      const name = prompt("Enter a name for this configuration:");
      if (!name) return;

      const strategyParams = {};
      Object.keys(params).forEach(key => {
          if (!IGNORED_PARAMS.includes(key)) {
              strategyParams[key] = params[key];
          }
      });

      try {
          const res = await axios.post(`${API_URL}/config/strategies/saved`, {
              name: name,
              strategyId: params.strategy,
              params: strategyParams,
              symbol: params.symbol,
              start_date: params.start_date,
              end_date: params.end_date,
              capital: params.capital
          });
          alert("✅ Configuration Saved!");
          setSavedConfigs(prev => [res.data, ...prev.filter(c => c._id !== res.data._id)]);
      } catch (err) {
          alert("❌ Save Failed: " + (err.response?.data?.error || err.message));
      }
  };

  // --- Helper: Clean Payload for Backend ---
  const preparePayload = (currentParams) => {
      const clean = { ...currentParams };
      
      // Remove legacy/system keys that shouldn't go to backend logic if they are redundant
      // 'interval' is legacy for 'resolution'. Backend uses 'resolution'.
      if (clean.interval) delete clean.interval;
      if (clean.period) delete clean.period;

      // When ensemble mode is active, single model_file is irrelevant — only ensemble_models matters
      if (clean.use_ensemble) delete clean.model_file;

      Object.keys(clean).forEach(key => {
          // Resolution should stay as string if originally string (Backtester expects safe string/number handling but Fyers prefers string)
          if (key === 'resolution') return;

          let val = clean[key];
          // Try parse numeric strings
          if (typeof val === 'string' && val.trim() !== '') {
              // Check if valid number format (allow ints and floats)
              if (!isNaN(Number(val))) {
                  clean[key] = Number(val);
              }
          }
      });
      return clean;
  };

  const handleDeployLive = async () => {
    if (!params.symbol) return alert("Please select a symbol.");
    // Warn if format is incorrect
    if (!params.symbol.includes(':')) {
        const proceed = window.confirm(`⚠️ Symbol '${params.symbol}' does not look like a Fyers symbol (e.g., NSE:NIFTYBANK-INDEX). \n\nThe backend will reject this. Do you want to try anyway?`);
        if (!proceed) return;
    }

    const confirm = window.confirm(`Are you sure you want to DEPLOY this configuration for ${params.symbol} to the Live Bot?`);
    if (!confirm) return;

    // MERGE DEFAULTS: Ensure we save the EXACT snapshot of what the user sees
    const currentDefaults = strategyDefaults[params.strategy] || {};
    // Merge: Defaults -> Params
    const mergedRaw = { ...currentDefaults, ...params };
    const cleanParams = preparePayload(mergedRaw);

    try {
        await axios.post(`${API_URL}/config/symbols`, {
            symbol: params.symbol,
            strategy: params.strategy,
            params: cleanParams,
            isActive: true, 
            tradeMode: 'LIVE' 
        });
        alert(`🚀 Deployed to Live Bot for ${params.symbol}!`);
    } catch (err) {
        alert("❌ Deploy Failed: " + (err.response?.data?.error || err.message));
    }
  };

  const copyPrompt = async (tradeIdx, type) => {
    const key = `${type}_${tradeIdx}`;
    setPromptCopyState(s => ({ ...s, [key]: 'copying' }));
    try {
      const { data } = await axios.get(`${API_URL}/backtest/signal-prompt`, {
        params: { resultId: backtestResultId, tradeIdx, type },
      });
      await navigator.clipboard.writeText(data.prompt);
      setPromptCopyState(s => ({ ...s, [key]: 'done' }));
      setTimeout(() => setPromptCopyState(s => { const n = { ...s }; delete n[key]; return n; }), 2000);
    } catch {
      setPromptCopyState(s => ({ ...s, [key]: 'error' }));
      setTimeout(() => setPromptCopyState(s => { const n = { ...s }; delete n[key]; return n; }), 2000);
    }
  };

  const runBacktest = async () => {
    setLoading(true);
    setResult(null);
    setAiJobId(null);
    setAiPolling(false);
    setAiProgress({ done: 0, total: 0 });
    setShowAiSim(false);
    setBacktestResultId(null);
    setAiResimMap(null);
    setAiResimAltMap(null);
    setAiSlTpView('main');
    allAiDecisionsRef.current = {};
    setAiReentryJobId(null);
    setAiReentryPolling(false);
    setAiReentryProgress({ done: 0, total: 0 });
    setAiReentryIndexMap([]);
    setAiReentryResimMap(null);
    try {
      const cleanParams = preparePayload(params);
      const res = await axios.post(`${API_URL}/engine/backtest/run`, cleanParams);
      if (res.data.error) {
        alert("Backtest Error: " + res.data.error);
        setResult(null);
      } else {
        setResult(res.data);
        if (res.data.resultId) setBacktestResultId(res.data.resultId);
        if (res.data.ai_job_id) {
          setAiJobId(res.data.ai_job_id);
          setAiPolling(true);
        }
      }
    } catch (err) {
      alert("Backtest failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Poll for async AI confirmation results — delta-aware incremental updates
  useEffect(() => {
    if (!aiPolling || !aiJobId) return;
    // Guard: StrictMode runs effects twice; HMR can also cause double-mount.
    // Block a second loop from starting if one is already active for this job.
    if (aiPollActiveJobRef.current === aiJobId) return;
    aiPollActiveJobRef.current = aiJobId;

    let cancelled = false;
    const abortCtrl = new AbortController();

    // decisions keys are 0,1,2... in CHRONOLOGICAL order (oldest=0).
    // result.trades is REVERSED (newest=0). Map: display idx → chronological idx = (N-1-idx).
    const totalTrades = result?.trades?.length ?? 0;
    const chronIdx = (displayIdx) => totalTrades - 1 - displayIdx;

    // Track what we've already seen so we skip no-op polls and only send delta to state.
    let lastDone = 0;                // last known completed count
    const allDecisions = {};         // full accumulated decisions (for resim at the end)
    const pollStartTime = Date.now();

    // Apply ONLY new/delta decisions to React state — avoids mapping unchanged trades.
    const applyDelta = (newDecisions, done, total) => {
      setAiProgress({ done, total });
      if (!Object.keys(newDecisions).length) return;  // nothing new — skip state update
      setResult(prev => {
        if (!prev) return prev;
        let changed = false;
        const n = (prev.trades || []).length;
        const updatedTrades = (prev.trades || []).map((trade, idx) => {
          const d = newDecisions[String(n - 1 - idx)];
          if (!d || trade.ai_decision === d.decision) return trade;
          changed = true;
          return {
            ...trade,
            aiConfirmation: d,
            ai_confidence: (d.confidence || 0) / 100,
            ai_decision: d.decision,
            ai_reentry_suggested: d.reentry_suggested || false,
            ai_reentry_level: d.reentry_level || null,
            ai_reentry_note: d.reentry_note || null,
          };
        });
        return changed ? { ...prev, trades: updatedTrades } : prev;
      });
    };

    // After all AI decisions arrive, ask Node to re-simulate using Black-Scholes.
    // Uses allDecisions (full set), not a single poll's delta.
    const runAccurateResim = async (decisions, resultId) => {
      try {
        // Persist decisions for on-demand alt resim toggle
        allAiDecisionsRef.current = decisions;
        const followAiSlTp = params?.ai_follow_sl_tp !== false;
        const followStrategyExits = params?.ai_follow_strategy_exits === true;
        const aiDecisions = Object.entries(decisions)
          .filter(([, d]) => followAiSlTp ? (d.suggested_sl && d.suggested_tp) : d.decision === 'CONFIRM')
          .map(([ci, d]) => ({ tradeIdx: chronIdx(parseInt(ci)), suggested_sl: d.suggested_sl, suggested_tp: d.suggested_tp }));
        if (!aiDecisions.length) return;
        const res = await axios.post(`${API_URL}/backtest/ai-resim`, { resultId, aiDecisions, followAiSlTp, followStrategyExits });
        const map = new Map();
        for (const s of res.data.simTrades) map.set(s.tradeIdx, s);
        setAiResimMap(map);
      } catch (err) {
        console.error('AI resim failed:', err.message);
      }
    };

    const triggerReentryFlow = async (decisions, resultId) => {
      try {
        const candidates = Object.entries(decisions)
          .filter(([, d]) => d.reentry_suggested && d.reentry_level && d.decision === 'REJECT')
          .map(([ci, d]) => ({
            tradeIdx: chronIdx(parseInt(ci)),
            reentry_level: d.reentry_level,
            ai_decision: d.decision,
            ai_reasoning: d.reasoning || '',
            reentry_note: d.reentry_note || '',
          }));
        if (!candidates.length) return;
        const aiModels = params?.ai_models?.length ? params.ai_models : ['gemini-2.0-flash'];
        const ctxRes = await axios.post(`${API_URL}/backtest/reentry-contexts`, {
          resultId, candidates, aiModels, aiConcurrency: params?.ai_concurrency ?? 1,
        });
        const { job_id, found, touched_data = [] } = ctxRes.data;
        const touchedIndices = touched_data.map(t => t.tradeIdx);
        const touchedSet = new Set(touchedIndices);
        setResult(prev => {
          if (!prev) return prev;
          const updatedTrades = (prev.trades || []).map((trade, idx) => {
            const td = touched_data.find(t => t.tradeIdx === idx);
            if (td) return { ...trade, ai_reentry_entry_time: td.touchTime, ai_reentry_entry_price: td.touchPrice, ai_reentry_level_reached: true };
            const isCandidate = candidates.some(c => c.tradeIdx === idx);
            if (isCandidate && !touchedSet.has(idx)) return { ...trade, ai_reentry_level_reached: false };
            return trade;
          });
          return { ...prev, trades: updatedTrades };
        });
        if (!job_id || !found) return;
        setAiReentryIndexMap(touchedIndices);
        setAiReentryJobId(job_id);
        setAiReentryPolling(true);
      } catch (err) {
        console.error('Re-entry flow failed:', err.message);
      }
    };

    const poll = async () => {
      try {
        // Pass `since` so the server only returns decisions we haven't seen yet.
        const res = await axios.get(`${API_URL}/ai-confirmation/status/${aiJobId}?since=${lastDone}`, {
          signal: abortCtrl.signal,
        });
        if (cancelled) return;
        const { status, decisions: newDecisions = {}, done = 0, total = 0 } = res.data;

        if (done > lastDone) {
          // New decisions arrived — merge into accumulator and update state.
          Object.assign(allDecisions, newDecisions);
          lastDone = done;
          applyDelta(newDecisions, done, total);
        } else {
          // No progress — just keep the progress bar in sync, skip state clone.
          setAiProgress({ done, total });
        }

        if (status === 'complete') {
          setAiPolling(false);
          if (backtestResultId) {
            runAccurateResim(allDecisions, backtestResultId);
            if (params?.ai_enable_reentry !== false) {
              triggerReentryFlow(allDecisions, backtestResultId);
            }
          }
        } else if (status === 'error') {
          setAiPolling(false);
          console.error('AI job failed:', res.data.error);
        } else {
          // Adaptive interval: 3 s for the first 2 min, 5 s after that.
          const elapsed = Date.now() - pollStartTime;
          const interval = elapsed > 2 * 60 * 1000 ? 5000 : 3000;
          setTimeout(poll, interval);
        }
      } catch (err) {
        if (err.name === 'CanceledError' || err.name === 'AbortError') return;
        if (!cancelled) {
          console.error('AI status poll failed:', err.message);
          setTimeout(poll, 8000);
        }
      }
    };
    poll();
    return () => {
      cancelled = true;
      abortCtrl.abort();
      if (aiPollActiveJobRef.current === aiJobId) aiPollActiveJobRef.current = null;
    };
  }, [aiPolling, aiJobId, backtestResultId, setResult, params]);

  // Poll for re-entry AI job (second pass — only runs after first job suggests re-entry levels)
  useEffect(() => {
    if (!aiReentryPolling || !aiReentryJobId) return;
    let cancelled = false;

    const applyReentryDecisions = (decisions, done, total) => {
      setAiReentryProgress({ done, total });
      setResult(prev => {
        if (!prev) return prev;
        let changed = false;
        // decisions keyed 0,1,2... = position in re-entry signals array
        // aiReentryIndexMap[i] = original tradeIdx for that position
        const updatedTrades = (prev.trades || []).map((trade, idx) => {
          const position = aiReentryIndexMap.indexOf(idx);
          if (position < 0) return trade;
          const d = decisions[String(position)];
          if (!d) return trade;
          changed = true;
          return {
            ...trade,
            ai_reentry_decision: d.decision,
            ai_reentry_confidence: d.confidence || 0,
            ai_reentry_reasoning: d.reasoning || '',
            ai_reentry_sl: d.suggested_sl || null,
            ai_reentry_tp: d.suggested_tp || null,
            ai_reentry_level_reached: true,
          };
        });
        return changed ? { ...prev, trades: updatedTrades } : prev;
      });
    };

    const runReentryResim = async (decisions, resultId) => {
      try {
        const reentryDecisions = aiReentryIndexMap
          .map((tradeIdx, pos) => {
            const d = decisions[String(pos)];
            if (!d || d.decision !== 'CONFIRM') return null;
            return { tradeIdx, suggested_sl: d.suggested_sl, suggested_tp: d.suggested_tp };
          })
          .filter(Boolean);
        if (!reentryDecisions.length) return;
        const simRes = await axios.post(`${API_URL}/backtest/reentry-resim`, { resultId, reentryDecisions });
        const map = new Map();
        for (const s of simRes.data.simTrades) map.set(s.tradeIdx, s);
        setAiReentryResimMap(map);
      } catch (err) {
        console.error('Re-entry resim failed:', err.message);
      }
    };

    const poll = async () => {
      try {
        const res = await axios.get(`${API_URL}/ai-confirmation/status/${aiReentryJobId}`);
        if (cancelled) return;
        const { status, decisions = {}, done = 0, total = 0 } = res.data;
        applyReentryDecisions(decisions, done, total);
        if (status === 'complete' || status === 'error') {
          setAiReentryPolling(false);
          if (status === 'complete' && backtestResultId) {
            runReentryResim(decisions, backtestResultId);
          }
          if (status === 'error') console.error('AI re-entry job failed');
        } else {
          setTimeout(poll, 2500);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('AI re-entry poll failed:', err.message);
          setTimeout(poll, 6000);
        }
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [aiReentryPolling, aiReentryJobId, aiReentryIndexMap, backtestResultId, setResult]);

  // Auto-fetch defaults on mount if strategy is set but empty params
  // Or handle change
  // Keys that should persist across strategy changes
  const SYSTEM_KEYS = [
      'symbol', 'start_date', 'end_date', 'capital', 'resolution', 
      'lot_size', 'trade_start_time', 'trade_end_time', 
      'backtest_mode', 'dataSource', 'broker', 'futures_expiry', 'trade_mode'
  ];

  // Helper: Get only system params from current state
  const getSystemParams = (currentParams) => {
      const sys = {};
      SYSTEM_KEYS.forEach(k => {
          if (currentParams[k] !== undefined) sys[k] = currentParams[k];
      });
      return sys;
  };

  const handleStrategyChange = (e) => {
    const newStrategy = e.target.value;
    
    // Fetch Best Defaults
    fetch(`${API_URL}/engine/defaults?strategy=${newStrategy}`)
        .then(res => res.json())
        .then(data => {
            // RESET Logic: Keep System Params, Replace Strategy Params with Defaults
            const systemParams = getSystemParams(params);
            const newParams = { 
                ...systemParams, 
                strategy: newStrategy,
                ...data 
            };
            setParams(newParams);
        })
        .catch(err => console.error("Failed to load strategy defaults:", err));

    // Optimistic Update (will be overwritten by fetch)
    setParams(prev => ({ ...getSystemParams(prev), strategy: newStrategy }));
  };

  return (
    <div className="p-8 space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-white">Backtest Strategy</h1>
        <button 
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded border border-slate-700 text-sm transition-colors"
            onClick={() => {
                const json = prompt("Paste Parameters JSON here:");
                if (json) {
                    try {
                        const parsed = JSON.parse(json);
                        
                        // Smart Import: 
                        // 1. If JSON has "strategy", we assume it's a full config -> Replace All (but keep critical system keys if missing in JSON)
                        // 2. If JSON is partial (no strategy), we merge into current.
                        
                        // Actually, user wants to Paste JSON and have it EXACTLY as is, usually.
                        // But if they paste a snippet without Symbol/Date, they want to keep current Symbol/Date.
                        
                        // Strategy: Create a base from Current System Params, then Overwrite with JSON.
                        // This cleans out OLD strategy params (unwanted 'ema_long' etc) that are NOT in the JSON.
                        
                        const systemDefaults = getSystemParams(params);
                        
                        // If JSON has its own system keys, they override current defaults.
                        const newParams = { ...systemDefaults, ...parsed };
                        
                        setParams(newParams);
                        alert("✅ Parameters Imported Successfully");
                    } catch (e) {
                        alert("❌ Invalid JSON: " + e.message);
                    }
                }
            }}
        >
            <span className="font-mono text-xs">{`{ }`}</span> Import JSON
        </button>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Controls */}
        <div className="bg-surface p-6 rounded-xl border border-slate-700 space-y-6 sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
          <h3 className="text-xl font-bold">Configuration</h3>
          
          <div className="space-y-4">
             {/* Saved Config Loader (Backtest Only) */}
             {savedConfigs.length > 0 && (
                 <div className="bg-slate-800 p-3 rounded border border-slate-600">
                     <label className="block text-xs font-bold text-blue-400 mb-2">📂 Load Saved Config (Backtest)</label>
                     <select 
                         className="w-full bg-slate-900 border border-slate-500 rounded p-2 text-white text-sm"
                         onChange={(e) => {
                             const cfg = savedConfigs.find(c => c._id === e.target.value);
                             if (cfg) {
                                  setParams(prev => ({
                                      ...prev,
                                      strategy: cfg.strategyId,
                                      symbol: cfg.symbol || prev.symbol,
                                      ...cfg.params
                                  }));
                              }
                         }}
                         defaultValue=""
                     >
                         <option value="" disabled>-- Select a Saved Config --</option>
                         {savedConfigs.map(cfg => (
                             <option key={cfg._id} value={cfg._id}>
                                 {cfg.name} ({cfg.strategyId})
                             </option>
                         ))}
                     </select>
                 </div>
             )}

             {/* Live Bot Config Loader */}
             {liveConfigs.length > 0 && (
                 <div className="bg-slate-800 p-3 rounded border border-slate-600">
                     <label className="block text-xs font-bold text-green-400 mb-2">📂 Load Saved Strategy (Live Bot)</label>
                     <select 
                         className="w-full bg-slate-900 border border-slate-500 rounded p-2 text-white text-sm"
                         onChange={(e) => {
                             const cfg = liveConfigs.find(c => c.symbol === e.target.value);
                             if (cfg) {
                                  setParams(prev => {
                                      let computedLotSize = prev.lot_size;
                                      if (cfg.params.lots && instrumentConfig[cfg.symbol]) {
                                          computedLotSize = cfg.params.lots * instrumentConfig[cfg.symbol].lotSize;
                                      } else if (cfg.params.lot_size) {
                                          computedLotSize = cfg.params.lot_size;
                                      } else if (instrumentConfig[cfg.symbol]) {
                                          computedLotSize = instrumentConfig[cfg.symbol].lotSize;
                                      }

                                      return {
                                          ...prev,
                                          symbol: cfg.symbol,
                                          strategy: cfg.strategyName || 'mta_ema_crossover',
                                          ...cfg.params,
                                          lot_size: computedLotSize 
                                      };
                                  });
                              }
                         }}
                         defaultValue=""
                     >
                         <option value="" disabled>-- Select a Live Bot Strategy --</option>
                         {liveConfigs.map(cfg => (
                             <option key={cfg.symbol} value={cfg.symbol}>
                                 {cfg.symbol === 'DEFAULT' ? 'Global Default Params' : `${cfg.strategyName || 'Strategy'} (${cfg.symbol})`}
                             </option>
                         ))}
                     </select>
                 </div>
             )}

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Strategy</label>
              <select 
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                value={params.strategy || 'mta_ema_crossover'}
                onChange={handleStrategyChange}
              >
                <option value="mta_ema_crossover">MTA EMA Crossover</option>
                <option value="vwap_momentum">VWAP Momentum Scalper</option>
                <option value="bb_reversion">Bollinger Band Reversion</option>
                <option value="inside_bar">Inside Bar Breakout</option>
                <option value="false_inside_bar">False Inside Bar (Fakey)</option>
                <option value="hybrid_inside_bar">Hybrid Inside Bar + Fakey</option>
                <option value="orb_breakout">Open Range Breakout (ORB)</option>
                <option value="supertrend_adx">SuperTrend + ADX Filter</option>
                <option value="ai_filtered">AI Filtered Strategy (LSTM) 🧠</option>
                <option value="candlestick_pattern">Candlestick Pattern (Reversal)</option>
                <option value="breakout_range">Breakout Range Strategy</option>
                <option value="pos_5ema_scalp">Power of Stocks 5 EMA Scalp</option>
                <option value="vwap_scalp">VWAP Rejection Scalp</option>
                <option value="momentum_scalp">Momentum RSI-EMA Scalp</option>
                <option value="universal">Universal / Discovery Mode</option>
                <option value="rl_agent">RL Agent Strategy 🤖</option>
              </select>
            </div>



            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Resolution (Timeframe)</label>
              <select 
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                value={params.resolution || '5'}
                onChange={e => {
                    const val = e.target.value;
                    // User Request: resolution should be number if possible
                    const numVal = Number(val);
                    setParams({...params, resolution: isNaN(numVal) ? val : numVal});
                }}
              >
                <option value="1">1 Minute</option>
                <option value="3">3 Minutes</option>
                <option value="5">5 Minutes</option>
                <option value="15">15 Minutes</option>
                <option value="30">30 Minutes</option>
                <option value="60">1 Hour</option>
                <option value="D">Daily</option>
              </select>
            </div>
            
            {/* AI Confirmation (Universal) */}
            <div className="bg-purple-900/10 border border-purple-800/30 p-2 rounded mt-2 space-y-2">
                 <div className="flex items-center justify-between">
                     <label className="text-sm text-purple-200">🤖 AI Confirmation</label>
                     <input
                        type="checkbox"
                        className="w-4 h-4 accent-purple-500"
                        checked={params.use_ai_confirmation || false}
                        onChange={e => setParams({...params, use_ai_confirmation: e.target.checked})}
                     />
                 </div>
                 {params.use_ai_confirmation && (
                     <div className="mt-2 flex items-center justify-between">
                         <label className="text-xs text-slate-400">Min Conf (%)</label>
                         <input
                            type="number"
                            step="5"
                            className="w-16 bg-slate-900 border border-slate-700 rounded p-1 text-xs text-white text-right"
                            value={(params.ai_confidence_threshold || 0.60) * 100}
                            onChange={e => setParams({...params, ai_confidence_threshold: parseFloat(e.target.value) / 100})}
                         />
                     </div>
                 )}

                 {/* Gemini Risk Filter */}
                 <div className="border-t border-purple-800/20 pt-2 flex items-center justify-between">
                     <div>
                         <label className="text-sm text-purple-200">✨ Gemini Risk Filter</label>
                         <p className="text-[10px] text-slate-500 leading-tight">Batch confirms signals via Gemma 3 27B</p>
                     </div>
                     <input
                        type="checkbox"
                        className="w-4 h-4 accent-purple-400 cursor-pointer"
                        checked={params.enable_ai_confirmation || false}
                        onChange={e => setParams({...params, enable_ai_confirmation: e.target.checked})}
                     />
                 </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Symbol</label>
              <select 
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                value={params.symbol}
                onChange={e => {
                  const newSymbol = e.target.value;
                  const config = instrumentConfig[newSymbol];
                  setParams({
                    ...params, 
                    symbol: newSymbol,
                    lot_size: config ? config.lotSize : 30,
                    trade_start_time: (config && marketTimings[config.exchange]) ? marketTimings[config.exchange].strategyStart : (marketTimings['NSE']?.strategyStart || "09:30"),
                    trade_end_time: (config && marketTimings[config.exchange]) ? marketTimings[config.exchange].strategyEnd : (marketTimings['NSE']?.strategyEnd || "15:00")
                  });
                }}
              >
                  {Object.keys(instrumentConfig).length === 0 && <option>Loading instruments...</option>}
                  
                  <optgroup label="Indices">
                      {Object.entries(instrumentConfig)
                          .filter(([k]) => !k.includes('-EQ') && !k.startsWith('MCX:'))
                          .map(([key, config]) => (
                              <option key={key} value={key}>{config.underlying}</option>
                          ))}
                  </optgroup>

                  <optgroup label="── Precious Metals (MCX) ──">
                      {Object.entries(instrumentConfig)
                          .filter(([k]) => k.startsWith('MCX:') && ['GOLD','GOLDM','GOLDPETAL','SILVER','SILVERMIC','SILVERM'].includes(instrumentConfig[k].underlying))
                          .map(([key, config]) => (
                              <option key={key} value={key}>{config.displayName || config.underlying}</option>
                          ))}
                  </optgroup>
                  <optgroup label="── Energy (MCX) ──">
                      {Object.entries(instrumentConfig)
                          .filter(([k]) => k.startsWith('MCX:') && ['CRUDEOIL','NATURALGAS'].includes(instrumentConfig[k].underlying))
                          .map(([key, config]) => (
                              <option key={key} value={key}>{config.displayName || config.underlying}</option>
                          ))}
                  </optgroup>
                  <optgroup label="── Base Metals (MCX) ──">
                      {Object.entries(instrumentConfig)
                          .filter(([k]) => k.startsWith('MCX:') && ['COPPER','ZINC','ALUMINIUM','LEAD','NICKEL'].includes(instrumentConfig[k].underlying))
                          .map(([key, config]) => (
                              <option key={key} value={key}>{config.displayName || config.underlying}</option>
                          ))}
                  </optgroup>

                  <optgroup label="Stocks">
                      {Object.entries(instrumentConfig)
                          .filter(([k]) => k.includes('-EQ'))
                          .map(([key, config]) => (
                              <option key={key} value={key}>{config.underlying}</option>
                          ))}
                  </optgroup>
              </select>
              <input 
                  type="text" 
                  placeholder="Or Type Custom Symbol..." 
                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs mt-2"
                  onChange={(e) => setParams({...params, symbol: e.target.value})}
              />
            </div>

            {/* Broker / Data Source Selector */}
            <div className="bg-slate-800 p-3 rounded border border-blue-900/50">
              <label className="block text-xs font-bold text-blue-300 mb-2">
                📡 Data Broker
              </label>
              <select
                className="w-full bg-slate-900 border border-blue-800 rounded p-2 text-white text-sm"
                value={params.broker || 'fyers'}
                onChange={e => setParams({...params, broker: e.target.value})}
              >
                <option value="fyers">🔵 Fyers (NSE/BSE/MCX)</option>
                <option value="angel_one">🟠 Angel One (Free — Recommended for MCX)</option>
              </select>
              <p className="text-[10px] mt-1 leading-relaxed" style={{color: params.symbol?.startsWith('MCX:') ? '#fbbf24' : '#64748b'}}>
                {params.symbol?.startsWith('MCX:')
                  ? '⚡ MCX symbol auto-routes to Angel One (contract rolling + tvDatafeed fallback)'
                  : (params.broker || 'fyers') === 'angel_one'
                    ? '✅ Angel One SmartAPI — free, no gaps, MCX supported'
                    : '🔵 Fyers API — requires active subscription'}
              </p>
            </div>


            {/* 1. General Settings */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Start Date</label>
                <input 
                  type="date" 
                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                  value={params.start_date}
                  onChange={e => setParams({...params, start_date: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">End Date</label>
                <input 
                  type="date" 
                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                  value={params.end_date}
                  onChange={e => setParams({...params, end_date: e.target.value})}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 mt-4">
                <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Backtest Mode</label>
                    <select 
                        className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                        value={params.backtest_mode || 'Simulated Premium'}
                        onChange={e => setParams({...params, backtest_mode: e.target.value})}
                    >
                        <option value="Simulated Premium">Simulated Premium (Fast & Approx - 0.5 Delta)</option>
                        <option value="Real Option Data">Real Option Data (Slow & Accurate)</option>
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-blue-400 mb-1">Data Source (Indices)</label>
                    <select 
                        className="w-full bg-slate-900 border border-blue-900 rounded p-2 text-white"
                        value={params.dataSource || 'AUTO'}
                        onChange={e => setParams({...params, dataSource: e.target.value})}
                    >
                        <option value="AUTO">Auto (Smart Switch)</option>
                        <option value="SPOT">Spot Data (API)</option>
                        <option value="FUT">Current Month Future</option>
                        <option value="ARCHIVE">📂 Local Archive (Fast)</option>
                        <option value="SPOT_ARCHIVE">🔁 Spot API + Archive Options</option>
                    </select>
                </div>
                
                {/* Expiry Selection (Futures / Real Option Data) */}
                {(params.dataSource === 'FUT' || params.backtest_mode === 'Real Option Data') && (
                     <div className="mt-4">
                         <label className="block text-sm font-medium text-purple-400 mb-1">
                             {params.backtest_mode === 'Real Option Data' ? 'Options Expiry Date' : 'Futures Expiry Date'}
                         </label>
                         <select 
                             className="w-full bg-slate-900 border border-purple-900 rounded p-2 text-white"
                             value={params.futures_expiry || ''}
                             onChange={e => setParams({...params, futures_expiry: e.target.value})}
                         >
                             <option value="">-- Auto (Match Start Date) --</option>
                             {expiryDates.map((exp) => (
                                 <option key={exp.date} value={exp.date}>{exp.label}</option>
                             ))}
                         </select>
                         <div className="text-[10px] text-gray-500 mt-1">
                             Force a specific contract (e.g. 26FEB) regardless of backtest dates.
                         </div>
                     </div>
                )}
                
                {/* TRADING MODE (BUY v/s SELL) */}
                <div>
                     <label className="block text-sm font-medium text-purple-400 mb-1">Trading Mode</label>
                     <select 
                        className="w-full bg-slate-900 border border-purple-900 rounded p-2 text-white"
                        value={params.trade_mode || 'BUY'}
                        onChange={e => setParams({...params, trade_mode: e.target.value})}
                     >
                         <option value="BUY">Buying (Long Options)</option>
                         <option value="SELL">Selling (Naked Shorts)</option>
                         <option value="HEDGE_SELL">Selling (Hedged)</option>
                     </select>
                </div>

                {/* Selling Parameters (Conditional) */}
                {(params.trade_mode === 'SELL' || params.trade_mode === 'HEDGE_SELL') && (
                     <div className={`bg-slate-800/50 p-3 rounded border border-purple-500/30 grid gap-3 ${params.trade_mode === 'HEDGE_SELL' ? 'grid-cols-3' : 'grid-cols-2'}`}>
                         <div>
                             <label className="block text-xs text-purple-300 mb-1">Margin / Lot (₹)</label>
                             <input type="number"
                                className="w-full bg-slate-900 border border-purple-700/50 rounded p-2 text-white text-xs"
                                value={params.margin_per_lot || 120000}
                                onChange={e => setParams({...params, margin_per_lot: parseFloat(e.target.value)})}
                             />
                         </div>
                         <div>
                             <label className="block text-xs text-purple-300 mb-1">Theta Gain / Day (Pts)</label>
                             <input type="number"
                                className="w-full bg-slate-900 border border-purple-700/50 rounded p-2 text-white text-xs"
                                value={params.theta_decay || 20}
                                onChange={e => setParams({...params, theta_decay: parseFloat(e.target.value)})}
                             />
                         </div>
                         {params.trade_mode === 'HEDGE_SELL' && (
                             <div>
                                 <label className="block text-xs text-purple-300 mb-1">Hedge Cost (Pts)</label>
                                 <input type="number"
                                    className="w-full bg-slate-900 border border-purple-700/50 rounded p-2 text-white text-xs"
                                    value={params.hedge_cost || 10}
                                    onChange={e => setParams({...params, hedge_cost: parseFloat(e.target.value)})}
                                 />
                             </div>
                         )}
                     </div>
                )}
                
                 <div className="col-span-1 lg:col-span-1 flex items-center gap-3 bg-slate-800 p-2 rounded border border-slate-700 mt-0 h-10">
                    <input 
                        type="checkbox" 
                        id="holding_enabled"
                        className="w-4 h-4 accent-blue-500 cursor-pointer"
                        checked={params.holding_enabled || false}
                        onChange={e => setParams({...params, holding_enabled: e.target.checked})}
                    />
                    <label htmlFor="holding_enabled" className="text-xs font-bold text-slate-300 cursor-pointer select-none">
                        Positional <span className="text-slate-500 font-normal">(Carry Over)</span>
                    </label>
                </div>
            </div>

            {/* 2. Risk & Sizing */}
            <div className="border-t border-slate-700 pt-4 space-y-4">
                <h4 className="text-sm font-bold text-slate-300">🛡️ Risk & Sizing</h4>
                
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs text-slate-400 mb-1">Starting Capital (₹)</label>
                        <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                            value={params.capital}
                            onChange={e => setParams({...params, capital: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-xs text-slate-400 mb-1">Lot Size (Total Qty)</label>
                        <input type="number" 
                            step={instrumentConfig[params.symbol]?.lotSize || 1} 
                            min={instrumentConfig[params.symbol]?.lotSize || 1}
                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                            value={params.lot_size}
                            onChange={e => setParams({...params, lot_size: parseInt(e.target.value)})} />
                        <span className="text-[10px] text-slate-500">
                           Multiple of {instrumentConfig[params.symbol]?.lotSize || '1'}
                        </span>
                    </div>
                    <div>
                        <label className="block text-xs text-slate-400 mb-1">Max Daily Loss (₹)</label>
                        <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                            value={params.max_daily_loss || 2000}
                            onChange={e => setParams({...params, max_daily_loss: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-xs text-slate-400 mb-1">Max Single Loss (₹)</label>
                        <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                            value={params.max_single_trade_loss || 2000}
                            onChange={e => setParams({...params, max_single_trade_loss: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-xs text-slate-400 mb-1">Max Trades / Day</label>
                        <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                            value={params.max_trades_per_day || 10}
                            onChange={e => setParams({...params, max_trades_per_day: parseInt(e.target.value)})} />
                    </div>
                    <div>
                        <label className="block text-xs text-slate-400 mb-1">Trade Start Time</label>
                        <input type="time" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                            value={params.trade_start_time || "09:30"}
                            onChange={e => setParams({...params, trade_start_time: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-xs text-slate-400 mb-1">Trade End Time</label>
                        <input type="time" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                            value={params.trade_end_time || "15:00"}
                            onChange={e => setParams({...params, trade_end_time: e.target.value})} />
                    </div>
                    {/* Execution Friction */}
                    <div>
                        <label className="block text-xs text-slate-400 mb-1">Slippage (%)</label>
                        <input type="number" step="0.01" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                            value={params.slippage_percent || 0.05}
                            onChange={e => setParams({...params, slippage_percent: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-xs text-slate-400 mb-1">Brokerage/Order (₹)</label>
                        <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                            value={params.brokerage_per_order || 20}
                            onChange={e => setParams({...params, brokerage_per_order: e.target.value})} />
                    </div>
                </div>
            </div>

            {/* 3. Exit & SL/TP (ATR) */}
            <div className="border-t border-slate-700 pt-4 space-y-4">
                <h4 className="text-sm font-bold text-slate-300">🎯 Exit & SL/TP (ATR)</h4>
                
                {params.strategy === 'rl_agent' && (
                    <div className="col-span-2 flex items-start gap-2 bg-violet-900/20 border border-violet-700/40 rounded p-3 mb-2">
                        <span className="text-violet-400 text-base mt-0.5">🤖</span>
                        <p className="text-xs text-violet-300 leading-relaxed">
                            <span className="font-bold">RL model autonomously manages SL &amp; TP</span> via its trained action space (ATR-bin system). Stop-Loss Type and Fixed SL/TP overrides are not applicable. ATR multipliers below act as legacy fallback for old models only.
                        </p>
                    </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                    {params.strategy !== 'rl_agent' && (
                    <div>
                        <label className="block text-xs text-slate-400 mb-1">Stop-Loss Type</label>
                        <select className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                            value={params.sl_type || 'ATR'}
                            onChange={e => setParams({...params, sl_type: e.target.value})}
                        >
                            <option value="ATR">ATR (Dynamic)</option>
                            <option value="FIXED">Fixed Points</option>
                            <option value="STRATEGY">Strategy Defined</option>
                            <option value="INDEX_LEVEL">Index Level (Manual)</option>
                        </select>
                    </div>
                    )}
                    <div>
                        <label className="block text-xs text-slate-400 mb-1">Strike Selection</label>
                        <select className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                            value={params.strike_selection || 'ATM'}
                            onChange={e => setParams({...params, strike_selection: e.target.value})}
                        >
                            <option value="ATM">ATM (Delta ~0.5)</option>
                            <option value="ITM_1">ITM 1 Step (Safe / Delta ~0.6)</option>
                            <option value="ITM_2">ITM 2 Step (Deep / Delta ~0.7)</option>
                            <option value="OTM_1">OTM 1 Step (Risky / Delta ~0.4)</option>
                        </select>
                    </div>
                    {/* SL/TP Reference Chart — Spot ATR vs Swing Structure */}
                    {params.strategy !== 'rl_agent' && params.backtest_mode !== 'Real Option Data' && (
                      <div className="col-span-2">
                        <label className="block text-xs text-slate-400 mb-1">SL/TP Reference Chart</label>
                        <select
                          className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                          value={params.sl_tp_type || 'SPOT_ATR'}
                          onChange={e => setParams({...params, sl_tp_type: e.target.value})}
                        >
                          <option value="SPOT_ATR">Spot Index — ATR Based (Standard)</option>
                          <option value="SPOT_SWING">Spot Index — Swing Structure</option>
                        </select>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          {params.sl_tp_type === 'SPOT_SWING'
                            ? 'SL at last swing low/high; TP at R:R multiple — all prices in index terms'
                            : 'SL & TP set via ATR multiplier on the underlying index chart'}
                        </p>
                      </div>
                    )}

                    {/* Swing SL parameters */}
                    {params.sl_tp_type === 'SPOT_SWING' && params.strategy !== 'rl_agent' && (
                      <>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Swing Lookback (candles)</label>
                          <input type="number" min="3" max="50"
                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                            value={params.swing_lookback || 10}
                            onChange={e => setParams({...params, swing_lookback: parseInt(e.target.value) || 10})} />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Risk : Reward Ratio</label>
                          <input type="number" step="0.5" min="1"
                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                            value={params.rr_ratio || 2.0}
                            onChange={e => setParams({...params, rr_ratio: parseFloat(e.target.value) || 2.0})} />
                        </div>
                      </>
                    )}

                    {/* Conditional Inputs */}
                    {params.sl_type === 'FIXED' && !params.use_dynamic_sl && (
                        <>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Fixed SL (Pts)</label>
                                <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                                    value={params.fixed_sl_points || 40}
                                    onChange={e => setParams({...params, fixed_sl_points: e.target.value})} />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Fixed TP (Pts)</label>
                                <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                                    value={params.fixed_tp_points || 100}
                                    onChange={e => setParams({...params, fixed_tp_points: e.target.value})} />
                            </div>
                        </>
                    )}

                    {/* Only show the ATR inputs if Dynamic SL is ticked for RL, or if it's generic ATR mode */}
                    {(params.strategy === 'rl_agent' || params.sl_type === 'ATR' || params.use_dynamic_sl) && (
                      <>
                        <div>
                            <label className="block text-xs text-slate-400 mb-1">ATR Period</label>
                            <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                                value={params.atr_period || 14}
                                onChange={e => setParams({...params, atr_period: parseInt(e.target.value) || 14})} />
                        </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">
                                    {params.strategy === 'rl_agent' ? 'ATR TP Mult (Legacy Fallback)' : 'ATR TP Multiplier'}
                                </label>
                                <input type="number" step="0.1" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                                    value={params.atr_tp_mult || 3.5}
                                    onChange={e => setParams({...params, atr_tp_mult: parseFloat(e.target.value)})} />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">
                                    {params.strategy === 'rl_agent' ? 'ATR SL Mult (Legacy Fallback)' : params.sl_type === 'STRATEGY' ? 'ATR SL Mult (Fallback)' : 'ATR SL Multiplier'}
                                </label>
                                <input type="number" step="0.1" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                                    value={params.atr_sl_mult || 1.8}
                                    onChange={e => setParams({...params, atr_sl_mult: parseFloat(e.target.value)})} />
                            </div>
                      </>
                    )}
                    
                    {params.strategy === 'rl_agent' && (
                        <div className="col-span-2 flex items-center justify-between bg-blue-900/20 p-2 rounded border border-blue-800/50 mt-1">
                            <label className="text-sm text-blue-300 font-bold">Use Smart Volatility SL (Advanced)</label>
                            <input type="checkbox" className="w-4 h-4 accent-blue-500"
                                checked={params.use_dynamic_sl || false}
                                onChange={e => setParams({...params, use_dynamic_sl: e.target.checked})} />
                        </div>
                    )}
                    <div>
                        <label className="block text-xs text-slate-400 mb-1" title="Reject trades with Stop Loss tighter than this value">
                            Minimum SL Points
                        </label>
                        <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                            value={params.min_sl_points !== undefined ? params.min_sl_points : 5}
                            onChange={e => setParams({...params, min_sl_points: parseInt(e.target.value)})} />
                    </div>

                    {/* Trailing SL Control */}
                    <div className="col-span-2 flex items-center justify-between mt-2 bg-slate-800/50 p-2 rounded border border-slate-700/50">
                         <div className="flex flex-col">
                             <label className="text-xs text-slate-300 font-medium">Trailing Stop-Loss</label>
                             <span className="text-[10px] text-slate-500">Move SL to Break-even & Trail</span>
                         </div>
                         <div className="flex items-center gap-3">
                             <input type="checkbox"
                                 checked={params.use_trailing_sl || false}
                                 onChange={e => setParams({...params, use_trailing_sl: e.target.checked})}
                                 className="w-4 h-4 accent-blue-500"
                             />
                             {params.use_trailing_sl && (
                                 <div className="flex items-center gap-1">
                                     <span className="text-[10px] text-slate-400">Mult:</span>
                                     <input type="number" step="0.1"
                                         className="w-16 bg-slate-900 border border-slate-700 rounded p-1 text-xs text-white"
                                         value={params.trailing_sl_mult || 1.5}
                                         onChange={e => setParams({...params, trailing_sl_mult: parseFloat(e.target.value)})}
                                     />
                                 </div>
                             )}
                         </div>
                    </div>
                </div>
                </div>


            {/* AI Confirmation Section */}
            <div className="border-t border-slate-700 pt-4 space-y-3">
                {/* ── Internal ML model filter ── */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                            <Activity className="w-4 h-4 text-purple-400" />
                            AI Confirmation
                            <span className="text-[10px] bg-purple-900/40 text-purple-300 px-1 rounded ml-1">Beta</span>
                        </h4>
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-purple-500 cursor-pointer"
                          checked={params.use_ai_confirmation || false}
                          onChange={e => setParams({...params, use_ai_confirmation: e.target.checked})}
                        />
                    </div>

                    {params.use_ai_confirmation && (
                        <div className="bg-slate-800/50 p-3 rounded border border-purple-900/30 space-y-3">
                             <div>
                                 <label className="block text-xs text-slate-400 mb-1">Select AI Model</label>
                                 <select
                                    className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                                    value={params.modelName || ''}
                                    onChange={e => setParams({...params, modelName: e.target.value})}
                                 >
                                     <option value="">-- {params.symbol ? `Auto (${params.symbol})` : 'Auto-Detect'} --</option>
                                     {aiModels.map((m, idx) => (
                                         <option key={idx} value={m.name || m.symbol}>
                                             {m.name ? `${m.name} (${m.symbol})` : m.symbol}
                                         </option>
                                     ))}
                                 </select>
                                 <div className="text-[10px] text-slate-500 mt-1">
                                     Select a specific trained model or leave Auto to find model by symbol.
                                 </div>
                             </div>

                             <div className="flex items-center justify-between">
                                 <label className="text-xs text-slate-400">Min Confidence (%)</label>
                                 <input
                                    type="number"
                                    step="5"
                                    className="w-16 bg-slate-900 border border-slate-700 rounded p-1 text-xs text-white text-right"
                                    value={(params.ai_confidence_threshold || 0.60) * 100}
                                    onChange={e => setParams({...params, ai_confidence_threshold: parseFloat(e.target.value) / 100})}
                                 />
                             </div>
                        </div>
                    )}
                </div>

                {/* ── AI Risk Filter (Multi-Model) ── */}
                <div className="bg-slate-800/40 rounded border border-purple-900/40 p-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <h4 className="text-sm font-bold text-purple-300 flex items-center gap-1">
                                ✨ AI Risk Filter
                                <span className="text-[10px] bg-purple-900/50 text-purple-400 px-1 rounded ml-1">Multi-Model</span>
                            </h4>
                            <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">
                                Confirms every signal via AI before PnL. Select multiple models to split<br/>
                                signals across them in parallel — faster than a single model for large runs.
                            </p>
                        </div>
                        <input
                          type="checkbox"
                          id="enable_ai_confirmation"
                          className="w-4 h-4 accent-purple-400 cursor-pointer flex-shrink-0 ml-3"
                          checked={params.enable_ai_confirmation || false}
                          onChange={e => setParams({...params, enable_ai_confirmation: e.target.checked})}
                        />
                    </div>

                    {params.enable_ai_confirmation && (
                        <div className="mt-2 pt-2 border-t border-purple-900/30 space-y-3">
                            <div className="flex items-center gap-1.5 text-[10px] text-amber-400/80">
                                <span>⚠</span>
                                <span>Ensure <code className="bg-slate-900 px-1 rounded">GOOGLE_AI_STUDIO_API_KEY</code> is set in <code className="bg-slate-900 px-1 rounded">.env</code>.</span>
                            </div>

                            {/* Model multi-select */}
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-[10px] text-slate-300 font-medium">Select Models</label>
                                    {(params.ai_models || []).length > 1 && (
                                        <span className="text-[10px] text-green-400">
                                            ⚡ Parallel — signals split across {(params.ai_models || []).length} models
                                        </span>
                                    )}
                                </div>
                                <div className="bg-slate-900/60 rounded border border-purple-900/30 overflow-hidden">
                                    {(() => {
                                        const selectedModels = params.ai_models || [];
                                        const rows = [];
                                        let lastGroup = null;
                                        geminiModels.forEach(m => {
                                            if (m.group !== lastGroup) {
                                                lastGroup = m.group;
                                                rows.push(
                                                    <div key={`g-${m.group}`} className="px-2 pt-2 pb-0.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                                                        {m.group}
                                                    </div>
                                                );
                                            }
                                            const selected = selectedModels.includes(m.id);
                                            rows.push(
                                                <label
                                                    key={m.id}
                                                    className={`flex items-center gap-2 text-xs px-2 py-1 cursor-pointer hover:bg-slate-800 ${selected ? 'bg-purple-900/20' : ''}`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        className="w-3.5 h-3.5 accent-purple-400 flex-shrink-0"
                                                        checked={selected}
                                                        onChange={e => {
                                                            const updated = e.target.checked
                                                                ? [...selectedModels, m.id]
                                                                : selectedModels.filter(id => id !== m.id);
                                                            setParams({...params, ai_models: updated});
                                                        }}
                                                    />
                                                    <span className={selected ? 'text-purple-200' : 'text-slate-400'}>{m.label}</span>
                                                    <span className="text-[10px] text-slate-600 ml-auto">{m.quota}</span>
                                                </label>
                                            );
                                        });
                                        return rows;
                                    })()}
                                </div>
                                {(params.ai_models || []).length === 0 && (
                                    <p className="text-[10px] text-red-400 mt-1">⚠ Select at least one model</p>
                                )}
                                {(params.ai_models || []).length > 1 && (
                                    <p className="text-[10px] text-green-400/80 mt-1">
                                        ~{Math.ceil(100 / (params.ai_models || []).length)}% of signals per model — total time ≈ single-model time.
                                    </p>
                                )}
                            </div>

                            {/* Max signals cap + Parallel workers — side by side */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[10px] text-slate-400 mb-1">
                                        Max signals to evaluate
                                        <span className="text-slate-500 ml-1">(blank = all)</span>
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        placeholder="e.g. 50"
                                        className="w-full bg-slate-900 border border-purple-800/40 rounded p-1.5 text-white text-xs"
                                        value={params.ai_max_signals || ''}
                                        onChange={e => setParams({...params, ai_max_signals: e.target.value ? parseInt(e.target.value) : null})}
                                    />
                                    <p className="text-[10px] text-slate-500 mt-0.5">Others are auto-confirmed when cap is set.</p>
                                </div>
                                <div>
                                    <label className="block text-[10px] text-slate-400 mb-1">
                                        Parallel workers
                                        <span className="text-slate-500 ml-1">(per model)</span>
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="10"
                                        placeholder="1"
                                        className="w-full bg-slate-900 border border-purple-800/40 rounded p-1.5 text-white text-xs"
                                        value={params.ai_concurrency || 1}
                                        onChange={e => setParams({...params, ai_concurrency: Math.max(1, parseInt(e.target.value) || 1)})}
                                    />
                                    <p className="text-[10px] text-slate-500 mt-0.5">
                                        {(params.ai_concurrency || 1) > 1
                                            ? <span className="text-amber-400/80">⚡ {params.ai_concurrency}× faster — use only for Claude/unlimited models</span>
                                            : 'Safe for all models. Increase for Claude (no quota).'}
                                    </p>
                                </div>
                            </div>

                            {/* Re-entry check toggle */}
                            <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                                <input
                                    type="checkbox"
                                    className="w-3.5 h-3.5 accent-violet-500"
                                    checked={params.ai_enable_reentry !== false}
                                    onChange={e => setParams({ ...params, ai_enable_reentry: e.target.checked })}
                                />
                                <span className="text-[11px] text-slate-300 font-medium">Re-entry checks</span>
                                <span className="text-[10px] text-slate-500">
                                    {params.ai_enable_reentry !== false
                                        ? 'AI re-evaluates rejected trades at suggested watch levels'
                                        : 'Disabled — first-pass AI only, no re-entry second pass'}
                                </span>
                            </label>

                            <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                                <input
                                    type="checkbox"
                                    className="w-3.5 h-3.5 accent-violet-500"
                                    checked={params.ai_follow_sl_tp !== false}
                                    onChange={e => setParams({ ...params, ai_follow_sl_tp: e.target.checked })}
                                />
                                <span className="text-[11px] text-slate-300 font-medium">Follow AI SL/TP</span>
                                <span className="text-[10px] text-slate-500">
                                    {params.ai_follow_sl_tp !== false
                                        ? 'Simulation uses AI suggested SL/TP levels'
                                        : 'Simulation uses strategy SL/TP — AI filters trades only'}
                                </span>
                            </label>

                            <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                                <input
                                    type="checkbox"
                                    className="w-3.5 h-3.5 accent-violet-500"
                                    checked={params.ai_follow_strategy_exits === true}
                                    onChange={e => setParams({ ...params, ai_follow_strategy_exits: e.target.checked })}
                                />
                                <span className="text-[11px] text-slate-300 font-medium">Follow Strategy Exits</span>
                                <span className="text-[10px] text-slate-500">
                                    {params.ai_follow_strategy_exits === true
                                        ? 'Simulation honours strategy exit signals — resim stops when strategy closed'
                                        : 'Simulation holds until SL/TP hit (ignores strategy exit time)'}
                                </span>
                            </label>

                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
                                <span>• Anonymised OHLCV (T-0 … T-25)</span>
                                <span>• RSI / ATR / ADX context</span>
                                <span>• Suggests SL &amp; TP levels</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* 4. Strategy Specific Params */}
            <div className="border-t border-slate-700 pt-4 space-y-4">
                <h4 className="text-sm font-bold text-slate-300">⚡ Strategy Parameters</h4>
                
                <div className="grid grid-cols-2 gap-4">
                    {/* Explicit ORB Inputs for Better UX (Dropdown) */}
                    {params.strategy === 'orb_breakout' && (
                        <>
                             <div className="col-span-1">
                                <label className="block text-xs text-slate-400 mb-1">Range Duration</label>
                                <select 
                                    className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                                    value={params.range_duration_min || 30}
                                    onChange={e => setParams({...params, range_duration_min: parseInt(e.target.value)})}
                                >
                                    <option value="15">15 Min</option>
                                    <option value="30">30 Min</option>
                                    <option value="45">45 Min</option>
                                    <option value="60">60 Min</option>
                                </select>
                             </div>
                             <div className="col-span-1">
                                 <label className="block text-xs text-slate-400 mb-1">Breakout Buffer %</label>
                                 <input type="number" step="0.01" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                                    value={params.breakout_buffer_pct}
                                    onChange={e => setParams({...params, breakout_buffer_pct: e.target.value})} />
                             </div>
                        </>
                    )}

                    {/* Breakout Strategy Specific */}
                    {params.strategy === 'breakout_range' && (
                        <div className="col-span-2 bg-slate-800/50 p-2 rounded border border-blue-900/30 mb-2">
                             <label className="block text-xs text-blue-300 mb-1 font-bold">Breakout Range Mode</label>
                             <select 
                                 className="w-full bg-slate-900 border border-blue-900/50 rounded p-2 text-white text-sm"
                                 value={params.breakout_mode || 'ORB'}
                                 onChange={e => setParams({...params, breakout_mode: e.target.value})}
                             >
                                 <option value="ORB">Opening Range Breakout (ORB)</option>
                                 <option value="DYNAMIC">Dynamic (Donchian / Recent High-Low)</option>
                             </select>
                             <div className="text-[10px] text-slate-500 mt-1">
                                 {params.breakout_mode === 'ORB' ? 'Trades breakouts of the initial market range (e.g. first 30m).' : 'Trades breakouts of dynamic High/Low channels (Donchian).'}
                             </div>
                        </div>
                    )}

                    {/* RL Agent Target Model Dropdown — hidden when Ensemble Mode is active */}
                    {params.strategy === 'rl_agent' && !params.use_ensemble && (
                        <div className="col-span-2">
                             <label className="block text-xs text-blue-300 mb-1 font-bold">Target RL Model</label>
                             <select 
                                 className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                                 value={params.model_file || ''}
                                 onChange={e => setParams({...params, model_file: e.target.value})}
                             >
                                 <option value="">-- Select RL Model --</option>
                                 {rlModels.flatMap((m, idx) => {
                                     const finalFile = m.model_file || `${m.model_name || m.symbol}_ppo_final.zip`;
                                     const label = m.model_name ? `${m.model_name} (${m.symbol})` : m.symbol;
                                     const opts = [
                                         <option key={`${idx}_f`} value={finalFile}>{label} — Final</option>
                                     ];
                                     if (m.best_model) opts.push(
                                         <option key={`${idx}_b`} value={m.best_model}>{label} — Best (Val)</option>
                                     );
                                     return opts;
                                 })}
                             </select>
                             <div className="text-[10px] text-slate-500 mt-1">
                                 Select the specific AI model weights to trade natively. Stop Losses are managed purely by the Neural Network.
                             </div>
                        </div>
                    )}

                    {/* RL Agent Risk Controls */}
                    {params.strategy === 'rl_agent' && (
                        <div className="col-span-2 mt-1">
                            <div className="border border-orange-900/50 bg-orange-950/20 rounded-lg p-3">
                                <div className="text-xs font-bold text-orange-400 mb-2">⚡ RL Safety Controls</div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">⏰ Max Hold Candles</label>
                                        <input type="number" step="1" min="0"
                                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                                            value={params.max_hold_candles ?? 20}
                                            onChange={e => setParams({...params, max_hold_candles: parseInt(e.target.value) || 0})}
                                        />
                                        <div className="text-[10px] text-slate-500 mt-1">Force exit after N candles. 0 = disabled. (20 = ~100 min on 5m)</div>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">🛑 Adverse Exit (ATR×)</label>
                                        <input type="number" step="0.5" min="0"
                                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                                            value={params.adverse_atr_mult ?? 3.0}
                                            onChange={e => setParams({...params, adverse_atr_mult: parseFloat(e.target.value) || 3.0})}
                                        />
                                        <div className="text-[10px] text-slate-500 mt-1">Exit if spot moves N×ATR against position. Prevents slow-bleed losses.</div>
                                    </div>
                                    <div className="col-span-2 flex items-center justify-between pt-1">
                                        <div>
                                            <span className="text-xs text-slate-400">Enable Adverse Spot Move Stop</span>
                                            <div className="text-[10px] text-slate-500">Catches trades the SL misses (slow drift, open all day)</div>
                                        </div>
                                        <input type="checkbox"
                                            checked={params.adverse_exit_enabled ?? true}
                                            onChange={e => setParams({...params, adverse_exit_enabled: e.target.checked})}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* RL Daily Risk Rules */}
                    {params.strategy === 'rl_agent' && (
                        <div className="col-span-2 mt-1">
                            <div className="border border-teal-900/50 bg-teal-950/20 rounded-lg p-3">
                                <div className="text-xs font-bold text-teal-400 mb-2">📅 Daily Risk Rules</div>
                                <div className="grid grid-cols-2 gap-2">
                                    {/* Daily Profit Lock */}
                                    <div className="col-span-2 flex items-center justify-between">
                                        <div>
                                            <span className="text-xs text-slate-300 font-medium">Daily Profit Lock</span>
                                            <div className="text-[10px] text-slate-500">Stop entering new trades after hitting daily gain target</div>
                                        </div>
                                        <input type="checkbox"
                                            checked={params.enable_daily_profit_lock ?? true}
                                            onChange={e => setParams({...params, enable_daily_profit_lock: e.target.checked})}
                                        />
                                    </div>
                                    {(params.enable_daily_profit_lock ?? true) && (
                                        <div>
                                            <label className="block text-xs text-slate-400 mb-1">Lock After Gain (%)</label>
                                            <input type="number" step="0.1" min="0.1" max="10"
                                                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                                                value={params.daily_profit_lock_pct ?? 0.5}
                                                onChange={e => setParams({...params, daily_profit_lock_pct: parseFloat(e.target.value) || 0.5})}
                                            />
                                            <div className="text-[10px] text-slate-500 mt-1">e.g. 0.5 = lock after 0.5% daily gain</div>
                                        </div>
                                    )}
                                    {/* Daily Loss Filter */}
                                    <div className="col-span-2 flex items-center justify-between pt-1 border-t border-teal-900/30">
                                        <div>
                                            <span className="text-xs text-slate-300 font-medium">Daily Loss Filter</span>
                                            <div className="text-[10px] text-slate-500">Block low-quality entries after consecutive daily losses</div>
                                        </div>
                                        <input type="checkbox"
                                            checked={params.enable_daily_loss_filter ?? true}
                                            onChange={e => setParams({...params, enable_daily_loss_filter: e.target.checked})}
                                        />
                                    </div>
                                    {(params.enable_daily_loss_filter ?? true) && (
                                        <div>
                                            <label className="block text-xs text-slate-400 mb-1">Max Losses Before Block</label>
                                            <select
                                                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                                                value={params.max_daily_losses ?? 3}
                                                onChange={e => setParams({...params, max_daily_losses: parseInt(e.target.value)})}
                                            >
                                                <option value={1}>1 loss → filter entries</option>
                                                <option value={2}>2 losses → filter entries</option>
                                                <option value={3}>3 losses → block entries</option>
                                                <option value={4}>4 losses → block entries</option>
                                                <option value={99}>Disabled (no cap)</option>
                                            </select>
                                            <div className="text-[10px] text-slate-500 mt-1">After this many intra-day losses, new entries are blocked for the day</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* RL Ensemble Mode */}
                    {params.strategy === 'rl_agent' && (
                        <div className="col-span-2 mt-1">
                            <div className="border border-purple-900/50 bg-purple-950/20 rounded-lg p-3">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="text-xs font-bold text-purple-400">🤝 Ensemble Mode</div>
                                    <input type="checkbox"
                                        checked={params.use_ensemble || false}
                                        onChange={e => setParams({...params, use_ensemble: e.target.checked})}
                                    />
                                </div>
                                {params.use_ensemble && (
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Select 2+ Models for Majority Vote</label>
                                        <div className="max-h-40 overflow-y-auto bg-slate-900 border border-slate-700 rounded p-2 space-y-1">
                                            {rlModels.length === 0 && (
                                                <div className="text-xs text-slate-500 italic">No models available. Train or upload models first.</div>
                                            )}
                                            {rlModels.flatMap((m, idx) => {
                                                const variants = [
                                                    { file: m.model_file || `${m.model_name || m.symbol}_ppo_final.zip`, tag: 'Final' },
                                                    ...(m.best_model ? [{ file: m.best_model, tag: 'Best' }] : []),
                                                ];
                                                return variants.map(({ file, tag }) => {
                                                    const selected = (params.ensemble_models || []).includes(file);
                                                    return (
                                                        <label key={`${idx}_${tag}`} className={`flex items-center gap-2 text-xs p-1 rounded cursor-pointer hover:bg-slate-800 ${selected ? 'bg-purple-900/30 text-purple-300' : 'text-slate-300'}`}>
                                                            <input type="checkbox"
                                                                checked={selected}
                                                                onChange={e => {
                                                                    const current = params.ensemble_models || [];
                                                                    const updated = e.target.checked
                                                                        ? [...current, file]
                                                                        : current.filter(f => f !== file);
                                                                    setParams({...params, ensemble_models: updated});
                                                                }}
                                                            />
                                                            <span>{m.model_name || m.symbol} <span className="text-slate-500">({tag})</span></span>
                                                            <span className="text-slate-600 ml-auto text-[10px]">{file}</span>
                                                        </label>
                                                    );
                                                });
                                            })}
                                        </div>
                                        {(params.ensemble_models || []).length > 0 && (params.ensemble_models || []).length < 2 && (
                                            <div className="text-[10px] text-orange-400 mt-1">⚠ Select at least 2 models for ensemble voting to work.</div>
                                        )}
                                        <div className="text-[10px] text-slate-500 mt-1">
                                            Ensemble runs all selected models on the same candles, then takes a majority vote on direction. Improves accuracy by reducing single-model bias.
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Dynamic Inputs (Fallback) */}
                    {Object.entries(strategyDefaults[params.strategy] || {}).map(([key, val]) => {
                        // Skip keys we explicitly handled above or internal ones
                        if (['resolution', 'lots', 'trade_start_time', 'trade_end_time', 'max_daily_loss', 'max_single_trade_loss', 'max_trades_per_day', 'max_slippage_percent'].includes(key)) return null;
                        if (['atr_period', 'atr_tp_mult', 'atr_sl_mult', 'use_trailing_sl', 'trailing_sl_mult', 'min_sl_points'].includes(key)) return null;
                        if (params.strategy === 'orb_breakout' && ['range_duration_min', 'breakout_buffer_pct'].includes(key)) return null;
                        // RL Agent: skip keys rendered in dedicated sections above
                        if (params.strategy === 'rl_agent' && ['model_file', 'max_hold_candles', 'adverse_atr_mult', 'adverse_exit_enabled', 'use_dynamic_sl', 'use_ensemble', 'ensemble_models', 'enable_daily_profit_lock', 'daily_profit_lock_pct', 'enable_daily_loss_filter', 'max_daily_losses'].includes(key)) return null;

                        if (params.strategy === 'breakout_range' && ['breakout_mode'].includes(key)) return null;

                        
                        const label = key.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
                        const isBool = typeof val === 'boolean';
                        
                        return (
                            <div key={key} className={isBool ? "col-span-2 flex items-center justify-between" : ""}>
                                <label className={isBool ? "text-sm text-slate-400" : "block text-xs text-slate-400 mb-1"}>{label}</label>
                                {isBool ? (
                                    <input type="checkbox" checked={params[key] ?? val} 
                                        onChange={e => setParams({...params, [key]: e.target.checked})} />
                                ) : (
                                    <input type={typeof val === 'string' ? "text" : "number"} step="0.1" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                                        value={params[key] ?? val}
                                        onChange={e => {
                                            let v = e.target.value;
                                            // Only parse as number if the original default was a number
                                            if (typeof val === 'number' && !isNaN(parseFloat(v))) v = parseFloat(v);
                                            setParams({...params, [key]: v});
                                        }} />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
            


         <div className="grid grid-cols-2 gap-2 mt-auto">
            <button 
                onClick={handleSaveDefault}
                className="bg-gray-700 hover:bg-gray-600 text-xs py-2 rounded text-gray-300 border border-gray-600"
                title="Update Global Strategy Defaults with these values"
            >
                💾 Save as Default
            </button>
            <button 
                onClick={handleSaveConfig}
                className="bg-purple-800 hover:bg-purple-700 text-xs py-2 rounded text-purple-100 border border-purple-700 shadow-sm"
                title="Save this specific config for later"
            >
                📁 Save Config
            </button>
            <button 
                onClick={handleDeployLive}
                className="bg-green-800 hover:bg-green-700 text-xs py-2 rounded text-green-100 border border-green-700 shadow-sm"
                title="Configure Live Bot for this symbol"
            >
                🚀 Deploy Live
            </button>
        </div>
          </div>
        </div>

        {/* Results */}
        <div className="lg:col-span-2 bg-surface p-6 rounded-xl border border-slate-700 min-h-[500px]">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold">Results</h3>
            <button
                onClick={runBacktest}
                disabled={loading}
                className="bg-primary hover:bg-blue-600 disabled:opacity-50 text-white font-bold py-2 px-5 rounded-lg flex items-center gap-2 transition-colors text-sm"
            >
                {loading ? 'Running...' : <><Play className="w-4 h-4" /> Run Backtest</>}
            </button>
          </div>
          
          {result ? (
            <div className="space-y-8">
              {result.warnings && result.warnings.length > 0 && (
                <div className="space-y-2">
                  {result.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/40 text-amber-300 rounded-lg px-4 py-3 text-sm">
                      <span className="mt-0.5">⚠️</span>
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="p-4 bg-slate-800 rounded-lg">
                  <p className="text-slate-400 text-sm">Total P&L</p>
                  <p className={`text-xl font-bold ${result.metrics.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    ₹{result.metrics.totalPnL.toFixed(2)}
                  </p>
                </div>
                <div className="p-4 bg-slate-800 rounded-lg">
                  <p className="text-slate-400 text-sm">Avg PnL / Trade</p>
                  <p className={`text-xl font-bold ${result.metrics.avgPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    ₹{result.metrics.avgPnL}
                  </p>
                </div>
                <div className="p-4 bg-slate-800 rounded-lg">
                  <p className="text-slate-400 text-sm">Win Rate</p>
                  <p className="text-xl font-bold text-white">{result.metrics.winRate}%</p>
                </div>
                <div className="p-4 bg-slate-800 rounded-lg">
                  <p className="text-slate-400 text-sm">Total Trades</p>
                  <p className="text-xl font-bold text-white">{result.metrics.totalTrades}</p>
                </div>
                <div className="p-4 bg-slate-800 rounded-lg">
                  <p className="text-slate-400 text-sm">Max Drawdown</p>
                  <p className="text-xl font-bold text-red-500">{result.metrics.maxDrawdown}%</p>
                </div>
                <div className="p-4 bg-slate-800 rounded-lg">
                  <p className="text-slate-400 text-sm">Sharpe Ratio</p>
                  <p className={`text-xl font-bold ${result.metrics.sharpeRatio >= 1 ? 'text-green-500' : result.metrics.sharpeRatio > 0 ? 'text-yellow-500' : 'text-red-500'}`}>
                    {result.metrics.sharpeRatio}
                  </p>
                </div>
              </div>
              
              {/* AI Confirmation Status Banner */}
              {aiPolling && (
                <div className="bg-violet-900/30 border border-violet-500/40 rounded-lg px-4 py-3 flex items-center gap-3 text-sm">
                  <Bot className="w-4 h-4 shrink-0 text-violet-400 animate-pulse" />
                  <span className="text-violet-300 flex-1">
                    AI analyzing trades live
                    {aiProgress.total > 0 && (
                      <span className="ml-2 font-mono text-violet-200">
                        {aiProgress.done} / {aiProgress.total}
                      </span>
                    )}
                  </span>
                  {aiProgress.total > 0 && (
                    <div className="flex-1 max-w-[180px] bg-slate-700 rounded-full h-1.5">
                      <div
                        className="bg-violet-500 h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${Math.round((aiProgress.done / aiProgress.total) * 100)}%` }}
                      />
                    </div>
                  )}
                  <button
                    className="ml-1 px-2.5 py-1 text-xs bg-red-800/60 hover:bg-red-700 text-red-200 rounded border border-red-600/50 transition-colors whitespace-nowrap"
                    title="Stop AI processing — keeps decisions received so far"
                    onClick={async () => {
                      setAiPolling(false);
                      if (aiJobId) {
                        try { await axios.post(`${API_URL}/ai-confirmation/cancel/${aiJobId}`); }
                        catch (_) {}
                      }
                    }}
                  >
                    ⛔ Stop
                  </button>
                </div>
              )}

              {/* Re-entry AI progress banner */}
              {aiReentryPolling && (
                <div className="flex items-center gap-3 bg-amber-900/20 border border-amber-500/30 rounded-lg px-4 py-2 text-xs">
                  <span className="text-amber-300 animate-pulse">⏳</span>
                  <span className="text-amber-200 flex-1">
                    Re-entry check in progress
                    {aiReentryProgress.total > 0 && (
                      <span className="ml-2 font-mono text-amber-100">{aiReentryProgress.done} / {aiReentryProgress.total}</span>
                    )}
                  </span>
                  {aiReentryProgress.total > 0 && (
                    <div className="flex-1 max-w-[180px] bg-slate-700 rounded-full h-1.5">
                      <div
                        className="bg-amber-500 h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${Math.round((aiReentryProgress.done / aiReentryProgress.total) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* AI Summary Panel */}
              {result.ai_summary && (
                <div className="bg-slate-800 rounded-lg overflow-hidden border border-violet-500/30">
                  <button
                    onClick={() => setAiPanelOpen(o => !o)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-700/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-violet-400 font-medium">
                      <Bot className="w-4 h-4" />
                      AI Strategy Analysis
                    </div>
                    {aiPanelOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </button>
                  {aiPanelOpen && (
                    <div className="px-5 pb-5 pt-1 border-t border-slate-700">
                      <div className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed whitespace-pre-wrap text-sm">
                        {result.ai_summary}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {(() => {
                const hasAiSimAvail = (aiResimMap && aiResimMap.size > 0) || result.trades.some(t => t.aiConfirmation?.suggested_sl);
                const hasAiSlTpData = result.trades.some(t => t.aiConfirmation?.suggested_sl && t.aiConfirmation?.suggested_tp);
                const mainFollowAiSlTp = params?.ai_follow_sl_tp !== false;
                const chartData = showAiSim && aiSimData ? aiSimData.curve : result.equityCurve;
                const isComparison = showAiSim && !!aiSimData;
                return (
                <div className="bg-slate-800 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-slate-400">Equity Curve</h4>
                    <div className="flex items-center gap-2">
                      {showAiSim && hasAiSlTpData && (
                        <div className="flex items-center rounded border border-slate-600 overflow-hidden text-xs">
                          <button
                            className={`px-2.5 py-1 transition-colors ${aiSlTpView === 'main' ? (mainFollowAiSlTp ? 'bg-violet-700/60 text-violet-200' : 'bg-slate-600 text-white') : 'text-slate-400 hover:text-slate-200'}`}
                            onClick={() => setAiSlTpView('main')}
                          >
                            {mainFollowAiSlTp ? 'AI SL/TP' : 'Strategy SL/TP'}
                          </button>
                          <button
                            className={`px-2.5 py-1 transition-colors border-l border-slate-600 ${aiSlTpView === 'alt' ? (mainFollowAiSlTp ? 'bg-slate-600 text-white' : 'bg-violet-700/60 text-violet-200') : 'text-slate-400 hover:text-slate-200'}`}
                            onClick={async () => {
                              setAiSlTpView('alt');
                              if (!aiResimAltMap) await runAltResim();
                            }}
                          >
                            {aiResimAltLoading ? '⏳' : (mainFollowAiSlTp ? 'Strategy SL/TP' : 'AI SL/TP')}
                          </button>
                        </div>
                      )}
                      {hasAiSimAvail && (
                        <button
                          className={`text-xs px-3 py-1 rounded border transition-colors ${showAiSim ? 'bg-green-800/60 border-green-600 text-green-200' : 'bg-slate-700 border-slate-600 text-slate-300 hover:border-green-600 hover:text-green-300'}`}
                          onClick={() => { setShowAiSim(s => !s); setAiSlTpView('main'); }}
                        >
                          📊 {showAiSim ? 'AI View ✓' : 'Compare AI SL/TP'}
                        </button>
                      )}
                    </div>
                  </div>

                  {isComparison && (() => {
                    const diff = aiSimData.totalPnl - aiSimData.originalPnl;
                    return (
                      <div className="space-y-1.5 mb-3">
                        {/* Row 1 — P&L comparison */}
                        <div className="grid grid-cols-4 gap-2 text-center">
                          <div className="bg-slate-700/60 rounded p-2">
                            <p className="text-[10px] text-slate-400">Strategy P&L</p>
                            <p className={`text-sm font-bold ${aiSimData.originalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              ₹{aiSimData.originalPnl.toFixed(0)}
                            </p>
                          </div>
                          <div className="bg-green-900/30 border border-green-700/40 rounded p-2">
                            <p className="text-[10px] text-slate-400">
                              {aiSlTpView === 'alt'
                                ? (mainFollowAiSlTp ? 'Strategy SL/TP P&L' : 'AI SL/TP P&L')
                                : (mainFollowAiSlTp ? 'AI SL/TP P&L' : 'Strategy SL/TP P&L')}
                            </p>
                            <p className={`text-sm font-bold ${aiSimData.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              ₹{aiSimData.totalPnl.toFixed(0)}
                            </p>
                          </div>
                          <div className="bg-slate-700/60 rounded p-2">
                            <p className="text-[10px] text-slate-400">Difference</p>
                            <p className={`text-sm font-bold ${diff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {diff >= 0 ? '+' : ''}₹{diff.toFixed(0)}
                            </p>
                          </div>
                          <div className="bg-slate-700/60 rounded p-2">
                            <p className="text-[10px] text-slate-400">Confirmed Win Rate</p>
                            <p className="text-sm font-bold text-white">{aiSimData.winRate}%</p>
                          </div>
                        </div>
                        {/* Row 2 — totals + risk metrics */}
                        <div className="grid grid-cols-4 gap-2 text-center">
                          <div className="bg-slate-700/60 rounded p-2">
                            <p className="text-[10px] text-slate-400">Confirmed Trades</p>
                            <p className="text-sm font-bold text-white">{aiSimData.totalTrades}</p>
                          </div>
                          <div className="bg-slate-700/60 rounded p-2">
                            <p className="text-[10px] text-slate-400">Rejected Trades</p>
                            <p className="text-sm font-bold text-red-400/80">{aiSimData.rejectedCount}</p>
                          </div>
                          <div className="bg-slate-700/60 rounded p-2">
                            <p className="text-[10px] text-slate-400">AI Sharpe</p>
                            <p className={`text-sm font-bold ${aiSimData.sharpe >= 1 ? 'text-green-400' : aiSimData.sharpe > 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                              {aiSimData.sharpe}
                            </p>
                          </div>
                          <div className="bg-slate-700/60 rounded p-2">
                            <p className="text-[10px] text-slate-400">AI Max DD</p>
                            <p className={`text-sm font-bold ${aiSimData.maxDrawdown > 20 ? 'text-red-400' : aiSimData.maxDrawdown > 10 ? 'text-yellow-400' : 'text-green-400'}`}>
                              -{aiSimData.maxDrawdown}%
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  {isComparison && (
                    <p className="text-[10px] text-slate-500 mb-2">
                      Est. using delta ~0.5. Actual premium moves may differ due to IV & time decay.
                    </p>
                  )}

                  <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis
                        dataKey={isComparison ? 't' : 'date'}
                        stroke="#94a3b8"
                        tickFormatter={isComparison ? (v) => `T${v}` : (s) => new Date(s).toLocaleDateString()}
                      />
                      <YAxis stroke="#94a3b8" domain={['auto', 'auto']} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }}
                        itemStyle={{ color: '#fff' }}
                        labelFormatter={isComparison ? (v) => `Trade #${v}` : (l) => new Date(l).toLocaleString()}
                      />
                      {isComparison ? (
                        <>
                          <Legend wrapperStyle={{ fontSize: '11px' }} />
                          <Line type="monotone" dataKey="original" stroke="#3b82f6" name="Strategy" dot={false} strokeWidth={2} />
                          <Line type="monotone" dataKey="ai_sim" stroke="#4ade80" name="AI SL/TP" dot={false} strokeWidth={2} strokeDasharray="5 3" />
                        </>
                      ) : (
                        <Line type="monotone" dataKey="balance" stroke="#3b82f6" strokeWidth={2} dot={false} />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                  </div>
                </div>
                );
              })()}

              {/* Trades Table */}
              {(() => {
                const hasSpotData = result.trades.length > 0 && result.trades[0].spot_sl != null;
                const isSwingMode = result.trades.length > 0 && result.trades[0].sl_tp_type === 'SPOT_SWING';
                const hasReentryData = result.trades.some(t => t.ai_reentry_entry_time || t.ai_reentry_decision);
                return (
                <div className="bg-slate-800 rounded-lg p-4 overflow-hidden">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-slate-400">All Trades ({result.trades.length})</h4>
                    {hasSpotData && (
                      <div className="flex items-center gap-2">
                        {isSwingMode && (
                          <span className="text-[10px] bg-blue-900/40 text-blue-300 border border-blue-700/40 px-2 py-0.5 rounded-full">
                            Swing SL Mode
                          </span>
                        )}
                        <div className="flex rounded overflow-hidden border border-slate-600 text-xs">
                          <button
                            className={`px-3 py-1 transition-colors ${!showSpotView ? 'bg-slate-600 text-white' : 'bg-transparent text-slate-400 hover:text-white'}`}
                            onClick={() => setShowSpotView(false)}
                          >Premium</button>
                          <button
                            className={`px-3 py-1 transition-colors ${showSpotView ? 'bg-blue-700 text-white' : 'bg-transparent text-slate-400 hover:text-white'}`}
                            onClick={() => setShowSpotView(true)}
                          >Spot Index</button>
                        </div>
                      </div>
                    )}
                  </div>
                  {showSpotView && hasSpotData && (
                    <p className="text-[10px] text-blue-400/70 mb-2">
                      Showing index price levels. Entry &amp; Exit = underlying index price at signal/exit bar. SL/TP = index levels used as exit triggers. P&amp;L is still based on option premium.
                    </p>
                  )}
                  <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <table className="w-full text-sm text-left text-slate-300">
                    <thead className="text-xs text-slate-400 uppercase bg-slate-700/50 sticky top-0 z-10">
                      <tr>
                        <th className="px-4 py-3 bg-slate-800">Entry Time</th>
                        <th className="px-4 py-3 bg-slate-800">Symbol</th>
                        <th className="px-4 py-3 bg-slate-800">Volume</th>
                        <th className="px-4 py-3 bg-slate-800">Avg Vol</th>
                        <th className="px-4 py-3 bg-slate-800">Type</th>
                        <th className="px-4 py-3 bg-slate-800">AI</th>
                        <th className="px-4 py-3 bg-slate-800">
                          {showSpotView && hasSpotData ? <span className="text-blue-400">Spot Entry</span> : 'Prem Entry'}
                        </th>
                        <th className="px-4 py-3 bg-slate-800">
                          {showSpotView && hasSpotData ? <span className="text-blue-400">Spot SL</span> : 'Spot SL'}
                        </th>
                        <th className="px-4 py-3 bg-slate-800">
                          {showSpotView && hasSpotData ? <span className="text-blue-400">Spot TP</span> : 'Spot TP'}
                        </th>
                        <th className="px-4 py-3 bg-slate-800">Invested</th>
                        <th className="px-4 py-3 bg-slate-800">Exit Time</th>
                        <th className="px-4 py-3 bg-slate-800">
                          {showSpotView && hasSpotData ? <span className="text-blue-400">Spot Exit</span> : 'Prem Exit'}
                        </th>
                        <th className="px-4 py-3 bg-slate-800">PnL</th>
                        <th className="px-4 py-3 bg-slate-800">Reason</th>
                        {showAiSim && aiSimData && <>
                          <th className="px-4 py-3 bg-green-900/20 text-green-400/80 border-l border-green-700/30" title="AI-suggested stop-loss index level">AI SL</th>
                          <th className="px-4 py-3 bg-green-900/20 text-green-400/80" title="AI-suggested take-profit index level">AI TP</th>
                          <th className="px-4 py-3 bg-green-900/20 text-green-400/80" title="Underlying index level where AI scenario exited">AI Exit Spot</th>
                          <th className="px-4 py-3 bg-green-900/20 text-green-400/80">AI Reason</th>
                          <th className="px-4 py-3 bg-green-900/20 text-green-400/80">AI Est. P&L</th>
                        </>}
                        {hasReentryData && <>
                          <th className="px-4 py-3 bg-violet-900/20 text-violet-400/80 border-l border-violet-700/30" title="Re-entry signal entry time">Re-entry Entry</th>
                          <th className="px-4 py-3 bg-violet-900/20 text-violet-400/80" title="Spot level at re-entry">Entry Spot</th>
                          <th className="px-4 py-3 bg-violet-900/20 text-violet-400/80" title="AI stop-loss for re-entry trade">Re AI SL</th>
                          <th className="px-4 py-3 bg-violet-900/20 text-violet-400/80" title="AI take-profit for re-entry trade">Re AI TP</th>
                          <th className="px-4 py-3 bg-violet-900/20 text-violet-400/80" title="Re-entry trade exit time">Re-exit Time</th>
                          <th className="px-4 py-3 bg-violet-900/20 text-violet-400/80" title="Spot level at re-entry exit">Re-exit Spot</th>
                          <th className="px-4 py-3 bg-violet-900/20 text-violet-400/80">Re-exit Reason</th>
                          <th className="px-4 py-3 bg-violet-900/20 text-violet-400/80">Re-entry P&L</th>
                        </>}
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.map((trade, idx) => (
                        <tr key={idx} className="border-b border-slate-700 hover:bg-slate-700/30">
                          <td className="px-4 py-3 text-xs">{new Date(trade.entryTime).toLocaleString()}</td>
                          <td className="px-4 py-3 font-mono text-xs">{trade.option_symbol || '-'}</td>
                          <td className="px-4 py-3 text-slate-400 text-xs">{trade.volume || '-'}</td>
                          <td className="px-4 py-3 text-slate-500 text-xs">{trade.avg_volume ? Math.round(trade.avg_volume) : '-'}</td>
                          <td className={`px-4 py-3 font-bold text-xs ${trade.type === 'CE' || trade.type === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                            {trade.type}
                          </td>
                          <td className="px-4 py-3 text-xs max-w-[150px]">
                            {trade.ai_decision ? (
                              <div className="flex flex-col items-start gap-0.5">
                                <span className={`px-1.5 py-0.5 rounded font-bold whitespace-nowrap ${trade.ai_decision === 'CONFIRM' ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
                                  {trade.ai_decision === 'CONFIRM' ? '✓' : '✗'} {trade.ai_decision}
                                  {trade.ai_confidence ? <span className="font-normal ml-1 opacity-70">{(trade.ai_confidence * 100).toFixed(0)}%</span> : null}
                                </span>
                                {trade.aiConfirmation?.reasoning && (
                                  <span
                                    className={`italic leading-tight cursor-help ${trade.ai_decision === 'CONFIRM' ? 'text-green-400/70' : 'text-red-400/70'}`}
                                    style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                                    title={trade.aiConfirmation.reasoning}
                                  >
                                    {trade.aiConfirmation.reasoning}
                                  </span>
                                )}
                                {(trade.ai_spot_sl || trade.ai_spot_tp) && (
                                  <span className="text-purple-400/70 text-[10px] mt-0.5"
                                    title="AI-suggested index levels for SL and TP">
                                    SL {trade.ai_spot_sl ? Number(trade.ai_spot_sl).toFixed(0) : '–'} / TP {trade.ai_spot_tp ? Number(trade.ai_spot_tp).toFixed(0) : '–'}
                                  </span>
                                )}
                                {trade.ai_reentry_suggested && trade.ai_reentry_level && (
                                  <>
                                    <span
                                      className={`text-[10px] mt-0.5 font-medium px-1 py-0.5 rounded ${trade.ai_decision === 'REJECT' ? 'bg-amber-900/40 text-amber-300' : 'bg-sky-900/40 text-sky-300'}`}
                                      title={trade.ai_reentry_note || 'Better entry level suggested'}
                                    >
                                      {trade.ai_decision === 'REJECT' ? '⏳' : '💡'} Watch {Number(trade.ai_reentry_level).toFixed(0)}
                                      {trade.ai_reentry_note ? ` — ${trade.ai_reentry_note}` : ''}
                                    </span>
                                    {/* Re-entry AI second decision */}
                                    {trade.ai_reentry_decision ? (
                                      <span
                                        className={`text-[10px] mt-0.5 font-semibold px-1 py-0.5 rounded ${trade.ai_reentry_decision === 'CONFIRM' ? 'bg-green-900/60 text-green-200' : 'bg-red-900/60 text-red-200'}`}
                                        title={trade.ai_reentry_reasoning || ''}
                                      >
                                        ↳ Re-entry: {trade.ai_reentry_decision === 'CONFIRM' ? '✓' : '✗'} {trade.ai_reentry_decision}
                                        {trade.ai_reentry_confidence ? <span className="font-normal opacity-70 ml-1">{trade.ai_reentry_confidence.toFixed(0)}%</span> : null}
                                        {trade.ai_reentry_reasoning ? <span className="block font-normal italic opacity-70 mt-0.5" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{trade.ai_reentry_reasoning}</span> : null}
                                      </span>
                                    ) : trade.ai_reentry_level_reached === false ? (
                                      <span className="text-[10px] mt-0.5 text-slate-500 italic">↳ Level not reached</span>
                                    ) : aiReentryPolling ? (
                                      <span className="text-[10px] mt-0.5 text-amber-500/60 animate-pulse">↳ re-checking…</span>
                                    ) : null}
                                  </>
                                )}
                                {backtestResultId && (
                                  <div className="flex gap-1 mt-1 flex-wrap">
                                    <button
                                      onClick={() => copyPrompt(idx, 'first')}
                                      title="Copy the exact prompt sent to the AI for this trade"
                                      className="flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded bg-slate-700/60 text-slate-400 hover:text-slate-200 hover:bg-slate-600/60 transition-colors"
                                    >
                                      {promptCopyState[`first_${idx}`] === 'done'
                                        ? <><Check size={9} className="text-green-400" /> Copied</>
                                        : promptCopyState[`first_${idx}`] === 'copying'
                                        ? <><Copy size={9} className="animate-pulse" /> …</>
                                        : <><Copy size={9} /> Prompt</>}
                                    </button>
                                    {trade.ai_reentry_decision && (
                                      <button
                                        onClick={() => copyPrompt(idx, 'reentry')}
                                        title="Copy the exact re-entry prompt sent to the AI"
                                        className="flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded bg-violet-900/40 text-violet-400 hover:text-violet-200 hover:bg-violet-800/40 transition-colors"
                                      >
                                        {promptCopyState[`reentry_${idx}`] === 'done'
                                          ? <><Check size={9} className="text-green-400" /> Copied</>
                                          : promptCopyState[`reentry_${idx}`] === 'copying'
                                          ? <><Copy size={9} className="animate-pulse" /> …</>
                                          : <><Copy size={9} /> Re-entry</>}
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            ) : aiPolling ? (
                              <span className="text-slate-600 animate-pulse text-xs">analyzing…</span>
                            ) : '-'}
                          </td>
                          {/* Entry price: spot or premium depending on view */}
                          <td className="px-4 py-3 font-bold text-white text-xs">
                            {showSpotView && hasSpotData
                              ? (trade.spot_entry ? Number(trade.spot_entry).toFixed(2) : '-')
                              : Number(trade.entryPrice).toFixed(2)}
                          </td>
                          {/* SL: always spot level; tooltip shows source details */}
                          <td className="px-4 py-3 text-red-300 text-xs cursor-help border-b border-dashed border-red-500/30"
                            title={trade.slDetails
                              ? trade.slDetails.chosen === 'SWING'
                                ? `Mode: Swing | Extreme: ${trade.slDetails.swingExtreme ?? 'N/A'} | Dist: ${trade.slDetails.slDist ?? 'N/A'} | R:R: ${trade.slDetails.rrRatio ?? 'N/A'}`
                                : `ATR: ${trade.slDetails.atr} | Strat: ${trade.slDetails.strategy ?? 'N/A'} | Fixed: ${trade.slDetails.fixed ?? 'N/A'} | Chosen: ${trade.slDetails.chosen}`
                              : 'No Details'}>
                            {(showSpotView && hasSpotData ? trade.spot_sl : trade.sl)
                              ? Number(showSpotView && hasSpotData ? trade.spot_sl : trade.sl).toFixed(2)
                              : '-'}
                          </td>
                          {/* TP: always spot level */}
                          <td className="px-4 py-3 text-green-300 text-xs">
                            {(showSpotView && hasSpotData ? trade.spot_tp : trade.tp)
                              ? Number(showSpotView && hasSpotData ? trade.spot_tp : trade.tp).toFixed(2)
                              : '-'}
                          </td>
                          <td className="px-4 py-3 text-xs">₹{trade.invested_amount ? Number(trade.invested_amount).toFixed(2) : '-'}</td>
                          <td className="px-4 py-3 text-xs">{new Date(trade.exitTime).toLocaleString()}</td>
                          {/* Exit price: spot or premium depending on view */}
                          <td className="px-4 py-3 text-xs">
                            {showSpotView && hasSpotData
                              ? (trade.spot_exit ? Number(trade.spot_exit).toFixed(2) : '-')
                              : Number(trade.exitPrice).toFixed(2)}
                          </td>
                          <td className={`px-4 py-3 font-bold text-xs ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {Number(trade.pnl).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-slate-400 text-xs">{trade.reason}</td>
                          {showAiSim && aiSimData && (() => {
                            const sim = aiSimData.trades[idx];
                            const isReject = trade.ai_decision === 'REJECT';
                            const aiSl = trade.aiConfirmation?.suggested_sl || trade.ai_spot_sl;
                            const aiTp = trade.aiConfirmation?.suggested_tp || trade.ai_spot_tp;
                            const isCE = trade.type === 'CE' || trade.type === 'BUY';
                            const pnl = sim?.ai_sim_pnl ?? 0;
                            const diff = pnl - trade.pnl;
                            return (
                              <>
                                <td className="px-4 py-3 text-xs font-mono border-l border-green-700/20"
                                  title={aiSl ? `AI SL: ${Number(aiSl).toFixed(2)} (${isCE ? 'below' : 'above'} entry)` : 'No AI SL'}>
                                  {aiSl ? <span className="text-red-300/80">{Number(aiSl).toFixed(0)}</span> : <span className="text-slate-600">-</span>}
                                </td>
                                <td className="px-4 py-3 text-xs font-mono"
                                  title={aiTp ? `AI TP: ${Number(aiTp).toFixed(2)} (${isCE ? 'above' : 'below'} entry)` : 'No AI TP'}>
                                  {aiTp ? <span className="text-green-300/80">{Number(aiTp).toFixed(0)}</span> : <span className="text-slate-600">-</span>}
                                </td>
                                {!sim?.ai_sim_exit || isReject ? (
                                  <>
                                    <td className="px-4 py-3 text-slate-500 text-xs font-mono">-</td>
                                    <td className="px-4 py-3 text-xs">
                                      {isReject
                                        ? <span className="px-1 py-0.5 rounded text-[10px] bg-red-900/30 text-red-500" title="AI rejected this trade — not taken">REJECTED</span>
                                        : <span className="px-1 py-0.5 rounded text-[10px] bg-slate-700 text-slate-400">NO DATA</span>}
                                    </td>
                                    <td className={`px-4 py-3 text-xs font-bold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                      {isReject ? <span title="Trade not taken — AI rejected">₹0</span> : Number(pnl).toFixed(2)}
                                      {!isReject && <span className={`block text-[10px] font-normal ${diff >= 0 ? 'text-green-500/70' : 'text-red-500/70'}`}>{diff >= 0 ? '↑+' : '↓'}{diff.toFixed(0)}</span>}
                                    </td>
                                  </>
                                ) : (
                                  <>
                                    <td className="px-4 py-3 text-xs font-mono"
                                      title={sim.ai_sim_exit.reason === 'TP_HIT' ? `TP hit — target was ${Number(aiTp || sim.ai_sim_exit.spot).toFixed(0)}` : sim.ai_sim_exit.reason === 'SL_HIT' ? `SL hit — stop was ${Number(aiSl || sim.ai_sim_exit.spot).toFixed(0)}` : 'Closed at session end'}>
                                      {Number(sim.ai_sim_exit.spot).toFixed(2)}
                                    </td>
                                    <td className="px-4 py-3 text-xs">
                                      <span className={`px-1 py-0.5 rounded text-[10px] ${sim.ai_sim_exit.reason === 'TP_HIT' ? 'bg-green-900/50 text-green-300' : sim.ai_sim_exit.reason === 'SL_HIT' ? 'bg-red-900/50 text-red-300' : 'bg-slate-700 text-slate-400'}`}>
                                        {sim.ai_sim_exit.reason}
                                      </span>
                                    </td>
                                    <td className={`px-4 py-3 text-xs font-bold ${sim.ai_sim_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                      {Number(sim.ai_sim_pnl).toFixed(2)}
                                      <span className={`block text-[10px] font-normal ${(sim.ai_sim_pnl - trade.pnl) >= 0 ? 'text-green-500/70' : 'text-red-500/70'}`}>{(sim.ai_sim_pnl - trade.pnl) >= 0 ? '↑+' : '↓'}{(sim.ai_sim_pnl - trade.pnl).toFixed(0)}</span>
                                    </td>
                                  </>
                                )}
                              </>
                            );
                          })()}
                          {hasReentryData && (() => {
                            const reEntry = aiReentryResimMap?.get(idx);
                            const entryTime = reEntry?.entry_time || trade.ai_reentry_entry_time;
                            const entrySpot = reEntry?.entry_spot ?? trade.ai_reentry_entry_price;
                            const reAiSl = trade.ai_reentry_sl;
                            const reAiTp = trade.ai_reentry_tp;
                            if (!trade.ai_reentry_suggested) {
                              return (
                                <>
                                  <td className="px-4 py-3 text-slate-600 text-xs border-l border-violet-700/20">-</td>
                                  <td className="px-4 py-3 text-slate-600 text-xs">-</td>
                                  <td className="px-4 py-3 text-slate-600 text-xs">-</td>
                                  <td className="px-4 py-3 text-slate-600 text-xs">-</td>
                                  <td className="px-4 py-3 text-slate-600 text-xs">-</td>
                                  <td className="px-4 py-3 text-slate-600 text-xs">-</td>
                                  <td className="px-4 py-3 text-slate-600 text-xs">-</td>
                                  <td className="px-4 py-3 text-slate-600 text-xs">-</td>
                                </>
                              );
                            }
                            const isConfirmed = trade.ai_reentry_decision === 'CONFIRM';
                            return (
                              <>
                                <td className="px-4 py-3 text-xs border-l border-violet-700/20">
                                  {entryTime
                                    ? new Date(entryTime).toLocaleString()
                                    : (aiReentryPolling ? <span className="text-amber-500/60 animate-pulse text-[10px]">…</span> : '-')}
                                </td>
                                <td className="px-4 py-3 text-xs font-mono">
                                  {entrySpot != null ? Number(entrySpot).toFixed(2) : '-'}
                                </td>
                                <td className="px-4 py-3 text-xs font-mono">
                                  {reAiSl ? <span className="text-red-300/80">{Number(reAiSl).toFixed(0)}</span> : '-'}
                                </td>
                                <td className="px-4 py-3 text-xs font-mono">
                                  {reAiTp ? <span className="text-green-300/80">{Number(reAiTp).toFixed(0)}</span> : '-'}
                                </td>
                                <td className="px-4 py-3 text-xs">
                                  {reEntry?.exit_time
                                    ? new Date(reEntry.exit_time).toLocaleString()
                                    : (isConfirmed && !aiReentryResimMap ? <span className="text-amber-500/60 animate-pulse text-[10px]">simulating…</span> : '-')}
                                </td>
                                <td className="px-4 py-3 text-xs font-mono">
                                  {reEntry?.exit_spot != null ? Number(reEntry.exit_spot).toFixed(2) : '-'}
                                </td>
                                <td className="px-4 py-3 text-xs">
                                  {reEntry?.exit_reason ? (
                                    <span className={`px-1 py-0.5 rounded text-[10px] ${reEntry.exit_reason === 'TP_HIT' ? 'bg-green-900/50 text-green-300' : reEntry.exit_reason === 'SL_HIT' ? 'bg-red-900/50 text-red-300' : 'bg-slate-700 text-slate-400'}`}>
                                      {reEntry.exit_reason}
                                    </span>
                                  ) : '-'}
                                </td>
                                <td className={`px-4 py-3 text-xs font-bold ${reEntry?.exit_pnl == null ? 'text-slate-500' : reEntry.exit_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {reEntry?.exit_pnl != null ? `₹${Number(reEntry.exit_pnl).toFixed(2)}` : '-'}
                                </td>
                              </>
                            );
                          })()}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>
                );
              })()}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-slate-500">
              Run a backtest to see results
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
