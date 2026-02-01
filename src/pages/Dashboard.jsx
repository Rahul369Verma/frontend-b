import React, { useState, useEffect } from 'react';
import { Play, Square, Activity, DollarSign, TrendingUp, AlertTriangle, Shield, ShoppingCart, List, Database } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
  const [globalConfig, setGlobalConfig] = useState(null);
  const [symbolConfig, setSymbolConfig] = useState({});
  const [activeConfig, setActiveConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Trade Preview Modal State
  const [previewModal, setPreviewModal] = useState({ 
      isOpen: false, 
      loading: false, 
      data: null, 
      params: { type: 'CE', symbol: '', quantity: 15, sl: 40, tp: 100, price: 0 } 
  });

  const navigate = useNavigate();

  const handleTestClick = (symbol, config) => {
      // Prepare state for Backtester
      const stateToPass = {
          symbol: symbol,
          strategy: config.strategyName,
          params: { ...config } // Pass all params from the card
      };
      
      // Remove internal keys if present
      delete stateToPass.params.strategyName;
      delete stateToPass.params._id;
      delete stateToPass.params.__v;
      delete stateToPass.params.updatedAt;

      navigate('/backtest', { state: stateToPass });
  };

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
          // New Config Data
          setGlobalConfig(data.config?.globalSettings || {});
          setSymbolConfig(data.config?.symbolConfigs || {});
          setActiveConfig(data.config?.activeParams || {});
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

  // Socket Ref
  const socketRef = React.useRef(null);
  const [showChain, setShowChain] = useState(false);

  useEffect(() => {
    // Initial Fetch
    fetchData();

    // Connect Socket
    const socket = io(import.meta.env.VITE_API_URL || 'http://localhost:5000');
    socketRef.current = socket;

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
            setGlobalConfig(data.config?.globalSettings || {});
            setSymbolConfig(data.config?.symbolConfigs || {});
            setActiveConfig(data.config?.activeParams || {});
        }
    });

    socket.on('disconnect', () => {
        console.log("❌ Disconnected from WebSocket");
    });

    return () => {
        socket.disconnect();
    };
  }, []);

  // Handlers for Option Chain Toggle
  const toggleOptionChain = () => {
      if (showChain) {
          // Stop
          setShowChain(false);
          setOptionChain([]); // Clear local
          socketRef.current?.emit('stop_option_chain');
      } else {
          // Start
          setShowChain(true);
          socketRef.current?.emit('request_option_chain');
      }
  };

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

  const openTradeModal = async (type, symbol) => {
      // 1. Open Modal with Loading State
      setPreviewModal({
          isOpen: true,
          loading: true,
          data: null,
          params: { type, symbol, quantity: 0, sl: 0, tp: 0, price: 0 } // Reset
      });
      
      try {
          // 2. Fetch Preview Data from Backend
          const res = await axios.post(`${API_URL}/engine/preview-trade`, { type, symbol });
          const preview = res.data;
          
          setPreviewModal(prev => ({
              ...prev,
              loading: false,
              data: preview,
              params: {
                  type,
                  symbol,
                  quantity: preview.quantity,
                  sl: preview.suggestedSl,
                  tp: preview.suggestedTp,
                  price: preview.optionLtp || 0
              }
          }));
      } catch (err) {
          alert("Failed to Get Trade Preview: " + err.message);
          setPreviewModal(prev => ({ ...prev, isOpen: false }));
      }
  };

  const executeTradeFromModal = async () => {
       const { params, data } = previewModal;
       if (!window.confirm("Confirm Execution?")) return;
       
       try {
           // Pass explicit params from Modal Inputs
           const payload = {
               type: params.type,
               symbol: params.symbol, // Underlying
               optionSymbol: data.optionSymbol, // Explicit Option Symbol
               quantity: parseInt(params.quantity),
               slPoints: parseFloat(params.sl),
               tpPoints: parseFloat(params.tp),
               entryPrice: parseFloat(params.price),
               mode: params.forcePaper ? 'PAPER' : undefined // Override Mode
           };

           await axios.post(`${API_URL}/engine/manual-trade`, payload);
           alert("✅ Trade Executed Successfully!");
           setPreviewModal(prev => ({ ...prev, isOpen: false })); // Close
           fetchData(); // Refresh Dashboard
       } catch (err) {
           alert("❌ Execution Failed: " + err.message);
       }
  };

  const handleModalInput = (field, value) => {
      setPreviewModal(prev => ({
          ...prev,
          params: { ...prev.params, [field]: value }
      }));
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

      {/* Global & Symbol Configuration */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Global Defaults */}
          <div className="bg-surface p-6 rounded-xl border border-slate-700 space-y-4">
               <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <Shield className="w-5 h-5 text-primary" /> Global Defaults
                </h3>
                <div className="space-y-3">
                    <div className="flex justify-between p-3 bg-slate-800 rounded">
                        <span className="text-slate-400">Trading Window</span>
                        <span className="font-bold text-white">{globalConfig?.trade_start_time || "09:15"} - {globalConfig?.trade_end_time || "15:30"}</span>
                    </div>
                     <div className="flex justify-between p-3 bg-slate-800 rounded">
                        <span className="text-slate-400">Max Daily Loss</span>
                        <span className="font-bold text-red-400">₹{globalConfig?.max_daily_loss || 2000}</span>
                    </div>
                     <div className="flex justify-between p-3 bg-slate-800 rounded">
                        <span className="text-slate-400">Max Trades/Day</span>
                        <span className="font-bold text-white">{globalConfig?.max_trades_per_day || 5}</span>
                    </div>
                     <div className="flex justify-between p-3 bg-slate-800 rounded">
                        <span className="text-slate-400">Kill Switch</span>
                        <span className={`font-bold ${globalConfig?.kill_switch ? 'text-red-500' : 'text-green-500'}`}>
                            {globalConfig?.kill_switch ? 'ENGAGED' : 'OFF'}
                        </span>
                    </div>
                </div>
          </div>

          {/* Symbol Strategies - DETAILED VIEW */}
          <div className="lg:col-span-2 bg-surface p-6 rounded-xl border border-slate-700">
               <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-primary" /> Active Strategy Configuration (Full Details)
                </h3>
                
                <div className="space-y-6">
                    {/* Iterate over activeParams which has the FULL merged config */}
                    {Object.entries(activeConfig || {}).map(([symbol, params]) => {
                        return (
                            <div key={symbol} className="bg-slate-800 rounded-lg border border-slate-600 overflow-hidden">
                                {/* Header */}
                                <div className="p-4 bg-slate-700/50 border-b border-slate-600 flex justify-between items-center">
                                    <div className="flex justify-between items-center w-full">
                                        <h4 className="font-bold text-lg text-white/90">{symbol}</h4>
                                        <div className="flex gap-2 items-center">
                                            {/* Context-Aware Mock Trade Buttons */}
                                            <button
                                                onClick={() => openTradeModal('CE', symbol)}
                                                className="px-2 py-1 bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/40 rounded text-xs font-bold transition-colors"
                                                title={`Simulate BUY CE Signal for ${symbol}`}
                                            >
                                                + CE
                                            </button>
                                            <button
                                                onClick={() => openTradeModal('PE', symbol)}
                                                className="px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 rounded text-xs font-bold transition-colors"
                                                title={`Simulate BUY PE Signal for ${symbol}`}
                                            >
                                                + PE
                                            </button>

                                            <button
                                                onClick={() => handleTestClick(symbol, params)}
                                                className="px-3 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded text-xs transition-colors flex items-center gap-1 ml-2"
                                                title="Test this config in Backtester"
                                            >
                                                 Test
                                            </button>
                                            <span className="text-xs px-2 py-1 rounded bg-white/5 border border-white/10 text-gray-400">
                                                {params.strategyName || 'Legacy Strategy'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Key-Value Grid */}
                                <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                     {Object.entries(params).map(([key, val]) => {
                                         if (key === 'strategyName') return null; // Already in header
                                         
                                         // Formatting Value
                                         let displayVal = val;
                                         if (typeof val === 'boolean') displayVal = val ? 'TRUE' : 'FALSE';
                                         if (typeof val === 'object') displayVal = JSON.stringify(val);

                                         // Highlight important keys
                                         const isKey = ['lots', 'capital', 'max_daily_loss', 'max_single_trade_loss'].includes(key);
                                         
                                         return (
                                             <div key={key} className="overflow-hidden">
                                                 <p className="text-slate-500 text-[10px] uppercase font-bold tracking-wider mb-0.5">{key.replace(/_/g, ' ')}</p>
                                                 <p className={`font-mono text-sm truncate ${isKey ? 'text-white font-bold' : 'text-slate-300'} ${typeof val === 'boolean' ? (val ? 'text-green-400' : 'text-red-400') : ''}`} title={String(displayVal)}>
                                                     {String(displayVal)}
                                                 </p>
                                             </div>
                                         )
                                     })}
                                </div>
                            </div>
                        )
                    })}
                     
                     {(!activeConfig || Object.keys(activeConfig).length === 0) && (
                         <div className="text-slate-500 text-sm italic p-4 text-center">
                             Waiting for bot engine to report active configurations...
                         </div>
                     )}
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
                                <td className={`p-3 font-bold ${pos.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>₹{pos.pnl ? pos.pnl.toFixed(2) : "0.00"}</td>
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
                onClick={() => openTradeModal('CE')}
                className="w-full bg-green-500/10 hover:bg-green-500/20 text-green-500 border border-green-500/20 py-3 rounded-lg font-bold transition-colors"
             >
                📈 Test FAKE BUY (CE)
             </button>
             <button 
                onClick={() => openTradeModal('PE')}
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
      <div className="bg-surface rounded-xl border border-slate-700 p-6 transition-all duration-300">
          <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold flex items-center gap-2 text-white">
                <List className="w-5 h-5 text-primary" /> Real Option Chain <span className="text-slate-500 text-sm font-normal">(BANKNIFTY)</span>
              </h3>
              <button
                  onClick={toggleOptionChain}
                  className={`px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg ${
                      showChain 
                      ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20 shadow-red-900/10' 
                      : 'bg-green-500/10 text-green-500 hover:bg-green-500/20 border border-green-500/20 shadow-green-900/10'
                  }`}
              >
                  {showChain ? 'Hide Chain' : 'Load Chain'}
              </button>
          </div>

          {showChain ? (
              optionChain.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-slate-700">
                    <table className="w-full text-center border-collapse text-sm">
                        <thead>
                            <tr className="text-slate-400 border-b border-slate-700 bg-slate-800/80">
                                <th className="p-3 text-green-400 font-bold bg-green-900/10" colSpan="2">CALLS (CE)</th>
                                <th className="p-3 text-white bg-slate-700 font-bold border-x border-slate-600">STRIKE</th>
                                <th className="p-3 text-red-400 font-bold bg-red-900/10" colSpan="2">PUTS (PE)</th>
                            </tr>
                            <tr className="text-xs text-slate-500 border-b border-slate-700 bg-slate-800/40">
                                <th className="p-2 w-[15%]">LTP</th>
                                <th className="p-2 w-[25%]">Symbol</th>
                                <th className="p-2 w-[20%] bg-slate-800/50 border-x border-slate-700"></th>
                                <th className="p-2 w-[25%]">Symbol</th>
                                <th className="p-2 w-[15%]">LTP</th>
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
                                    const isAtm = marketData?.ltp && Math.abs(marketData.ltp - strike) < 100; // Highlight ATM roughly

                                    return (
                                        <tr key={strike} className={`border-b border-slate-800 hover:bg-slate-700/30 transition-colors ${isAtm ? 'bg-blue-500/5' : ''}`}>
                                            {/* CE Data */}
                                            <td className={`p-2 font-mono font-medium ${ce ? 'text-green-400' : 'text-slate-600'}`}>
                                                {ce ? `₹${ce.ltp.toFixed(2)}` : '-'}
                                            </td>
                                            <td className="p-2 text-[10px] text-slate-500 truncate max-w-[100px]" title={ce?.tradingsymbol}>
                                                {ce?.tradingsymbol || '-'}
                                            </td>

                                            {/* Strike */}
                                            <td className={`p-2 font-bold font-mono border-x border-slate-700 ${isAtm ? 'text-blue-400 bg-blue-500/10' : 'text-slate-300 bg-slate-800/30'}`}>
                                                {strike}
                                            </td>

                                            {/* PE Data */}
                                            <td className="p-2 text-[10px] text-slate-500 truncate max-w-[100px]" title={pe?.tradingsymbol}>
                                                {pe?.tradingsymbol || '-'}
                                            </td>
                                            <td className={`p-2 font-mono font-medium ${pe ? 'text-red-400' : 'text-slate-600'}`}>
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
                <div className="flex flex-col items-center justify-center h-48 text-slate-500 bg-slate-900/30 rounded-lg animate-pulse border border-slate-800/50">
                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3"></div>
                    <p className="text-sm font-medium">Connecting to Real-Time Feed...</p>
                </div>
              )
          ) : (
             <div className="flex flex-col items-center justify-center h-32 text-slate-500 bg-slate-900/20 rounded-lg border border-slate-800/50 border-dashed">
                 <List className="w-10 h-10 opacity-10 mb-2" />
                 <p className="text-xs font-medium uppercase tracking-widest opacity-60">Chain Hidden</p>
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

      {/* TRADE CONFIRMATION MODAL */}
      {previewModal.isOpen && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
              <div className="bg-surface border border-slate-600 rounded-xl w-full max-w-md shadow-2xl overflow-hidden">
                  
                  {/* Header */}
                  <div className={`p-4 border-b border-slate-700 flex justify-between items-center ${previewModal.params.type === 'CE' ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                      <h3 className={`text-lg font-bold flex items-center gap-2 ${previewModal.params.type === 'CE' ? 'text-green-400' : 'text-red-400'}`}>
                          {previewModal.params.type === 'CE' ? <TrendingUp className="w-5 h-5" /> : <TrendingUp className="w-5 h-5 rotate-180" />}
                          Confirm {previewModal.params.type} Entry
                      </h3>
                      
                      <div className="flex items-center gap-3">
                          {/* MODE BADGE */}
                          {(status.mode === 'LIVE' || status.mode === 'live') ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white animate-pulse border border-red-400 shadow-lg shadow-red-500/20">
                                  🔴 LIVE EXECUTION
                              </span>
                          ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40">
                                  📝 SIMULATION
                              </span>
                          )}
                          <button onClick={() => setPreviewModal(prev => ({ ...prev, isOpen: false }))} className="text-slate-400 hover:text-white">✕</button>
                      </div>
                  </div>

                  {/* Body */}
                  <div className="p-6 space-y-4">
                      {previewModal.loading ? (
                          <div className="py-8 flex flex-col items-center justify-center text-slate-400">
                              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-2"></div>
                              Fetching Live Price...
                          </div>
                      ) : (
                          <>
                              {/* Option Info */}
                              <div className="bg-slate-800 p-3 rounded-lg border border-slate-700">
                                  <div className="flex justify-between items-center mb-1">
                                      <span className="text-xs text-slate-400">Option Symbol</span>
                                      <span className="text-xs font-mono text-slate-500">{previewModal.data?.spotSymbol}</span>
                                  </div>
                                  <div className="text-base font-bold text-white break-all font-mono mb-2">
                                      {previewModal.data?.optionSymbol}
                                  </div>
                                  <div className="flex justify-between items-center pt-2 border-t border-slate-700">
                                      <span className="text-sm text-slate-300">Current Price (LTP)</span>
                                      <span className="text-lg font-bold text-blue-400">₹{previewModal.data?.optionLtp}</span>
                                  </div>
                              </div>

                              {/* Form Inputs */}
                              <div className="grid grid-cols-2 gap-4">
                                  <div>
                                      <label className="text-xs text-slate-400 block mb-1">Quantity</label>
                                      <input 
                                          type="number" 
                                          value={previewModal.params.quantity}
                                          onChange={(e) => handleModalInput('quantity', e.target.value)}
                                          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white font-mono focus:border-primary outline-none"
                                      />
                                  </div>
                                  <div>
                                      <label className="text-xs text-slate-400 block mb-1">Entry Price (Limit)</label>
                                      <input 
                                          type="number" 
                                          value={previewModal.params.price}
                                          onChange={(e) => handleModalInput('price', e.target.value)}
                                          step="0.05"
                                          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white font-mono focus:border-primary outline-none"
                                      />
                                  </div>
                                  <div>
                                      <label className="text-xs text-red-300 block mb-1">Stop Loss (Pts)</label>
                                      <input 
                                          type="number" 
                                          value={previewModal.params.sl}
                                          onChange={(e) => handleModalInput('sl', e.target.value)}
                                          className="w-full bg-slate-900 border border-red-500/30 rounded px-3 py-2 text-white font-mono focus:border-red-500 outline-none"
                                      />
                                      <span className="text-[10px] text-slate-500">
                                          Risk: ₹{(previewModal.params.sl * previewModal.params.quantity).toFixed(0)}
                                      </span>
                                  </div>
                                  <div>
                                      <label className="text-xs text-green-300 block mb-1">Target Profit (Pts)</label>
                                      <input 
                                          type="number" 
                                          value={previewModal.params.tp}
                                          onChange={(e) => handleModalInput('tp', e.target.value)}
                                          className="w-full bg-slate-900 border border-green-500/30 rounded px-3 py-2 text-white font-mono focus:border-green-500 outline-none"
                                      />
                                      <span className="text-[10px] text-slate-500">
                                          Reward: ₹{(previewModal.params.tp * previewModal.params.quantity).toFixed(0)}
                                      </span>
                                  </div>
                              </div>
                              
                              {/* Force Paper Toggle - Allow testing in Live Mode */}
                              {(status.mode === 'LIVE' || status.mode === 'live') && (
                                  <div className="bg-blue-500/10 border border-blue-500/30 p-3 rounded-lg flex justify-between items-center">
                                      <div>
                                          <div className="text-sm font-bold text-blue-300">Force Paper Trade</div>
                                          <div className="text-[10px] text-blue-400">Simulate this trade without real execution</div>
                                      </div>
                                      <label className="relative inline-flex items-center cursor-pointer">
                                          <input 
                                              type="checkbox" 
                                              className="sr-only peer"
                                              checked={previewModal.params.forcePaper || false}
                                              onChange={(e) => handleModalInput('forcePaper', e.target.checked)}
                                          />
                                          <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                                      </label>
                                  </div>
                              )}

                              <div className="text-[10px] text-slate-500 italic text-center">
                                  * Limit order will be placed with 2% buffer for entry.
                              </div>
                          </>
                      )}
                  </div>

                  {/* Footer */}
                  <div className="p-4 border-t border-slate-700 bg-slate-800/50 flex gap-3">
                      <button 
                          onClick={() => setPreviewModal(prev => ({ ...prev, isOpen: false }))}
                          className="flex-1 py-3 rounded-lg font-bold text-slate-400 hover:bg-slate-700 transition-colors"
                      >
                          Cancel
                      </button>
                      <button 
                          onClick={executeTradeFromModal}
                          disabled={previewModal.loading}
                          className={`flex-1 py-3 rounded-lg font-bold text-white shadow-lg transition-transform active:scale-95 ${
                              previewModal.params.type === 'CE' 
                              ? 'bg-green-600 hover:bg-green-500 shadow-green-900/20' 
                              : 'bg-red-600 hover:bg-red-500 shadow-red-900/20'
                          }`}
                      >
                          ⚡ Execute Order
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}
