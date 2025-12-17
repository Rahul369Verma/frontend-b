import React, { useState } from 'react';
import { Activity, Play, TrendingUp, AlertTriangle, Code } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGlobalState } from '../context/GlobalContext';
import { io } from 'socket.io-client';

const LOT_SIZES = {
  "NSE:NIFTYBANK-INDEX": 35,
  "NSE:NIFTY50-INDEX": 75,
  "BSE:SENSEX-INDEX": 20,
  "NSE:FINNIFTY-INDEX": 65,
  "NSE:MIDCPNIFTY-INDEX": 140
};

export default function Optimizer() {
  const navigate = useNavigate();
  const { optimizerParams: config, setOptimizerParams: setConfig, optimizerResult: results, setOptimizerResult: setResults, setBacktestParams } = useGlobalState();

  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [selectedResult, setSelectedResult] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, matches: 0 });
  const [stopOnMatch, setStopOnMatch] = useState(false);

  React.useEffect(() => {
    const socket = io(import.meta.env.VITE_API_URL || 'http://localhost:5000');
    
    socket.on('optimization_progress', (data) => {
        setProgress(data);
    });

    return () => socket.disconnect();
  }, []);

  const startOptimization = async () => {
    setRunning(true);
    setError(null);
    setResults(null);
    setSelectedResult(null);
    setProgress({ current: 0, total: config.iterations, matches: 0 });
    
    try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/api/engine/optimizer/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                symbol: config.symbol,
                lot_size: config.lot_size || 15,
                start_date: config.start_date,
                end_date: config.end_date,
                capital: config.capital,
                iterations: config.iterations,
                strategy: config.strategy,
                min_trades: config.minTrades,
                min_win_rate: config.minWinRate,
                max_drawdown: config.maxDrawdown || 20,
                min_sharpe_ratio: config.minSharpeRatio,
                stop_on_match: stopOnMatch
            })
        });
        
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        setResults(data);
        if (data.best_parameters && data.best_parameters.length > 0) {
            setSelectedResult(data.best_parameters[0]);
        }
        
    } catch (err) {
        console.error("Optimization Error:", err);
        setError(err.message || "Failed to run optimization");
    } finally {
        setRunning(false);
    }
  };

  // ... handleRowClick ...

  return (
    <div className="p-8 space-y-8">
      {/* ... Header ... */}
      <h1 className="text-3xl font-bold text-white flex items-center gap-3">
        <Activity className="w-8 h-8 text-primary" />
        Strategy Optimizer
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="bg-surface p-6 rounded-xl border border-slate-700 space-y-6 h-fit">
          <h3 className="text-xl font-bold">Parameters</h3>
          
          <div className="space-y-4">
            {/* ... Existing Inputs ... */}
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Strategy</label>
              <select className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white">
                <option value="mta_ema_crossover">MTA EMA Crossover</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Symbol</label>
              <select 
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                value={config.symbol}
                onChange={e => {
                    const newSymbol = e.target.value;
                    setConfig({
                        ...config, 
                        symbol: newSymbol,
                        lot_size: LOT_SIZES[newSymbol] || 15
                    });
                }}
              >
                <option value="NSE:NIFTYBANK-INDEX">NIFTY BANK</option>
                <option value="NSE:NIFTY50-INDEX">NIFTY 50</option>
                <option value="BSE:SENSEX-INDEX">SENSEX</option>
                <option value="NSE:FINNIFTY-INDEX">FINNIFTY</option>
                <option value="NSE:MIDCPNIFTY-INDEX">MIDCPNIFTY</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Lot Size</label>
              <input 
                type="number" 
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                value={config.lot_size || LOT_SIZES[config.symbol] || 35}
                onChange={e => setConfig({...config, lot_size: parseInt(e.target.value)})}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Start Date</label>
                <input 
                  type="date" 
                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                  value={config.start_date}
                  onChange={e => setConfig({...config, start_date: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">End Date</label>
                <input 
                  type="date" 
                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                  value={config.end_date}
                  onChange={e => setConfig({...config, end_date: e.target.value})}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Starting Capital (₹)</label>
              <input 
                type="number" 
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                value={config.capital}
                onChange={e => setConfig({...config, capital: parseInt(e.target.value)})}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Iterations (Genetic Algo)</label>
              <input 
                type="number" 
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                value={config.iterations}
                onChange={e => setConfig({...config, iterations: parseInt(e.target.value)})}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Min Trades</label>
                  <input 
                    type="number" 
                    className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                    value={config.minTrades}
                    onChange={e => setConfig({...config, minTrades: parseInt(e.target.value)})}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Min Win Rate %</label>
                  <input 
                    type="number" 
                    className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                    value={config.minWinRate}
                    onChange={e => setConfig({...config, minWinRate: parseInt(e.target.value)})}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Max Drawdown %</label>
                  <input 
                    type="number" 
                    className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                    value={config.maxDrawdown || 20}
                    onChange={e => setConfig({...config, maxDrawdown: parseInt(e.target.value)})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Min Sharpe Ratio</label>
                  <input 
                    type="number" 
                    step="0.1"
                    className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                    value={config.minSharpeRatio !== undefined ? config.minSharpeRatio : 0.4}
                    onChange={e => setConfig({...config, minSharpeRatio: parseFloat(e.target.value)})}
                  />
                </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-slate-800 rounded-lg border border-slate-700">
                <div 
                    className={`w-10 h-6 rounded-full p-1 cursor-pointer transition-colors ${stopOnMatch ? 'bg-green-500' : 'bg-slate-600'}`}
                    onClick={() => setStopOnMatch(!stopOnMatch)}
                >
                    <div className={`w-4 h-4 bg-white rounded-full transition-transform ${stopOnMatch ? 'translate-x-4' : 'translate-x-0'}`} />
                </div>
                <span className="text-sm font-medium text-slate-300">Stop on First Match</span>
            </div>

            <button
              onClick={startOptimization}
              disabled={running}
              className="w-full bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {running ? 'Optimizing...' : <><Play className="w-4 h-4" /> Start Optimization</>}
            </button>
            
            {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/50 rounded text-red-400 text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    {error}
                </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 bg-surface p-6 rounded-xl border border-slate-700 min-h-[400px]">
          {running ? (
            <div className="h-full flex flex-col items-center justify-center space-y-6">
              <div className="relative w-32 h-32">
                 <svg className="w-full h-full" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="45" fill="none" stroke="#1e293b" strokeWidth="8" />
                    <circle 
                        cx="50" cy="50" r="45" fill="none" stroke="#3b82f6" strokeWidth="8" 
                        strokeDasharray="283" 
                        strokeDashoffset={283 - (283 * progress.current / (progress.total || 1))}
                        className="transition-all duration-300 ease-out"
                        transform="rotate(-90 50 50)"
                    />
                 </svg>
                 <div className="absolute inset-0 flex items-center justify-center flex-col">
                    <span className="text-2xl font-bold text-white">{Math.round((progress.current / (progress.total || 1)) * 100)}%</span>
                 </div>
              </div>
              
              <div className="text-center space-y-2">
                  <p className="text-xl font-bold text-white">Running Optimization...</p>
                  <p className="text-slate-400">Iteration {progress.current} of {progress.total}</p>
                  <p className="text-green-400 font-medium">Found {progress.matches} matches so far</p>
              </div>
            </div>
          ) : results ? (
            <div className="space-y-6">
                <div className="flex justify-between items-center">
                    <h3 className="text-xl font-bold flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-green-400" />
                        Optimization Results
                    </h3>
                    <span className="text-sm text-slate-400">
                        Found {results.best_parameters?.length || 0} profitable sets
                    </span>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="text-slate-400 border-b border-slate-700">
                                <th className="p-3">Rank</th>
                                <th className="p-3">Win Rate</th>
                                <th className="p-3">Total PnL</th>
                                <th className="p-3">Trades</th>
                                <th className="p-3">Max DD</th>
                                <th className="p-3">Sharpe</th> {/* Added Sharpe column header */}
                                <th className="p-3">EMA (S/L)</th>
                                <th className="p-3">Filters</th>
                                <th className="p-3">Action</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm">
                            {results.best_parameters?.map((res, idx) => (
                                <tr 
                                    key={idx} 
                                    className={`border-b border-slate-800 hover:bg-slate-800/50 cursor-pointer transition-colors ${selectedResult === res ? 'bg-slate-800/80' : ''}`}
                                    onClick={() => handleRowClick(res)}
                                >
                                    <td className="p-3 font-bold text-primary">#{idx + 1}</td>
                                    <td className="p-3 text-green-400">{res.metrics.winRate}%</td>
                                    <td className="p-3 font-mono">₹{res.metrics.totalPnL.toLocaleString()}</td>
                                    <td className="p-3">{res.metrics.totalTrades}</td>
                                    <td className="p-3 text-red-400">{res.metrics.maxDrawdown}%</td>
                                    <td className="p-3 text-blue-400">{res.metrics.sharpeRatio}</td>
                                    <td className="p-3">{res.params.ema_short} / {res.params.ema_long}</td>
                                    <td className="p-3 text-xs text-slate-400">
                                        {res.params.use_adx_filter && <span className="mr-1 bg-blue-900/30 px-1 rounded">ADX</span>}
                                        {res.params.use_rsi_filter && <span className="mr-1 bg-purple-900/30 px-1 rounded">RSI</span>}
                                        {res.params.use_1h_filter && <span className="bg-orange-900/30 px-1 rounded">1H</span>}
                                    </td>
                                    <td className="p-3 flex gap-2">
                                        <button className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-white">
                                            Test
                                        </button>
                                        <button 
                                            className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-white flex items-center gap-1"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedResult(res);
                                            }}
                                            title="View JSON"
                                        >
                                            <Code className="w-3 h-3" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                
                {selectedResult && (
                    <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-800">
                        <h4 className="font-bold mb-2 text-slate-300 flex items-center gap-2">
                            <Code className="w-4 h-4 text-primary" />
                            Selected Parameters JSON (Rank #{results.best_parameters.indexOf(selectedResult) + 1})
                        </h4>
                        <pre className="text-xs text-slate-500 overflow-x-auto p-2 bg-black rounded">
                            {JSON.stringify(selectedResult.params, null, 2)}
                        </pre>
                    </div>
                )}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-500">
              Run optimization to see best parameters
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
