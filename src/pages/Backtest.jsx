import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Play } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useGlobalState } from '../context/GlobalContext';

const API_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;

// LOT_SIZES moved to Backend API

export default function Backtest() {
  const { backtestParams: params, setBacktestParams: setParams, backtestResult: result, setBacktestResult: setResult } = useGlobalState();
  const [loading, setLoading] = useState(false);
  const [instrumentConfig, setInstrumentConfig] = useState({});

  useEffect(() => {
      axios.get(`${API_URL}/config/instruments`)
        .then(res => {
            setInstrumentConfig(res.data);
            // Optional: Set default symbol if not set
        })
        .catch(err => console.error("Failed to fetch instrument config", err));
  }, []);

  const runBacktest = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await axios.post(`${API_URL}/engine/backtest/run`, params);
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

  return (
    <div className="p-8 space-y-8">
      <h1 className="text-3xl font-bold text-white">Backtest Strategy</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Controls */}
        <div className="bg-surface p-6 rounded-xl border border-slate-700 space-y-6">
          <h3 className="text-xl font-bold">Configuration</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Strategy</label>
              <select 
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                value={params.strategy}
                onChange={e => setParams({...params, strategy: e.target.value})}
              >
                <option value="mta_ema_crossover">MTA (5m) EMA Crossover</option>
                <option value="ema_daily_trend">5m State / 15m Daily Trend</option>
                <option value="ema_scalp_sim">5m Fast Crossover (Scalp)</option>
                <option value="ema_trend_confirm">5m Entry / 15m Trend EMA</option>
                <option value="ema_momentum">9-15 EMA Momentum</option>
                <option value="ema_confluence_strict">9-15 EMA Confluence (Strict)</option>
                <option value="ai_prediction">AI Prediction Strategy</option>
              </select>
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
                    lot_size: config ? config.lotSize : 15 
                  });
                }}
              >
                {/* Dynamic Options from Backend */}
                {Object.keys(instrumentConfig).length === 0 && <option>Loading...</option>}
                
                <optgroup label="Indices">
                    {Object.entries(instrumentConfig)
                        .filter(([k, v]) => !k.includes('-EQ') && !k.startsWith('MCX:'))
                        .map(([key, config]) => (
                            <option key={key} value={key}>{config.underlying}</option>
                        ))}
                </optgroup>

                <optgroup label="Commodities (MCX)">
                    {Object.entries(instrumentConfig)
                        .filter(([k, v]) => k.startsWith('MCX:'))
                        .map(([key, config]) => (
                            <option key={key} value={key}>{config.underlying}</option>
                        ))}
                </optgroup>

                <optgroup label="Stocks">
                    {Object.entries(instrumentConfig)
                        .filter(([k, v]) => k.includes('-EQ'))
                        .map(([key, config]) => (
                            <option key={key} value={key}>{config.underlying}</option>
                        ))}
                </optgroup>
              </select>
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
                            onChange={e => setParams({...params, lot_size: e.target.value})} />
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
                        <label className="block text-xs text-slate-400 mb-1">Max Trades / Day</label>
                        <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                            value={params.max_trades_per_day || 10}
                            onChange={e => setParams({...params, max_trades_per_day: e.target.value})} />
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
                        <label className="block text-xs text-slate-400 mb-1">Stop-Loss Method</label>
                        <select className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                            value={params.sl_method || 'atr'}
                            onChange={e => setParams({...params, sl_method: e.target.value})}
                        >
                            <option value="atr">ATR (Dynamic)</option>
                            <option value="fixed">Fixed Points (Not Impl)</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs text-slate-400 mb-1">ATR Period</label>
                        <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                            value={params.atr_period || 14}
                            onChange={e => setParams({...params, atr_period: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-xs text-slate-400 mb-1">ATR TP Multiplier</label>
                        <input type="number" step="0.1" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                            value={params.atr_tp_mult || 3.5}
                            onChange={e => setParams({...params, atr_tp_mult: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-xs text-slate-400 mb-1">ATR SL Multiplier</label>
                        <input type="number" step="0.1" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                            value={params.atr_sl_mult || 1.8}
                            onChange={e => setParams({...params, atr_sl_mult: e.target.value})} />
                    </div>
                </div>
            </div>

            {/* 4. Strategy Filters */}
            <div className="border-t border-slate-700 pt-4 space-y-4">
                <h4 className="text-sm font-bold text-slate-300">⚡ Strategy Filters</h4>
                
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs text-slate-400 mb-1">EMA Short</label>
                        <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                            value={params.ema_short || 5}
                            onChange={e => setParams({...params, ema_short: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-xs text-slate-400 mb-1">EMA Long</label>
                        <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                            value={params.ema_long || 7}
                            onChange={e => setParams({...params, ema_long: e.target.value})} />
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-sm text-slate-400">Use 15m Trend Filter</label>
                        <input type="checkbox" checked={params.use_15m_filter !== false} 
                            onChange={e => setParams({...params, use_15m_filter: e.target.checked})} />
                    </div>
                    <div className="flex items-center justify-between">
                        <label className="text-sm text-slate-400">Use 1h Trend Filter</label>
                        <input type="checkbox" checked={params.use_1h_filter || false} 
                            onChange={e => setParams({...params, use_1h_filter: e.target.checked})} />
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-sm text-slate-400">Use ADX Filter</label>
                        <input type="checkbox" checked={params.use_adx_filter} 
                            onChange={e => setParams({...params, use_adx_filter: e.target.checked})} />
                    </div>
                    {params.use_adx_filter && (
                        <div>
                            <label className="block text-xs text-slate-400 mb-1">ADX Threshold</label>
                            <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                                value={params.adx_threshold || 26}
                                onChange={e => setParams({...params, adx_threshold: e.target.value})} />
                        </div>
                    )}
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-sm text-slate-400">Use RSI Filter</label>
                        <input type="checkbox" checked={params.use_rsi_filter} 
                            onChange={e => setParams({...params, use_rsi_filter: e.target.checked})} />
                    </div>
                    {params.use_rsi_filter && (
                        <div className="grid grid-cols-3 gap-2">
                             <div>
                                <label className="block text-xs text-slate-400 mb-1">Period</label>
                                <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                                    value={params.rsi_period || 14}
                                    onChange={e => setParams({...params, rsi_period: e.target.value})} />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Overbought</label>
                                <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                                    value={params.rsi_overbought || 85}
                                    onChange={e => setParams({...params, rsi_overbought: e.target.value})} />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Oversold</label>
                                <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"
                                    value={params.rsi_oversold || 24}
                                    onChange={e => setParams({...params, rsi_oversold: e.target.value})} />
                            </div>
                        </div>
                    )}
                </div>
            </div>
            
            <button
              onClick={runBacktest}
              disabled={loading}
              className="w-full bg-primary hover:bg-blue-600 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              {loading ? 'Running...' : <><Play className="w-4 h-4" /> Run Backtest</>}
            </button>
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
                        <th className="px-4 py-3 bg-slate-800">Type</th>
                        <th className="px-4 py-3 bg-slate-800">Price</th>
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
                          <td className={`px-4 py-3 font-bold ${trade.type === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                            {trade.type}
                          </td>
                          <td className="px-4 py-3">{trade.entryPrice != null ? trade.entryPrice.toFixed(2) : '-'}</td>
                          <td className="px-4 py-3">₹{trade.invested_amount != null ? trade.invested_amount.toFixed(2) : '-'}</td>
                          <td className="px-4 py-3">{new Date(trade.exitTime).toLocaleString()}</td>
                          <td className="px-4 py-3">{trade.exitPrice != null ? trade.exitPrice.toFixed(2) : '-'}</td>
                          <td className={`px-4 py-3 font-bold ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {trade.pnl != null ? trade.pnl.toFixed(2) : '-'}
                          </td>
                          <td className="px-4 py-3 text-slate-400">{trade.reason}</td>
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
