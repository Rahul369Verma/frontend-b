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
    max_daily_loss: 2000,
    max_trades_per_day: 10,
    ai_enable_reentry: true,
    ai_follow_sl_tp: true,
    ai_follow_strategy_exits: false,
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
