import React, { createContext, useContext, useState } from 'react';

const GlobalContext = createContext();

export function GlobalProvider({ children }) {
  const today = new Date().toISOString().split('T')[0];
  
  // Backtest State
  const [backtestParams, setBacktestParams] = useState({
    strategy: 'mta_ema_crossover',
    symbol: 'BANKNIFTY',
    start_date: '2025-01-01',
    end_date: today,
    resolution: '5',
    capital: 30000,
    // Initial defaults will be loaded from Backend or Strategy selection
    lot_size: 35,
    trade_start_time: "09:30",
    trade_end_time: "15:00",
    max_daily_loss: 2000,
    max_trades_per_day: 10
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
    symbol: 'NSE:NIFTYBANK-INDEX',
    lot_size: 35,
    start_date: '2025-01-01',
    end_date: today,
    capital: 30000,
    iterations: 10,
    strategy: 'mta_ema_crossover',
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
