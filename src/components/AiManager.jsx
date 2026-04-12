import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FaRobot, FaBrain, FaChartLine, FaPlay, FaSync, FaExclamationTriangle, FaStop, FaChevronDown, FaChevronUp, FaPlus } from 'react-icons/fa';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const API_URL  = `${API_BASE}/api/ai`;

import { INSTRUMENT_CONFIG } from '../constants';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse the last [Progress] line from a log string into { percent, speed, eta, text } */
function parseProgress(logs) {
    if (!logs) return null;
    const matches = [...logs.matchAll(/\[Progress\] (.*?) \((.*?)%\) \| Speed: (.*?) steps\/s \| ETA: (.*)/g)];
    if (!matches.length) return null;
    const m = matches[matches.length - 1];
    return { text: m[1], percent: parseFloat(m[2]), speed: m[3], eta: m[4] };
}

function isActive(status) {
    return status === 'training' || status === 'running';
}

function statusBadge(status) {
    const map = {
        training:  'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
        running:   'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
        completed: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        failed:    'bg-rose-500/20 text-rose-300 border-rose-500/40',
        idle:      'bg-slate-500/20 text-slate-400 border-slate-500/40',
    };
    return map[status] || map.idle;
}

// ── Job Card ─────────────────────────────────────────────────────────────────
function JobCard({ job, onStop, expanded, onToggleExpand }) {
    const progress  = parseProgress(job.logs);
    const active    = isActive(job.status);
    const logEndRef = useRef(null);

    useEffect(() => {
        if (expanded && logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [job.logs, expanded]);

    return (
        <div className={`border rounded-xl overflow-hidden transition-all ${active ? 'border-indigo-500/40 bg-slate-900/80' : 'border-slate-700 bg-slate-900/40'}`}>
            {/* Header row */}
            <div className="flex items-center gap-3 p-4">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${active ? 'bg-indigo-400 animate-pulse' : job.status === 'completed' ? 'bg-emerald-400' : 'bg-rose-400'}`} />

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-white truncate">{job.modelName || job.symbol}</span>
                        {job.symbol && job.modelName !== job.symbol && (
                            <span className="text-xs text-slate-500">({job.symbol})</span>
                        )}
                        {job.profile && job.profile !== 'base' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-indigo-900/60 text-indigo-300 border-indigo-700/50 font-semibold uppercase tracking-wide">
                                {job.profile}
                            </span>
                        )}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold uppercase tracking-wide ${statusBadge(job.status)}`}>
                            {job.status}
                        </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                        {job.timesteps?.toLocaleString()} steps
                        {job.startedAt && ` · Started ${new Date(job.startedAt).toLocaleTimeString()}`}
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                    {active && (
                        <button
                            onClick={() => onStop(job)}
                            title="Stop training and save model"
                            className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-500 text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors"
                        >
                            <FaStop className="w-2.5 h-2.5" /> Stop
                        </button>
                    )}
                    <button
                        onClick={onToggleExpand}
                        className="p-1.5 hover:bg-slate-700 rounded-lg transition-colors text-slate-400"
                    >
                        {expanded ? <FaChevronUp className="w-3 h-3" /> : <FaChevronDown className="w-3 h-3" />}
                    </button>
                </div>
            </div>

            {/* Progress bar (always visible when active) */}
            {progress && active && (
                <div className="px-4 pb-3">
                    <div className="flex justify-between text-[10px] mb-1">
                        <span className="text-indigo-300 font-mono">{progress.text} steps</span>
                        <span className="text-emerald-400 font-mono">{progress.speed} steps/s</span>
                        <span className="text-amber-400 font-mono">ETA: {progress.eta}</span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-1.5">
                        <div
                            className="bg-indigo-500 h-1.5 rounded-full transition-all duration-700"
                            style={{ width: `${Math.min(100, progress.percent)}%` }}
                        />
                    </div>
                    <div className="text-right text-[10px] text-slate-500 mt-0.5">
                        {Math.min(100, progress.percent).toFixed(1)}%
                    </div>
                </div>
            )}

            {/* Expandable log panel */}
            {expanded && (
                <div className="border-t border-slate-700/50 px-4 pb-4 pt-3">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-2">Logs</div>
                    <div className="h-44 bg-black rounded p-2 overflow-y-auto text-xs font-mono text-slate-300 whitespace-pre-wrap border border-slate-700">
                        {job.logs || 'No output yet...'}
                        <div ref={logEndRef} />
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Main Component ────────────────────────────────────────────────────────────
const AiManager = () => {
    const [status,        setStatus]        = useState({ status: 'loading', model_trained: false });
    const [loadingStatus, setLoadingStatus] = useState(false);
    const [activeTab,     setActiveTab]     = useState('static');

    // Static model training
    const [trainConfig,  setTrainConfig]  = useState({ symbol: 'NSE:NIFTYBANK-INDEX', start_date: '2024-01-01', end_date: '2024-02-01', epochs: 50, lookback: 10 });
    const [training,     setTraining]     = useState(false);
    const [trainMetrics, setTrainMetrics] = useState(null);

    // RL multi-job state
    const [rlTrainConfig, setRlTrainConfig] = useState({
        symbol: 'NSE:NIFTYBANK-INDEX', timesteps: 100000,
        start_date: '2024-01-01', end_date: '2024-02-01',
        dataSource: 'AUTO', resolution: '1',
        customName: '', broker: 'angel_one', baseModel: '', profile: 'base',
        intraday: true,
    });
    const [rlJobs,          setRlJobs]          = useState([]);   // all jobs (active + recent)
    const [expandedJobId,   setExpandedJobId]   = useState(null); // which job's logs are open
    const [launchingJob,    setLaunchingJob]    = useState(false); // "Launch" button loading state
    const [rlModelExists,   setRlModelExists]   = useState(false);
    const [availableRlModels, setAvailableRlModels] = useState([]);
    const [uploadFile,      setUploadFile]      = useState(null);
    const [uploadingModel,  setUploadingModel]  = useState(false);
    const [evaluatingKey,   setEvaluatingKey]   = useState(null);  // '{modelName}_final' | '{modelName}_best'
    const [evalResults,     setEvalResults]     = useState({});    // key → metrics object

    // Backtest
    const [backtestConfig, setBacktestConfig] = useState({
        strategy: 'ai_adaptive', symbol: 'NSE:NIFTYBANK-INDEX',
        start_date: '2024-02-01', end_date: '2024-02-10', capital: 100000,
        params: { confidence_threshold: 0.6, use_adaptive_risk: true }
    });
    const [backtesting,    setBacktesting]    = useState(false);
    const [backtestResult, setBacktestResult] = useState(null);

    const [instrumentConfig, setInstrumentConfig] = useState({});

    // Derived
    const hasActiveJobs = rlJobs.some(j => isActive(j.status));

    useEffect(() => {
        fetchStatus();
        setInstrumentConfig(INSTRUMENT_CONFIG);
    }, []);

    const fetchRlStatus = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/rl/status`);
            if (!res.ok) return;
            const data = await res.json();
            // Backend returns { jobs: [...] }; handle legacy { status, logs } gracefully
            if (Array.isArray(data.jobs)) {
                setRlJobs(data.jobs);
            } else if (data.status) {
                setRlJobs([{ jobId: 'legacy', symbol: rlTrainConfig.symbol, modelName: rlTrainConfig.symbol, profile: 'base', status: data.status, logs: data.logs, startedAt: null }]);
            }
        } catch (err) {
            console.error('fetchRlStatus:', err);
        }
    }, [rlTrainConfig.symbol]);

    const checkRlModel = useCallback(async (symbol) => {
        if (!symbol) return;
        try {
            const res  = await fetch(`${API_BASE}/api/rl/check_model/${encodeURIComponent(symbol)}`);
            if (res.ok) setRlModelExists((await res.json()).isTrained);
        } catch (err) {
            console.error("checkRlModel:", err);
        }
    }, []);

    const fetchRlModels = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/rl/models/info`);
            if (res.ok) setAvailableRlModels(await res.json());
        } catch (err) {
            console.error("fetchRlModels:", err);
        }
    }, []);

    // Poll job status while any job is running
    useEffect(() => {
        let interval;
        if (activeTab === 'rl' && hasActiveJobs) {
            interval = setInterval(fetchRlStatus, 2000);
        }
        return () => clearInterval(interval);
    }, [activeTab, hasActiveJobs, fetchRlStatus]);

    // Fetch one status pass on tab switch
    useEffect(() => {
        if (activeTab === 'rl') {
            fetchRlStatus();
            checkRlModel(rlTrainConfig.symbol);
            fetchRlModels();
        }
    }, [activeTab, rlTrainConfig.symbol, fetchRlStatus, checkRlModel, fetchRlModels]);

    const fetchStatus = async () => {
        setLoadingStatus(true);
        try {
            const res  = await fetch(`${API_URL}/status`);
            if (res.status === 503 || res.status === 500) throw new Error("AI Service Unavailable");
            setStatus(await res.json());
        } catch (err) {
            setStatus({ status: 'offline', error: err.message });
        } finally {
            setLoadingStatus(false);
        }
    };

    // ── Static training ───────────────────────────────────────────────────────
    const handleTrain = async () => {
        setTraining(true);
        setTrainMetrics(null);
        try {
            const res  = await fetch(`${API_URL}/train`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol: trainConfig.symbol, lookback: trainConfig.lookback, epochs: trainConfig.epochs, startDate: trainConfig.start_date, endDate: trainConfig.end_date })
            });
            const data = await res.json();
            if (res.ok) { setTrainMetrics(data.metrics); fetchStatus(); }
            else alert("Training Error: " + (data.error || data.detail));
        } catch (err) {
            alert("Training Failed: " + err.message);
        } finally {
            setTraining(false);
        }
    };

    // ── Launch a new RL training job ─────────────────────────────────────────
    const handleRlTrain = async () => {
        setLaunchingJob(true);
        try {
            const res  = await fetch(`${API_BASE}/api/rl/train`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol:     rlTrainConfig.symbol,
                    timesteps:  rlTrainConfig.timesteps,
                    start_date: rlTrainConfig.start_date,
                    end_date:   rlTrainConfig.end_date,
                    dataSource: rlTrainConfig.dataSource,
                    resolution: rlTrainConfig.resolution,
                    customName: rlTrainConfig.customName,
                    broker:     rlTrainConfig.broker,
                    baseModel:  rlTrainConfig.baseModel,
                    profile:    rlTrainConfig.profile,
                    intraday:   !!rlTrainConfig.intraday,
                })
            });
            const data = await res.json();
            if (res.ok) {
                // Immediately add a placeholder card so the user sees feedback
                const jobId     = data.job_id || `${rlTrainConfig.symbol}_${Date.now()}`;
                const modelName = (rlTrainConfig.customName && rlTrainConfig.customName.trim())
                    ? rlTrainConfig.customName.trim()
                    : rlTrainConfig.symbol.replace(/:/g, '_');
                setRlJobs(prev => [{
                    jobId, symbol: rlTrainConfig.symbol, modelName,
                    profile: rlTrainConfig.profile, timesteps: rlTrainConfig.timesteps,
                    status: 'training', startedAt: new Date().toISOString(), logs: 'Initializing...',
                }, ...prev]);
                setExpandedJobId(jobId); // auto-expand the new job
            } else {
                alert("RL Training Error: " + (data.error || data.detail));
            }
        } catch (err) {
            alert("RL Training Failed: " + err.message);
        } finally {
            setLaunchingJob(false);
        }
    };

    // ── Stop a specific job ───────────────────────────────────────────────────
    const handleStopJob = async (job) => {
        if (!window.confirm(`Stop training job "${job.modelName || job.symbol}"? The model trained so far will be saved.`)) return;
        try {
            const res  = await fetch(`${API_BASE}/api/rl/stop-training`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ job_id: job.jobId, symbol: job.symbol, customName: job.modelName })
            });
            const data = await res.json();
            if (res.ok) alert("Stop signal sent! The process will exit cleanly in a moment.");
            else        alert("Failed to stop: " + (data.error || "Unknown error"));
        } catch (err) {
            alert("Failed to stop training: " + err.message);
        }
    };

    // ── Model upload / download / delete ─────────────────────────────────────
    const handleUploadModel = async () => {
        if (!uploadFile) return alert("Please select a .zip file");
        setUploadingModel(true);
        const formData = new FormData();
        formData.append('model_file', uploadFile);
        formData.append('symbol', rlTrainConfig.symbol || 'UNKNOWN');
        try {
            const res  = await fetch(`${API_BASE}/api/rl/upload`, { method: 'POST', body: formData });
            const data = await res.json();
            if (res.ok) { alert("Model uploaded successfully!"); setUploadFile(null); fetchRlModels(); }
            else alert("Upload failed: " + (data.error || "Unknown error"));
        } catch (err) {
            alert("Upload failed: " + err.message);
        } finally {
            setUploadingModel(false);
        }
    };

    const downloadFile = (filename) => {
        const a = document.createElement('a');
        a.href = `${API_BASE}/api/rl/models/download/${encodeURIComponent(filename)}`;
        a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    };

    const handleEvaluateModel = async (model, variant) => {
        // variant: 'final' | 'best'
        const modelFile = variant === 'best' ? model.best_model : model.model_file;
        const metaFile  = model._metadata_file;
        if (!modelFile || !metaFile) return;

        const key = `${model.model_name || model.symbol}_${variant}`;
        setEvaluatingKey(key);
        try {
            const res  = await fetch(`${API_BASE}/api/rl/evaluate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_file: modelFile, metadata_file: metaFile }),
            });
            const data = await res.json();
            if (res.ok && data.metrics) {
                setEvalResults(prev => ({ ...prev, [key]: data.metrics }));
            } else {
                alert(`Evaluation failed: ${data.error || 'unknown error'}`);
            }
        } catch (err) {
            alert(`Evaluation error: ${err.message}`);
        } finally {
            setEvaluatingKey(null);
        }
    };

    const handleDeleteModel = async (filename) => {
        if (!window.confirm(`Delete ${filename}?`)) return;
        try {
            const zipFilename = filename.endsWith('_metadata.json') ? filename.replace('_metadata.json', '.zip') : filename;
            const res = await fetch(`${API_BASE}/api/rl/models/${zipFilename}`, { method: 'DELETE' });
            if (res.ok) fetchRlModels();
            else { const d = await res.json(); alert("Delete failed: " + d.error); }
        } catch (err) { console.error(err); }
    };

    // ── Backtest ──────────────────────────────────────────────────────────────
    const handleBacktest = async () => {
        setBacktesting(true); setBacktestResult(null);
        try {
            const res  = await fetch(`${API_URL}/backtest`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    strategy: backtestConfig.strategy, symbol: backtestConfig.symbol,
                    startDate: backtestConfig.start_date, endDate: backtestConfig.end_date,
                    capital: backtestConfig.capital,
                    params: { ...backtestConfig.params, use_ai_prediction: true }
                })
            });
            const data = await res.json();
            if (res.ok) setBacktestResult(data);
            else alert("Backtest Error: " + (data.error || data.detail));
        } catch (err) { alert("Backtest Failed: " + err.message); }
        finally { setBacktesting(false); }
    };

    // ── Render ────────────────────────────────────────────────────────────────
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
                            {activeTab === 'rl'
                                ? (rlModelExists ? 'RL Model Available' : 'No RL Model Saved')
                                : (status.model_trained ? 'Model Active' : 'No Model Loaded')}
                            {hasActiveJobs && (
                                <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-semibold animate-pulse">
                                    {rlJobs.filter(j => isActive(j.status)).length} training
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                <button onClick={fetchStatus} className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
                    <FaSync className={`w-5 h-5 text-slate-400 ${loadingStatus ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Main grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* Left: Training config */}
                <div className="space-y-6">
                    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                        {/* Tabs */}
                        <div className="flex border-b border-slate-700 mb-6">
                            <button
                                className={`pb-2 px-4 font-semibold text-sm transition-colors ${activeTab === 'static' ? 'border-b-2 border-purple-500 text-purple-400' : 'text-slate-400 hover:text-slate-200'}`}
                                onClick={() => setActiveTab('static')}
                            >
                                <FaBrain className="inline mr-2" />Static Model
                            </button>
                            <button
                                className={`pb-2 px-4 font-semibold text-sm transition-colors ${activeTab === 'rl' ? 'border-b-2 border-indigo-500 text-indigo-400' : 'text-slate-400 hover:text-slate-200'}`}
                                onClick={() => { setActiveTab('rl'); fetchRlStatus(); }}
                            >
                                <FaRobot className="inline mr-2" />RL Agent
                                {hasActiveJobs && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500 text-white font-bold">{rlJobs.filter(j => isActive(j.status)).length}</span>}
                            </button>
                        </div>

                        {/* ── Static Model Form ── */}
                        {activeTab === 'static' ? (
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold">Symbol</label>
                                        <select value={trainConfig.symbol} onChange={(e) => setTrainConfig({...trainConfig, symbol: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none">
                                            <option value="" disabled>-- Select Symbol --</option>
                                            {Object.keys(instrumentConfig).length === 0 && <option>Loading...</option>}
                                            <optgroup label="Indices">
                                                {Object.entries(instrumentConfig).filter(([k]) => !k.includes('-EQ') && !k.startsWith('MCX:')).map(([key, config]) => (
                                                    <option key={key} value={key}>{config.underlying || key}</option>
                                                ))}
                                            </optgroup>
                                            <optgroup label="Stocks">
                                                {Object.entries(instrumentConfig).filter(([k]) => k.includes('-EQ')).map(([key, config]) => (
                                                    <option key={key} value={key}>{config.underlying || key}</option>
                                                ))}
                                            </optgroup>
                                            <optgroup label="Commodities (MCX)">
                                                {Object.entries(instrumentConfig).filter(([k]) => k.startsWith('MCX:')).map(([key, config]) => (
                                                    <option key={key} value={key}>{config.underlying || key}</option>
                                                ))}
                                            </optgroup>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold">Epochs</label>
                                        <input type="number" value={trainConfig.epochs} onChange={(e) => setTrainConfig({...trainConfig, epochs: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold">Start Date</label>
                                        <input type="date" value={trainConfig.start_date} onChange={(e) => setTrainConfig({...trainConfig, start_date: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold">End Date</label>
                                        <input type="date" value={trainConfig.end_date} onChange={(e) => setTrainConfig({...trainConfig, end_date: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" />
                                    </div>
                                </div>
                                <button onClick={handleTrain} disabled={training} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:cursor-not-allowed py-3 rounded-lg font-bold transition-all flex justify-center items-center gap-2">
                                    {training ? <FaSync className="animate-spin" /> : <FaBrain />}
                                    {training ? 'Training Model...' : 'Train Model'}
                                </button>
                                {trainMetrics && (
                                    <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                                        <h3 className="text-emerald-400 font-bold mb-2">Training Results</h3>
                                        <div className="grid grid-cols-2 gap-4 text-sm">
                                            <div className="flex justify-between"><span className="text-slate-400">Accuracy:</span><span className="text-white font-mono">{(trainMetrics.val_accuracy * 100).toFixed(1)}%</span></div>
                                            <div className="flex justify-between"><span className="text-slate-400">F1 Score:</span><span className="text-white font-mono">{(trainMetrics.val_f1 * 100).toFixed(1)}%</span></div>
                                            <div className="flex justify-between"><span className="text-slate-400">Iterations:</span><span className="text-white font-mono">{trainMetrics.iterations}</span></div>
                                            <div className="flex justify-between"><span className="text-slate-400">Loss:</span><span className="text-white font-mono">{trainMetrics.loss?.toFixed(4)}</span></div>
                                        </div>
                                    </div>
                                )}
                            </div>

                        ) : (
                        /* ── RL Agent Form ── */
                            <div className="space-y-4">
                                {/* Symbol */}
                                <div>
                                    <label className="text-xs text-slate-400 uppercase tracking-wider font-bold">Symbol</label>
                                    <select
                                        value={rlTrainConfig.symbol}
                                        onChange={(e) => {
                                            const sym = e.target.value;
                                            const isMcx = sym.startsWith('MCX:');
                                            setRlTrainConfig({
                                                ...rlTrainConfig,
                                                symbol: sym,
                                                // MCX has no SPOT — auto-switch data source to FUTURES
                                                dataSource: isMcx ? 'FUTURES' : rlTrainConfig.dataSource,
                                                broker: isMcx ? 'angel_one' : rlTrainConfig.broker,
                                                // MCX intraday recommended (no overnight futures risk)
                                                intraday: isMcx ? true : rlTrainConfig.intraday,
                                            });
                                        }}
                                        className="w-full bg-slate-900 border border-slate-700 rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none"
                                    >
                                        <option value="" disabled>-- Select Symbol --</option>
                                        {Object.keys(instrumentConfig).length > 0 && (
                                            <>
                                                <optgroup label="── NSE / BSE Indices">
                                                    {Object.entries(instrumentConfig)
                                                        .filter(([k]) => !k.includes('-EQ') && !k.startsWith('MCX:'))
                                                        .map(([key, config]) => (
                                                            <option key={key} value={key}>{config.underlying || key}</option>
                                                        ))}
                                                </optgroup>
                                                <optgroup label="── NSE Stocks">
                                                    {Object.entries(instrumentConfig)
                                                        .filter(([k]) => k.includes('-EQ'))
                                                        .map(([key, config]) => (
                                                            <option key={key} value={key}>{config.underlying || key}</option>
                                                        ))}
                                                </optgroup>
                                                <optgroup label="── MCX Commodities (Futures)">
                                                    {Object.entries(instrumentConfig)
                                                        .filter(([k]) => k.startsWith('MCX:'))
                                                        .map(([key, config]) => (
                                                            <option key={key} value={key}>{config.displayName || config.underlying || key}</option>
                                                        ))}
                                                </optgroup>
                                            </>
                                        )}
                                    </select>
                                    {rlTrainConfig.symbol.startsWith('MCX:') && (
                                        <p className="text-xs text-amber-400 mt-1">
                                            MCX commodity — data source set to FUTURES (continuous contract). Broker: Angel One. Intraday mode auto-enabled.
                                        </p>
                                    )}
                                </div>

                                {/* Intraday Mode toggle */}
                                <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/60 border border-slate-700">
                                    <input
                                        type="checkbox"
                                        id="rl-intraday-toggle"
                                        checked={!!rlTrainConfig.intraday}
                                        onChange={(e) => setRlTrainConfig({ ...rlTrainConfig, intraday: e.target.checked })}
                                        className="mt-0.5 w-4 h-4 accent-indigo-500 cursor-pointer flex-shrink-0"
                                    />
                                    <label htmlFor="rl-intraday-toggle" className="cursor-pointer">
                                        <span className="text-sm font-semibold text-slate-200">Intraday Mode</span>
                                        <p className="text-xs text-slate-400 mt-0.5">
                                            Each training episode = one trading session. Positions are force-closed at session end with a penalty — the agent learns to exit before close instead of holding overnight.
                                            {rlTrainConfig.symbol.startsWith('MCX:') && (
                                                <span className="text-amber-400"> Auto-enabled for MCX (14.5h session, no overnight carry).</span>
                                            )}
                                            {!rlTrainConfig.symbol.startsWith('MCX:') && (
                                                <span className="text-slate-500"> Recommended ON for NSE options — overnight theta decay and gap risk make holding across sessions unprofitable.</span>
                                            )}
                                        </p>
                                    </label>
                                </div>

                                {/* Timesteps */}
                                <div>
                                    <label className="text-xs text-slate-400 uppercase tracking-wider font-bold">Timesteps</label>
                                    <input type="number" value={rlTrainConfig.timesteps} onChange={(e) => setRlTrainConfig({...rlTrainConfig, timesteps: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" />
                                    <p className="text-xs text-slate-500 mt-1">Recommended: 100,000+ for stable learning.</p>
                                </div>

                                {/* Date range */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold">Start Date</label>
                                        <input type="date" value={rlTrainConfig.start_date} onChange={(e) => setRlTrainConfig({...rlTrainConfig, start_date: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold">End Date</label>
                                        <input type="date" value={rlTrainConfig.end_date} onChange={(e) => setRlTrainConfig({...rlTrainConfig, end_date: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" />
                                    </div>
                                </div>

                                {/* Broker / DataSource / Resolution */}
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold block mb-1">Broker</label>
                                        <select value={rlTrainConfig.broker} onChange={(e) => setRlTrainConfig({...rlTrainConfig, broker: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm focus:border-indigo-500 outline-none">
                                            <option value="angel_one">Angel One</option>
                                            <option value="fyers">Fyers</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold block mb-1">Data Source</label>
                                        <select value={rlTrainConfig.dataSource} onChange={(e) => setRlTrainConfig({...rlTrainConfig, dataSource: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm focus:border-indigo-500 outline-none">
                                            <option value="AUTO">AUTO</option>
                                            <option value="SPOT">SPOT</option>
                                            <option value="FUTURES">FUTURES</option>
                                            <option value="ARCHIVE">ARCHIVE</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-400 uppercase tracking-wider font-bold block mb-1">Timeframe</label>
                                        <select value={rlTrainConfig.resolution} onChange={(e) => setRlTrainConfig({...rlTrainConfig, resolution: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm focus:border-indigo-500 outline-none">
                                            <option value="1">1 Min</option>
                                            <option value="3">3 Min</option>
                                            <option value="5">5 Min</option>
                                            <option value="15">15 Min</option>
                                            <option value="60">1 Hour</option>
                                            <option value="D">1 Day</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Custom model name */}
                                <div>
                                    <label className="text-xs text-slate-400 uppercase tracking-wider font-bold block mb-1">Custom Model Name <span className="text-slate-600 font-normal normal-case">(optional)</span></label>
                                    <input type="text" placeholder="e.g. SCALPER_BOT_V2" value={rlTrainConfig.customName} onChange={(e) => setRlTrainConfig({...rlTrainConfig, customName: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm focus:border-indigo-500 outline-none placeholder-slate-600" />
                                </div>

                                {/* Feature profile */}
                                <div>
                                    <label className="text-xs text-slate-400 uppercase tracking-wider font-bold block mb-1">
                                        Feature Profile
                                        <span className="ml-2 text-[10px] text-indigo-400 font-normal normal-case">
                                            {rlTrainConfig.profile === 'lean'          && '56 features — best signal:noise ratio'}
                                            {rlTrainConfig.profile === 'lean_mtf'      && '68 features — lean + 60m/1D macro'}
                                            {rlTrainConfig.profile === 'lean_cdl'      && '72 features — lean + 16 candlesticks'}
                                            {rlTrainConfig.profile === 'smart_money'   && '68 features — SL hunts + liquidity pools + institutional'}
                                            {rlTrainConfig.profile === 'base'          && '71 features — balanced default'}
                                            {rlTrainConfig.profile === 'quantum'       && '79 features — physics-inspired'}
                                            {rlTrainConfig.profile === 'mtf_full'      && '83 features — multi-timeframe macro'}
                                            {rlTrainConfig.profile === 'dow_theory'    && '76 features — swing structure'}
                                            {rlTrainConfig.profile === 'cdl_rich'      && '87 features — pattern specialist'}
                                            {rlTrainConfig.profile === 'comprehensive' && '112 features — all groups'}
                                            {rlTrainConfig.profile === 'chart_vision'  && '92 features — EMA cross + Fib + Trendlines'}
                                        </span>
                                    </label>
                                    <select value={rlTrainConfig.profile} onChange={(e) => setRlTrainConfig({...rlTrainConfig, profile: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm focus:border-indigo-500 outline-none">
                                        <option value="lean">Lean — Best signal:noise, no BB/SuperTrend/OB (56 features)</option>
                                        <option value="lean_mtf">Lean MTF — Lean + 60m/1D macro bias (68 features)</option>
                                        <option value="lean_cdl">Lean CDL — Lean + 16 extra candlestick patterns (72 features)</option>
                                        <option value="smart_money">Smart Money — SL hunts + liquidity pools + institutional flow (68 features)</option>
                                        <option value="base">Base — Core TA + SMC/Wyckoff/OB (71 features)</option>
                                        <option value="quantum">Quantum — Physics-inspired market state (79 features)</option>
                                        <option value="mtf_full">MTF Full — 60m + Daily macro bias (83 features)</option>
                                        <option value="dow_theory">Dow Theory — Swing HH/HL/LH/LL structure (76 features)</option>
                                        <option value="cdl_rich">CDL Rich — 21 candlestick patterns (87 features)</option>
                                        <option value="comprehensive">Comprehensive — All features combined (112 features)</option>
                                        <option value="chart_vision">Chart Vision — EMA cross + Fibonacci + Trendlines (92 features)</option>
                                    </select>
                                    <p className="text-[10px] text-slate-500 mt-1">Each profile trains a specialist model — you can run multiple profiles simultaneously.</p>
                                </div>

                                {/* Base model (continual learning) */}
                                <div>
                                    <label className="text-xs text-slate-400 uppercase tracking-wider font-bold block mb-1">Base Model <span className="text-slate-600 font-normal normal-case">(continual learning)</span></label>
                                    <select value={rlTrainConfig.baseModel} onChange={(e) => setRlTrainConfig({...rlTrainConfig, baseModel: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm focus:border-indigo-500 outline-none">
                                        <option value="">-- None (Train from scratch) --</option>
                                        {availableRlModels.flatMap((model, idx) => {
                                            const finalFile = model.model_file || `${model.symbol}_ppo_final.zip`;
                                            const date = model.trained_at || model.timestamp ? new Date(model.timestamp || model.trained_at).toLocaleDateString() : 'Unknown';
                                            const label = model.model_name || model.symbol;
                                            const opts = [
                                                <option key={`${idx}_f`} value={finalFile}>{label} — Final ({date})</option>
                                            ];
                                            if (model.best_model) opts.push(
                                                <option key={`${idx}_b`} value={model.best_model}>{label} — Best/Val ({date})</option>
                                            );
                                            return opts;
                                        })}
                                    </select>
                                </div>

                                {/* Launch button */}
                                <button
                                    onClick={handleRlTrain}
                                    disabled={launchingJob}
                                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:cursor-not-allowed py-3 rounded-lg font-bold transition-all flex justify-center items-center gap-2"
                                >
                                    {launchingJob ? <FaSync className="animate-spin" /> : <FaPlus />}
                                    {launchingJob ? 'Launching...' : 'Launch Training Job'}
                                </button>
                                <p className="text-[10px] text-slate-500 text-center">You can launch multiple jobs simultaneously — each runs in its own process.</p>

                                {/* Model registry */}
                                <div className="mt-4 border-t border-slate-700 pt-6">
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                                            <FaBrain className="text-indigo-400" /> Saved RL Models
                                        </h3>
                                        <div className="flex gap-2 items-center">
                                            <input type="file" accept=".zip" onChange={(e) => setUploadFile(e.target.files[0])} className="text-xs text-slate-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100" />
                                            <button onClick={handleUploadModel} disabled={!uploadFile || uploadingModel} className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-xs px-3 py-1.5 rounded transition-colors">
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
                                                                    {model.profile && model.profile !== 'base' && (
                                                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-900/60 text-indigo-300 border border-indigo-700/50 font-semibold uppercase tracking-wide">{model.profile}</span>
                                                                    )}
                                                                </div>
                                                                <div className="text-slate-500 mt-1 flex gap-2">
                                                                    <span>{new Date(model.timestamp || model.trained_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                                                    <span>•</span>
                                                                    <span>{model.timesteps?.toLocaleString() || 0} steps</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 text-slate-300">
                                                                <div>{model.data_length ? `${model.data_length.toLocaleString()} candles` : (model.description || 'N/A')}</div>
                                                                <div className="text-slate-500 mt-1">{model.start_date && model.start_date !== 'N/A' ? `${model.start_date} → ${model.end_date}` : 'Custom / Uploaded'}</div>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                {model.action_distribution ? (
                                                                    <div className="flex flex-col gap-1">
                                                                        {[['Hold','slate'], ['Buy','emerald'], ['Sell','rose'], ['Exit_Long','amber'], ['Exit_Short','orange']].map(([k, c]) =>
                                                                            model.action_distribution[k] !== undefined && (
                                                                                <div key={k} className="flex items-center gap-1.5 text-[10px] font-medium">
                                                                                    <span className={`w-2 h-2 rounded-full bg-${c}-${c==='slate'?'400':'500'}`}></span>
                                                                                    <span className="text-slate-300 w-10">{k.replace('_',' ')}</span>
                                                                                    <span className={`text-${c}-${c==='slate'?'400':'400'}`}>{model.action_distribution[k]}%</span>
                                                                                </div>
                                                                            )
                                                                        )}
                                                                    </div>
                                                                ) : <span className="text-slate-500 italic">No Data</span>}
                                                            </td>
                                                            <td className="px-4 py-3 text-right text-slate-400 font-mono">
                                                                <div className="flex flex-col items-end gap-1.5">
                                                                    <span className="text-xs">{model.file_size_kb ? `${model.file_size_kb} KB` : '...'}</span>
                                                                    <button onClick={() => downloadFile(model.model_file || `${model.model_name || model.symbol}_ppo_final.zip`)} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">↓ Final</button>
                                                                    {model.best_model && (
                                                                        <button onClick={() => downloadFile(model.best_model)} className="text-xs text-violet-400 hover:text-violet-300 transition-colors">↓ Best ({model.best_model_size_kb ? `${model.best_model_size_kb} KB` : '...'})</button>
                                                                    )}
                                                                    <button onClick={() => downloadFile(model._metadata_file || (model.model_file || '').replace(/_ppo_final\.zip$/, '_metadata.json').replace(/\.zip$/, '_metadata.json'))} className="text-xs text-slate-400 hover:text-slate-300 transition-colors">↓ Meta</button>
                                                                    <button onClick={() => handleDeleteModel(model.model_file || `${model.symbol}_ppo_final.zip`)} className="text-xs text-rose-500 hover:text-rose-400 transition-colors">Delete</button>
                                                                    {/* OOS Evaluate buttons */}
                                                                    <div className="border-t border-slate-700/50 pt-1.5 mt-0.5 flex flex-col items-end gap-1">
                                                                        {(() => {
                                                                            const modelKey = model.model_name || model.symbol;
                                                                            const finalKey = `${modelKey}_final`;
                                                                            const bestKey  = `${modelKey}_best`;
                                                                            const isFinalEval = evaluatingKey === finalKey;
                                                                            const isBestEval  = evaluatingKey === bestKey;
                                                                            const finalResult = evalResults[finalKey];
                                                                            const bestResult  = evalResults[bestKey];
                                                                            return (<>
                                                                                <button
                                                                                    onClick={() => handleEvaluateModel(model, 'final')}
                                                                                    disabled={!!evaluatingKey}
                                                                                    className="text-[10px] text-amber-400 hover:text-amber-300 disabled:text-slate-600 transition-colors"
                                                                                >{isFinalEval ? '⏳ Evaluating...' : 'Eval Final'}</button>
                                                                                {model.best_model && (
                                                                                    <button
                                                                                        onClick={() => handleEvaluateModel(model, 'best')}
                                                                                        disabled={!!evaluatingKey}
                                                                                        className="text-[10px] text-emerald-400 hover:text-emerald-300 disabled:text-slate-600 transition-colors"
                                                                                    >{isBestEval ? '⏳ Evaluating...' : 'Eval Best'}</button>
                                                                                )}
                                                                                {(finalResult || bestResult) && (
                                                                                    <div className="mt-1 text-[9px] text-left w-full space-y-0.5 border border-slate-700/50 rounded p-1.5 bg-slate-800/60">
                                                                                        {[['final', finalResult, 'text-amber-300'], ['best', bestResult, 'text-emerald-300']].map(([label, r, cls]) =>
                                                                                            r && (
                                                                                                <div key={label}>
                                                                                                    <span className={`font-bold uppercase ${cls}`}>{label}</span>
                                                                                                    <span className="text-slate-400"> · {r.n_trades}T · WR </span>
                                                                                                    <span className={r.win_rate >= 0.5 ? 'text-emerald-400' : 'text-rose-400'}>{(r.win_rate * 100).toFixed(1)}%</span>
                                                                                                    <span className="text-slate-400"> · </span>
                                                                                                    <span className={r.total_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{r.total_pnl > 0 ? '+' : ''}{r.total_pnl}</span>
                                                                                                    <span className="text-slate-500"> · S:{r.sharpe?.toFixed(2)}</span>
                                                                                                </div>
                                                                                            )
                                                                                        )}
                                                                                    </div>
                                                                                )}
                                                                            </>);
                                                                        })()}
                                                                    </div>
                                                                </div>
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
                    </div>
                </div>

                {/* Right: Backtest */}
                <div className="space-y-6">
                    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                            <FaChartLine className="text-emerald-400" /> AI Backtest
                        </h2>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <label className={`cursor-pointer p-3 rounded border transition-all ${backtestConfig.strategy === 'ai_adaptive' ? 'bg-indigo-500/20 border-indigo-500' : 'bg-slate-900 border-slate-700'}`}>
                                    <input type="radio" name="strategy" className="hidden" checked={backtestConfig.strategy === 'ai_adaptive'} onChange={() => setBacktestConfig(c => ({...c, strategy: 'ai_adaptive'}))} />
                                    <div className="font-bold text-sm">Adaptive Risk</div>
                                    <div className="text-xs text-slate-400 mt-1">Dynamic TP/SL based on confidence</div>
                                </label>
                                <label className={`cursor-pointer p-3 rounded border transition-all ${backtestConfig.strategy === 'ai_prediction' ? 'bg-indigo-500/20 border-indigo-500' : 'bg-slate-900 border-slate-700'}`}>
                                    <input type="radio" name="strategy" className="hidden" checked={backtestConfig.strategy === 'ai_prediction'} onChange={() => setBacktestConfig(c => ({...c, strategy: 'ai_prediction'}))} />
                                    <div className="font-bold text-sm">Standard AI</div>
                                    <div className="text-xs text-slate-400 mt-1">Fixed Risk with AI Filtering</div>
                                </label>
                            </div>
                            <div className="p-4 bg-slate-900 rounded-lg space-y-3">
                                <div className="flex justify-between items-center">
                                    <label className="text-sm text-slate-300">Confidence Threshold</label>
                                    <span className="text-indigo-400 font-mono font-bold">{backtestConfig.params.confidence_threshold}</span>
                                </div>
                                <input type="range" min="0.5" max="0.9" step="0.05" value={backtestConfig.params.confidence_threshold}
                                    onChange={(e) => setBacktestConfig(c => ({ ...c, params: { ...c.params, confidence_threshold: parseFloat(e.target.value) } }))}
                                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500" />
                                {backtestConfig.strategy === 'ai_adaptive' && (
                                    <div className="flex items-center gap-2 mt-2">
                                        <input type="checkbox" checked={backtestConfig.params.use_adaptive_risk}
                                            onChange={(e) => setBacktestConfig(c => ({ ...c, params: { ...c.params, use_adaptive_risk: e.target.checked } }))}
                                            className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500" />
                                        <label className="text-sm text-slate-300">Enable Dynamic TP/SL Scaling</label>
                                    </div>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-slate-400 uppercase tracking-wider font-bold">Start Date</label>
                                    <input type="date" value={backtestConfig.start_date} onChange={(e) => setBacktestConfig({...backtestConfig, start_date: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-400 uppercase tracking-wider font-bold">End Date</label>
                                    <input type="date" value={backtestConfig.end_date} onChange={(e) => setBacktestConfig({...backtestConfig, end_date: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" />
                                </div>
                            </div>
                            <button onClick={handleBacktest} disabled={backtesting || !status.model_trained}
                                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:cursor-not-allowed py-3 rounded-lg font-bold transition-all flex justify-center items-center gap-2">
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

            {/* ── Active & Recent Training Jobs ── */}
            {activeTab === 'rl' && rlJobs.length > 0 && (
                <div className="mt-6">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-base font-bold text-slate-300 flex items-center gap-2">
                            <FaRobot className="text-indigo-400" />
                            Training Jobs
                            <span className="text-xs text-slate-500 font-normal">({rlJobs.length} total · {rlJobs.filter(j => isActive(j.status)).length} running)</span>
                        </h2>
                        <button onClick={fetchRlStatus} className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1.5 transition-colors">
                            <FaSync className="w-3 h-3" /> Refresh
                        </button>
                    </div>
                    <div className="space-y-3">
                        {rlJobs.map(job => (
                            <JobCard
                                key={job.jobId}
                                job={job}
                                onStop={handleStopJob}
                                expanded={expandedJobId === job.jobId}
                                onToggleExpand={() => setExpandedJobId(prev => prev === job.jobId ? null : job.jobId)}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* ── Backtest Results ── */}
            {backtestResult && (
                <div className="mt-8 bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                    <h2 className="text-xl font-bold mb-6">Backtest Performance</h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                        <ResultCard label="Total Return"  value={`₹${backtestResult.total_pnl?.toFixed(2)}`}    color={backtestResult.total_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'} />
                        <ResultCard label="Win Rate"      value={`${(backtestResult.win_rate * 100).toFixed(1)}%`} color="text-blue-400" />
                        <ResultCard label="Trades"        value={backtestResult.total_trades}                    color="text-white" />
                        <ResultCard label="Drawdown"      value={`₹${backtestResult.max_drawdown?.toFixed(2)}`}  color="text-rose-400" />
                    </div>
                    <div className="h-64 w-full bg-slate-900 rounded-lg p-4">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={backtestResult.equity_curve}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                <XAxis dataKey="timestamp" hide />
                                <YAxis stroke="#94a3b8" />
                                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }} itemStyle={{ color: '#e2e8f0' }} />
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
