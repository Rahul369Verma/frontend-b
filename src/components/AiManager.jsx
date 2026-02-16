import React, { useState, useEffect } from 'react';
import { FaRobot, FaBrain, FaChartLine, FaPlay, FaSync, FaExclamationTriangle } from 'react-icons/fa';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const API_URL = `${API_BASE}/api/ai`;

const AiManager = () => {
    // Status
    const [status, setStatus] = useState({ status: 'loading', model_trained: false });
    const [loadingStatus, setLoadingStatus] = useState(false);

    // Training
    const [trainConfig, setTrainConfig] = useState({
        symbol: 'NSE:NIFTYBANK-INDEX',
        start_date: '2024-01-01',
        end_date: '2024-02-01',
        epochs: 50,
        lookback: 10
    });
    const [training, setTraining] = useState(false);
    const [trainMetrics, setTrainMetrics] = useState(null);

    // Backtest
    const [backtestConfig, setBacktestConfig] = useState({
        strategy: 'ai_adaptive', // Default to Adaptive
        symbol: 'NSE:NIFTYBANK-INDEX',
        start_date: '2024-02-01',
        end_date: '2024-02-10',
        capital: 100000,
        params: {
            confidence_threshold: 0.6,
            use_adaptive_risk: true
        }
    });
    const [backtesting, setBacktesting] = useState(false);
    const [backtestResult, setBacktestResult] = useState(null);

    // State for Instrument Config
    const [instrumentConfig, setInstrumentConfig] = useState({});
    
    useEffect(() => {
        fetchStatus();
        // Fetch Instruments for Dropdown
        const fetchInstruments = async () => {
            try {
                const res = await fetch(`${API_BASE}/api/config/instruments`);
                if (res.ok) {
                    const data = await res.json();
                    setInstrumentConfig(data);
                }
            } catch (err) {
                console.error("Failed to fetch instruments", err);
            }
        };
        fetchInstruments();
    }, []);

    const fetchStatus = async () => {
        setLoadingStatus(true);
        try {
            const res = await fetch(`${API_URL}/status`);
            if (res.status === 503 || res.status === 500) {
                 throw new Error("AI Service Unavailable (Is api_server.py running?)");
            }
            const data = await res.json();
            setStatus(data);
        } catch (err) {
            console.error(err);
            setStatus({ status: 'offline', error: err.message });
        } finally {
            setLoadingStatus(false);
        }
    };

    const handleTrain = async () => {
        setTraining(true);
        setTrainMetrics(null);
        try {
            const res = await fetch(`${API_URL}/train`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: trainConfig.symbol,
                    lookback: trainConfig.lookback,
                    epochs: trainConfig.epochs,
                    startDate: trainConfig.start_date,
                    endDate: trainConfig.end_date
                })
            });
            const data = await res.json();
            if (res.ok) {
                setTrainMetrics(data.metrics);
                fetchStatus();
            } else {
                alert("Training Error: " + (data.error || data.detail));
            }
        } catch (err) {
            alert("Training Failed: " + err.message);
        } finally {
            setTraining(false);
        }
    };

    const handleBacktest = async () => {
        setBacktesting(true);
        setBacktestResult(null);
        try {
            // Prepare Params
            const payload = {
                strategy: backtestConfig.strategy,
                symbol: backtestConfig.symbol,
                startDate: backtestConfig.start_date,
                endDate: backtestConfig.end_date,
                capital: backtestConfig.capital,
                params: {
                    ...backtestConfig.params,
                    use_ai_prediction: true // Force enable AI if not implied
                }
            };

            const res = await fetch(`${API_URL}/backtest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (res.ok) {
                setBacktestResult(data);
            } else {
                alert("Backtest Error: " + (data.error || data.detail));
            }
        } catch (err) {
            alert("Backtest Failed: " + err.message);
        } finally {
            setBacktesting(false);
        }
    };

    return (
        <div className="p-6 bg-slate-900 min-h-screen text-slate-100 font-sans">
            {/* Header */}
            <div className="flex justify-between items-center mb-8">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
                        <FaRobot className="w-8 h-8 text-indigo-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-white">AI Strategy Manager</h1>
                        <div className="flex items-center gap-2 text-sm text-slate-400">
                            <span className={`w-2 h-2 rounded-full ${status.status === 'ready' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                            Since: {status.model_trained ? 'Model Active' : 'No Model Loaded'}
                        </div>
                    </div>
                </div>
                <button onClick={fetchStatus} className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
                    <FaSync className={`w-5 h-5 text-slate-400 ${loadingStatus ? 'animate-spin' : ''}`} />
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Left Col: Training */}
                <div className="space-y-6">
                    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                            <FaBrain className="text-purple-400" /> Model Training
                        </h2>
                        
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-slate-400 uppercase tracking-wider font-bold">Symbol</label>
                                    <select 
                                        value={trainConfig.symbol}
                                        onChange={(e) => setTrainConfig({...trainConfig, symbol: e.target.value})}
                                        className="w-full bg-slate-900 border border-slate-700 rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none"
                                    >
                                        <option value="" disabled>-- Select Symbol --</option>
                                        {Object.keys(instrumentConfig).length === 0 && <option>Loading instruments...</option>}
                                        
                                        <optgroup label="Indices">
                                            {Object.entries(instrumentConfig)
                                                .filter(([k]) => !k.includes('-EQ') && !k.startsWith('MCX:'))
                                                .map(([key, config]) => (
                                                    <option key={key} value={key}>{config.underlying || key}</option>
                                                ))}
                                        </optgroup>

                                        <optgroup label="Stocks">
                                            {Object.entries(instrumentConfig)
                                                .filter(([k]) => k.includes('-EQ'))
                                                .map(([key, config]) => (
                                                    <option key={key} value={key}>{config.underlying || key}</option>
                                                ))}
                                        </optgroup>
                                        
                                         <optgroup label="Commodities (MCX)">
                                            {Object.entries(instrumentConfig)
                                                .filter(([k]) => k.startsWith('MCX:'))
                                                .map(([key, config]) => (
                                                    <option key={key} value={key}>{config.underlying || key}</option>
                                                ))}
                                        </optgroup>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs text-slate-400 uppercase tracking-wider font-bold">Epochs</label>
                                    <input 
                                        type="number" 
                                        value={trainConfig.epochs}
                                        onChange={(e) => setTrainConfig({...trainConfig, epochs: parseInt(e.target.value)})}
                                        className="w-full bg-slate-900 border border-slate-700 rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" 
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-slate-400 uppercase tracking-wider font-bold">Start Date</label>
                                    <input 
                                        type="date" 
                                        value={trainConfig.start_date}
                                        onChange={(e) => setTrainConfig({...trainConfig, start_date: e.target.value})}
                                        className="w-full bg-slate-900 border border-slate-700 rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" 
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-400 uppercase tracking-wider font-bold">End Date</label>
                                    <input 
                                        type="date" 
                                        value={trainConfig.end_date}
                                        onChange={(e) => setTrainConfig({...trainConfig, end_date: e.target.value})}
                                        className="w-full bg-slate-900 border border-slate-700 rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" 
                                    />
                                </div>
                            </div>

                            <button 
                                onClick={handleTrain} 
                                disabled={training}
                                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:cursor-not-allowed py-3 rounded-lg font-bold transition-all flex justify-center items-center gap-2"
                            >
                                {training ? <FaSync className="animate-spin" /> : <FaBrain />}
                                {training ? 'Training Model...' : 'Train Model'}
                            </button>
                        </div>

                        {trainMetrics && (
                            <div className="mt-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                                <h3 className="text-emerald-400 font-bold mb-2">Training Results</h3>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-slate-400">Accuracy:</span>
                                        <span className="text-white font-mono">{(trainMetrics.val_accuracy * 100).toFixed(1)}%</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-400">F1 Score:</span>
                                        <span className="text-white font-mono">{(trainMetrics.val_f1 * 100).toFixed(1)}%</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-400">Iterations:</span>
                                        <span className="text-white font-mono">{trainMetrics.iterations}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-400">Loss:</span>
                                        <span className="text-white font-mono">{trainMetrics.loss?.toFixed(4)}</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Col: Backtest */}
                <div className="space-y-6">
                    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                             <FaChartLine className="text-emerald-400" /> AI Backtest
                        </h2>

                        <div className="space-y-4">
                             {/* Strategy Selection */}
                             <div className="grid grid-cols-2 gap-4">
                                <label className={`cursor-pointer p-3 rounded border transition-all ${backtestConfig.strategy === 'ai_adaptive' ? 'bg-indigo-500/20 border-indigo-500' : 'bg-slate-900 border-slate-700'}`}>
                                    <input 
                                        type="radio" 
                                        name="strategy" 
                                        className="hidden" 
                                        checked={backtestConfig.strategy === 'ai_adaptive'} 
                                        onChange={() => setBacktestConfig(c => ({...c, strategy: 'ai_adaptive'}))} 
                                    />
                                    <div className="font-bold text-sm">Adaptive Risk</div>
                                    <div className="text-xs text-slate-400 mt-1">Dynamic TP/SL based on confidence</div>
                                </label>
                                <label className={`cursor-pointer p-3 rounded border transition-all ${backtestConfig.strategy === 'ai_prediction' ? 'bg-indigo-500/20 border-indigo-500' : 'bg-slate-900 border-slate-700'}`}>
                                    <input 
                                        type="radio" 
                                        name="strategy" 
                                        className="hidden" 
                                        checked={backtestConfig.strategy === 'ai_prediction'} 
                                        onChange={() => setBacktestConfig(c => ({...c, strategy: 'ai_prediction'}))} 
                                    />
                                    <div className="font-bold text-sm">Standard AI</div>
                                    <div className="text-xs text-slate-400 mt-1">Fixed Risk with AI Filtering</div>
                                </label>
                             </div>

                             {/* Params */}
                             <div className="p-4 bg-slate-900 rounded-lg space-y-3">
                                <div className="flex justify-between items-center">
                                    <label className="text-sm text-slate-300">Confidence Threshold</label>
                                    <span className="text-indigo-400 font-mono font-bold">{backtestConfig.params.confidence_threshold}</span>
                                </div>
                                <input 
                                    type="range" 
                                    min="0.5" max="0.9" step="0.05"
                                    value={backtestConfig.params.confidence_threshold}
                                    onChange={(e) => setBacktestConfig(c => ({
                                        ...c, 
                                        params: { ...c.params, confidence_threshold: parseFloat(e.target.value) }
                                    }))}
                                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                />

                                {backtestConfig.strategy === 'ai_adaptive' && (
                                    <div className="flex items-center gap-2 mt-2">
                                        <input 
                                            type="checkbox" 
                                            checked={backtestConfig.params.use_adaptive_risk}
                                            onChange={(e) => setBacktestConfig(c => ({
                                                ...c,
                                                params: { ...c.params, use_adaptive_risk: e.target.checked }
                                            }))}
                                            className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500"
                                        />
                                        <label className="text-sm text-slate-300">Enable Dynamic TP/SL Scaling</label>
                                    </div>
                                )}
                             </div>

                             <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-slate-400 uppercase tracking-wider font-bold">Start Date</label>
                                    <input 
                                        type="date" 
                                        value={backtestConfig.start_date}
                                        onChange={(e) => setBacktestConfig({...backtestConfig, start_date: e.target.value})}
                                        className="w-full bg-slate-900 border border-slate-700 rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" 
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-400 uppercase tracking-wider font-bold">End Date</label>
                                    <input 
                                        type="date" 
                                        value={backtestConfig.end_date}
                                        onChange={(e) => setBacktestConfig({...backtestConfig, end_date: e.target.value})}
                                        className="w-full bg-slate-900 border border-slate-700 rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" 
                                    />
                                </div>
                            </div>
                            
                            <button 
                                onClick={handleBacktest} 
                                disabled={backtesting || !status.model_trained}
                                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:cursor-not-allowed py-3 rounded-lg font-bold transition-all flex justify-center items-center gap-2"
                            >
                                {backtesting ? <FaSync className="animate-spin" /> : <FaPlay />}
                                {backtesting ? 'Running Backtest...' : 'Run Backtest'}
                            </button>
                            
                            {!status.model_trained && (
                                <div className="flex items-center gap-2 text-rose-400 text-xs justify-center">
                                    <FaExclamationTriangle /> Model must be trained first
                                </div>
                            )}

                        </div>
                    </div>
                </div>
            </div>

            {/* Backtest Results */}
            {backtestResult && (
                <div className="mt-8 bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                     <h2 className="text-xl font-bold mb-6">Backtest Performance</h2>
                     
                     <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                        <ResultCard label="Total Return" value={`₹${backtestResult.total_pnl?.toFixed(2)}`} color={backtestResult.total_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'} />
                        <ResultCard label="Win Rate" value={`${(backtestResult.win_rate * 100).toFixed(1)}%`} color="text-blue-400" />
                        <ResultCard label="Trades" value={backtestResult.total_trades} color="text-white" />
                        <ResultCard label="Drawdown" value={`₹${backtestResult.max_drawdown?.toFixed(2)}`} color="text-rose-400" />
                     </div>

                     {/* Chart */}
                     <div className="h-64 w-full bg-slate-900 rounded-lg p-4 mb-6">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={backtestResult.equity_curve}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                <XAxis dataKey="timestamp" hide />
                                <YAxis stroke="#94a3b8" />
                                <Tooltip 
                                    contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }}
                                    itemStyle={{ color: '#e2e8f0' }}
                                />
                                <Line type="monotone" dataKey="equity" stroke="#6366f1" strokeWidth={2} dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                     </div>
                </div>
            )}
        </div>
    );
};

const ResultCard = ({ label, value, color }) => (
    <div className="bg-slate-900 p-4 rounded-lg border border-slate-700">
        <div className="text-slate-500 text-xs uppercase tracking-wider font-bold mb-1">{label}</div>
        <div className={`text-2xl font-mono font-bold ${color}`}>{value}</div>
    </div>
);

export default AiManager;
