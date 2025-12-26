import React, { useState, useEffect } from 'react';
import { Play, Square, Activity, DollarSign, TrendingUp, AlertTriangle, Shield, ShoppingCart, List, Database } from 'lucide-react';
import axios from 'axios';
import { io } from 'socket.io-client';

// API Base URL
const API_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;

function StatCard({ title, value, subtext, icon: Icon, color }) {
  return (
    <div className="bg-surface p-6 rounded-xl border border-slate-700">
      <div className="flex justify-between items-start mb-4">
        <div>
          <p className="text-slate-400 text-sm font-medium">{title}</p>
          <h3 className="text-2xl font-bold mt-1 text-white">{value}</h3>
        </div>
        <div className={`p-3 rounded-lg bg-${color}-500/10 text-${color}-500`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
      {subtext && <p className="text-sm text-slate-500">{subtext}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [status, setStatus] = useState({ is_running: false, mode: 'paper' });
  const [marketData, setMarketData] = useState(null);
  const [pnl, setPnl] = useState({ daily_pnl: 0, trades_count: 0 });
  const [positions, setPositions] = useState([]);
  const [optionChain, setOptionChain] = useState([]);
  const [mongoTrades, setMongoTrades] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchData = async () => {
    try {
      // Consolidated API Call
      const response = await axios.get(`${API_URL}/engine/dashboard`);
      const data = response.data;

      if (data) {
          setStatus(data.status || { is_running: false });
          setMarketData(data.marketData || null);
          setPnl(data.pnl || { daily_pnl: 0, trades_count: 0 });
          setPositions(data.positions || []);
          setOptionChain(data.optionChain || []);
          setMongoTrades(data.mongoTrades || []);
      }
    } catch (err) {
      console.error("Failed to fetch dashboard data", err);
    }
  };

  useEffect(() => {
    // Check for Fyers Auth Code in URL
    const params = new URLSearchParams(window.location.search);
    const authCode = params.get('auth_code');

    if (authCode) {
        console.log("🔐 Found Fyers Auth Code, exchanging for token...");
        axios.post(`${API_URL}/auth/fyers/callback`, { auth_code: authCode })
            .then(res => {
                alert("✅ Fyers Authenticated Successfully!");
                // Remove auth_code from URL
                window.history.replaceState({}, document.title, window.location.pathname);
                fetchData(); // Refresh status
            })
            .catch(err => {
                alert("❌ Fyers Authentication Failed: " + (err.response?.data?.error || err.message));
            });
    }
  }, []);

  useEffect(() => {
    // Initial Fetch
    fetchData();

    // Connect Socket
    const socket = io(import.meta.env.VITE_API_URL || 'http://localhost:5000');

    socket.on('connect', () => {
        console.log("✅ Connected to WebSocket");
    });

    socket.on('dashboard_update', (data) => {
        // console.log("🔄 Received Dashboard Update via Socket");
        if (data) {
            setStatus(data.status || { is_running: false });
            setMarketData(data.marketData || null);
            setPnl(data.pnl || { daily_pnl: 0, trades_count: 0 });
            setPositions(data.positions || []);
            setOptionChain(data.optionChain || []);
            setMongoTrades(data.mongoTrades || []);
        }
    });

    socket.on('disconnect', () => {
        console.log("❌ Disconnected from WebSocket");
    });

    return () => {
        socket.disconnect();
    };
  }, []);

  const toggleBot = async () => {
    setLoading(true);
    try {
      if (status.is_running) await axios.post(`${API_URL}/engine/bot/stop`);
      else await axios.post(`${API_URL}/engine/bot/start`);
      await fetchData();
    } catch (err) {
      alert("Failed to toggle bot: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const manualTrade = async (type) => {
    if (!window.confirm(`Execute Manual ${type} Trade?`)) return;
    try {
        await axios.post(`${API_URL}/engine/manual-trade`, { type });
        alert(`${type} Trade Executed!`);
        fetchData();
    } catch (err) {
        alert("Trade Failed: " + err.message);
    }
  };

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-white">Live Dashboard</h1>
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${
              (status.mode === 'LIVE' || status.mode === 'live') 
                ? 'bg-red-500/20 text-red-400 border border-red-500/50' 
                : 'bg-blue-500/20 text-blue-400 border border-blue-500/50'
            }`}>
              {(status.mode === 'LIVE' || status.mode === 'live') ? '🔴 LIVE TRADING' : '📝 PAPER TRADING'}
            </span>
          </div>
          <p className="text-slate-400 mt-1">
            {status.active_strategy} • {status.fyers_connected ? '🟢 Fyers Connected' : '🔴 Fyers Disconnected'}
          </p>
          
          {/* Resource Monitor Widget */}
          {status.system_metrics && (
              <div className="mt-2 flex items-center gap-4 text-xs font-mono bg-slate-800/50 p-2 rounded border border-slate-700 w-fit">
                  <div className="flex items-center gap-2">
                       <span className="text-slate-400">RAM:</span>
                       <div className="w-24 h-2 bg-slate-700 rounded-full overflow-hidden">
                           <div 
                                className={`h-full transition-all duration-500 ${
                                    status.system_metrics.ram_used > 400 ? 'bg-red-500' : 
                                    status.system_metrics.ram_used > 300 ? 'bg-yellow-500' : 'bg-green-500'
                                }`} 
                                style={{ width: `${Math.min(100, (status.system_metrics.ram_used / status.system_metrics.ram_total) * 100)}%` }}
                           />
                       </div>
                       <span className={`${status.system_metrics.ram_used > 300 ? 'text-yellow-400' : 'text-slate-300'}`}>
                           {status.system_metrics.ram_used}MB
                        </span>
                  </div>
                  <div className="w-px h-3 bg-slate-600"></div>
                  <div className="flex items-center gap-2">
                       <span className="text-slate-400">CPU:</span>
                       <span className="text-slate-300">{status.system_metrics.cpu_load}</span>
                  </div>
              </div>
          )}
        </div>
        {/* Button Removed - Controlled via Telegram */
       /* <button
          onClick={toggleBot}
          disabled={loading}
          className={`flex items-center gap-2 px-6 py-3 rounded-lg font-bold transition-all ${
            status.is_running
              ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20'
              : 'bg-green-500 hover:bg-green-600 text-white shadow-lg shadow-green-500/20'
          }`}
        >
          {loading ? <span className="animate-spin">⌛</span> : status.is_running ? <><Square className="w-5 h-5 fill-current" /> Stop Bot</> : <><Play className="w-5 h-5 fill-current" /> Start Bot</>}
        </button> */}
      </div>

      {/* Active Strategy Configuration */}
      <div className="bg-surface p-6 rounded-xl border border-slate-700">
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" /> Active Strategy Configuration
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="p-3 bg-slate-800 rounded-lg">
                <p className="text-slate-400 text-xs">EMA Short/Long</p>
                <p className="text-lg font-bold text-white">{status.strategy_params?.ema_short} / {status.strategy_params?.ema_long}</p>
            </div>
            <div className="p-3 bg-slate-800 rounded-lg">
                <p className="text-slate-400 text-xs">ADX Filter</p>
                <p className={`text-lg font-bold ${status.strategy_params?.use_adx_filter ? 'text-green-400' : 'text-slate-500'}`}>
                    {status.strategy_params?.use_adx_filter ? `> ${status.strategy_params?.adx_threshold}` : 'OFF'}
                </p>
            </div>
            <div className="p-3 bg-slate-800 rounded-lg">
                <p className="text-slate-400 text-xs">RSI Range</p>
                <p className={`text-lg font-bold ${status.strategy_params?.use_rsi_filter ? 'text-purple-400' : 'text-slate-500'}`}>
                    {status.strategy_params?.use_rsi_filter ? `${status.strategy_params?.rsi_oversold} - ${status.strategy_params?.rsi_overbought}` : 'OFF'}
                </p>
            </div>
             <div className="p-3 bg-slate-800 rounded-lg">
                <p className="text-slate-400 text-xs">ATR TP/SL</p>
                <p className="text-lg font-bold text-white">{status.strategy_params?.atr_tp_mult}x / {status.strategy_params?.atr_sl_mult}x</p>
            </div>
            <div className="p-3 bg-slate-800 rounded-lg">
                <p className="text-slate-400 text-xs">Trading Window</p>
                <p className="text-lg font-bold text-white">{status.strategy_params?.trade_start_time} - {status.strategy_params?.trade_end_time}</p>
            </div>
             <div className="p-3 bg-slate-800 rounded-lg">
                <p className="text-slate-400 text-xs">Risk (Loss/Trades)</p>
                <p className="text-lg font-bold text-red-400">₹{status.strategy_params?.max_daily_loss} / {status.strategy_params?.max_trades_per_day}</p>
            </div>
        </div>
      </div>

      {/* Live Market Data Section */}
      <div className="bg-surface p-6 rounded-xl border border-slate-700">
        <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" /> Live Market Data (BANKNIFTY)
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="p-4 bg-slate-800 rounded-lg">
                <p className="text-slate-400 text-sm">Spot Price</p>
                <p className="text-xl font-bold text-white">₹{marketData?.ltp?.toFixed(2) || "0.00"}</p>
            </div>
            <div className="p-4 bg-slate-800 rounded-lg">
                <p className="text-slate-400 text-sm">5m EMA Short</p>
                <p className="text-xl font-bold text-blue-400">₹{marketData?.ema_short?.toFixed(2) || "0.00"}</p>
            </div>
            <div className="p-4 bg-slate-800 rounded-lg">
                <p className="text-slate-400 text-sm">5m EMA Long</p>
                <p className="text-xl font-bold text-purple-400">₹{marketData?.ema_long?.toFixed(2) || "0.00"}</p>
            </div>
            <div className="p-4 bg-slate-800 rounded-lg">
                <p className="text-slate-400 text-sm">5m Trend</p>
                <div className="flex items-baseline gap-2">
                    <p className={`text-xl font-bold ${marketData?.trend === 'BULLISH' ? 'text-green-500' : 'text-red-500'}`}>
                        {marketData?.trend || "NEUTRAL"}
                    </p>
                    <span className={`text-xs ${marketData?.ema_short - marketData?.ema_long > 0 ? 'text-green-500' : 'text-red-500'}`}>
                        (₹{(marketData?.ema_short - marketData?.ema_long)?.toFixed(2) || "0.00"})
                    </span>
                </div>
            </div>
            <div className="p-4 bg-slate-800 rounded-lg">
                <p className="text-slate-400 text-sm">Last Update</p>
                <p className="text-xl font-bold text-slate-300">
                    {marketData?.timestamp ? new Date(marketData.timestamp).toLocaleTimeString() : "--:--:--"}
                </p>
            </div>
             <div className="p-4 bg-slate-800 rounded-lg">
                <p className="text-slate-400 text-sm">Last Heartbeat</p>
                <p className="text-xl font-bold text-green-400">
                    {marketData?.lastHeartbeat ? new Date(marketData.lastHeartbeat).toLocaleTimeString() : "--:--:--"}
                </p>
            </div>
            <div className="p-4 bg-slate-800 rounded-lg">
                <p className="text-slate-400 text-sm">Last Signal Check</p>
                <p className="text-xl font-bold text-yellow-400">
                    {marketData?.lastSignalCheck ? new Date(marketData.lastSignalCheck).toLocaleTimeString() : "Waiting..."}
                </p>
            </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Daily P&L"
          value={`₹${pnl.daily_pnl?.toFixed(2)}`}
          icon={DollarSign}
          color={pnl.daily_pnl >= 0 ? 'green' : 'red'}
        />
        <StatCard
          title="Trades Today"
          value={`${pnl.trades_count} / ${status.max_trades}`}
          icon={Activity}
          color="blue"
        />
         <StatCard
          title="Signal Status"
          value="MONITORING"
          subtext="Waiting for crossover..."
          icon={Shield}
          color="yellow"
        />
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Positions Table */}
        <div className="lg:col-span-2 bg-surface rounded-xl border border-slate-700 p-6">
          <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-primary" /> Live Positions
          </h3>
          {positions.length > 0 ? (
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="text-slate-400 border-b border-slate-700">
                            <th className="p-3">Symbol</th>
                            <th className="p-3">Qty</th>
                            <th className="p-3">Price</th>
                            <th className="p-3">P&L</th>
                        </tr>
                    </thead>
                    <tbody>
                        {positions.map((pos, i) => (
                            <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/50">
                                <td className="p-3 font-medium text-white">{pos.symbol}</td>
                                <td className="p-3 text-slate-300">{pos.quantity}</td>
                                <td className="p-3 text-slate-300">₹{pos.price}</td>
                                <td className={`p-3 font-bold ${0 >= 0 ? 'text-green-500' : 'text-red-500'}`}>₹0.00</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-slate-500 bg-slate-900/50 rounded-lg">
                No open positions
            </div>
          )}
        </div>

        {/* Manual Controls */}
        <div className="bg-surface rounded-xl border border-slate-700 p-6 space-y-6">
          <h3 className="text-xl font-bold mb-4">Manual Controls</h3>
          <div className="space-y-4">
             <button 
                onClick={() => manualTrade('CE')}
                className="w-full bg-green-500/10 hover:bg-green-500/20 text-green-500 border border-green-500/20 py-3 rounded-lg font-bold transition-colors"
             >
                📈 Test FAKE BUY (CE)
             </button>
             <button 
                onClick={() => manualTrade('PE')}
                className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 py-3 rounded-lg font-bold transition-colors"
             >
                📉 Test FAKE SELL (PE)
             </button>
             <hr className="border-slate-700" />
             <button className="w-full bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-lg font-bold transition-colors">
                🚨 CLOSE ALL POSITIONS
             </button>
          </div>
        </div>
      </div>

      {/* Option Chain */}
      <div className="bg-surface rounded-xl border border-slate-700 p-6">
          <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
            <List className="w-5 h-5 text-primary" /> Real Option Chain (BANKNIFTY)
          </h3>
          {optionChain.length > 0 ? (
            <div className="overflow-x-auto">
                <table className="w-full text-center border-collapse text-sm">
                    <thead>
                        <tr className="text-slate-400 border-b border-slate-700 bg-slate-800/50">
                            <th className="p-3 text-green-400" colSpan="2">CALLS (CE)</th>
                            <th className="p-3 text-white bg-slate-700">STRIKE</th>
                            <th className="p-3 text-red-400" colSpan="2">PUTS (PE)</th>
                        </tr>
                        <tr className="text-xs text-slate-500 border-b border-slate-700">
                            <th className="p-2">LTP</th>
                            <th className="p-2">Symbol</th>
                            <th className="p-2 bg-slate-800"></th>
                            <th className="p-2">Symbol</th>
                            <th className="p-2">LTP</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(() => {
                            // Group by Strike
                            const grouped = {};
                            optionChain.forEach(opt => {
                                if (!grouped[opt.strike]) grouped[opt.strike] = { CE: null, PE: null };
                                grouped[opt.strike][opt.type] = opt;
                            });
                            
                            return Object.keys(grouped).sort((a, b) => a - b).map((strike) => {
                                const ce = grouped[strike].CE;
                                const pe = grouped[strike].PE;
                                const isAtm = marketData?.ltp && Math.abs(marketData.ltp - strike) < 50; // Highlight ATM roughly

                                return (
                                    <tr key={strike} className={`border-b border-slate-800 hover:bg-slate-800/30 ${isAtm ? 'bg-blue-500/10' : ''}`}>
                                        {/* CE Data */}
                                        <td className={`p-2 font-mono ${ce ? 'text-green-400' : 'text-slate-600'}`}>
                                            {ce ? `₹${ce.ltp.toFixed(2)}` : '-'}
                                        </td>
                                        <td className="p-2 text-xs text-slate-500 truncate max-w-[100px]" title={ce?.tradingsymbol}>
                                            {ce?.tradingsymbol || '-'}
                                        </td>

                                        {/* Strike */}
                                        <td className={`p-2 font-bold bg-slate-800/50 border-x border-slate-700 ${isAtm ? 'text-blue-400' : 'text-white'}`}>
                                            {strike}
                                        </td>

                                        {/* PE Data */}
                                        <td className="p-2 text-xs text-slate-500 truncate max-w-[100px]" title={pe?.tradingsymbol}>
                                            {pe?.tradingsymbol || '-'}
                                        </td>
                                        <td className={`p-2 font-mono ${pe ? 'text-red-400' : 'text-slate-600'}`}>
                                            {pe ? `₹${pe.ltp.toFixed(2)}` : '-'}
                                        </td>
                                    </tr>
                                );
                            });
                        })()}
                    </tbody>
                </table>
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-slate-500 bg-slate-900/50 rounded-lg">
                Loading Option Chain...
            </div>
          )}
      </div>

      {/* MongoDB Trade History */}
      <div className="bg-surface rounded-xl border border-slate-700 p-6">
          <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" /> MongoDB Trade History
          </h3>
          {mongoTrades.length > 0 ? (
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                    <thead>
                        <tr className="text-slate-400 border-b border-slate-700">
                            <th className="p-3">Time</th>
                            <th className="p-3">Symbol</th>
                            <th className="p-3">Action</th>
                            <th className="p-3">Qty</th>
                            <th className="p-3">Price</th>
                            <th className="p-3">P&L</th>
                            <th className="p-3">Reason</th>
                        </tr>
                    </thead>
                    <tbody>
                        {mongoTrades.map((trade, i) => (
                            <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/50">
                                <td className="p-3 text-slate-300">{new Date(trade.timestamp).toLocaleString()}</td>
                                <td className="p-3 font-medium text-white">{trade.tradingsymbol || trade.symbol}</td>
                                <td className={`p-3 font-bold ${trade.action === 'BUY' ? 'text-green-500' : 'text-red-500'}`}>{trade.action}</td>
                                <td className="p-3 text-slate-300">{trade.quantity}</td>
                                <td className="p-3 text-slate-300">₹{trade.price}</td>
                                <td className={`p-3 font-bold ${trade.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>₹{trade.pnl}</td>
                                <td className="p-3 text-slate-400">{trade.reason}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-slate-500 bg-slate-900/50 rounded-lg">
                No trade history found.
            </div>
          )}
      </div>
    </div>
  );
}
