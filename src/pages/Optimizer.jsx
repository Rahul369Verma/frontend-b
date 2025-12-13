import React, { useState } from 'react';
import { Activity, Play, TrendingUp, AlertTriangle, Code } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGlobalState } from '../context/GlobalContext';

export default function Optimizer() {
  const navigate = useNavigate();
  const { optimizerParams: config, setOptimizerParams: setConfig, optimizerResult: results, setOptimizerResult: setResults, setBacktestParams } = useGlobalState();

  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [selectedResult, setSelectedResult] = useState(null);

  const startOptimization = async () => {
    setRunning(true);
    setError(null);
    setResults(null);
    setSelectedResult(null);
    
    try {
        const symbolMap = {
            'BANKNIFTY': 'NSE:NIFTYBANK-INDEX',
            'NIFTY': 'NSE:NIFTY50-INDEX'
        };

        const response = await fetch(`${import.meta.env.VITE_API_URL}/api/engine/optimizer/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                symbol: symbolMap[config.symbol] || config.symbol,
                start_date: config.start_date,
                end_date: config.end_date,
                capital: config.capital,
                iterations: config.iterations,
                strategy: config.strategy,
                min_trades: config.minTrades,
                min_win_rate: config.minWinRate,
                max_drawdown: config.maxDrawdown || 20
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

  const handleRowClick = (result) => {
      // Update Backtest Params in Global Context
      setBacktestParams(prev => ({
          ...prev,
          ...result.params,
          symbol: config.symbol,
          start_date: config.start_date,
          end_date: config.end_date,
          capital: config.capital,
          // Ensure we map optimizer params to backtest params correctly if names differ
          // Assuming result.params keys match backtestParams keys
      }));
      
      // Navigate to Backtest Page
      navigate('/backtest');
  };

  return (
    <div className="p-8 space-y-8">
      <h1 className="text-3xl font-bold text-white flex items-center gap-3">
        <Activity className="w-8 h-8 text-primary" />
        Strategy Optimizer
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="bg-surface p-6 rounded-xl border border-slate-700 space-y-6 h-fit">
          <h3 className="text-xl font-bold">Parameters</h3>
          
          <div className="space-y-4">
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
                onChange={e => setConfig({...config, symbol: e.target.value})}
              >
                <option value="BANKNIFTY">BANKNIFTY</option>
                <option value="NIFTY">NIFTY</option>
              </select>
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
            <div className="h-full flex flex-col items-center justify-center space-y-4">
              <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
              <p className="text-slate-400">Running genetic algorithm...</p>
              <p className="text-xs text-slate-500">Testing {config.iterations} parameter combinations from {config.start_date} to {config.end_date}</p>
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
