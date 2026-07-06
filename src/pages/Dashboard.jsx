import React, { useState, useEffect } from 'react';
import DeploymentsPanel from '../components/DeploymentsPanel';
import CollapsibleCard from '../components/CollapsibleCard';
import { Play, Square, Activity, DollarSign, TrendingUp, AlertTriangle, Shield, ShoppingCart, List, Database, ChevronDown, ChevronRight } from 'lucide-react';
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
  // Per-symbol signal-check timeline (from /api/engine/dashboard).
  // Shape: { [symbol]: { current: {action, type, reason, ts, strategyName},
  //                       history: [...last 20 entries] } }
  const [signalStatus, setSignalStatus] = useState({});
  const [tradesPage, setTradesPage] = useState(1);
  const [tradesTotal, setTradesTotal] = useState(0);
  const [tradesSearch, setTradesSearch] = useState("");
  const [tradesLimit, setTradesLimit] = useState(10);
  // Trade History fold state (persisted). Default OPEN.
  const [tradesExpanded, setTradesExpanded] = useState(() => {
    try { const v = localStorage.getItem('dash:tradesOpen'); return v === null ? true : v === '1'; }
    catch (_) { return true; }
  });
  const toggleTrades = () => setTradesExpanded(prev => {
    const next = !prev;
    try { localStorage.setItem('dash:tradesOpen', next ? '1' : '0'); } catch (_) {}
    return next;
  });

  // ── Live Activity Feed state ─────────────────────────────────────────────
  // Unified timeline from /api/live-activity (trades + AI rejects/errors + engine errors).
  // Polled every 8s when the section is expanded; paused when collapsed to save bandwidth.
  const [activityEvents, setActivityEvents] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityFilters, setActivityFilters] = useState({
    types: ['TRADE_ENTRY', 'TRADE_EXIT', 'AI_CONFIRM', 'AI_REJECT', 'AI_ERROR', 'ENTRY_SKIPPED', 'ENGINE_ERROR'],
    symbol: '',
    strategy: '',
    tradeId: '',
    limit: 100,
  });
  const [activityExpanded, setActivityExpanded] = useState(true);
  const [activityDetail, setActivityDetail] = useState(null);  // selected event for modal

  // ── Web Session Health state ─────────────────────────────────────────────
  // Keys are symbols; values are { symbol, strategyName, claude_web?, gemini_web? }.
  // Re-fetched every 5 min (matches backend cache TTL). Manual "Re-check" forces refresh.
  const [sessionHealth, setSessionHealth] = useState({ results: {}, total_expired: 0, total_missing: 0, checked_at: null });
  const [sessionHealthLoading, setSessionHealthLoading] = useState(false);

  // Refs to track current pagination/search for socket listener (prevents stale closure)
  const tradesPageRef = React.useRef(1);
  const tradesSearchRef = React.useRef("");

  useEffect(() => {
      tradesPageRef.current = tradesPage;
      tradesSearchRef.current = tradesSearch;
  }, [tradesPage, tradesSearch]);
  const [globalConfig, setGlobalConfig] = useState(null);
  const [symbolConfig, setSymbolConfig] = useState(null);
  const [activeConfig, setActiveConfig] = useState(null);

  // Trade Preview Modal State
  const [previewModal, setPreviewModal] = useState({ 
      isOpen: false, 
      loading: false, 
      data: null, 
      params: { type: 'CE', symbol: '', quantity: 15, sl: 40, tp: 100, price: 0 } 
  });

  // Signal Simulator state
  const [simModal, setSimModal] = useState({ isOpen: false, symbol: null, type: 'CE', loading: false, result: null, error: null });

  const openSimulator = (symbol) => setSimModal({ isOpen: true, symbol, type: 'CE', loading: false, result: null, error: null });
  const closeSimulator = () => setSimModal(s => ({ ...s, isOpen: false }));

  const runSimulation = async () => {
    setSimModal(s => ({ ...s, loading: true, result: null, error: null }));
    try {
      const res = await axios.post(`${API_URL}/engine/test-signal`, { symbol: simModal.symbol, type: simModal.type });
      setSimModal(s => ({ ...s, loading: false, result: res.data }));
    } catch (err) {
      setSimModal(s => ({ ...s, loading: false, error: err.response?.data?.error || err.message }));
    }
  };

  const navigate = useNavigate();

  const handleTestClick = (symbol, config) => {
      // Prepare state for Backtester
      const stateToPass = {
          symbol: symbol,
          strategy: config.strategyName,
          params: { ...config } // The 'config' argument here is already the flattened params object
      };
      
      // Remove internal keys if present
      delete stateToPass.params.strategyName;
      delete stateToPass.params.strategyClass;
      delete stateToPass.params._id;
      delete stateToPass.params.__v;
      delete stateToPass.params.updatedAt;

      navigate('/backtest', { state: stateToPass });
  };

  
  useEffect(() => {
      const fetchMongoTrades = async () => {
        try {
            // Smart filter: if the search box contains hex-only chars (6+) it's
            // probably a trade ID short suffix — route it to the trade_id filter.
            // Anything else goes to the symbol filter as before.
            const term = (tradesSearch || '').trim();
            const looksLikeTradeId = /^[a-fA-F0-9]{6,24}$/.test(term);
            const params = new URLSearchParams({
                page: String(tradesPage),
                limit: String(tradesLimit),
            });
            if (term) {
                if (looksLikeTradeId) params.set('trade_id', term);
                else params.set('symbol', term);
            }
            const response = await axios.get(`${API_URL}/trades?${params.toString()}`);
            if (response.data) {
                 setMongoTrades(response.data.trades || []);
                 setTradesTotal(response.data.total || 0);
            }
        } catch (err) {
            console.error("Failed to fetch paginated trades", err);
        }
      };
      fetchMongoTrades();
  }, [tradesPage, tradesSearch, tradesLimit]); 

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
          setSignalStatus(data.signalStatus || {});
          // mongoTrades is now handled entirely by specialized fetchMongoTrades hook
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

    // Connect Socket. `withCredentials: true` lets the browser attach the
    // dash_session cookie on the handshake so the server's io.use() auth
    // middleware can verify it. Without this, the connection is rejected with
    // "Unauthorized" the moment auth is enabled.
    const socket = io(import.meta.env.VITE_API_URL || 'http://localhost:5000', {
        withCredentials: true,
    });
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
            setSignalStatus(data.signalStatus || {});
            
            // Only update mongoTrades from socket if we are on page 1 and not searching
            // This prevents the UI from "jumping" back to the start when paginating
            // if (tradesPageRef.current === 1 && tradesSearchRef.current === "") {
            //     setMongoTrades(data.mongoTrades || []);
            // }

            setGlobalConfig(data.config?.globalSettings || {});
            setSymbolConfig(data.config?.symbolConfigs || {});
            setActiveConfig(data.config?.activeParams || {});
        }
    });

    // ── position_tick: sub-second live PnL updates ──────────────────────────
    // The backend's runBackgroundLoop runs every 2s, but option premium can move
    // ₹5–20 in a single second on liquid contracts. This listener consumes
    // tick-driven mini-updates emitted from the fyersData onTick callback —
    // ~200 bytes per emit, throttled to one per 200ms per position.
    //
    // Each payload is { positions: [{spotSymbol, symbol, ltp, spot_ltp, pnl,
    // pnl_pct, holding_seconds}], at }. We merge by `spotSymbol` into the
    // existing positions state, preserving all other fields (entryPrice,
    // broker_sl_price, follow_mode, AI metadata, etc.) from the last full
    // dashboard_update. Pure merge — no re-render of the whole panel.
    socket.on('position_tick', ({ positions: tickUpdates }) => {
        if (!Array.isArray(tickUpdates) || tickUpdates.length === 0) return;
        setPositions(prev => {
            if (!Array.isArray(prev) || prev.length === 0) return prev;
            const byKey = new Map(tickUpdates.map(u => [u.spotSymbol || u.symbol, u]));
            let changed = false;
            const next = prev.map(p => {
                const key = p.spotSymbol || p.symbol;
                const u = byKey.get(key);
                if (!u) return p;
                changed = true;
                return {
                    ...p,
                    ltp:             u.ltp ?? p.ltp,
                    spot_ltp:        u.spot_ltp ?? p.spot_ltp,
                    pnl:             u.pnl ?? p.pnl,
                    pnl_pct:         u.pnl_pct ?? p.pnl_pct,
                    holding_seconds: u.holding_seconds ?? p.holding_seconds,
                };
            });
            return changed ? next : prev;
        });
    });

    socket.on('disconnect', () => {
        console.log("❌ Disconnected from WebSocket");
    });

    return () => {
        socket.disconnect();
    };
  }, []);

  // ── Web Session Health polling ───────────────────────────────────────────
  // Hits /api/strategies/session-health which validates Claude.ai sessionKey /
  // Gemini cookies for every active strategy. Backend caches results for 5 min;
  // we re-poll every 5 min too so the cache is always warm.
  const fetchSessionHealth = React.useCallback(async (force = false) => {
    setSessionHealthLoading(true);
    try {
      const res = await axios.get(`${API_URL}/strategies/session-health`, {
        params: force ? { force: 'true' } : {},
      });
      setSessionHealth(res.data || {});
    } catch (err) {
      console.warn('[SessionHealth] fetch failed:', err.message);
    } finally {
      setSessionHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessionHealth();
    const iv = setInterval(() => fetchSessionHealth(), 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [fetchSessionHealth]);

  // ── Live Activity Feed polling ───────────────────────────────────────────
  // Pulls /api/live-activity every 8s while the section is expanded. Filters
  // recompute the URL on each tick (acceptable — backend is bounded by limit).
  useEffect(() => {
    if (!activityExpanded) return;
    let cancelled = false;
    const fetchActivity = async () => {
      try {
        setActivityLoading(true);
        const params = {
          types: activityFilters.types.join(','),
          limit: activityFilters.limit,
        };
        if (activityFilters.symbol)   params.symbol = activityFilters.symbol;
        if (activityFilters.strategy) params.strategy = activityFilters.strategy;
        if (activityFilters.tradeId)  params.trade_id = activityFilters.tradeId.trim();
        const res = await axios.get(`${API_URL}/live-activity`, { params });
        if (!cancelled) setActivityEvents(res.data?.events || []);
      } catch (err) {
        if (!cancelled) console.warn('[Activity] fetch failed:', err.message);
      } finally {
        if (!cancelled) setActivityLoading(false);
      }
    };
    fetchActivity();
    const iv = setInterval(fetchActivity, 8000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [activityExpanded, activityFilters.types, activityFilters.symbol, activityFilters.strategy, activityFilters.tradeId, activityFilters.limit]);

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

  // Per-position close handler. Hits POST /api/engine/close-position which
  // routes through liveEngine.closePosition() — same EXIT path the SL/TP
  // gates use, so broker exit + SL cancel + Telegram all happen as normal.
  // We track in-flight closures so the button can show a spinner state and
  // disable itself, preventing accidental double-clicks during the ~500ms
  // broker round-trip.
  const [closingSymbols, setClosingSymbols] = useState({});
  // Per-position accordion toggle for the AI In-flight Review history.
  // Keyed by spotSymbol/symbol so each card's accordion is independent.
  const [reviewsExpanded, setReviewsExpanded] = useState({});
  // Last-copied trade ID for a brief "copied" affordance on the badge.
  const [copiedTradeId, setCopiedTradeId] = useState(null);

  // Shortens a Mongo ObjectId (24 hex chars) for display: last 6 chars,
  // uppercased. e.g. "67abc...01F4" → "01F4DE". Returns '—' for empty input.
  const shortTradeId = (id) => {
    if (!id || typeof id !== 'string') return '—';
    return id.slice(-6).toUpperCase();
  };
  // Copy the full trade ID to clipboard with a transient visual confirmation.
  // The user can paste it into the Trade History search box (which now also
  // matches against trade_id) to filter every event tied to that trade.
  const copyTradeId = (id) => {
    if (!id) return;
    try {
      navigator.clipboard.writeText(id);
      setCopiedTradeId(id);
      setTimeout(() => setCopiedTradeId(prev => (prev === id ? null : prev)), 1500);
    } catch (_) { /* clipboard blocked — no-op */ }
  };
  // Self-contained badge component. Click copies the full ID.
  const TradeIdBadge = ({ id, label = 'ID' }) => {
    if (!id) return null;
    const copied = copiedTradeId === id;
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); copyTradeId(id); }}
        title={`Trade ID: ${id}\nClick to copy. Paste into Trade History search to filter.`}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold transition-colors ${
          copied
            ? 'bg-emerald-700/60 text-emerald-100'
            : 'bg-slate-700/60 hover:bg-slate-600/80 text-slate-300 hover:text-white'
        }`}
      >
        <span className="text-slate-500 font-sans tracking-wide">{label}</span>
        <span>{copied ? '✓ copied' : shortTradeId(id)}</span>
      </button>
    );
  };
  const handleClosePosition = async (pos) => {
      // Identify THIS position uniquely. spotSymbol is NOT unique — two
      // deployments can hold positions on the same underlying — so prefer
      // deploymentId, falling back to the (unique) option contract symbol.
      // We also send deploymentId to the server so it closes the exact
      // position the user clicked instead of the newest on that underlying.
      const key = pos.deploymentId || pos.symbol;
      const pnlStr = pos.pnl != null
          ? ` (PnL ${pos.pnl >= 0 ? '+' : ''}₹${Math.round(pos.pnl).toLocaleString()})`
          : '';
      if (!window.confirm(`Close ${pos.symbol}${pnlStr}?\n\nThis fires a market exit via the broker.`)) return;
      setClosingSymbols(s => ({ ...s, [key]: true }));
      try {
          const res = await axios.post(`${API_URL}/engine/close-position`, {
              deploymentId: pos.deploymentId || null,
              spotSymbol: pos.spotSymbol,
          });
          if (res.data?.success) {
              console.log(`✅ Closed ${pos.symbol}`, res.data);
              // Optimistically drop from local state — the next dashboard_update
              // will reflect the authoritative server state in <2s anyway.
              setPositions(prev => prev.filter(p => (p.deploymentId || p.symbol) !== key));
          } else {
              alert(`❌ Close failed: ${res.data?.message || 'Unknown error'}`);
          }
      } catch (err) {
          alert(`❌ Close failed: ${err.response?.data?.error || err.message}`);
      } finally {
          setClosingSymbols(s => { const n = { ...s }; delete n[key]; return n; });
      }
  };

  // Force-close an ORPHAN position — bypasses the engine path (which doesn't
  // know about the orphan) and marks the Trade doc CLOSED directly with a
  // best-effort exit price taken from the live socket cache server-side.
  // PAPER-only; LIVE orphans must be reconciled at the broker first.
  const handleForceCloseOrphan = async (pos) => {
      if (!pos?.trade_id) { alert('No trade_id on this position — cannot force-close.'); return; }
      const pnlStr = pos.pnl != null
          ? ` (PnL ${pos.pnl >= 0 ? '+' : ''}₹${Math.round(pos.pnl).toLocaleString()})`
          : '';
      if (!window.confirm(
          `Force-close orphan ${pos.symbol}${pnlStr}?\n\n` +
          `This marks the Trade doc CLOSED at the current LTP without going through the engine. ` +
          `Use only when the engine isn't actively monitoring this position.`
      )) return;
      const key = `orphan:${pos.trade_id}`;
      setClosingSymbols(s => ({ ...s, [key]: true }));
      try {
          const res = await axios.post(`${API_URL}/engine/force-close-orphan`, { tradeId: pos.trade_id });
          if (res.data?.success) {
              console.log(`✅ Orphan force-closed: ${pos.symbol}`, res.data);
              setPositions(prev => prev.filter(p => p.trade_id !== pos.trade_id));
          } else {
              alert(`❌ Force-close failed: ${res.data?.error || 'Unknown error'}`);
          }
      } catch (err) {
          alert(`❌ Force-close failed: ${err.response?.data?.error || err.message}`);
      } finally {
          setClosingSymbols(s => { const n = { ...s }; delete n[key]; return n; });
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

      {/* Web Session Health Banner — only renders when there's actually a problem */}
      {(sessionHealth.total_expired > 0 || sessionHealth.total_missing > 0) && (
          <div className="bg-amber-900/30 border border-amber-700 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                  <h3 className="text-amber-200 font-bold mb-1">
                      ⚠️ Web session credentials need attention
                  </h3>
                  <p className="text-amber-100/80 text-sm mb-2">
                      {sessionHealth.total_expired > 0 && (
                          <>{sessionHealth.total_expired} expired</>
                      )}
                      {sessionHealth.total_expired > 0 && sessionHealth.total_missing > 0 && ' · '}
                      {sessionHealth.total_missing > 0 && (
                          <>{sessionHealth.total_missing} missing</>
                      )}
                      {' '}across active strategies. These will fail at AI confirmation with auth errors.
                      Open the Backtest page → re-paste the cookies → click Deploy to refresh.
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                      {Object.values(sessionHealth.results || {}).flatMap(s => {
                          const issues = [];
                          if (s.claude_web && !s.claude_web.valid) {
                              issues.push(
                                  <span key={s.symbol + 'c'} className="text-xs px-2 py-0.5 rounded bg-amber-800/60 text-amber-100">
                                      🍪 Claude — {s.symbol} ({s.claude_web.reason})
                                  </span>
                              );
                          }
                          if (s.gemini_web && !s.gemini_web.valid) {
                              issues.push(
                                  <span key={s.symbol + 'g'} className="text-xs px-2 py-0.5 rounded bg-cyan-800/60 text-cyan-100">
                                      🍪 Gemini — {s.symbol} ({s.gemini_web.reason})
                                  </span>
                              );
                          }
                          return issues;
                      })}
                  </div>
              </div>
              <button
                  onClick={() => fetchSessionHealth(true)}
                  disabled={sessionHealthLoading}
                  className="text-xs px-3 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white disabled:opacity-50"
                  title="Force re-check (bypasses 5-min cache)"
              >
                  {sessionHealthLoading ? 'Checking…' : 'Re-check'}
              </button>
          </div>
      )}

      {/* Global & Symbol Configuration — stacked full-width, each foldable.
          DeploymentsPanel is THE single place to see and manage every deployed
          strategy (multiple strategies per symbol, each with its own resolution)
          and now owns the full width; Global Defaults folds away above it. */}
      <div className="space-y-6">
          {/* Global Defaults — collapsible, DEFAULT COLLAPSED. When folded, the
              header still surfaces a one-line summary + a loud KILL-SWITCH badge. */}
          <CollapsibleCard
              title="Global Defaults"
              icon={Shield}
              storageKey="dash:globalDefaults"
              defaultOpen={false}
              summary={`${globalConfig?.trade_start_time || "09:15"}–${globalConfig?.trade_end_time || "15:30"} · max loss ₹${(globalConfig?.max_daily_loss || 10000).toLocaleString('en-IN')} · ${globalConfig?.max_trades_per_day || 5}/day`}
              right={globalConfig?.kill_switch
                  ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-bold border border-red-500/40">⛔ KILL SWITCH</span>
                  : null}
          >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="flex flex-col gap-1 p-3 bg-slate-800 rounded">
                        <span className="text-xs text-slate-400">Trading Window</span>
                        <span className="font-bold text-white">{globalConfig?.trade_start_time || "09:15"} - {globalConfig?.trade_end_time || "15:30"}</span>
                    </div>
                    <div className="flex flex-col gap-1 p-3 bg-slate-800 rounded">
                        <span className="text-xs text-slate-400">Max Daily Loss</span>
                        <span className="font-bold text-red-400">₹{(globalConfig?.max_daily_loss || 10000).toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex flex-col gap-1 p-3 bg-slate-800 rounded">
                        <span className="text-xs text-slate-400">Max Trades/Day</span>
                        <span className="font-bold text-white">{globalConfig?.max_trades_per_day || 5}</span>
                    </div>
                    <div className="flex flex-col gap-1 p-3 bg-slate-800 rounded">
                        <span className="text-xs text-slate-400">Kill Switch</span>
                        <span className={`font-bold ${globalConfig?.kill_switch ? 'text-red-500' : 'text-green-500'}`}>
                            {globalConfig?.kill_switch ? 'ENGAGED' : 'OFF'}
                        </span>
                    </div>
                </div>
          </CollapsibleCard>

          {/* DeploymentsPanel — full width; self-contained accordion (its own header folds it). */}
          <DeploymentsPanel
              onTest={handleTestClick}
              onSim={openSimulator}
              onManualTrade={openTradeModal}
              sessionHealth={sessionHealth}
              globalConfig={globalConfig}
          />
      </div>

      {/* Live Market Data Section — collapsible */}
      <CollapsibleCard
          title="Live Market Data (BANKNIFTY)"
          icon={TrendingUp}
          storageKey="dash:marketData"
          defaultOpen={true}
          summary={marketData?.ltp ? `₹${marketData.ltp.toFixed(2)} · ${marketData?.trend || 'NEUTRAL'}` : null}
      >
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
      </CollapsibleCard>

      {/* ── Compact Stats Strip ─────────────────────────────────────────
          Replaces the three separate StatCards. One row, dense, scannable.
          Each cell is colour-coded so you can read state in a fraction of a
          second during market hours. Combined PnL (realized + unrealized)
          dominates because that's the number you actually trade against. */}
      <div className="bg-surface rounded-xl border border-slate-700 p-3 flex flex-wrap items-stretch divide-x divide-slate-700">
          {(() => {
              const realized = pnl?.daily_pnl ?? 0;
              const unrealized = pnl?.unrealized_pnl ?? 0;
              const combined = pnl?.combined_pnl ?? (realized + unrealized);
              const maxLoss = status?.max_daily_loss || globalConfig?.max_daily_loss || 10000;
              const lossPctUsed = maxLoss > 0 ? Math.max(0, Math.min(100, (-Math.min(0, combined) / maxLoss) * 100)) : 0;
              const tradesToday = pnl?.trades_count ?? 0;
              const maxTrades = status?.strategy_params?.max_trades_per_day || 20;
              const openPositions = pnl?.open_positions ?? positions.length ?? 0;
              const fmt = n => `${n >= 0 ? '+' : ''}₹${Math.round(n).toLocaleString()}`;
              const colorFor = n => n > 0 ? 'text-emerald-400' : n < 0 ? 'text-rose-400' : 'text-slate-300';
              return (
                  <>
                      <div className="flex-1 min-w-[160px] px-4 py-2 flex flex-col justify-center">
                          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold flex items-center gap-1.5">
                              <DollarSign className="w-3 h-3" /> Combined PnL
                          </div>
                          <div className={`text-2xl font-bold font-mono ${colorFor(combined)}`}>
                              {fmt(combined)}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                              <span className={colorFor(realized)}>Realized {fmt(realized)}</span>
                              <span className="mx-1.5 text-slate-700">·</span>
                              <span className={colorFor(unrealized)}>Open {fmt(unrealized)}</span>
                          </div>
                      </div>
                      <div className="flex-1 min-w-[140px] px-4 py-2 flex flex-col justify-center">
                          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold flex items-center gap-1.5">
                              <Activity className="w-3 h-3" /> Trades Today
                          </div>
                          <div className="text-2xl font-bold font-mono text-blue-300">
                              {tradesToday}<span className="text-base text-slate-500 font-normal"> / {maxTrades}</span>
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                              {openPositions > 0 ? `${openPositions} open now` : 'No open positions'}
                          </div>
                      </div>
                      <div className="flex-1 min-w-[160px] px-4 py-2 flex flex-col justify-center">
                          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold flex items-center gap-1.5">
                              <AlertTriangle className="w-3 h-3" /> Daily Loss Used
                          </div>
                          <div className={`text-2xl font-bold font-mono ${lossPctUsed > 80 ? 'text-rose-400' : lossPctUsed > 50 ? 'text-amber-400' : 'text-slate-300'}`}>
                              {lossPctUsed.toFixed(0)}<span className="text-base text-slate-500 font-normal">%</span>
                          </div>
                          <div className="w-full h-1 bg-slate-800 rounded-full mt-1 overflow-hidden">
                              <div
                                  className={`h-full transition-all ${lossPctUsed > 80 ? 'bg-rose-500' : lossPctUsed > 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                  style={{ width: `${lossPctUsed}%` }}
                              />
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                              of ₹{maxLoss.toLocaleString()} cap
                          </div>
                      </div>
                      <div className="flex-1 min-w-[160px] px-4 py-2 flex flex-col justify-center">
                          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold flex items-center gap-1.5">
                              <Shield className="w-3 h-3" /> Engine Status
                          </div>
                          <div className={`text-2xl font-bold ${status?.is_running ? 'text-emerald-400' : 'text-slate-500'}`}>
                              {status?.is_running ? 'RUNNING' : 'STOPPED'}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5 truncate" title={status?.active_strategy || 'No strategies'}>
                              {status?.active_strategy || 'No strategies'}
                          </div>
                      </div>
                  </>
              );
          })()}
      </div>

      {/* ── Signal Status Timeline Strip ─────────────────────────────────
          One row per active symbol. The right side shows a horizontal ribbon
          of color dots — each dot is one recent signal check. Color tells you
          at a glance what's been happening:
            🟢 ENTRY signal (rare, only when strategy fires)
            ⚫ NEUTRAL / no signal (most common)
            🔵 WAIT (filter blocked)
            🟡 specific block reason (volume, RSI etc.)
          Hover any dot for the exact reason + timestamp.
          The "current" status is shown left of the dot ribbon. */}
      {signalStatus && Object.keys(signalStatus).length > 0 && (
          <div className="bg-surface rounded-xl border border-slate-700 p-4">
              <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold flex items-center gap-2 text-slate-200">
                      <Activity className="w-4 h-4 text-primary" /> Signal Status Timeline
                  </h3>
                  <span className="text-[10px] text-slate-500">
                      newest →  · last {Math.max(...Object.values(signalStatus).map(s => s?.history?.length || 0), 0)} checks per symbol
                  </span>
              </div>
              <div className="space-y-1.5">
                  {Object.entries(signalStatus).map(([sym, info]) => {
                      const current = info?.current;
                      const history = info?.history || [];
                      // Color rules — kept tight so the ribbon reads instantly
                      const colorFor = (action, reason) => {
                          if (action === 'ENTRY') return 'bg-emerald-500';
                          if (action === 'WAIT')  return 'bg-blue-500/70';
                          // Specific block reasons surface in amber
                          if (reason && reason !== 'No Signal' && reason !== 'Trend Mismatch') return 'bg-amber-500/70';
                          return 'bg-slate-700';
                      };
                      const currColor = colorFor(current?.action, current?.reason);
                      return (
                          <div key={sym} className="flex items-center gap-3 text-xs">
                              {/* Symbol + current status */}
                              <div className="w-44 truncate text-slate-300 font-mono" title={sym}>{sym}</div>
                              <div className="flex items-center gap-1.5 w-40">
                                  <span className={`w-2 h-2 rounded-full ${currColor}`} />
                                  <span className={`uppercase text-[10px] font-bold ${
                                      current?.action === 'ENTRY' ? 'text-emerald-300'
                                      : current?.action === 'WAIT' ? 'text-blue-300'
                                      : 'text-slate-400'
                                  }`}>
                                      {current?.action || '—'}
                                  </span>
                                  {current?.type && (
                                      <span className="text-[10px] text-slate-500">{current.type}</span>
                                  )}
                              </div>
                              {/* Reason (truncated) */}
                              <div className="flex-1 truncate text-[11px] text-slate-500 italic" title={current?.reason || ''}>
                                  {current?.reason || '—'}
                              </div>
                              {/* History ribbon — oldest left, newest right */}
                              <div className="flex items-center gap-0.5 flex-shrink-0">
                                  {history.map((h, i) => (
                                      <span
                                          key={i}
                                          className={`w-1.5 h-3 rounded-sm ${colorFor(h.action, h.reason)}`}
                                          title={`${new Date(h.ts).toLocaleTimeString('en-IN', { hour12: false })}\n${h.action}${h.type ? ' ' + h.type : ''}: ${h.reason}`}
                                      />
                                  ))}
                              </div>
                          </div>
                      );
                  })}
              </div>
          </div>
      )}

      {/* ── Live Positions Panel ──────────────────────────────────────
          Full-width now that the Manual Controls panel is gone — per-strategy
          🧪 Sim buttons cover manual signal testing, and each position card
          has its own Close button for individual exits. */}
      <div className="grid grid-cols-1 gap-8">
        <div className="bg-surface rounded-xl border border-slate-700 p-6">
          <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5 text-primary" /> Live Positions
                  {positions.length > 0 && (
                      <span className="text-xs font-normal text-slate-500">
                          {positions.length} open
                      </span>
                  )}
              </h3>
              {positions.length > 0 && (() => {
                  const totalPnl = positions.reduce((s, p) => s + (p.pnl || 0), 0);
                  return (
                      <span className={`text-sm font-mono font-bold ${totalPnl > 0 ? 'text-emerald-400' : totalPnl < 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                          {totalPnl >= 0 ? '+' : ''}₹{Math.round(totalPnl).toLocaleString()} total
                      </span>
                  );
              })()}
          </div>
          {positions.length > 0 ? (
              <div className="space-y-3">
                  {positions.map((pos, i) => {
                      const isLong   = pos.type === 'CE' || pos.type === 'LONG' || pos.side === 1;
                      const pnl      = pos.pnl || 0;
                      const pnlPct   = pos.pnl_pct || 0;
                      const ltp      = pos.ltp || pos.entryPrice || 0;
                      const spotLtp  = pos.spot_ltp || null;
                      const entrySpot = pos.entrySpot || null;

                      // BROKER-side levels (option premium prices, actually sitting at broker)
                      const brokerSl = pos.broker_sl_price || pos.sl_price || 0;
                      const brokerTp = pos.broker_tp_price || pos.tp_price || 0;

                      // SPOT-side levels (index prices, monitored by engine when ai_use_spot_exits is on)
                      const spotSl   = pos.spot_sl_level || pos.aiSpotSl || pos.aiSuggestedSl || null;
                      const spotTp   = pos.spot_tp_level || pos.aiSpotTp || pos.aiSuggestedTp || null;

                      // Follow mode resolved server-side
                      const followMode = pos.follow_mode || 'strategy';
                      const followLabel = {
                          ai_spot_exits: { txt: '🎯 AI Spot Exits', cls: 'bg-cyan-700/40 text-cyan-200', desc: 'Engine watches index live; broker SL is wider safety net' },
                          ai_levels:     { txt: '🤖 AI Levels',     cls: 'bg-violet-700/40 text-violet-200', desc: 'Broker SL/TP placed at AI\'s spot levels via delta conversion' },
                          strategy:      { txt: '📐 Strategy',       cls: 'bg-slate-700/60 text-slate-300', desc: 'Strategy SL/TP — no AI override applied' },
                      }[followMode] || { txt: followMode, cls: 'bg-slate-700/60 text-slate-300' };

                      // Progress bar — current option LTP between broker SL and broker TP
                      const totalRange = Math.abs(brokerTp - brokerSl) || 1;
                      const fromSl     = Math.abs(ltp - brokerSl);
                      const progressPct = Math.max(0, Math.min(100, (fromSl / totalRange) * 100));
                      const slDistPct = pos.entryPrice ? Math.abs(((ltp - brokerSl) / pos.entryPrice) * 100) : 0;
                      const tpDistPct = pos.entryPrice ? Math.abs(((brokerTp - ltp) / pos.entryPrice) * 100) : 0;
                      // Entry marker position on the progress bar
                      const entryMarkerPct = pos.entryPrice && totalRange > 0
                          ? Math.max(0, Math.min(100, (Math.abs(pos.entryPrice - brokerSl) / totalRange) * 100))
                          : null;

                      // Time held — human-readable: "1h 5m" / "12m 34s" / "47s"
                      const hs = pos.holding_seconds || 0;
                      const heldStr = hs >= 3600
                          ? `${Math.floor(hs / 3600)}h ${Math.floor((hs % 3600) / 60)}m`
                          : hs >= 60
                              ? `${Math.floor(hs / 60)}m ${hs % 60}s`
                              : `${hs}s`;
                      const entryTimeStr = pos.entry_time_iso
                          ? new Date(pos.entry_time_iso).toLocaleTimeString('en-IN', { hour12: false })
                          : null;

                      // Spot move since entry
                      const spotMove = (spotLtp != null && entrySpot != null) ? (spotLtp - entrySpot) : null;

                      const isOrphan = !!pos.orphan;
                      return (
                          <div
                              // Key MUST be unique per contract. trade_id alone collided when a
                              // backend bug briefly linked two positions to one trade doc — dup
                              // React keys made both cards swap live fields on every poll (the
                              // "flickering PnL"). symbol+deployment is unique even then.
                              key={`${pos.deploymentId || pos.trade_id || i}|${pos.symbol}`}
                              className={`rounded-lg border p-3 transition-colors ${
                                  isOrphan
                                      ? 'border-amber-700/60 bg-amber-950/15'
                                      : pnl > 0
                                          ? 'border-emerald-700/50 bg-emerald-950/10'
                                          : pnl < 0
                                              ? 'border-rose-700/50 bg-rose-950/10'
                                              : 'border-slate-700 bg-slate-900/40'
                              }`}
                          >
                              {/* ── Orphan banner: position exists in DB but the
                                  engine isn't tracking it (sibling on same
                                  underlying overwrote it in memory). Engine
                                  won't auto-SL/TP. Operator must Force-Close. */}
                              {isOrphan && (
                                  <div className="mb-2 px-2 py-1.5 rounded border border-amber-700/60 bg-amber-950/40 text-amber-200 text-[11px] leading-snug">
                                      <div className="font-bold mb-0.5">⚠ Orphan position — not actively monitored</div>
                                      <div className="text-amber-300/80">
                                          {pos.orphan_reason || 'The engine is monitoring a sibling on the same underlying. Auto-SL/TP will not fire on this trade.'}
                                      </div>
                                  </div>
                              )}
                              {/* ── Row 1: badges + symbol + live PnL ── */}
                              <div className="flex items-center justify-between gap-2 mb-2">
                                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isLong ? 'bg-emerald-700/40 text-emerald-200' : 'bg-rose-700/40 text-rose-200'}`}>
                                          {pos.type || (isLong ? 'CE' : 'PE')}
                                      </span>
                                      <span className="font-mono text-sm text-white truncate" title={pos.symbol}>
                                          {pos.symbol}
                                      </span>
                                      {pos.trade_id && (
                                          <TradeIdBadge id={pos.trade_id} label="ID" />
                                      )}
                                      {isOrphan && (
                                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-700/40 text-amber-200 font-bold" title="DB row exists but engine doesn't monitor this position">
                                              ORPHAN
                                          </span>
                                      )}
                                      {pos.mode && (
                                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${pos.mode === 'LIVE' ? 'bg-red-700/40 text-red-200' : 'bg-slate-700 text-slate-300'}`}>
                                              {pos.mode}
                                          </span>
                                      )}
                                      {pos.strategyName && (
                                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono" title="Strategy that produced this signal">
                                              {pos.strategyName}
                                          </span>
                                      )}
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${followLabel.cls}`} title={followLabel.desc}>
                                          {followLabel.txt}
                                      </span>
                                  </div>
                                  <div className="text-right">
                                      <div className={`font-mono font-bold text-lg ${pnl > 0 ? 'text-emerald-400' : pnl < 0 ? 'text-rose-400' : 'text-slate-300'}`}>
                                          {pnl >= 0 ? '+' : ''}₹{Math.round(pnl).toLocaleString()}
                                      </div>
                                      <div className="text-[10px] text-slate-500 font-mono">
                                          {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}% · qty {pos.quantity || 0}
                                      </div>
                                  </div>
                              </div>

                              {/* ── Row 2: Entry option price | Entry spot | Held ── */}
                              <div className="grid grid-cols-4 gap-3 text-[11px] mb-2 pb-2 border-b border-slate-800/50">
                                  <div>
                                      <div className="text-slate-500 text-[9px] uppercase tracking-wider">Entry Option</div>
                                      <div className="font-mono text-slate-300 font-bold">₹{(pos.entryPrice || 0).toFixed(2)}</div>
                                  </div>
                                  <div>
                                      <div className="text-slate-500 text-[9px] uppercase tracking-wider">Option LTP</div>
                                      <div className="font-mono text-white font-bold">₹{ltp.toFixed(2)}</div>
                                  </div>
                                  <div>
                                      <div className="text-slate-500 text-[9px] uppercase tracking-wider">Entry Spot</div>
                                      <div className="font-mono text-slate-300 font-bold">
                                          {entrySpot != null ? entrySpot.toFixed(2) : <span className="text-slate-600">—</span>}
                                      </div>
                                  </div>
                                  <div>
                                      <div className="text-slate-500 text-[9px] uppercase tracking-wider">Spot LTP</div>
                                      <div className="font-mono text-white font-bold">
                                          {spotLtp != null ? (
                                              <>
                                                  {spotLtp.toFixed(2)}
                                                  {spotMove != null && (
                                                      <span className={`ml-1 text-[10px] ${spotMove > 0 ? 'text-emerald-400' : spotMove < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                                                          ({spotMove > 0 ? '+' : ''}{spotMove.toFixed(2)})
                                                      </span>
                                                  )}
                                              </>
                                          ) : <span className="text-slate-600">—</span>}
                                      </div>
                                  </div>
                              </div>

                              {/* ── Row 3: Broker SL/TP (option-premium levels at broker) ── */}
                              <div className="text-[11px] mb-2">
                                  <div className="flex justify-between items-center mb-1">
                                      <span className="text-slate-500 text-[9px] uppercase tracking-wider flex items-center gap-1">
                                          <span className="text-amber-400">🛡</span> Broker SL/TP (option premium)
                                      </span>
                                      <span className="text-[9px] text-slate-600">{slDistPct.toFixed(1)}% / {tpDistPct.toFixed(1)}% from LTP</span>
                                  </div>
                                  <div className="flex justify-between text-[10px] font-mono mb-1">
                                      <span className="text-rose-400">SL ₹{brokerSl.toFixed(2)}</span>
                                      <span className="text-emerald-400">TP ₹{brokerTp.toFixed(2)}</span>
                                  </div>
                                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden relative">
                                      <div
                                          className={`h-full ${progressPct > 50 ? 'bg-emerald-500' : 'bg-rose-500'}`}
                                          style={{ width: `${progressPct}%` }}
                                      />
                                      {entryMarkerPct != null && (
                                          <div
                                              className="absolute top-0 h-full w-0.5 bg-slate-300"
                                              style={{ left: `${entryMarkerPct}%` }}
                                              title={`Entry @ ₹${pos.entryPrice.toFixed(2)}`}
                                          />
                                      )}
                                  </div>
                              </div>

                              {/* ── Row 4: Spot SL/TP (index-level, shown if AI gave them) ── */}
                              {(spotSl != null || spotTp != null) && (
                                  <div className="text-[11px] mb-2 pb-2 border-b border-slate-800/50">
                                      <div className="flex justify-between items-center mb-1">
                                          <span className="text-slate-500 text-[9px] uppercase tracking-wider flex items-center gap-1">
                                              <span className="text-cyan-400">🎯</span> Spot SL/TP {pos.aiUseSpotExits ? '(engine-monitored)' : '(AI suggestion)'}
                                          </span>
                                          {pos.aiUseSpotExits && (
                                              <span className="text-[9px] text-cyan-400 font-bold">ACTIVE</span>
                                          )}
                                      </div>
                                      <div className="flex justify-between text-[10px] font-mono">
                                          <span className="text-rose-400">
                                              SL {spotSl != null ? spotSl.toFixed(2) : '—'}
                                              {spotSl != null && spotLtp != null && (
                                                  <span className="text-slate-500 ml-1">({Math.abs(spotLtp - spotSl).toFixed(1)} pts away)</span>
                                              )}
                                          </span>
                                          <span className="text-emerald-400">
                                              TP {spotTp != null ? spotTp.toFixed(2) : '—'}
                                              {spotTp != null && spotLtp != null && (
                                                  <span className="text-slate-500 ml-1">({Math.abs(spotTp - spotLtp).toFixed(1)} pts away)</span>
                                              )}
                                          </span>
                                      </div>
                                  </div>
                              )}

                              {/* ── Row 5: time + AI footer ── */}
                              <div className="flex items-center justify-between gap-2 text-[10px]">
                                  <div className="text-slate-400 flex items-center gap-2">
                                      <span className="text-slate-500">⏱</span>
                                      <span className="font-mono">{heldStr}</span>
                                      {entryTimeStr && (
                                          <span className="text-slate-600">since {entryTimeStr}</span>
                                      )}
                                  </div>
                                  {pos.aiDecision && (
                                      <div className="flex items-center gap-2 text-slate-400 min-w-0">
                                          <span className="text-violet-400 font-bold">🤖</span>
                                          {pos.aiConfidence != null && (
                                              <span className="font-mono text-violet-300">{Math.round(pos.aiConfidence)}%</span>
                                          )}
                                          {pos.aiModel && (
                                              <span className="text-slate-500 truncate max-w-[120px]" title={pos.aiModel}>
                                                  {String(pos.aiModel).replace(/^claude-web\/|^gemini-web\//, '')}
                                              </span>
                                          )}
                                      </div>
                                  )}
                              </div>
                              {pos.aiReasoning && (
                                  <div className="text-[10px] text-slate-500 italic mt-1 truncate" title={pos.aiReasoning}>
                                      📋 {pos.aiReasoning}
                                  </div>
                              )}

                              {/* ── AI In-flight Review accordion ──────────────────────
                                  Shows every periodic review the AI performed while the
                                  position was open: HOLD / CLOSE_NOW / UPDATE_SL / UPDATE_TP
                                  with timestamp, confidence, reasoning, and whether the
                                  verdict was actually applied. Only rendered when the
                                  strategy has ai_inflight_review_enabled. */}
                              {pos.inflight_review_enabled && (() => {
                                  const reviews = Array.isArray(pos.inflight_reviews) ? pos.inflight_reviews : [];
                                  const key = pos.spotSymbol || pos.symbol;
                                  const expanded = !!reviewsExpanded[key];
                                  const intervalMin = pos.inflight_review_interval_min || 15;
                                  const lastReview = reviews[0]; // newest-first from server
                                  const ACTION_STYLE = {
                                      HOLD:      { txt: 'HOLD',      cls: 'bg-slate-700/60 text-slate-300' },
                                      CLOSE_NOW: { txt: 'CLOSE',     cls: 'bg-rose-700/40 text-rose-200' },
                                      UPDATE_SL: { txt: 'UPDATE SL', cls: 'bg-amber-700/40 text-amber-200' },
                                      UPDATE_TP: { txt: 'UPDATE TP', cls: 'bg-cyan-700/40 text-cyan-200' },
                                      ERROR:     { txt: 'ERROR',     cls: 'bg-rose-900/40 text-rose-300' },
                                  };
                                  return (
                                      <div className="mt-2 border-t border-slate-800/50 pt-2">
                                          <button
                                              onClick={() => setReviewsExpanded(prev => ({ ...prev, [key]: !prev[key] }))}
                                              className="w-full flex items-center justify-between text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
                                              title={`AI re-reviews this trade every ${intervalMin} min`}
                                          >
                                              <span className="flex items-center gap-2">
                                                  <span>{expanded ? '▼' : '▶'}</span>
                                                  <span className="font-semibold">🔄 AI In-flight Reviews</span>
                                                  <span className="text-slate-600">·</span>
                                                  <span className="font-mono text-slate-500">{reviews.length}</span>
                                                  <span className="text-slate-600 text-[10px]">(every {intervalMin}m)</span>
                                              </span>
                                              {lastReview && (
                                                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${ACTION_STYLE[lastReview.action]?.cls || 'bg-slate-700/60 text-slate-300'}`}>
                                                      latest: {ACTION_STYLE[lastReview.action]?.txt || lastReview.action}
                                                      {lastReview.confidence != null && ` ${lastReview.confidence}%`}
                                                  </span>
                                              )}
                                          </button>

                                          {expanded && (
                                              <div className="mt-2 space-y-2 max-h-64 overflow-y-auto pr-1">
                                                  {reviews.length === 0 ? (
                                                      <div className="text-[11px] text-slate-500 italic px-2 py-3 text-center bg-slate-900/40 rounded border border-dashed border-slate-700">
                                                          No reviews yet. First review fires ~{intervalMin} min after entry.
                                                      </div>
                                                  ) : reviews.map((r, idx) => {
                                                      const style = ACTION_STYLE[r.action] || { txt: r.action, cls: 'bg-slate-700/60 text-slate-300' };
                                                      const ts = r.ts ? new Date(r.ts) : null;
                                                      const tsStr = ts ? ts.toLocaleTimeString('en-IN', { hour12: false }) : '—';
                                                      const dateStr = ts ? ts.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) : '';
                                                      const heldMin = r.held_seconds != null ? Math.round(r.held_seconds / 60) : null;
                                                      const pnlVal = r.pnl_rs;
                                                      const applied = r.applied;
                                                      return (
                                                          <div
                                                              key={`${r.ts}-${idx}`}
                                                              className="bg-slate-900/50 border border-slate-800 rounded p-2 text-[11px]"
                                                          >
                                                              <div className="flex items-center justify-between gap-2 mb-1">
                                                                  <div className="flex items-center gap-2 min-w-0">
                                                                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${style.cls}`}>
                                                                          {style.txt}
                                                                      </span>
                                                                      {r.confidence != null && (
                                                                          <span className="text-violet-300 font-mono text-[10px]">{r.confidence}%</span>
                                                                      )}
                                                                      {applied === true && (
                                                                          <span className="text-emerald-400 text-[10px]" title="Verdict applied">✓ applied</span>
                                                                      )}
                                                                      {applied === false && (
                                                                          <span
                                                                              className="text-amber-400 text-[10px]"
                                                                              title={r.rejection_reason || 'Sanity check rejected this verdict'}
                                                                          >
                                                                              ⚠ rejected
                                                                          </span>
                                                                      )}
                                                                  </div>
                                                                  <div className="text-slate-500 font-mono text-[10px] whitespace-nowrap">
                                                                      {dateStr} {tsStr}
                                                                  </div>
                                                              </div>
                                                              {r.reasoning && (
                                                                  <div className="text-slate-300 leading-snug whitespace-pre-wrap break-words">
                                                                      {r.reasoning}
                                                                  </div>
                                                              )}
                                                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500 font-mono">
                                                                  {heldMin != null && <span>held {heldMin}m</span>}
                                                                  {pnlVal != null && (
                                                                      <span className={pnlVal > 0 ? 'text-emerald-400' : pnlVal < 0 ? 'text-rose-400' : 'text-slate-500'}>
                                                                          PnL ₹{Math.round(pnlVal)}
                                                                      </span>
                                                                  )}
                                                                  {r.current_spot != null && (
                                                                      <span>spot {Number(r.current_spot).toFixed(2)}</span>
                                                                  )}
                                                                  {r.current_option_price != null && (
                                                                      <span>opt ₹{Number(r.current_option_price).toFixed(2)}</span>
                                                                  )}
                                                                  {r.new_sl != null && (
                                                                      <span className="text-amber-300">new SL {Number(r.new_sl).toFixed(2)}</span>
                                                                  )}
                                                                  {r.new_tp != null && (
                                                                      <span className="text-cyan-300">new TP {Number(r.new_tp).toFixed(2)}</span>
                                                                  )}
                                                                  {r.model && (
                                                                      <span className="text-slate-600 truncate" title={r.model}>
                                                                          {String(r.model).replace(/^claude-web\/|^gemini-web\//, '')}
                                                                      </span>
                                                                  )}
                                                              </div>
                                                              {r.rejection_reason && applied === false && (
                                                                  <div className="mt-1 text-amber-400/70 text-[10px] italic">
                                                                      {r.rejection_reason}
                                                                  </div>
                                                              )}
                                                          </div>
                                                      );
                                                  })}
                                              </div>
                                          )}
                                      </div>
                                  );
                              })()}

                              {/* ── Close button — engine-managed exit for monitored
                                  positions; force-close for orphans (engine
                                  doesn't know about them so closePosition is a
                                  no-op). Both paths confirm with the user before
                                  hitting the server. */}
                              {(() => {
                                  // Must match the key used in handleClosePosition (deploymentId
                                  // first, then the unique option symbol) — spotSymbol is not
                                  // unique across two deployments on the same underlying.
                                  const lockKey = isOrphan ? `orphan:${pos.trade_id}` : (pos.deploymentId || pos.symbol);
                                  const isClosing = !!closingSymbols[lockKey];
                                  if (isOrphan) {
                                      return (
                                          <div className="mt-2 pt-2 border-t border-amber-800/40 flex justify-end">
                                              <button
                                                  onClick={() => handleForceCloseOrphan(pos)}
                                                  disabled={isClosing || !pos.trade_id || pos.mode === 'LIVE'}
                                                  className={`text-[11px] px-3 py-1 rounded font-bold transition-colors ${
                                                      isClosing || !pos.trade_id || pos.mode === 'LIVE'
                                                          ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                                                          : 'bg-amber-700/40 hover:bg-amber-700/70 text-amber-100 hover:text-white border border-amber-700/60'
                                                  }`}
                                                  title={pos.mode === 'LIVE'
                                                      ? 'LIVE orphan — close at broker; engine will reconcile.'
                                                      : 'Mark this orphan Trade doc CLOSED at current LTP.'}
                                              >
                                                  {isClosing ? '⏳ Closing…' : pos.mode === 'LIVE' ? '🔒 Close at Broker' : '🧹 Force-Close Orphan'}
                                              </button>
                                          </div>
                                      );
                                  }
                                  return (
                                      <div className="mt-2 pt-2 border-t border-slate-800/50 flex justify-end">
                                          <button
                                              onClick={() => handleClosePosition(pos)}
                                              disabled={isClosing}
                                              className={`text-[11px] px-3 py-1 rounded font-bold transition-colors ${
                                                  isClosing
                                                      ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                                                      : 'bg-rose-700/40 hover:bg-rose-700/70 text-rose-200 hover:text-white border border-rose-700/60'
                                              }`}
                                              title="Fire a market exit for this position via the broker"
                                          >
                                              {isClosing ? '⏳ Closing…' : '🛑 Close Position'}
                                          </button>
                                      </div>
                                  );
                              })()}
                          </div>
                      );
                  })}
              </div>
          ) : (
              <div className="flex flex-col items-center justify-center h-32 text-slate-500 bg-slate-900/40 rounded-lg border border-dashed border-slate-700">
                  <ShoppingCart className="w-6 h-6 mb-1 opacity-50" />
                  <div className="text-sm">No open positions</div>
                  <div className="text-[10px] text-slate-600 mt-1">Waiting for the next signal…</div>
              </div>
          )}
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
          <div className="flex justify-between items-center mb-4">
              <button
                  type="button"
                  onClick={toggleTrades}
                  aria-expanded={tradesExpanded}
                  title={tradesExpanded ? 'Collapse trade history' : 'Expand trade history'}
                  className="text-xl font-bold flex items-center gap-2 text-left hover:text-primary transition-colors"
              >
                {tradesExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                <Database className="w-5 h-5 text-primary" /> Trade History
                {tradesTotal > 0 && <span className="text-xs font-normal text-slate-500">({tradesTotal})</span>}
              </button>
              {tradesExpanded && (
              <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 font-medium whitespace-nowrap">Show:</span>
                      <select 
                          value={tradesLimit}
                          onChange={(e) => {
                              setTradesLimit(parseInt(e.target.value));
                              setTradesPage(1); // Reset to page 1 on limit change
                          }}
                          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white font-mono focus:border-primary outline-none cursor-pointer hover:border-slate-500 transition-colors"
                      >
                          <option value={10}>10</option>
                          <option value={20}>20</option>
                          <option value={50}>50</option>
                          <option value={100}>100</option>
                      </select>
                  </div>
                  <input 
                      type="text" 
                      placeholder="Search Symbol..." 
                      value={tradesSearch}
                      onChange={(e) => {
                          setTradesSearch(e.target.value);
                          setTradesPage(1); // Reset to page 1 on new search
                      }}
                      className="bg-slate-900 border border-slate-700 rounded px-3 py-1 text-sm text-white font-mono focus:border-primary outline-none"
                  />
              </div>
              )}
          </div>
          {tradesExpanded && (<>
          {mongoTrades.length > 0 ? (
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                    <thead>
                        <tr className="text-slate-400 border-b border-slate-700">
                            <th className="p-3">Trade ID</th>
                            <th className="p-3">Entry Time</th>
                            <th className="p-3">Exit Time</th>
                            <th className="p-3">Status</th>
                            <th className="p-3">Symbol</th>
                            <th className="p-3">Strategy</th>
                            <th className="p-3">Action</th>
                            <th className="p-3">Qty</th>
                            <th className="p-3">Price (En/Ex)</th>
                            <th className="p-3">P&L</th>
                            <th className="p-3">Reason</th>
                        </tr>
                    </thead>
                    <tbody>
                        {mongoTrades.map((trade, i) => (
                            <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/50">
                                {/* Trade ID — same ObjectId for ENTRY + EXIT (the
                                    same doc is updated, not duplicated). Click to
                                    copy the full hex for searching everywhere. */}
                                <td className="p-3">
                                    <TradeIdBadge id={trade.trade_id || trade._id} label="" />
                                </td>
                                {/* Entry Time (Fallback to timestamp for old logs if action is BUY/ENTRY) */}
                                <td className="p-3 text-slate-300">
                                    {trade.entryTime
                                        ? new Date(trade.entryTime).toLocaleString()
                                        : (trade.action === 'ENTRY' || trade.action === 'BUY' ? new Date(trade.timestamp).toLocaleString() : '-')}
                                </td>
                                
                                {/* Exit Time (Fallback to timestamp for old logs if action is EXIT/SELL) */}
                                <td className="p-3 text-slate-400">
                                    {trade.exitTime 
                                        ? new Date(trade.exitTime).toLocaleString() 
                                        : (trade.action === 'EXIT' || trade.action === 'SELL' ? new Date(trade.timestamp).toLocaleString() : '-')}
                                </td>
                                
                                <td className="p-3">
                                    {trade.status ? (
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${trade.status === 'OPEN' ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-700 text-slate-300'}`}>
                                            {trade.status}
                                        </span>
                                    ) : (
                                        <span className="text-slate-500 text-xs italic">Legacy</span>
                                    )}
                                </td>
                                
                                <td className="p-3 font-medium text-white">{trade.tradingsymbol || trade.symbol}</td>
                                <td className="p-3 text-slate-300 text-xs truncate max-w-[140px]" title={trade.strategyName || trade.strategy || ''}>
                                    {trade.strategyName || trade.strategy || <span className="text-slate-600">—</span>}
                                </td>
                                <td className={`p-3 font-bold ${trade.action === 'BUY' || trade.action === 'ENTRY' ? 'text-green-500' : 'text-red-500'}`}>{trade.action}</td>
                                <td className="p-3 text-slate-300">{trade.quantity}</td>
                                
                                {/* Price Column handles both Unified and Legacy */}
                                <td className="p-3 text-slate-300">
                                    {trade.status ? (
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-xs text-slate-400">En: ₹{trade.entryPrice || trade.price}</span>
                                            {trade.exitPrice && <span>Ex: <span className="text-white">₹{trade.exitPrice}</span></span>}
                                        </div>
                                    ) : (
                                        <span>₹{trade.price}</span>
                                    )}
                                </td>
                                
                                <td className={`p-3 font-bold ${trade.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>₹{trade.pnl}</td>
                                <td className="p-3 text-slate-400 text-xs">{trade.reason}</td>
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
          
          {/* Pagination Controls */}
          {tradesTotal > 0 && (
              <div className="flex justify-between items-center mt-4 border-t border-slate-800 pt-4">
                  <button 
                      disabled={tradesPage === 1}
                      onClick={() => setTradesPage(p => Math.max(1, p - 1))}
                      className={`px-3 py-1 rounded text-sm font-medium ${tradesPage === 1 ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : 'bg-slate-700 hover:bg-slate-600 text-white'}`}
                  >
                      Previous
                  </button>
                  <span className="text-sm border border-slate-700 bg-slate-800 rounded px-4 py-1 font-mono text-slate-300">
                      Page {tradesPage} of {Math.max(1, Math.ceil(tradesTotal / tradesLimit))}
                  </span>
                  <button
                      disabled={tradesPage >= Math.ceil(tradesTotal / tradesLimit)}
                      onClick={() => setTradesPage(p => p + 1)}
                      className={`px-3 py-1 rounded text-sm font-medium ${tradesPage >= Math.ceil(tradesTotal / tradesLimit) ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : 'bg-slate-700 hover:bg-slate-600 text-white'}`}
                  >
                      Next
                  </button>
              </div>
          )}
          </>)}
       </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* Live Activity Feed — unified timeline of trades + AI events + errors */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      <div className="bg-surface rounded-xl border border-slate-700 p-6">
          <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
              <div className="flex items-center gap-3">
                  <h3 className="text-xl font-bold flex items-center gap-2">
                      <Activity className="w-5 h-5 text-primary" /> Live Activity Feed
                      {activityLoading && <span className="text-[10px] text-slate-500 font-normal">refreshing…</span>}
                  </h3>
                  <button
                      onClick={() => setActivityExpanded(v => !v)}
                      className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
                      title={activityExpanded ? 'Pause polling (collapse)' : 'Resume polling'}
                  >
                      {activityExpanded ? 'Collapse' : 'Expand'}
                  </button>
              </div>
              {activityExpanded && (
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                      <input
                          type="text"
                          placeholder="Filter symbol (e.g. NSE:NIFTYBANK-INDEX)"
                          value={activityFilters.symbol}
                          onChange={e => setActivityFilters(f => ({ ...f, symbol: e.target.value }))}
                          className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 w-56"
                      />
                      <input
                          type="text"
                          placeholder="Filter strategy"
                          value={activityFilters.strategy}
                          onChange={e => setActivityFilters(f => ({ ...f, strategy: e.target.value }))}
                          className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 w-40"
                      />
                      {/* Trade-ID filter — full ID (copy from a badge) or short suffix.
                          Correlates ENTRY/EXIT + AI confirm/reject/skip for one trade. */}
                      <div className="relative">
                          <input
                              type="text"
                              placeholder="Filter trade ID"
                              value={activityFilters.tradeId}
                              onChange={e => setActivityFilters(f => ({ ...f, tradeId: e.target.value }))}
                              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 pr-6 text-slate-200 w-40 font-mono"
                          />
                          {activityFilters.tradeId && (
                              <button
                                  type="button"
                                  onClick={() => setActivityFilters(f => ({ ...f, tradeId: '' }))}
                                  title="Clear trade-ID filter"
                                  className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-sm leading-none"
                              >×</button>
                          )}
                      </div>
                      <select
                          value={activityFilters.limit}
                          onChange={e => setActivityFilters(f => ({ ...f, limit: parseInt(e.target.value, 10) }))}
                          className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200"
                      >
                          <option value={50}>50</option>
                          <option value={100}>100</option>
                          <option value={250}>250</option>
                          <option value={500}>500</option>
                      </select>
                  </div>
              )}
          </div>

          {activityExpanded && (
              <>
                  {/* Type chips — click to toggle */}
                  <div className="flex gap-2 flex-wrap mb-4">
                      {[
                          { key: 'TRADE_ENTRY',  label: '🟢 Entry',     color: 'bg-emerald-700/40 text-emerald-200 border-emerald-700' },
                          { key: 'TRADE_EXIT',   label: '💰 Exit',      color: 'bg-blue-700/40 text-blue-200 border-blue-700' },
                          { key: 'AI_CONFIRM',   label: '✅ AI Confirm', color: 'bg-teal-700/40 text-teal-200 border-teal-700' },
                          { key: 'AI_REJECT',    label: '🛑 AI Reject', color: 'bg-rose-700/40 text-rose-200 border-rose-700' },
                          { key: 'AI_ERROR',     label: '⚠️ AI Error',  color: 'bg-amber-700/40 text-amber-200 border-amber-700' },
                          { key: 'ENTRY_SKIPPED',label: '⏭️ Skipped',   color: 'bg-orange-700/40 text-orange-200 border-orange-700' },
                          { key: 'ENGINE_ERROR', label: '🔥 Engine Err', color: 'bg-red-700/40 text-red-200 border-red-700' },
                      ].map(chip => {
                          const active = activityFilters.types.includes(chip.key);
                          return (
                              <button
                                  key={chip.key}
                                  onClick={() => setActivityFilters(f => ({
                                      ...f,
                                      types: active
                                          ? f.types.filter(t => t !== chip.key)
                                          : [...f.types, chip.key],
                                  }))}
                                  className={`text-[11px] px-2 py-1 rounded border ${active ? chip.color : 'bg-slate-800 text-slate-500 border-slate-700'}`}
                              >
                                  {chip.label}
                              </button>
                          );
                      })}
                  </div>

                  {/* Event timeline */}
                  <div className="overflow-x-auto rounded-lg border border-slate-800">
                      <table className="w-full text-sm">
                          <thead className="bg-slate-900/50 text-slate-400 text-[11px] uppercase tracking-wider">
                              <tr>
                                  <th className="p-2 text-left w-32">When</th>
                                  <th className="p-2 text-left w-32">Type</th>
                                  <th className="p-2 text-left w-20">Trade ID</th>
                                  <th className="p-2 text-left">Symbol</th>
                                  <th className="p-2 text-left">Strategy</th>
                                  <th className="p-2 text-left">Side</th>
                                  <th className="p-2 text-right">PnL / Conf</th>
                                  <th className="p-2 text-left">Detail</th>
                                  <th className="p-2 text-right w-16"></th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800">
                              {activityEvents.length === 0 && !activityLoading && (
                                  <tr>
                                      <td colSpan={9} className="p-6 text-center text-slate-500 italic">
                                          No activity in the selected window.
                                      </td>
                                  </tr>
                              )}
                              {activityEvents.map((ev, i) => {
                                  const ts = new Date(ev.timestamp);
                                  const tsStr = ts.toLocaleString('en-IN', { hour12: false });
                                  let typeBadge, rowTone, pnlOrConf, detail;
                                  if (ev.type === 'TRADE_ENTRY') {
                                      typeBadge = <span className="px-1.5 py-0.5 rounded bg-emerald-700/40 text-emerald-200">🟢 ENTRY</span>;
                                      rowTone = '';
                                      // ai_confidence is already on a 0-100 scale (Python's native).
                                      // No * 100 anywhere — that was the long-standing "6000%" bug.
                                      pnlOrConf = ev.ai_confidence != null ? `AI ${Math.round(ev.ai_confidence)}%` : '—';
                                      detail = (
                                          <span className="text-slate-400 text-xs">
                                              @ ₹{ev.price?.toFixed?.(2) ?? ev.price} · qty {ev.quantity ?? '?'} · {ev.reason || '—'}
                                          </span>
                                      );
                                  } else if (ev.type === 'TRADE_EXIT') {
                                      typeBadge = <span className="px-1.5 py-0.5 rounded bg-blue-700/40 text-blue-200">💰 EXIT</span>;
                                      const pnl = ev.pnl || 0;
                                      rowTone = pnl > 0 ? 'hover:bg-emerald-950/30' : (pnl < 0 ? 'hover:bg-rose-950/30' : '');
                                      pnlOrConf = (
                                          <span className={`font-mono font-bold ${pnl > 0 ? 'text-emerald-400' : pnl < 0 ? 'text-rose-400' : 'text-slate-300'}`}>
                                              {pnl > 0 ? '+' : ''}₹{Math.round(pnl).toLocaleString()}
                                          </span>
                                      );
                                      detail = (
                                          <span className="text-slate-400 text-xs">
                                              {ev.entryPrice?.toFixed?.(2)} → {ev.exitPrice?.toFixed?.(2)} · {ev.reason || '—'}
                                          </span>
                                      );
                                  } else if (ev.type === 'AI_CONFIRM') {
                                      typeBadge = <span className="px-1.5 py-0.5 rounded bg-teal-700/40 text-teal-200">✅ AI CONFIRM</span>;
                                      rowTone = 'hover:bg-teal-950/20';
                                      pnlOrConf = ev.ai_confidence != null
                                          ? <span className="font-mono text-teal-300">{Math.round(ev.ai_confidence)}%</span>
                                          : '—';
                                      detail = (
                                          <span className="text-teal-300/80 text-xs italic">
                                              {ev.ai_reasoning?.slice(0, 100) || '(no reasoning)'}
                                              {ev.ai_suggested_sl && ev.ai_suggested_tp ? (
                                                  <span className="ml-2 text-slate-500 not-italic">
                                                      · SL {ev.ai_suggested_sl} / TP {ev.ai_suggested_tp}
                                                  </span>
                                              ) : null}
                                          </span>
                                      );
                                  } else if (ev.type === 'AI_REJECT') {
                                      typeBadge = <span className="px-1.5 py-0.5 rounded bg-rose-700/40 text-rose-200">🛑 AI REJECT</span>;
                                      rowTone = 'hover:bg-rose-950/20';
                                      pnlOrConf = ev.ai_confidence != null ? `${Math.round(ev.ai_confidence)}%` : '—';
                                      detail = (
                                          <span className="text-rose-300/80 text-xs italic">
                                              {ev.ai_reasoning || '(no reasoning)'}
                                          </span>
                                      );
                                  } else if (ev.type === 'ENTRY_SKIPPED') {
                                      typeBadge = <span className="px-1.5 py-0.5 rounded bg-orange-700/40 text-orange-200">⏭️ SKIPPED</span>;
                                      rowTone = 'hover:bg-orange-950/20';
                                      pnlOrConf = <span className="text-orange-300/80 text-[11px]">no entry</span>;
                                      detail = (
                                          <span className="text-orange-300/80 text-xs italic">
                                              {ev.ai_reasoning || '(no reason)'}
                                          </span>
                                      );
                                  } else if (ev.type === 'AI_ERROR') {
                                      typeBadge = <span className="px-1.5 py-0.5 rounded bg-amber-700/40 text-amber-200">⚠️ AI ERR</span>;
                                      rowTone = 'hover:bg-amber-950/20';
                                      pnlOrConf = ev.elapsed_ms ? `${(ev.elapsed_ms / 1000).toFixed(0)}s` : '—';
                                      detail = (
                                          <span className="text-amber-300/80 text-xs">
                                              [{ev.failure_type}] {ev.ai_reasoning?.slice(0, 80) || '(no detail)'}
                                          </span>
                                      );
                                  } else if (ev.type === 'ENGINE_ERROR') {
                                      typeBadge = <span className="px-1.5 py-0.5 rounded bg-red-700/40 text-red-200">🔥 {ev.category || 'ERR'}</span>;
                                      rowTone = 'hover:bg-red-950/20';
                                      pnlOrConf = ev.severity === 'critical' ? <span className="text-red-300 font-bold">CRITICAL</span> : '—';
                                      detail = (
                                          <span className="text-red-300/80 text-xs">
                                              {(ev.message || '').slice(0, 100)}
                                          </span>
                                      );
                                  }
                                  return (
                                      <tr key={i} className={`text-slate-300 ${rowTone}`}>
                                          <td className="p-2 font-mono text-[11px] text-slate-400 whitespace-nowrap">{tsStr}</td>
                                          <td className="p-2 text-[11px]">{typeBadge}</td>
                                          <td className="p-2 text-[11px]">
                                              {ev.trade_id ? (
                                                  <span className="inline-flex items-center gap-1">
                                                      <TradeIdBadge id={String(ev.trade_id)} label="" />
                                                      <button
                                                          type="button"
                                                          onClick={() => setActivityFilters(f => ({ ...f, tradeId: String(ev.trade_id) }))}
                                                          title="Filter feed by this trade ID"
                                                          className="text-slate-500 hover:text-teal-300 text-[11px] leading-none"
                                                      >🔎</button>
                                                  </span>
                                              ) : (
                                                  <span className="text-slate-600">—</span>
                                              )}
                                          </td>
                                          <td className="p-2 text-xs truncate max-w-[180px]" title={ev.symbol || ''}>{ev.symbol || '—'}</td>
                                          <td className="p-2 text-xs text-slate-400 truncate max-w-[140px]" title={ev.strategyName || ''}>{ev.strategyName || '—'}</td>
                                          <td className="p-2 text-xs">{ev.side || '—'}</td>
                                          <td className="p-2 text-right text-xs">{pnlOrConf}</td>
                                          <td className="p-2">{detail}</td>
                                          <td className="p-2 text-right">
                                              <button
                                                  onClick={() => setActivityDetail(ev)}
                                                  className="text-[10px] px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300"
                                              >
                                                  view
                                              </button>
                                          </td>
                                      </tr>
                                  );
                              })}
                          </tbody>
                      </table>
                  </div>

                  <p className="text-[10px] text-slate-500 mt-2">
                      Auto-refreshes every 8s. Engine errors and AI logs retained for 30 days (TTL). Trade history persists indefinitely.
                  </p>
              </>
          )}
      </div>

      {/* Activity Detail Modal */}
      {activityDetail && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={() => setActivityDetail(null)}>
              <div className="bg-surface border border-slate-600 rounded-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
                  <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                      <h3 className="font-bold text-white">
                          {activityDetail.type} · {activityDetail.symbol || '—'}
                      </h3>
                      <button onClick={() => setActivityDetail(null)} className="text-slate-400 hover:text-white text-xl">×</button>
                  </div>
                  <div className="p-4">
                      <pre className="text-xs text-slate-300 bg-slate-900 p-3 rounded overflow-x-auto whitespace-pre-wrap break-words">
                          {JSON.stringify(activityDetail, null, 2)}
                      </pre>
                      {/* Prompt-rebuild button — works for any event that has a log_id
                          (AI events) OR an ai_job_id (TRADE_ENTRY events with AI metadata).
                          For TRADE_ENTRY we look up the live_ai_log by job_id first, then
                          rebuild the prompt from the saved signalContext. */}
                      {(activityDetail.log_id || activityDetail.ai_job_id) && (
                          <button
                              onClick={async () => {
                                  try {
                                      let logId = activityDetail.log_id;
                                      if (!logId && activityDetail.ai_job_id) {
                                          const lookup = await axios.get(`${API_URL}/live-ai-logs`, {
                                              params: { job_id: activityDetail.ai_job_id, limit: 1 },
                                          });
                                          logId = lookup.data?.logs?.[0]?._id;
                                          if (!logId) {
                                              alert('No live_ai_log found for this trade (job_id=' + activityDetail.ai_job_id + ')');
                                              return;
                                          }
                                      }
                                      const r = await axios.get(`${API_URL}/live-ai-logs/${logId}/prompt`);
                                      // Open in a new window for readability instead of alert().
                                      // Show BOTH sides: the prompt sent AND the AI's raw
                                      // response + failure code — so third-party parse/API
                                      // errors are debuggable from one screen.
                                      const esc = (s) => String(s == null ? '' : s)
                                          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                                      const w = window.open('', '_blank');
                                      if (w) {
                                          const d = r.data || {};
                                          const failed = !!(d.failure_type || d.failure_detail);
                                          const verdict = d.decision
                                              ? `${d.decision}${d.confidence != null ? ` @ ${Math.round(d.confidence)}%` : ''}`
                                              : '(no decision)';
                                          const failBlock = failed
                                              ? '<h2 style="color:#f87171">⚠ Failure</h2>' +
                                                '<p>type: <b>' + esc(d.failure_type || '—') + '</b>' +
                                                ' · detail: <b>' + esc(d.failure_detail || '—') + '</b></p>' +
                                                (d.failure_message ? '<p>' + esc(d.failure_message) + '</p>' : '') +
                                                (d.last_poll_error ? '<p>last poll error: ' + esc(d.last_poll_error) + '</p>' : '')
                                              : '';
                                          const rawBlock =
                                              '<h2 style="color:#34d399">AI Raw Response</h2>' +
                                              (d.reasoning ? '<p style="color:#94a3b8">reasoning: ' + esc(d.reasoning) + '</p>' : '') +
                                              '<pre style="background:#1e293b;padding:12px;border-radius:6px;overflow:auto">' +
                                              (d.raw_response ? esc(d.raw_response) : '(no raw response captured — pure API/timeout error, or a log written before raw-capture shipped)') +
                                              '</pre>';
                                          w.document.write(
                                              '<html><head><title>AI Exchange</title>' +
                                              '<style>body{background:#0f172a;color:#e2e8f0;font-family:monospace;padding:24px;white-space:pre-wrap;word-wrap:break-word;font-size:13px;line-height:1.5}h2{color:#a78bfa;margin-top:24px}pre{white-space:pre-wrap;word-wrap:break-word}</style>' +
                                              '</head><body>' +
                                              '<h2 style="margin-top:0">AI Exchange — ' + esc(d.model || 'unknown') + ' · verdict: ' + esc(verdict) + '</h2>' +
                                              (d.thinking_enabled ? '<p style="color:#fbbf24">🧠 Extended thinking was enabled</p>' : '') +
                                              failBlock +
                                              rawBlock +
                                              '<h2>Prompt Sent</h2>' +
                                              '<hr style="border:1px solid #334155"/>' +
                                              esc(d.prompt || '(empty)') +
                                              '</body></html>'
                                          );
                                          w.document.close();
                                      } else {
                                          alert(r.data?.raw_response || r.data?.prompt || 'No data available');
                                      }
                                  } catch (e) {
                                      alert('Failed to rebuild prompt: ' + (e.response?.data?.error || e.message));
                                  }
                              }}
                              className="mt-3 px-3 py-1.5 rounded bg-violet-700 hover:bg-violet-600 text-white text-xs"
                          >
                              📋 View AI prompt + raw response
                          </button>
                      )}
                  </div>
              </div>
          </div>
      )}

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

      {/* ── Signal Simulator Modal ── */}
      {simModal.isOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={closeSimulator}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-amber-400">🧪 Signal Simulator</h3>
                <p className="text-xs text-slate-400 mt-0.5">{simModal.symbol} — runs full pipeline without placing an order</p>
              </div>
              <button onClick={closeSimulator} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
            </div>

            {/* Controls */}
            <div className="p-4 flex items-center gap-3">
              <div className="flex rounded border border-slate-600 overflow-hidden text-sm">
                {['CE', 'PE'].map(t => (
                  <button key={t}
                    className={`px-4 py-1.5 transition-colors ${simModal.type === t ? (t === 'CE' ? 'bg-green-700/60 text-green-200' : 'bg-red-700/60 text-red-200') : 'text-slate-400 hover:text-white'}`}
                    onClick={() => setSimModal(s => ({ ...s, type: t, result: null, error: null }))}
                  >{t}</button>
                ))}
              </div>
              <button
                onClick={runSimulation}
                disabled={simModal.loading}
                className="flex-1 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded text-sm font-semibold transition-colors"
              >
                {simModal.loading ? '⏳ Running…' : '▶ Run Simulation'}
              </button>
            </div>

            {/* Error */}
            {simModal.error && (
              <div className="mx-4 mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded text-red-300 text-sm">{simModal.error}</div>
            )}

            {/* Results */}
            {simModal.result && (() => {
              const r = simModal.result;
              const aiR = r.aiResult;
              const pass = r.wouldExecute;
              return (
                <div className="px-4 pb-4 space-y-3">
                  {/* Verdict */}
                  <div className={`rounded-lg p-3 border text-center ${pass ? 'bg-green-900/30 border-green-600/40' : 'bg-red-900/30 border-red-600/40'}`}>
                    <p className={`text-lg font-bold ${pass ? 'text-green-400' : 'text-red-400'}`}>
                      {pass ? '✅ WOULD EXECUTE' : '❌ BLOCKED'}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {r.type} signal on {r.symbol} @ ₹{r.spot} &nbsp;·&nbsp; {new Date(r.timestamp).toLocaleTimeString()}
                    </p>
                  </div>

                  {/* Strategy signal result */}
                  {r.strategySignal && (
                    <div className="bg-slate-800 rounded-lg p-3 text-xs">
                      <p className="text-slate-400 font-semibold mb-1">Strategy Check (current candles)</p>
                      <span className={`px-2 py-0.5 rounded font-bold ${r.strategySignal.action === 'ENTRY' ? 'bg-green-700/40 text-green-300' : 'bg-slate-700 text-slate-400'}`}>
                        {r.strategySignal.action === 'ENTRY' ? `✓ ${r.strategySignal.type} Signal` : 'No Signal'}
                      </span>
                      {r.strategySignal.reason && <span className="ml-2 text-slate-500">{r.strategySignal.reason}</span>}
                    </div>
                  )}

                  {/* SL/TP */}
                  <div className="bg-slate-800 rounded-lg p-3">
                    <p className="text-xs text-slate-400 font-semibold mb-2">SL / TP ({r.slSource})</p>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div><p className="text-slate-500">Spot</p><p className="text-white font-bold">₹{r.spot}</p></div>
                      <div><p className="text-slate-500">SL Points</p><p className="text-red-400 font-bold">{r.slPoints}</p></div>
                      <div><p className="text-slate-500">TP Points</p><p className="text-green-400 font-bold">{r.tpPoints}</p></div>
                    </div>
                  </div>

                  {/* Option Contract — what the engine would actually order */}
                  {r.optionInfo && (
                    <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                      <p className="text-xs text-slate-400 font-semibold mb-2">
                        🎯 Option Contract {r.tradeMode && <span className="ml-1 text-[10px] text-slate-500">({r.tradeMode} mode)</span>}
                      </p>
                      {r.optionInfo.error ? (
                        <p className="text-xs text-orange-400">⚠️ {r.optionInfo.error}</p>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-white font-mono text-sm bg-slate-900 px-2 py-1 rounded">
                              {r.optionInfo.optionSymbol}
                            </span>
                            {r.optionInfo.expiry && (
                              <span className="text-[10px] text-slate-400">expiry {r.optionInfo.expiry}</span>
                            )}
                          </div>
                          <div className="grid grid-cols-4 gap-2 text-center text-xs">
                            {r.optionInfo.strike !== undefined && (
                              <div><p className="text-slate-500">Strike</p><p className="text-white font-bold">{r.optionInfo.strike}</p></div>
                            )}
                            {r.optionInfo.premium !== undefined && (
                              <div><p className="text-slate-500">Premium</p><p className="text-amber-300 font-bold">₹{r.optionInfo.premium}</p></div>
                            )}
                            {r.optionInfo.quantity !== undefined && (
                              <div>
                                <p className="text-slate-500">Quantity</p>
                                <p className="text-white font-bold">
                                  {r.optionInfo.quantity}
                                  <span className="text-[10px] text-slate-500 ml-1">({r.optionInfo.lots}×{r.optionInfo.lotSize})</span>
                                </p>
                              </div>
                            )}
                            {r.optionInfo.capitalRequired !== undefined && (
                              <div><p className="text-slate-500">Capital</p><p className="text-cyan-300 font-bold">₹{r.optionInfo.capitalRequired}</p></div>
                            )}
                          </div>
                          {(r.optionInfo.bid !== undefined || r.optionInfo.ask !== undefined) && (
                            <div className="mt-2 flex gap-3 text-[11px] text-slate-400">
                              {r.optionInfo.bid !== undefined && <span>Bid: <b className="text-slate-300">₹{r.optionInfo.bid}</b></span>}
                              {r.optionInfo.ask !== undefined && <span>Ask: <b className="text-slate-300">₹{r.optionInfo.ask}</b></span>}
                            </div>
                          )}
                          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                            {r.optionInfo.projectedRisk !== undefined && (
                              <span>Projected Risk: <b className="text-red-400">₹{r.optionInfo.projectedRisk}</b></span>
                            )}
                            {r.optionInfo.projectedReward !== undefined && (
                              <span>Projected Reward: <b className="text-green-400">₹{r.optionInfo.projectedReward}</b></span>
                            )}
                          </div>
                          {!r.optionInfo.premium && (
                            <p className="mt-2 text-[11px] text-orange-400">
                              ⚠️ Premium fetch returned 0 — symbol may not be subscribed/active. Capital/Risk in ₹ unavailable.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* AI Result */}
                  {r.aiEnabled && aiR && (
                    <div className={`rounded-lg p-3 border text-xs ${aiR.decision === 'CONFIRM' ? 'bg-violet-900/20 border-violet-600/30' : 'bg-orange-900/20 border-orange-600/30'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-slate-300 font-semibold">🤖 AI Confirmation</p>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded font-bold ${aiR.decision === 'CONFIRM' ? 'bg-green-700/50 text-green-300' : 'bg-red-700/50 text-red-300'}`}>
                            {aiR.decision}
                          </span>
                          <span className="text-slate-400">{((aiR.confidence || 0)).toFixed(0)}% conf</span>
                        </div>
                      </div>
                      {aiR.reasoning && <p className="text-slate-400 leading-relaxed">{aiR.reasoning}</p>}
                      {aiR.suggested_sl && (
                        <div className="mt-2 flex gap-3 text-slate-400">
                          <span>AI SL: <b className="text-red-400">₹{aiR.suggested_sl}</b></span>
                          <span>AI TP: <b className="text-green-400">₹{aiR.suggested_tp}</b></span>
                          {r.followAiSlTp
                            ? <span className="text-violet-400">✓ SL/TP overridden to {r.slPoints}/{r.tpPoints} pts</span>
                            : <span className="text-slate-500">SL/TP not overridden (Follow AI SL/TP off)</span>}
                        </div>
                      )}
                      {aiR.watch_level && <p className="mt-1 text-slate-500">Watch level: ₹{aiR.watch_level}</p>}
                    </div>
                  )}
                  {r.aiEnabled && !aiR && <p className="text-xs text-slate-500">AI confirmation returned no data.</p>}
                  {!r.aiEnabled && <p className="text-xs text-slate-500 text-center">AI Risk Filter not enabled for this strategy.</p>}

                  {/* Indicators */}
                  <div className="bg-slate-800 rounded-lg p-3">
                    <p className="text-xs text-slate-400 font-semibold mb-2">Indicators ({r.candleCount} × {r.resolution}m candles)</p>
                    <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs text-slate-300">
                      {Object.entries(r.indicators).filter(([, v]) => v !== 0).map(([k, v]) => (
                        <div key={k} className="flex justify-between">
                          <span className="text-slate-500 uppercase text-[10px]">{k}</span>
                          <span>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
