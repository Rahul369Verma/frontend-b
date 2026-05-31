import React, { createContext, useContext, useState } from 'react';
import { INSTRUMENT_CONFIG } from '../constants';

const GlobalContext = createContext();

export function GlobalProvider({ children }) {
  const today = new Date().toISOString().split('T')[0];
  
  // Derive defaults from constants
  const defaultSymbol = Object.keys(INSTRUMENT_CONFIG)[0] || 'NSE:NIFTYBANK-INDEX';
  const defaultLotSize = INSTRUMENT_CONFIG[defaultSymbol]?.lotSize || 30;

  // Backtest State
  const [backtestParams, setBacktestParams] = useState({
    strategy: 'mta_ema_crossover',
    symbol: defaultSymbol,
    start_date: '2025-01-01',
    end_date: today,
    resolution: '5',
    capital: 30000,
    // Initial defaults will be loaded from Backend or Strategy selection
    lot_size: defaultLotSize,
    trade_start_time: "09:30",
    trade_end_time: "15:00",
    max_daily_loss: 10000,
    max_trades_per_day: 10,
    ai_enable_reentry: true,
    // Legacy combined flag kept for back-compat — superseded by ai_follow_sl + ai_follow_tp.
    ai_follow_sl_tp: true,
    // New: follow AI-suggested SL and TP independently.
    ai_follow_sl: true,
    ai_follow_tp: true,
    ai_follow_strategy_exits: false,
    // Claude.ai web session — serial by default; user can raise via slider.
    claude_web_batch_size: 1,
    // Gemini web session — same defaults as Claude.
    gemini_web_batch_size: 1,
    // Claude Extended Thinking — off by default. `claude_effort` is the source of truth
    // (matches claude.ai's web UI enum); `claude_thinking_budget` is derived from it
    // and only used for the Anthropic API path (which takes a numeric budget_tokens).
    // For claude-web/*, we additionally send `effort` + `thinking_mode` on the
    // conversation create body so 4.8 picks the right reasoning depth.
    claude_thinking_enabled: false,
    claude_effort: 'high',           // 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    claude_thinking_budget: 32000,   // derived; kept for API path back-compat
    // Live engine fail-closed flag — when true, AI errors/timeouts return REJECT
    // (skip the trade) instead of the historical fail-open CONFIRM (which was
    // misleading on Telegram and only gated by the confidence threshold).
    ai_fail_closed: false,
    // Opt-in: ask the AI to browse the web for VIX + news + global cues before
    // deciding. Only meaningful for Claude.ai web-session models. Adds ~30–60s
    // latency per signal. OFF by default — turn on only when you want macro
    // context layered on top of the technical analysis.
    ai_enable_web_research: false,
    // In-flight AI review — periodically re-evaluates active positions and
    // can auto-tighten SL, extend TP, or close early. OFF by default.
    // FULL AUTONOMOUS: whatever the AI suggests (within sanity bounds) is
    // applied without confirmation. Telegram fires for every action.
    ai_inflight_review_enabled: false,
    ai_inflight_review_interval_min: 15,
    // AI spot-level exits (live engine only). When true, the engine monitors
    // the underlying index and fires market exits the moment spot crosses
    // AI's exact suggested_sl / suggested_tp. Broker SL stays as a wider safety
    // net (multiplied by ai_sl_safety_buffer) so disconnects/crashes can't
    // strand the position.
    ai_use_spot_exits: false,
    ai_sl_safety_buffer: 1.5,
    // Mastra second-AI validator — off by default; live matches backtest unless on.
    enable_mastra_validator: false,
  });
  const [backtestResult, setBacktestResult] = useState(null);

  // Fetch Defaults from Backend
  React.useEffect(() => {
    const fetchDefaults = async () => {
      try {
        const API_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;
        const res = await fetch(`${API_URL}/engine/defaults`);
        const data = await res.json();
        if (data) {
            // Filter out system params that should NOT be overwritten by defaults (Dates, Capital)
            // Use underscores to satisfy linter for unused vars
            const { 
                start_date: _sd, 
                end_date: _ed, 
                startDate: _Sd, 
                endDate: _Ed, 
                capital: _cap, 
                ...safeData 
            } = data;
            
            setBacktestParams(prev => ({
                ...prev,
                ...safeData
            }));
            console.log("✅ Loaded Strategy Defaults from Backend (Dates Excluded):", safeData);
        }
      } catch (err) {
        console.error("❌ Failed to load defaults:", err);
      }
    };
    fetchDefaults();
  }, []);
  // Optimizer State
  const [optimizerParams, setOptimizerParams] = useState({
    symbol: defaultSymbol,
    lot_size: defaultLotSize,
    resolution: '1',
    start_date: '2025-06-01',
    end_date: '2026-02-21',
    capital: 50000,
    iterations: 100,
    strategy: 'inside_bar',
    minTrades: 5,
    minWinRate: 40,
    maxDrawdown: 100,
    minSharpeRatio: 0.4,
    stop_on_match: false
  });
  const [optimizerResult, setOptimizerResult] = useState(null);

  return (
    <GlobalContext.Provider value={{
      backtestParams, setBacktestParams,
      backtestResult, setBacktestResult,
      optimizerParams, setOptimizerParams,
      optimizerResult, setOptimizerResult
    }}>
      {children}
    </GlobalContext.Provider>
  );
}

export function useGlobalState() {
  return useContext(GlobalContext);
}
