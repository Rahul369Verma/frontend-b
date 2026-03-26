import React, { useState, useEffect } from 'react';
import { FaRobot, FaBrain, FaChartLine, FaPlay, FaSync, FaExclamationTriangle } from 'react-icons/fa';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const API_URL = `${API_BASE}/api/ai`;

import { INSTRUMENT_CONFIG } from '../constants';
const AiManager = () => {
    const [status, setStatus] = useState({ status: 'loading', model_trained: false });
    const [loadingStatus, setLoadingStatus] = useState(false);
    const [rlStatus, setRlStatus] = useState({ status: 'idle', logs: '' });
    const [activeTab, setActiveTab] = useState('static'); // 'static' or 'rl'

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

    // RL Training
    const [rlTrainConfig, setRlTrainConfig] = useState({
        symbol: 'NSE:NIFTYBANK-INDEX',
        timesteps: 100000,
        start_date: '2024-01-01',
        end_date: '2024-02-01',
        dataSource: 'AUTO',
        resolution: '1',
        customName: '',
        broker: 'angel_one'
    });
    const [rlTraining, setRlTraining] = useState(false);
    const [rlModelExists, setRlModelExists] = useState(false);
    const [availableRlModels, setAvailableRlModels] = useState([]);
    const [uploadFile, setUploadFile] = useState(null);
    const [uploadingModel, setUploadingModel] = useState(false);

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
        // Use static instruments for Dropdown
        setInstrumentConfig(INSTRUMENT_CONFIG);
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

    const fetchRlStatus = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/rl/status`);
            if (res.ok) {
                const data = await res.json();
                setRlStatus(data);
                if (data.status === 'running' || data.status === 'training') {
                    setRlTraining(true);
                } else {
                    setRlTraining(false);
                }
            }
        } catch (err) {
            console.error(err);
        }
    };

    useEffect(() => {
        let interval;
        if (activeTab === 'rl' && rlTraining) {
            interval = setInterval(fetchRlStatus, 2000);
        }
        return () => clearInterval(interval);
    }, [activeTab, rlTraining]);

    const checkRlModel = async (symbol) => {
        if (!symbol) return;
        try {
            const res = await fetch(`${API_BASE}/api/rl/check_model/${encodeURIComponent(symbol)}`);
            if (res.ok) {
                const data = await res.json();
                setRlModelExists(data.isTrained);
            }
        } catch (err) {
            console.error("Failed to check RL model", err);
        }
    };

    const fetchRlModels = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/rl/models/info`);
            if (res.ok) {
                const data = await res.json();
                setAvailableRlModels(data);
            }
        } catch (err) {
            console.error("Failed to fetch RL models registry", err);
        }
    };

    useEffect(() => {
        if (activeTab === 'rl') {
            checkRlModel(rlTrainConfig.symbol);
            fetchRlModels();
        }
    }, [activeTab, rlTrainConfig.symbol]);

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

    const handleRlTrain = async () => {
        setRlTraining(true);
        try {
            const res = await fetch(`${API_BASE}/api/rl/train`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: rlTrainConfig.symbol,
                    timesteps: rlTrainConfig.timesteps,
                    start_date: rlTrainConfig.start_date,
                    end_date: rlTrainConfig.end_date,
                    dataSource: rlTrainConfig.dataSource,
                    resolution: rlTrainConfig.resolution,
                    customName: rlTrainConfig.customName,
                    broker: rlTrainConfig.broker
                })
            });
            const data = await res.json();
            if (res.ok) {
                fetchRlStatus();
            } else {
                alert("RL Training Error: " + (data.error || data.detail));
                setRlTraining(false);
            }
        } catch (err) {
            alert("RL Training Failed: " + err.message);
            setRlTraining(false);
        }
    };

    const handleStopRlTrain = async () => {
        if (!window.confirm("Are you sure you want to stop training? The model trained so far will be saved.")) return;
        try {
            const res = await fetch(`${API_BASE}/api/rl/stop-training`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    symbol: rlTrainConfig.symbol,
                    customName: rlTrainConfig.customName
                })
            });
            const data = await res.json();
            if (res.ok) {
                alert("Stop signal sent! Please wait a moment for the process to exit cleanly.");
            } else {
                alert("Failed to stop: " + (data.error || "Unknown Error"));
            }
        } catch (err) {
            alert("Failed to stop training: " + err.message);
        }
    };

    const handleUploadModel = async () => {
        if (!uploadFile) return alert("Please select a .zip file");
        setUploadingModel(true);
        const formData = new FormData();
        formData.append('model_file', uploadFile);
        formData.append('symbol', rlTrainConfig.symbol || 'UNKNOWN');

        try {
            const res = await fetch(`${API_BASE}/api/rl/upload`, {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (res.ok) {
                alert("Model uploaded successfully!");
                setUploadFile(null);
                fetchRlModels(); // Refresh the list
            } else {
                alert("Upload failed: " + (data.error || "Unknown error"));
            }
        } catch (err) {
             alert("Upload failed: " + err.message);
        } finally {
             setUploadingModel(false);
        }
    };

    const handleDeleteModel = async (filename) => {
         if (!window.confirm(`Are you sure you want to delete ${filename}?`)) return;
         try {
             // Derive zip filename if metadata was passed
             const zipFilename = filename.endsWith('_metadata.json') ? filename.replace('_metadata.json', '.zip') : filename;
             const res = await fetch(`${API_BASE}/api/rl/models/${zipFilename}`, { method: 'DELETE' });
             if (res.ok) {
                 fetchRlModels();
             } else {
                 const data = await res.json();
                 alert("Delete failed: " + data.error);
             }
         } catch(err) {
             console.error(err);
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

    // Helper to parse training progress from logs
    const parseProgress = (logs) => {
        if (!logs) return null;
        const matches = [...logs.matchAll(/\[Progress\] (.*?) \((.*?)%\) \| Speed: (.*?) steps\/s \| ETA: (.*)/g)];
        if (matches.length > 0) {
            const lastMatch = matches[matches.length - 1];
            return {
                text: lastMatch[1],
                percent: parseFloat(lastMatch[2]),
                speed: lastMatch[3],
                eta: lastMatch[4]
            };
        }
        return null;
    };

    const progressData = parseProgress(rlStatus.logs);

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
                            <span className={`w-2 h-2 rounded-full ${(activeTab === 'rl' ? rlModelExists : status.model_trained) ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                            Since: {activeTab === 'rl' ? (rlModelExists ? 'RL Model Available' : 'No RL Model Saved') : (status.model_trained ? 'Model Active' : 'No Model Loaded')}
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
                        <div className="flex border-b border-slate-700 mb-6">
                            <button
                                className={`pb-2 px-4 font-semibold text-sm transition-colors ${activeTab === 'static' ? 'border-b-2 border-purple-500 text-purple-400' : 'text-slate-400 hover:text-slate-200'}`}
                                onClick={() => setActiveTab('static')}
                            >
                                <FaBrain className="inline mr-2" /> Static Model
                            </button>
                            <button
                                className={`pb-2 px-4 font-semibold text-sm transition-colors ${activeTab === 'rl' ? 'border-b-2 border-indigo-500 text-indigo-400' : 'text-slate-400 hover:text-slate-200'}`}
                                onClick={() => { setActiveTab('rl'); fetchRlStatus(); }}
                            >
                                <FaRobot className="inline mr-2" /> RL Agent
                            </button>
                        </div>
                        
                        {activeTab === 'static' ? (
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
                        ) : (
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-2">
                                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold">Symbol</label>
                                        <select 
                                            value={rlTrainConfig.symbol}
                                            onChange={(e) => setRlTrainConfig({...rlTrainConfig, symbol: e.target.value})}
                                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none"
                                        >
                                            <option value="" disabled>-- Select Symbol --</option>
                                            {/* Assuming instrumentConfig is loaded */}
                                            {Object.keys(instrumentConfig).length > 0 && Object.entries(instrumentConfig)
                                                .filter(([k]) => !k.includes('-EQ') && !k.startsWith('MCX:'))
                                                .map(([key, config]) => (
                                                    <option key={key} value={key}>{config.underlying || key}</option>
                                                ))}
                                        </select>
                                    </div>
                                    <div className="col-span-2">
                                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold">Timesteps</label>
                                        <input 
                                            type="number" 
                                            value={rlTrainConfig.timesteps}
                                            onChange={(e) => setRlTrainConfig({...rlTrainConfig, timesteps: parseInt(e.target.value)})}
                                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" 
                                        />
                                        <p className="text-xs text-slate-500 mt-1">Recommended: 100,000+ for stable learning.</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold">Start Date</label>
                                        <input 
                                            type="date" 
                                            value={rlTrainConfig.start_date}
                                            onChange={(e) => setRlTrainConfig({...rlTrainConfig, start_date: e.target.value})}
                                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" 
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold">End Date</label>
                                        <input 
                                            type="date" 
                                            value={rlTrainConfig.end_date}
                                            onChange={(e) => setRlTrainConfig({...rlTrainConfig, end_date: e.target.value})}
                                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" 
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-4 mb-4">
                                    <div>
                                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold block mb-1">Broker</label>
                                        <select 
                                            value={rlTrainConfig.broker} 
                                            onChange={(e) => setRlTrainConfig({...rlTrainConfig, broker: e.target.value})}
                                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm focus:border-indigo-500 outline-none"
                                        >
                                            <option value="angel_one">Angel One</option>
                                            <option value="fyers">Fyers</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold block mb-1">Data Source</label>
                                        <select 
                                            value={rlTrainConfig.dataSource} 
                                            onChange={(e) => setRlTrainConfig({...rlTrainConfig, dataSource: e.target.value})}
                                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm focus:border-indigo-500 outline-none"
                                        >
                                            <option value="AUTO">AUTO (Futures if recent, else Spot)</option>
                                            <option value="SPOT">SPOT (Index Price)</option>
                                            <option value="FUTURES">FUTURES (Active Contract Series)</option>
                                            <option value="ARCHIVE">ARCHIVE (Local CSV Offline)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold block mb-1">Timeframe (Res)</label>
                                        <select 
                                            value={rlTrainConfig.resolution} 
                                            onChange={(e) => setRlTrainConfig({...rlTrainConfig, resolution: e.target.value})}
                                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm focus:border-indigo-500 outline-none"
                                        >
                                            <option value="1">1 Minute</option>
                                            <option value="3">3 Minutes</option>
                                            <option value="5">5 Minutes</option>
                                            <option value="15">15 Minutes</option>
                                            <option value="60">1 Hour</option>
                                            <option value="D">1 Day</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="mb-4">
                                    <label className="text-xs text-slate-400 uppercase tracking-wider font-bold block mb-1">Custom Model Name</label>
                                    <input 
                                        type="text" 
                                        placeholder="e.g. SCALPER_BOT_V2 (Optional)"
                                        value={rlTrainConfig.customName}
                                        onChange={(e) => setRlTrainConfig({...rlTrainConfig, customName: e.target.value})}
                                        className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm focus:border-indigo-500 outline-none placeholder-slate-600" 
                                    />
                                    <p className="text-[10px] text-slate-500 mt-1">Leave blank to auto-generate based on symbol.</p>
                                </div>

                                <div className="flex gap-2">
                                    <button 
                                        onClick={handleRlTrain} 
                                        disabled={rlTraining || rlStatus.status === 'running'}
                                        className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:cursor-not-allowed py-3 rounded-lg font-bold transition-all flex justify-center items-center gap-2"
                                    >
                                        {(rlTraining || rlStatus.status === 'running') ? <FaSync className="animate-spin" /> : <FaRobot />}
                                        {(rlTraining || rlStatus.status === 'running') ? 'Training RL Agent...' : 'Train RL Agent'}
                                    </button>
                                    
                                    {(rlTraining || rlStatus.status === 'running') && (
                                        <button 
                                            onClick={handleStopRlTrain}
                                            className="bg-rose-600 hover:bg-rose-500 px-6 py-3 rounded-lg font-bold transition-colors shadow-lg shadow-rose-900/20 whitespace-nowrap"
                                            title="Stop early and save model"
                                        >
                                            Stop Training
                                        </button>
                                    )}
                                </div>

                                <div className="mt-4">
                                    <label className="text-xs text-slate-400 uppercase tracking-wider font-bold mb-1 block">Live Logs</label>
                                    
                                    {progressData && (rlTraining || rlStatus.status === 'running') && (
                                        <div className="mb-2 p-3 bg-slate-950 rounded border border-indigo-500/30">
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="text-indigo-300 font-bold">{progressData.text} Steps</span>
                                                <span className="text-emerald-400 font-mono">{progressData.speed} steps/s</span>
                                                <span className="text-amber-400 font-mono">ETA: {progressData.eta}</span>
                                            </div>
                                            <div className="w-full bg-slate-800 rounded-full h-2.5">
                                                <div className="bg-indigo-500 h-2.5 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, progressData.percent)}%` }}></div>
                                            </div>
                                            <div className="text-right text-[10px] text-slate-500 mt-1">{Math.min(100, progressData.percent).toFixed(1)}% Complete</div>
                                        </div>
                                    )}

                                    <div className="h-48 bg-black rounded p-2 overflow-y-auto text-xs font-mono text-slate-300 resize-y border border-slate-700 whitespace-pre-wrap flex flex-col-reverse">
                                        {rlStatus.logs || 'Ready to start training...'}
                                    </div>
                                </div>

                                {/* Available Models Registry Table */}
                                <div className="mt-6 border-t border-slate-700 pt-6">
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                                            <FaBrain className="text-indigo-400" /> Available RL Models
                                        </h3>
                                        <div className="flex gap-2 items-center">
                                            <input 
                                                type="file" 
                                                accept=".zip" 
                                                onChange={(e) => setUploadFile(e.target.files[0])} 
                                                className="text-xs text-slate-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                                            />
                                            <button 
                                                onClick={handleUploadModel}
                                                disabled={!uploadFile || uploadingModel}
                                                className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-xs px-3 py-1.5 rounded transition-colors"
                                            >
                                                {uploadingModel ? 'Uploading...' : 'Upload'}
                                            </button>
                                        </div>
                                    </div>
                                    
                                    {availableRlModels.length === 0 ? (
                                        <div className="text-center py-6 bg-slate-800/50 rounded-lg border border-slate-700/50">
                                            <p className="text-sm text-slate-400">No trained PPO models found in registry.</p>
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto rounded-lg border border-slate-700">
                                            <table className="w-full text-left text-xs whitespace-nowrap">
                                                <thead className="bg-slate-800 text-slate-400 uppercase tracking-wider">
                                                    <tr>
                                                        <th className="px-4 py-3 font-semibold">Symbol / Name</th>
                                                        <th className="px-4 py-3 font-semibold">Data Range</th>
                                                        <th className="px-4 py-3 font-semibold">Action Bias</th>
                                                        <th className="px-4 py-3 font-semibold text-right">Size/Action</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-700/50 bg-slate-900/50">
                                                    {availableRlModels.map((model, idx) => (
                                                        <tr key={idx} className="hover:bg-slate-800/50 transition-colors">
                                                            <td className="px-4 py-3">
                                                                <div className="font-bold text-indigo-300 flex items-center gap-2">
                                                                    {model.model_name ? `${model.model_name} (${model.symbol})` : model.symbol}
                                                                </div>
                                                                <div className="text-slate-500 mt-1 flex gap-2">
                                                                    <span>{new Date(model.timestamp || model.trained_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                                                    <span>•</span>
                                                                    <span>{model.timesteps?.toLocaleString() || 0} steps</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 text-slate-300">
                                                                <div>{model.data_length ? `${model.data_length.toLocaleString()} candles` : (model.description || 'N/A')}</div>
                                                                <div className="text-slate-500 mt-1">
                                                                    {model.start_date && model.start_date !== 'N/A' ? `${model.start_date} → ${model.end_date}` : 'Custom / Uploaded'}
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                {model.action_distribution ? (
                                                                    <div className="flex flex-col gap-1">
                                                                        <div className="flex items-center gap-1.5 text-[10px] font-medium">
                                                                            <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                                                                            <span className="text-slate-300 w-8">Hold</span>
                                                                            <span className="text-slate-400">{model.action_distribution.Hold}%</span>
                                                                        </div>
                                                                        <div className="flex items-center gap-1.5 text-[10px] font-medium">
                                                                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                                                            <span className="text-slate-300 w-8">Buy</span>
                                                                            <span className="text-emerald-400">{model.action_distribution.Buy}%</span>
                                                                        </div>
                                                                        <div className="flex items-center gap-1.5 text-[10px] font-medium">
                                                                            <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                                                                            <span className="text-slate-300 w-8">Sell</span>
                                                                            <span className="text-rose-400">{model.action_distribution.Sell}%</span>
                                                                        </div>
                                                                        {model.action_distribution.Exit_Long !== undefined && (
                                                                            <div className="flex items-center gap-1.5 text-[10px] font-medium">
                                                                                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                                                                                <span className="text-slate-300 w-10">ExitL</span>
                                                                                <span className="text-amber-400">{model.action_distribution.Exit_Long}%</span>
                                                                            </div>
                                                                        )}
                                                                        {model.action_distribution.Exit_Short !== undefined && (
                                                                            <div className="flex items-center gap-1.5 text-[10px] font-medium">
                                                                                <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                                                                                <span className="text-slate-300 w-10">ExitS</span>
                                                                                <span className="text-orange-400">{model.action_distribution.Exit_Short}%</span>
                                                                            </div>
                                                                        )}
                                                                        {model.action_distribution.Exit !== undefined && model.action_distribution.Exit_Long === undefined && (
                                                                            <div className="flex items-center gap-1.5 text-[10px] font-medium">
                                                                                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                                                                                <span className="text-slate-300 w-8">Exit</span>
                                                                                <span className="text-amber-400">{model.action_distribution.Exit}%</span>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <span className="text-slate-500 italic">No Data</span>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-3 text-right text-slate-400 font-mono flex flex-col items-end gap-2">
                                                                <span>{model.file_size_kb ? `${model.file_size_kb} KB` : '...'}</span>
                                                                <button 
                                                                    onClick={() => handleDeleteModel(model.model_file || `${model.symbol}_ppo_final.zip`)} 
                                                                    className="text-xs text-rose-500 hover:text-rose-400 transition-colors"
                                                                >
                                                                    Delete
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'static' && trainMetrics && (
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
