import React, { createContext, useContext, useState } from 'react';

const GlobalContext = createContext();

export function GlobalProvider({ children }) {
  // Backtest State
  const [backtestParams, setBacktestParams] = useState({
    strategy: 'mta_ema_crossover',
    symbol: 'BANKNIFTY',
    start_date: '2024-01-01',
    end_date: '2024-01-31',
    interval: '5',
    capital: 30000,
    // Initial defaults (synced with backend on load)
    ema_short: 5,
    ema_long: 7,
    use_adx_filter: true,
    adx_period: 14,
    adx_threshold: 26,
    use_rsi_filter: true,
    rsi_period: 14,
    rsi_overbought: 85,
    rsi_oversold: 24,
    use_15m_filter: true,
    use_1h_filter: false,
    atr_period: 14,
    atr_tp_mult: 3.5,
    atr_sl_mult: 1.8,
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
            setBacktestParams(prev => ({
                ...prev,
                ...data
            }));
            console.log("✅ Loaded Strategy Defaults from Backend:", data);
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
    start_date: '2024-01-01',
    end_date: '2024-01-31',
    capital: 30000,
    iterations: 10,
    strategy: 'mta_ema_crossover',
    minTrades: 5,
    minWinRate: 40,
    maxDrawdown: 20
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
