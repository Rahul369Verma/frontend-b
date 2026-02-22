import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Play, Activity } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useGlobalState } from '../context/GlobalContext';

const API_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;

// LOT_SIZES moved to Backend API

import { useLocation } from 'react-router-dom';

export default function Backtest() {
  const { backtestParams: params, setBacktestParams: setParams, backtestResult: result, setBacktestResult: setResult } = useGlobalState();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [instrumentConfig, setInstrumentConfig] = useState({});
  const [strategyDefaults, setStrategyDefaults] = useState({});
  const [savedConfigs, setSavedConfigs] = useState([]);
  const [liveConfigs, setLiveConfigs] = useState([]);
  const [aiModels, setAiModels] = useState([]); // List of available models
  const [marketTimings, setMarketTimings] = useState({});
  const [expiryDates, setExpiryDates] = useState([]); // For Futures Expiry Selection

  useEffect(() => {
    const fetchExpiries = async () => {
        if (!params.symbol) return;
        try {
            const res = await axios.get(`${API_URL}/cal/expiries?symbol=${params.symbol}`);
            if (res.data.expiries && res.data.expiries.length > 0) {
                setExpiryDates(res.data.expiries);
            } else {
                setExpiryDates([]);
            }
        } catch (err) {
            console.error("Failed to fetch expiries", err);
            setExpiryDates([]);
        }
    };
    fetchExpiries();
  }, [params.symbol]);


  const fetchModels = async () => {
      try {
          // Fetch List of Models
          const modelsRes = await axios.get(`${API_URL}/ai/models`);
          setAiModels(modelsRes.data);
      } catch (err) {
          console.error("Failed to fetch AI models", err);
      }
  };

  useEffect(() => {
      fetchModels(); // Fetch on mount
      
      axios.get(`${API_URL}/config/timings`)
         .then(res => setMarketTimings(res.data))
         .catch(err => console.error("Failed to fetch timings", err));

      axios.get(`${API_URL}/config/instruments`)
        .then(res => setInstrumentConfig(res.data))
        .catch(err => console.error("Failed to fetch instruments", err));

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
                  'OrbStrategy': 'orb_breakout',
                  'SuperTrendStrategy': 'supertrend_adx',
                  'UniversalStrategy': 'universal',
                  'CandlestickPatternStrategy': 'candlestick_pattern',
                  'BreakoutRangeStrategy': 'breakout_range',
                  'PowerOfStocks5EmaStrategy': 'pos_5ema_scalp',
                  'VwapScalpStrategy': 'vwap_scalp',
                  'MomentumScalpStrategy': 'momentum_scalp'
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
              if (location.state.backtest_mode) newParams.backtest_mode = location.state.backtest_mode;
              if (location.state.resolution) newParams.resolution = location.state.resolution;

              return newParams;
          });
          
          // Clear state to avoid re-triggering on refresh (optional but good context cleanup)
          window.history.replaceState({}, document.title);
      }
  }, [location.state, setParams]);


  // Keys to exclude from Strategy Params (System/Backtest Config)
  const IGNORED_PARAMS = ['symbol', 'strategy', 'startDate', 'endDate', 'start_date', 'end_date', 'interval', 'period', 'capital'];

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
              symbol: params.symbol
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
            tradeMode: 'PAPER' 
        });
        alert(`🚀 Deployed to Live Bot for ${params.symbol}!`);
    } catch (err) {
        alert("❌ Deploy Failed: " + (err.response?.data?.error || err.message));
    }
  };

  const runBacktest = async () => {
    setLoading(true);
    setResult(null);
    try {
      // Clean params before executing
      const cleanParams = preparePayload(params);
      const res = await axios.post(`${API_URL}/engine/backtest/run`, cleanParams);
      if (res.data.error) {
        alert("Backtest Error: " + res.data.error);
        setResult(null);
      } else {
        setResult(res.data);
      }
    } catch (err) {
      alert("Backtest failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch defaults on mount if strategy is set but empty params
  // Or handle change
  // Keys that should persist across strategy changes
  const SYSTEM_KEYS = [
      'symbol', 'start_date', 'end_date', 'capital', 'resolution', 
      'lot_size', 'trade_start_time', 'trade_end_time', 
      'backtest_mode', 'dataSource', 'futures_expiry', 'trade_mode'
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
        <div className="bg-surface p-6 rounded-xl border border-slate-700 space-y-6">
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
                <option value="orb_breakout">Open Range Breakout (ORB)</option>
                <option value="supertrend_adx">SuperTrend + ADX Filter</option>
                <option value="ai_filtered">AI Filtered Strategy (LSTM) 🧠</option>
                <option value="candlestick_pattern">Candlestick Pattern (Reversal)</option>
                <option value="breakout_range">Breakout Range Strategy</option>
                <option value="pos_5ema_scalp">Power of Stocks 5 EMA Scalp</option>
                <option value="vwap_scalp">VWAP Rejection Scalp</option>
                <option value="momentum_scalp">Momentum RSI-EMA Scalp</option>
                <option value="universal">Universal / Discovery Mode</option>
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
            <div className="bg-purple-900/10 border border-purple-800/30 p-2 rounded mt-2">
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
                    lot_size: config ? config.lotSize : 15,
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

                  <optgroup label="Commodities (MCX)">
                      {Object.entries(instrumentConfig)
                          .filter(([k]) => k.startsWith('MCX:'))
                          .map(([key, config]) => (
                              <option key={key} value={key}>{config.underlying}</option>
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

            {/* Data Source Selection */}


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
                     <div className="col-span-1 lg:col-span-2 bg-slate-800/50 p-3 rounded border border-purple-500/30 grid grid-cols-3 gap-3">
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
                
                <div className="grid grid-cols-2 gap-4">
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
                    {/* Conditional Inputs */}
                    {params.sl_type === 'FIXED' ? (
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
                    ) : (
                        <>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">ATR Period</label>
                                <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                                    value={params.atr_period || 14}
                                    onChange={e => setParams({...params, atr_period: parseInt(e.target.value) || 14})} />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">ATR TP Multiplier</label>
                                <input type="number" step="0.1" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                                    value={params.atr_tp_mult || 3.5}
                                    onChange={e => setParams({...params, atr_tp_mult: parseFloat(e.target.value)})} />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">
                                    {params.sl_type === 'STRATEGY' ? 'ATR SL Mult (Fallback)' : 'ATR SL Multiplier'}
                                </label>
                                <input type="number" step="0.1" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                                    value={params.atr_sl_mult || 1.8}
                                    onChange={e => setParams({...params, atr_sl_mult: parseFloat(e.target.value)})} />
                            </div>
                        </>
                    )}

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
            <div className="border-t border-slate-700 pt-4">
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

                    {/* Dynamic Inputs (Fallback) */}
                    {Object.entries(strategyDefaults[params.strategy] || {}).map(([key, val]) => {
                        // Skip keys we explicitly handled above or internal ones
                        if (['resolution', 'lots', 'trade_start_time', 'trade_end_time', 'max_daily_loss', 'max_single_trade_loss', 'max_trades_per_day', 'max_slippage_percent'].includes(key)) return null;
                        if (['atr_period', 'atr_tp_mult', 'atr_sl_mult', 'use_trailing_sl', 'trailing_sl_mult'].includes(key)) return null; // Rendered in Risk/Exit Section
                        if (params.strategy === 'orb_breakout' && ['range_duration_min', 'breakout_buffer_pct'].includes(key)) return null;
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
            


            {/* AI Training Controls Moved to AI Manager */}
            <div className="flex gap-2">
                <button
                    onClick={runBacktest}
                    disabled={loading}
                    className="flex-1 bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
                >
                    {loading ? 'Running...' : <><Play className="w-4 h-4" /> Run Backtest</>}
                </button>
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
          <h3 className="text-xl font-bold mb-6">Results</h3>
          
          {result ? (
            <div className="space-y-8">
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
              
              <div className="h-96 bg-slate-800 rounded-lg p-4">
                <h4 className="text-slate-400 mb-4">Equity Curve</h4>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={result.equityCurve}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis 
                      dataKey="date" 
                      stroke="#94a3b8" 
                      tickFormatter={(str) => new Date(str).toLocaleDateString()}
                    />
                    <YAxis stroke="#94a3b8" domain={['auto', 'auto']} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }}
                      itemStyle={{ color: '#fff' }}
                      labelFormatter={(label) => new Date(label).toLocaleString()}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="balance" 
                      stroke="#3b82f6" 
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Trades Table */}
              <div className="bg-slate-800 rounded-lg p-4 overflow-hidden">
                <h4 className="text-slate-400 mb-4">All Trades ({result.trades.length})</h4>
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <table className="w-full text-sm text-left text-slate-300">
                    <thead className="text-xs text-slate-400 uppercase bg-slate-700/50 sticky top-0 z-10">
                      <tr>
                        <th className="px-4 py-3 bg-slate-800">Entry Time</th>
                        <th className="px-4 py-3 bg-slate-800">Symbol</th>
                        <th className="px-4 py-3 bg-slate-800">Volume</th>
                        <th className="px-4 py-3 bg-slate-800">Underlying</th>
                        <th className="px-4 py-3 bg-slate-800">Avg Vol</th>
                        <th className="px-4 py-3 bg-slate-800">Type</th>
                        <th className="px-4 py-3 bg-slate-800">AI Conf</th>
                        <th className="px-4 py-3 bg-slate-800">Price</th>
                        <th className="px-4 py-3 bg-slate-800">SL</th>
                        <th className="px-4 py-3 bg-slate-800">TP</th>
                        <th className="px-4 py-3 bg-slate-800">Invested</th>
                        <th className="px-4 py-3 bg-slate-800">Exit Time</th>
                        <th className="px-4 py-3 bg-slate-800">Exit Price</th>
                        <th className="px-4 py-3 bg-slate-800">PnL</th>
                        <th className="px-4 py-3 bg-slate-800">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.map((trade, idx) => (
                        <tr key={idx} className="border-b border-slate-700 hover:bg-slate-700/30">
                          <td className="px-4 py-3">{new Date(trade.entryTime).toLocaleString()}</td>
                          <td className="px-4 py-3 font-mono text-xs">{trade.option_symbol || '-'}</td>
                          <td className="px-4 py-3 text-slate-400">{trade.volume || '-'}</td>
                          <td className="px-4 py-3 font-medium text-blue-300">
                              <div className="flex flex-col text-xs">
                                  <span>{trade.underlying_price ? `${Number(trade.underlying_price).toFixed(2)} (${trade.underlying_type})` : '-'}</span>
                                  {trade.spot_price && trade.underlying_type === 'FUT' && (
                                      <span className="text-slate-400">Spot: {Number(trade.spot_price).toFixed(2)}</span>
                                  )}
                              </div>
                          </td>
                          <td className="px-4 py-3 text-slate-500">{trade.avg_volume ? Math.round(trade.avg_volume) : '-'}</td>
                          <td className={`px-4 py-3 font-bold ${trade.type === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                            {trade.type}
                          </td>
                          <td className="px-4 py-3 font-mono text-blue-300">
                            {trade.ai_confidence ? (trade.ai_confidence * 100).toFixed(0) + '%' : '-'}
                          </td>
                          <td className="px-4 py-3 font-bold text-white">{Number(trade.entryPrice).toFixed(2)}</td>
                          <td className="px-4 py-3 text-red-300 cursor-help border-b border-dashed border-red-500/30" title={trade.slDetails ? `ATR: ${trade.slDetails.atr} | Strat: ${trade.slDetails.strategy || 'N/A'} | Fixed: ${trade.slDetails.fixed || 'N/A'} | Chosen: ${trade.slDetails.chosen}` : 'No Details'}>
                              {trade.sl ? Number(trade.sl).toFixed(2) : '-'}
                          </td>
                          <td className="px-4 py-3 text-green-300">{trade.tp ? Number(trade.tp).toFixed(2) : '-'}</td>
                          <td className="px-4 py-3">₹{trade.invested_amount ? Number(trade.invested_amount).toFixed(2) : '-'}</td>
                          <td className="px-4 py-3">{new Date(trade.exitTime).toLocaleString()}</td>
                          <td className="px-4 py-3">{Number(trade.exitPrice).toFixed(2)}</td>
                          <td className={`px-4 py-3 font-bold ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {Number(trade.pnl).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-slate-400 text-xs">{trade.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
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
