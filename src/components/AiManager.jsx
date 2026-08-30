import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FaRobot, FaBrain, FaChartLine, FaPlay, FaSync, FaExclamationTriangle, FaStop, FaChevronDown, FaChevronUp, FaPlus } from 'react-icons/fa';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API_URL  = `${API_BASE}/api/ai`;

import { INSTRUMENT_CONFIG } from '../constants';
import { useChartTheme } from '../theme/chartTheme.js';
import { pollInterval } from '../hooks/usePolling.js';
import { API_BASE } from '../config/api.js';
import { useConfirm } from './confirmContext.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatEta(seconds) {
    if (seconds == null || seconds <= 0) return '--';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    if (m < 60) return `${m}m ${s.toString().padStart(2, '0')}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${(m % 60)}m`;
}

/** Wall-clock ETA: if percent% took elapsed seconds, remaining = elapsed*(100-pct)/pct */
function computeEta(startedAt, percent) {
    if (!startedAt || percent < 0.5) return null;
    const elapsed = (Date.now() - new Date(startedAt).getTime()) / 1000;
    if (elapsed <= 0) return null;
    return formatEta(elapsed * (100 - percent) / percent);
}

/** Parse the last progress line from a log string into { percent, speed, eta, text, isNitro } */
function parseProgress(logs, startedAt) {
    if (!logs) return null;

    // NITRO: last JSON telemetry line with phase/update fields
    const nitroLines = logs.split('\n').filter(l => {
        const t = l.trim();
        return t.startsWith('{') && t.includes('"NITRO"') && t.includes('"update"');
    });
    if (nitroLines.length) {
        try {
            const d = JSON.parse(nitroLines[nitroLines.length - 1].trim());
            const percent = Math.min(99, ((d.phase - 1) + d.update / Math.max(d.total_updates, 1)) / 3 * 100);
            return {
                text:    `Phase ${d.phase} · ${d.update}/${d.total_updates} updates`,
                percent,
                speed:   (d.mean_reward ?? 0).toFixed(5),
                eta:     computeEta(startedAt, percent) || '--',
                entropy: (d.entropy ?? 0).toFixed(3),
                isNitro: true,
                actDist: (d.act_H != null)
                    ? { H: d.act_H, B: d.act_B, S: d.act_S, ExL: d.act_ExL, ExS: d.act_ExS }
                    : null,
            };
        } catch {
            // malformed JSON telemetry line — skip
        }
    }

    // STANDARD: [Progress] text line — override log ETA with wall-clock ETA
    const matches = [...logs.matchAll(/\[Progress\] (.*?) \((.*?)%\) \| Speed: (.*?) steps\/s \| ETA: (.*)/g)];
    if (!matches.length) return null;
    const m = matches[matches.length - 1];
    const percent = parseFloat(m[2]);
    return { text: m[1], percent, speed: m[3], eta: computeEta(startedAt, percent) || m[4] };
}

function isActive(status) {
    return status === 'training' || status === 'running' || status === 'fetching_data';
}

function statusLabel(status) {
    const map = {
        fetching_data: 'Fetching Data',
        training:      'Training',
        running:       'Running',
        completed:     'Completed',
        failed:        'Failed',
        idle:          'Idle',
    };
    return map[status] || status;
}

function statusBadge(status) {
    const map = {
        fetching_data: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        training:      'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
        running:       'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
        completed:     'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        failed:        'bg-rose-500/20 text-rose-300 border-rose-500/40',
        idle:          'bg-slate-500/20 text-fg-4 border-line-3/40',
    };
    return map[status] || map.idle;
}

// ── Job Card ─────────────────────────────────────────────────────────────────
function JobCard({ job, onStop, expanded, onToggleExpand }) {
    const progress  = parseProgress(job.logs, job.startedAt);
    const active    = isActive(job.status);
    const logEndRef = useRef(null);

    useEffect(() => {
        if (expanded && logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [job.logs, expanded]);

    return (
        <div className={`border rounded-xl overflow-hidden transition-all ${active ? 'border-indigo-500/40 bg-slate-900/80' : 'border-line bg-slate-900/40'}`}>
            {/* Header row */}
            <div className="flex items-center gap-3 p-4">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${job.status === 'fetching_data' ? 'bg-amber-400 animate-pulse' : active ? 'bg-indigo-400 animate-pulse' : job.status === 'completed' ? 'bg-emerald-400' : 'bg-rose-400'}`} />

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-fg truncate">{job.modelName || job.symbol}</span>
                        {job.symbol && job.modelName !== job.symbol && (
                            <span className="text-xs text-fg-5">({job.symbol})</span>
                        )}
                        {job.profile && job.profile !== 'base' && (
                            <span className="text-3xs px-1.5 py-0.5 rounded border bg-indigo-900/60 text-indigo-300 border-indigo-700/50 font-semibold uppercase tracking-wide">
                                {job.profile}
                            </span>
                        )}
                        {job.engineMode === 'NITRO' && (
                            <span className="text-3xs px-1.5 py-0.5 rounded border bg-amber-500/20 text-amber-300 border-amber-500/40 font-semibold tracking-wide">
                                ⚡ NITRO
                            </span>
                        )}
                        {job.agentVersion && (
                            <span className="text-3xs px-1.5 py-0.5 rounded border bg-slate-800 text-fg-5 border-line font-mono tracking-wide">
                                v{job.agentVersion}
                            </span>
                        )}
                        <span className={`text-3xs px-1.5 py-0.5 rounded border font-semibold uppercase tracking-wide ${statusBadge(job.status)}`}>
                            {statusLabel(job.status)}
                        </span>
                    </div>
                    <div className="text-xs text-fg-5 mt-0.5">
                        {job.timesteps?.toLocaleString()} steps
                        {job.startedAt && ` · Started ${new Date(job.startedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false })}`}
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
                        aria-label={expanded ? 'Collapse section' : 'Expand section'}
                        aria-expanded={expanded}
                        className="p-1.5 hover:bg-slate-700 rounded-lg transition-colors text-fg-4"
                    >
                        {expanded ? <FaChevronUp className="w-3 h-3" /> : <FaChevronDown className="w-3 h-3" />}
                    </button>
                </div>
            </div>

            {/* Progress bar (always visible when active) */}
            {progress && active && (
                <div className="px-4 pb-3">
                    <div className="flex justify-between text-3xs mb-1">
                        <span className="text-indigo-300 font-mono">{progress.text}{progress.isNitro ? '' : ' steps'}</span>
                        <span className="text-emerald-400 font-mono">{progress.isNitro ? `reward ${progress.speed}` : `${progress.speed} steps/s`}</span>
                        <span className="text-amber-400 font-mono">ETA: {progress.eta}</span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-1.5">
                        <div
                            className="bg-indigo-500 h-1.5 rounded-full transition-all duration-700"
                            style={{ width: `${Math.min(100, progress.percent)}%` }}
                        />
                    </div>
                    <div className="flex justify-between text-3xs text-fg-5 mt-0.5">
                        {progress.actDist ? (
                            <span className="font-mono text-fg-4">
                                {Object.entries(progress.actDist).map(([k, v]) =>
                                    <span key={k} className="mr-2">{k}:<span className="text-fg-3">{v?.toFixed(1)}%</span></span>
                                )}
                                {progress.entropy && <span className="ml-1 text-fg-5">ent:<span className="text-fg-4">{progress.entropy}</span></span>}
                            </span>
                        ) : <span />}
                        <span>{Math.min(100, progress.percent).toFixed(1)}%</span>
                    </div>
                </div>
            )}

            {/* Expandable log panel */}
            {expanded && (
                <div className="border-t border-line/50 px-4 pb-4 pt-3">
                    <div className="text-3xs text-fg-5 uppercase tracking-wider font-bold mb-2">Logs</div>
                    {/* bg-bg-2 (sunken-surface role), not bg-black: `--color-black` is pinned to
                        #000 in every theme by design, so text-fg-3 on it collapses to 1.2-1.8:1
                        on the five light-mode themes. bg-2 keeps the log readable in all 12. */}
                    <div className="h-44 bg-bg-2 rounded p-2 overflow-y-auto text-xs font-mono text-fg-3 whitespace-pre-wrap border border-line">
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
    const confirm = useConfirm();
    // The equity curve is recharts, so its colours have to be concrete strings
    // for the active theme rather than var() references.
    const ct = useChartTheme();
    const [status,        setStatus]        = useState({ status: 'loading', model_trained: false });
    const [loadingStatus, setLoadingStatus] = useState(false);
    const [activeTab,     setActiveTab]     = useState('rl');   // RL Agent is the default tab

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
        intraday: true, windowSize: 100, batchSize: 0,
        lrInitial: 0.0003, lrFinal: 0.0001,
        nEpochs: 10, gaeLambda: 0.95, gamma: 0.99,
        entP1Start: 0.10, entP1End: 0.04, entP2End: 0.015, entP3End: 0.005,
        curriculum: '30/30/40',
        engineMode: 'STANDARD',
        nitroNEnvs: 256, nitroNSteps: 128,
        exitCooldown: 0, exoCsv: '',
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
    const [checkpoints,     setCheckpoints]     = useState([]);    // resumable checkpoints
    const [resumingModel,   setResumingModel]   = useState(null);  // model_name being resumed

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
                // Normalise snake_case agent_version (Flask) → camelCase agentVersion
                setRlJobs(data.jobs.map(j => ({
                    ...j,
                    agentVersion: j.agentVersion || j.agent_version || null,
                    engineMode:   j.engineMode   || j.engine_mode   || 'STANDARD',
                })));
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

    const fetchCheckpoints = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/rl/checkpoints`);
            if (res.ok) setCheckpoints((await res.json()).checkpoints || []);
        } catch (err) {
            console.error("fetchCheckpoints:", err);
        }
    }, []);

    // Poll job status while any job is running
    useEffect(() => {
        let interval;
        if (activeTab === 'rl' && hasActiveJobs) {
            interval = pollInterval(fetchRlStatus, 2000);
        }
        return () => interval?.();
    }, [activeTab, hasActiveJobs, fetchRlStatus]);

    // Fetch one status pass on tab switch
    useEffect(() => {
        if (activeTab === 'rl') {
            fetchRlStatus();
            checkRlModel(rlTrainConfig.symbol);
            fetchRlModels();
            fetchCheckpoints();
        }
    }, [activeTab, rlTrainConfig.symbol, fetchRlStatus, checkRlModel, fetchRlModels, fetchCheckpoints]);

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
                    baseModel:    rlTrainConfig.baseModel,
                    profile:      rlTrainConfig.profile,
                    intraday:     !!rlTrainConfig.intraday,
                    window_size:  rlTrainConfig.windowSize,
                    batch_size:   rlTrainConfig.batchSize,
                    lr_initial:   rlTrainConfig.lrInitial,
                    lr_final:     rlTrainConfig.lrFinal,
                    n_epochs:     rlTrainConfig.nEpochs,
                    gae_lambda:   rlTrainConfig.gaeLambda,
                    gamma:        rlTrainConfig.gamma,
                    ent_p1_start: rlTrainConfig.entP1Start,
                    ent_p1_end:   rlTrainConfig.entP1End,
                    ent_p2_end:   rlTrainConfig.entP2End,
                    ent_p3_end:   rlTrainConfig.entP3End,
                    curriculum:   rlTrainConfig.curriculum,
                    engine_mode:   rlTrainConfig.engineMode,
                    nitro_n_envs:  rlTrainConfig.nitroNEnvs,
                    nitro_n_steps: rlTrainConfig.nitroNSteps,
                    exit_cooldown: rlTrainConfig.exitCooldown || 0,
                    exo_csv:       rlTrainConfig.exoCsv       || '',
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
                    profile: rlTrainConfig.profile, engineMode: rlTrainConfig.engineMode,
                    agentVersion: data.agent_version || null,
                    timesteps: rlTrainConfig.timesteps,
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

    // ── Resume a training run from its last checkpoint ───────────────────────
    const handleResumeTraining = async (ckpt) => {
        if (!await confirm(`Resume "${ckpt.model_name}" from step ${ckpt.step.toLocaleString()} (${ckpt.pct_complete}% complete)?`)) return;
        setResumingModel(ckpt.model_name);
        try {
            const res  = await fetch(`${API_BASE}/api/rl/resume`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_name: ckpt.model_name }),
            });
            const data = await res.json();
            if (res.ok) {
                setCheckpoints(prev => prev.filter(c => c.model_name !== ckpt.model_name));
                fetchRlStatus();
            } else {
                alert("Resume failed: " + (data.error || "Unknown error"));
            }
        } catch (err) {
            alert("Resume failed: " + err.message);
        } finally {
            setResumingModel(null);
        }
    };

    // ── Stop a specific job ───────────────────────────────────────────────────
    const handleStopJob = async (job) => {
        if (!await confirm({ title: 'Stop training', body: `Stop training job "${job.modelName || job.symbol}"? The model trained so far will be saved.`, danger: true, confirmLabel: 'Stop training' })) return;
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
        if (!await confirm({ title: 'Delete model file', body: `Delete ${filename}?`, danger: true, confirmLabel: 'Delete model file' })) return;
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
        <div className="p-6 bg-slate-900 min-h-screen text-fg font-sans">

            {/* Header */}
            <div className="flex justify-between items-center mb-8">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
                        <FaRobot className="w-8 h-8 text-indigo-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-fg">AI Strategy Manager</h1>
                        <div className="flex items-center gap-2 text-sm text-fg-4">
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
                <button onClick={fetchStatus} aria-label="Refresh status" title="Refresh status" className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
                    <FaSync className={`w-5 h-5 text-fg-4 ${loadingStatus ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Main grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* Left: Training config */}
                <div className="space-y-6">
                    <div className="bg-slate-800/50 border border-line rounded-xl p-6">
                        {/* Tabs */}
                        <div className="flex border-b border-line mb-6">
                            <button
                                className={`pb-2 px-4 font-semibold text-sm transition-colors ${activeTab === 'static' ? 'border-b-2 border-purple-500 text-purple-400' : 'text-fg-4 hover:text-fg-2'}`}
                                onClick={() => setActiveTab('static')}
                            >
                                <FaBrain className="inline mr-2" />Static Model
                            </button>
                            <button
                                className={`pb-2 px-4 font-semibold text-sm transition-colors ${activeTab === 'rl' ? 'border-b-2 border-indigo-500 text-indigo-400' : 'text-fg-4 hover:text-fg-2'}`}
                                onClick={() => { setActiveTab('rl'); fetchRlStatus(); }}
                            >
                                <FaRobot className="inline mr-2" />RL Agent
                                {hasActiveJobs && <span className="ml-1.5 text-3xs px-1.5 py-0.5 rounded-full bg-indigo-500 text-white font-bold">{rlJobs.filter(j => isActive(j.status)).length}</span>}
                            </button>
                        </div>

                        {/* ── Static Model Form ── */}
                        {activeTab === 'static' ? (
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label htmlFor="aimanager-symbol-1" className="text-xs text-fg-4 uppercase tracking-wider font-bold">Symbol</label>
                                        <select id="aimanager-symbol-1" value={trainConfig.symbol} onChange={(e) => setTrainConfig({...trainConfig, symbol: e.target.value})} className="w-full bg-slate-900 border border-line rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none">
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
                                        <label htmlFor="aimanager-epochs-2" className="text-xs text-fg-4 uppercase tracking-wider font-bold">Epochs</label>
                                        <input id="aimanager-epochs-2" type="number" value={trainConfig.epochs} onChange={(e) => setTrainConfig({...trainConfig, epochs: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-line rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label htmlFor="aimanager-start-date-3" className="text-xs text-fg-4 uppercase tracking-wider font-bold">Start Date</label>
                                        <input id="aimanager-start-date-3" type="date" value={trainConfig.start_date} onChange={(e) => setTrainConfig({...trainConfig, start_date: e.target.value})} className="w-full bg-slate-900 border border-line rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" />
                                    </div>
                                    <div>
                                        <label htmlFor="aimanager-end-date-4" className="text-xs text-fg-4 uppercase tracking-wider font-bold">End Date</label>
                                        <input id="aimanager-end-date-4" type="date" value={trainConfig.end_date} onChange={(e) => setTrainConfig({...trainConfig, end_date: e.target.value})} className="w-full bg-slate-900 border border-line rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" />
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
                                            <div className="flex justify-between"><span className="text-fg-4">Accuracy:</span><span className="text-fg font-mono">{(trainMetrics.val_accuracy * 100).toFixed(1)}%</span></div>
                                            <div className="flex justify-between"><span className="text-fg-4">F1 Score:</span><span className="text-fg font-mono">{(trainMetrics.val_f1 * 100).toFixed(1)}%</span></div>
                                            <div className="flex justify-between"><span className="text-fg-4">Iterations:</span><span className="text-fg font-mono">{trainMetrics.iterations}</span></div>
                                            <div className="flex justify-between"><span className="text-fg-4">Loss:</span><span className="text-fg font-mono">{trainMetrics.loss?.toFixed(4)}</span></div>
                                        </div>
                                    </div>
                                )}
                            </div>

                        ) : (
                        /* ── RL Agent Form ── */
                            <div className="space-y-4">
                                {/* Symbol */}
                                <div>
                                    <label htmlFor="aimanager-symbol-5" className="text-xs text-fg-4 uppercase tracking-wider font-bold">Symbol</label>
                                    <select id="aimanager-symbol-5"
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
                                        className="w-full bg-slate-900 border border-line rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none"
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

                                {/* Engine Mode selector */}
                                <div className="space-y-1.5">
                                    <label className="text-xs text-fg-4 uppercase tracking-wider font-bold flex items-center gap-2">
                                        Training Engine
                                        {rlTrainConfig.engineMode === 'NITRO' && (
                                            <span className="text-3xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold">EXPERIMENTAL</span>
                                        )}
                                    </label>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setRlTrainConfig({ ...rlTrainConfig, engineMode: 'STANDARD', nEpochs: 10, batchSize: 0 })}
                                            className={`flex-1 py-2 px-3 rounded-lg border text-sm font-semibold transition-all ${
                                                rlTrainConfig.engineMode === 'STANDARD'
                                                    ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200'
                                                    : 'bg-slate-800/60 border-line text-fg-4 hover:border-line-2'
                                            }`}
                                        >
                                            <span className="block text-base leading-none mb-0.5">⚙️</span>
                                            Standard
                                            <span className="block text-3xs font-normal text-fg-5 mt-0.5">SB3 · PyTorch</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setRlTrainConfig({ ...rlTrainConfig, engineMode: 'NITRO', nEpochs: 4, batchSize: 0, lrFinal: 0.0003 })}
                                            className={`flex-1 py-2 px-3 rounded-lg border text-sm font-semibold transition-all ${
                                                rlTrainConfig.engineMode === 'NITRO'
                                                    ? 'bg-amber-500/20 border-amber-500 text-amber-200'
                                                    : 'bg-slate-800/60 border-line text-fg-4 hover:border-line-2'
                                            }`}
                                        >
                                            <span className="block text-base leading-none mb-0.5">⚡</span>
                                            Nitro
                                            <span className="block text-3xs font-normal text-fg-5 mt-0.5">JAX · XLA · GPU</span>
                                        </button>
                                    </div>
                                    <p className="text-3xs text-fg-5">
                                        {rlTrainConfig.engineMode === 'STANDARD'
                                            ? 'Stable Baselines3 — production-ready, well-tested SB3 PPO.'
                                            : 'JAX Nitro — vectorized environments, JIT-compiled PPO. Requires JAX CUDA build in training container.'}
                                    </p>
                                </div>

                                {/* Nitro-specific params — only visible when NITRO selected */}
                                {rlTrainConfig.engineMode === 'NITRO' && (
                                    <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/30 space-y-3">
                                        <p className="text-3xs text-amber-400 font-semibold uppercase tracking-wider">⚡ Nitro Parallelism</p>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label htmlFor="aimanager-parallel-envs-6" className="text-xs text-fg-4 font-semibold block mb-1">
                                                    Parallel Envs
                                                    <span className="ml-1 text-3xs text-fg-6 font-normal">(n_envs · vmap)</span>
                                                </label>
                                                <select id="aimanager-parallel-envs-6"
                                                    value={rlTrainConfig.nitroNEnvs}
                                                    onChange={(e) => setRlTrainConfig({...rlTrainConfig, nitroNEnvs: parseInt(e.target.value)})}
                                                    className="w-full bg-slate-900 border border-amber-700/50 rounded p-2 text-sm focus:border-amber-500 outline-none"
                                                >
                                                    <option value={16}>16 — Minimal · CPU test</option>
                                                    <option value={32}>32 — Small · debug</option>
                                                    <option value={64}>64 — Light · low VRAM</option>
                                                    <option value={128}>128 — Balanced</option>
                                                    <option value={256}>256 — Default · GPU optimal</option>
                                                    <option value={512}>512 — High · multi-GPU</option>
                                                    <option value={1024}>1024 — Max · 8-GPU cluster</option>
                                                </select>
                                                <p className="text-3xs text-fg-6 mt-1">More envs = more diverse rollouts per update.</p>
                                            </div>
                                            <div>
                                                <label htmlFor="aimanager-steps-env-7" className="text-xs text-fg-4 font-semibold block mb-1">
                                                    Steps / Env
                                                    <span className="ml-1 text-3xs text-fg-6 font-normal">(n_steps)</span>
                                                </label>
                                                <select id="aimanager-steps-env-7"
                                                    value={rlTrainConfig.nitroNSteps}
                                                    onChange={(e) => setRlTrainConfig({...rlTrainConfig, nitroNSteps: parseInt(e.target.value)})}
                                                    className="w-full bg-slate-900 border border-amber-700/50 rounded p-2 text-sm focus:border-amber-500 outline-none"
                                                >
                                                    <option value={16}>16 — Minimal · CPU test</option>
                                                    <option value={32}>32 — Small · debug</option>
                                                    <option value={64}>64 — Short rollouts</option>
                                                    <option value={128}>128 — Default</option>
                                                    <option value={256}>256 — Longer horizon</option>
                                                    <option value={512}>512 — Max horizon</option>
                                                </select>
                                                <p className="text-3xs text-fg-6 mt-1">Pool = n_envs × n_steps transitions.</p>
                                            </div>
                                        </div>
                                        <p className="text-3xs text-amber-400/70">
                                            Pool size: {(rlTrainConfig.nitroNEnvs * rlTrainConfig.nitroNSteps).toLocaleString()} transitions/update
                                        </p>
                                    </div>
                                )}

                                {/* Intraday Mode toggle */}
                                <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/60 border border-line">
                                    <input
                                        type="checkbox"
                                        id="rl-intraday-toggle"
                                        checked={!!rlTrainConfig.intraday}
                                        onChange={(e) => setRlTrainConfig({ ...rlTrainConfig, intraday: e.target.checked })}
                                        className="mt-0.5 w-4 h-4 accent-indigo-500 cursor-pointer flex-shrink-0"
                                    />
                                    <label htmlFor="rl-intraday-toggle" className="cursor-pointer">
                                        <span className="text-sm font-semibold text-fg-2">Intraday Mode</span>
                                        <p className="text-xs text-fg-4 mt-0.5">
                                            Each training episode = one trading session. Positions are force-closed at session end with a penalty — the agent learns to exit before close instead of holding overnight.
                                            {rlTrainConfig.symbol.startsWith('MCX:') && (
                                                <span className="text-amber-400"> Auto-enabled for MCX (14.5h session, no overnight carry).</span>
                                            )}
                                            {!rlTrainConfig.symbol.startsWith('MCX:') && (
                                                <span className="text-fg-5"> Recommended ON for NSE options — overnight theta decay and gap risk make holding across sessions unprofitable.</span>
                                            )}
                                        </p>
                                    </label>
                                </div>

                                {/* Timesteps + Window Size */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label htmlFor="aimanager-timesteps-8" className="text-xs text-fg-4 uppercase tracking-wider font-bold">Timesteps</label>
                                        <input id="aimanager-timesteps-8" type="number" value={rlTrainConfig.timesteps} onChange={(e) => setRlTrainConfig({...rlTrainConfig, timesteps: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-line rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" />
                                        <p className="text-xs text-fg-5 mt-1">100,000+ for stable learning.</p>
                                    </div>
                                    <div>
                                        <label htmlFor="aimanager-window-size-9" className="text-xs text-fg-4 uppercase tracking-wider font-bold block mb-1">
                                            Window Size
                                            <span className="ml-2 text-3xs text-indigo-400 font-normal normal-case">
                                                {rlTrainConfig.windowSize === 50  && '5m: 4.2h context'}
                                                {rlTrainConfig.windowSize === 100 && '5m: 8.3h · 1m: 1.7h'}
                                                {rlTrainConfig.windowSize === 150 && '5m: 12.5h · 1m: 2.5h'}
                                                {rlTrainConfig.windowSize === 200 && '5m: 16.7h · 1m: 3.3h'}
                                                {rlTrainConfig.windowSize === 300 && '5m: 25h · 1m: 5h (scalping)'}
                                                {rlTrainConfig.windowSize === 500 && '5m: 41.7h · 1m: 8.3h (slow)'}
                                            </span>
                                        </label>
                                        <select id="aimanager-window-size-9" value={rlTrainConfig.windowSize} onChange={(e) => setRlTrainConfig({...rlTrainConfig, windowSize: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-line rounded p-2 text-sm focus:border-indigo-500 outline-none">
                                            <option value={50}>50 — Fastest training, short context</option>
                                            <option value={100}>100 — Default · 8.3h on 5m</option>
                                            <option value={150}>150 — Extended · 12.5h on 5m</option>
                                            <option value={200}>200 — Deep context · 16.7h on 5m</option>
                                            <option value={300}>300 — 1m scalping · 5h on 1m</option>
                                            <option value={500}>500 — Max context (slow)</option>
                                        </select>
                                        <p className="text-xs text-fg-5 mt-1">Larger = more context, more memory, slower training.</p>
                                    </div>
                                </div>

                                {/* Date range */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label htmlFor="aimanager-start-date-10" className="text-xs text-fg-4 uppercase tracking-wider font-bold">Start Date</label>
                                        <input id="aimanager-start-date-10" type="date" value={rlTrainConfig.start_date} onChange={(e) => setRlTrainConfig({...rlTrainConfig, start_date: e.target.value})} className="w-full bg-slate-900 border border-line rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" />
                                    </div>
                                    <div>
                                        <label htmlFor="aimanager-end-date-11" className="text-xs text-fg-4 uppercase tracking-wider font-bold">End Date</label>
                                        <input id="aimanager-end-date-11" type="date" value={rlTrainConfig.end_date} onChange={(e) => setRlTrainConfig({...rlTrainConfig, end_date: e.target.value})} className="w-full bg-slate-900 border border-line rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" />
                                    </div>
                                </div>

                                {/* Broker / DataSource / Resolution */}
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label htmlFor="aimanager-broker-12" className="text-xs text-fg-4 uppercase tracking-wider font-bold block mb-1">Broker</label>
                                        <select id="aimanager-broker-12" value={rlTrainConfig.broker} onChange={(e) => setRlTrainConfig({...rlTrainConfig, broker: e.target.value})} className="w-full bg-slate-900 border border-line rounded p-2 text-sm focus:border-indigo-500 outline-none">
                                            <option value="angel_one">Angel One</option>
                                            <option value="fyers">Fyers</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label htmlFor="aimanager-data-source-13" className="text-xs text-fg-4 uppercase tracking-wider font-bold block mb-1">Data Source</label>
                                        <select id="aimanager-data-source-13" value={rlTrainConfig.dataSource} onChange={(e) => setRlTrainConfig({...rlTrainConfig, dataSource: e.target.value})} className="w-full bg-slate-900 border border-line rounded p-2 text-sm focus:border-indigo-500 outline-none">
                                            <option value="AUTO">AUTO</option>
                                            <option value="SPOT">SPOT</option>
                                            <option value="FUTURES">FUTURES</option>
                                            <option value="ARCHIVE">ARCHIVE</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label htmlFor="aimanager-timeframe-14" className="text-xs text-fg-4 uppercase tracking-wider font-bold block mb-1">Timeframe</label>
                                        <select id="aimanager-timeframe-14" value={rlTrainConfig.resolution} onChange={(e) => setRlTrainConfig({...rlTrainConfig, resolution: e.target.value})} className="w-full bg-slate-900 border border-line rounded p-2 text-sm focus:border-indigo-500 outline-none">
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
                                    <label htmlFor="aimanager-custom-model-name-15" className="text-xs text-fg-4 uppercase tracking-wider font-bold block mb-1">Custom Model Name <span className="text-fg-6 font-normal normal-case">(optional)</span></label>
                                    <input id="aimanager-custom-model-name-15" type="text" placeholder="e.g. SCALPER_BOT_V2" value={rlTrainConfig.customName} onChange={(e) => setRlTrainConfig({...rlTrainConfig, customName: e.target.value})} className="w-full bg-slate-900 border border-line rounded p-2 text-sm focus:border-indigo-500 outline-none placeholder-fg-6" />
                                </div>

                                {/* Feature profile */}
                                <div>
                                    <label htmlFor="aimanager-feature-profile-16" className="text-xs text-fg-4 uppercase tracking-wider font-bold block mb-1">
                                        Feature Profile
                                        <span className="ml-2 text-3xs text-indigo-400 font-normal normal-case">
                                            {rlTrainConfig.profile === 'lean'          && '61 features — best signal:noise ratio'}
                                            {rlTrainConfig.profile === 'lean_mtf'      && '73 features — lean + 60m/1D macro · MTF Transformer'}
                                            {rlTrainConfig.profile === 'lean_cdl'      && '77 features — lean + 16 candlesticks'}
                                            {rlTrainConfig.profile === 'smart_money'   && '73 features — SL hunts + liquidity pools + institutional'}
                                            {rlTrainConfig.profile === 'base'          && '76 features — balanced default'}
                                            {rlTrainConfig.profile === 'quantum'       && '84 features — physics-inspired'}
                                            {rlTrainConfig.profile === 'mtf_full'      && '88 features — separate Transformer per TF (15m/60m/1D)'}
                                            {rlTrainConfig.profile === 'dow_theory'    && '81 features — swing structure'}
                                            {rlTrainConfig.profile === 'cdl_rich'      && '92 features — pattern specialist'}
                                            {rlTrainConfig.profile === 'comprehensive' && '117 features — all groups · MTF Transformer'}
                                            {rlTrainConfig.profile === 'chart_vision'  && '97 features — EMA cross + Fib + Trendlines'}
                                            {rlTrainConfig.profile === 'focused_mtf'   && '44 features — importance-filtered, no volume/CCI/ATR/BB'}
                                        </span>
                                    </label>
                                    <select id="aimanager-feature-profile-16" value={rlTrainConfig.profile} onChange={(e) => setRlTrainConfig({...rlTrainConfig, profile: e.target.value})} className="w-full bg-slate-900 border border-line rounded p-2 text-sm focus:border-indigo-500 outline-none">
                                        <option value="lean">Lean — Best signal:noise, no BB/SuperTrend/OB (61 features)</option>
                                        <option value="lean_mtf">Lean MTF — Lean + 60m/1D macro bias · MTF Transformer (73 features)</option>
                                        <option value="lean_cdl">Lean CDL — Lean + 16 extra candlestick patterns (77 features)</option>
                                        <option value="smart_money">Smart Money — SL hunts + liquidity pools + institutional flow (73 features)</option>
                                        <option value="base">Base — Core TA + SMC/Wyckoff/OB (76 features)</option>
                                        <option value="quantum">Quantum — Physics-inspired market state (84 features)</option>
                                        <option value="mtf_full">MTF Full — Separate Transformer per TF: 15m/60m/1D (88 features)</option>
                                        <option value="dow_theory">Dow Theory — Swing HH/HL/LH/LL structure (81 features)</option>
                                        <option value="cdl_rich">CDL Rich — 21 candlestick patterns (92 features)</option>
                                        <option value="comprehensive">Comprehensive — All features · MTF Transformer (117 features)</option>
                                        <option value="chart_vision">Chart Vision — EMA cross + Fibonacci + Trendlines (97 features)</option>
                                        <option value="focused_mtf">Focused MTF — Importance winners only: MTF+SuperTrend+SMC+MACD (44 features)</option>
                                    </select>
                                    <p className="text-3xs text-fg-5 mt-1">Each profile trains a specialist model — you can run multiple profiles simultaneously.</p>
                                </div>

                                {/* ── Advanced Hyperparameters ── */}
                                <details className="group">
                                    <summary className="cursor-pointer text-xs text-fg-4 uppercase tracking-wider font-bold flex items-center gap-2 select-none">
                                        <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                                        Advanced Hyperparameters
                                        <span className="text-3xs text-fg-6 font-normal normal-case">
                                            {rlTrainConfig.engineMode === 'NITRO'
                                                ? 'LR (fixed) · Epochs · GAE · Gamma · Entropy · Curriculum · Minibatch'
                                                : 'LR · Epochs · GAE · Gamma · Entropy · Curriculum · Batch'}
                                        </span>
                                    </summary>

                                    <div className="mt-3 space-y-4 pl-2 border-l border-line">

                                        {/* Learning Rate — single field for NITRO (fixed), two for STANDARD (decaying) */}
                                        {rlTrainConfig.engineMode === 'NITRO' ? (
                                            <div>
                                                <label htmlFor="aimanager-learning-rate-17" className="text-xs text-fg-4 font-semibold block mb-1">Learning Rate
                                                    {/* amber-400, not amber-600: 600 is a solid-bg/border shade, and
                                                        as ink it was already failing on dark (2.2-2.5:1). 400 is the
                                                        accent-INK shade and inverts with the mode: >=4.4:1 in all 12. */}
                                                    <span className="ml-1 text-3xs text-amber-400 font-normal">fixed · no decay in Nitro</span>
                                                </label>
                                                <select id="aimanager-learning-rate-17" value={rlTrainConfig.lrInitial} onChange={(e) => setRlTrainConfig({...rlTrainConfig, lrInitial: parseFloat(e.target.value)})} className="w-full bg-slate-900 border border-amber-700/50 rounded p-2 text-sm focus:border-amber-500 outline-none">
                                                    <option value={0.001}>1e-3 — Aggressive (fast but unstable)</option>
                                                    <option value={0.0005}>5e-4 — Fast learning</option>
                                                    <option value={0.0003}>3e-4 — Default ✓</option>
                                                    <option value={0.0001}>1e-4 — Conservative</option>
                                                    <option value={0.00003}>3e-5 — Very slow (fine-tuning)</option>
                                                </select>
                                                <p className="text-3xs text-amber-400/70 mt-1">JAX Nitro applies a constant LR across all phases — LR End / linear decay is not used.</p>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label htmlFor="aimanager-lr-start-18" className="text-xs text-fg-4 font-semibold block mb-1">LR Start
                                                        <span className="ml-1 text-3xs text-fg-6 font-normal">initial learning rate</span>
                                                    </label>
                                                    <select id="aimanager-lr-start-18" value={rlTrainConfig.lrInitial} onChange={(e) => setRlTrainConfig({...rlTrainConfig, lrInitial: parseFloat(e.target.value)})} className="w-full bg-slate-900 border border-line rounded p-2 text-sm focus:border-indigo-500 outline-none">
                                                        <option value={0.001}>1e-3 — Aggressive (fast but unstable)</option>
                                                        <option value={0.0005}>5e-4 — Fast learning</option>
                                                        <option value={0.0003}>3e-4 — Default ✓</option>
                                                        <option value={0.0001}>1e-4 — Conservative</option>
                                                        <option value={0.00003}>3e-5 — Very slow (fine-tuning)</option>
                                                    </select>
                                                    <p className="text-3xs text-fg-5 mt-1">Too high = policy collapses. Too low = never converges.</p>
                                                </div>
                                                <div>
                                                    <label htmlFor="aimanager-lr-end-19" className="text-xs text-fg-4 font-semibold block mb-1">LR End
                                                        <span className="ml-1 text-3xs text-fg-6 font-normal">final learning rate</span>
                                                    </label>
                                                    <select id="aimanager-lr-end-19" value={rlTrainConfig.lrFinal} onChange={(e) => setRlTrainConfig({...rlTrainConfig, lrFinal: parseFloat(e.target.value)})} className="w-full bg-slate-900 border border-line rounded p-2 text-sm focus:border-indigo-500 outline-none">
                                                        <option value={0.0003}>3e-4 — No decay</option>
                                                        <option value={0.0001}>1e-4 — Default ✓</option>
                                                        <option value={0.00003}>3e-5 — Strong decay</option>
                                                        <option value={0.00001}>1e-5 — Very strong decay</option>
                                                    </select>
                                                    <p className="text-3xs text-fg-5 mt-1">LR decays linearly from Start → End over all timesteps.</p>
                                                </div>
                                            </div>
                                        )}

                                        {/* n_epochs + GAE lambda */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-xs text-fg-4 font-semibold block mb-1">PPO Epochs
                                                    <span className="ml-1 text-3xs text-fg-6 font-normal">gradient passes per rollout</span>
                                                </label>
                                                {rlTrainConfig.engineMode === 'NITRO' ? (
                                                    <select value={rlTrainConfig.nEpochs} onChange={(e) => setRlTrainConfig({...rlTrainConfig, nEpochs: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-amber-700/50 rounded p-2 text-sm focus:border-amber-500 outline-none">
                                                        <option value={1}>1 — Single pass · maximum stability</option>
                                                        <option value={2}>2 — Conservative</option>
                                                        <option value={4}>4 — Default ✓ · JAX optimal</option>
                                                        <option value={6}>6 — More gradient steps</option>
                                                        <option value={8}>8 — Max (watch KL divergence)</option>
                                                    </select>
                                                ) : (
                                                    <select value={rlTrainConfig.nEpochs} onChange={(e) => setRlTrainConfig({...rlTrainConfig, nEpochs: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-line rounded p-2 text-sm focus:border-indigo-500 outline-none">
                                                        <option value={5}>5 — Stable, less efficient</option>
                                                        <option value={8}>8 — Slightly conservative</option>
                                                        <option value={10}>10 — Default ✓</option>
                                                        <option value={15}>15 — More learning per batch</option>
                                                        <option value={20}>20 — Max (risk of divergence)</option>
                                                    </select>
                                                )}
                                                <p className="text-3xs text-fg-5 mt-1">
                                                    {rlTrainConfig.engineMode === 'NITRO'
                                                        ? 'Nitro pool is large — fewer epochs prevent policy drift on stale data.'
                                                        : 'Higher = more efficient use of data. Too high = clips trigger, policy drifts.'}
                                                </p>
                                            </div>
                                            <div>
                                                <label htmlFor="aimanager-gae-lambda-20" className="text-xs text-fg-4 font-semibold block mb-1">GAE Lambda
                                                    <span className="ml-1 text-3xs text-fg-6 font-normal">bias/variance tradeoff</span>
                                                </label>
                                                <select id="aimanager-gae-lambda-20" value={rlTrainConfig.gaeLambda} onChange={(e) => setRlTrainConfig({...rlTrainConfig, gaeLambda: parseFloat(e.target.value)})} className="w-full bg-slate-900 border border-line rounded p-2 text-sm focus:border-indigo-500 outline-none">
                                                    <option value={0.90}>0.90 — Low variance · scalping</option>
                                                    <option value={0.92}>0.92 — Scalping lean</option>
                                                    <option value={0.95}>0.95 — Default ✓ · balanced</option>
                                                    <option value={0.97}>0.97 — Swing trading</option>
                                                    <option value={0.99}>0.99 — Long horizon · low bias</option>
                                                </select>
                                                <p className="text-3xs text-fg-5 mt-1">Lower for scalping (short holds). Higher for swing (multi-hour trades).</p>
                                            </div>
                                        </div>

                                        {/* Gamma */}
                                        <div>
                                            <label htmlFor="aimanager-gamma-discount-factor-21" className="text-xs text-fg-4 font-semibold block mb-1">Gamma (Discount Factor)
                                                <span className="ml-1 text-3xs text-fg-6 font-normal">how much future rewards matter</span>
                                            </label>
                                            <select id="aimanager-gamma-discount-factor-21" value={rlTrainConfig.gamma} onChange={(e) => setRlTrainConfig({...rlTrainConfig, gamma: parseFloat(e.target.value)})} className="w-full bg-slate-900 border border-line rounded p-2 text-sm focus:border-indigo-500 outline-none">
                                                <option value={0.95}>0.95 — Scalping: focus on immediate P&L</option>
                                                <option value={0.97}>0.97 — Intraday short holds</option>
                                                <option value={0.99}>0.99 — Default ✓ · balanced intraday</option>
                                                <option value={0.995}>0.995 — Swing: cares about final trade outcome</option>
                                                <option value={0.999}>0.999 — Long horizon (slow to converge)</option>
                                            </select>
                                            <p className="text-3xs text-fg-5 mt-1">0.99 means a reward 100 steps away is worth 37% of an immediate one. Lower = more present-focused.</p>
                                        </div>

                                        {/* Entropy */}
                                        <div>
                                            <label className="text-xs text-fg-4 font-semibold block mb-1">Entropy Schedule
                                                <span className="ml-1 text-3xs text-fg-6 font-normal">exploration → exploitation across phases</span>
                                            </label>
                                            <div className="grid grid-cols-4 gap-2">
                                                {[
                                                    { key: 'entP1Start', label: 'P1 Start', default: 0.10, tip: 'High = more random early exploration' },
                                                    { key: 'entP1End',   label: 'P1 End',   default: 0.04, tip: 'P2 starts from this value' },
                                                    { key: 'entP2End',   label: 'P2 End',   default: 0.015, tip: 'P3 starts from this value' },
                                                    { key: 'entP3End',   label: 'P3 End',   default: 0.005, tip: 'Final exploitation level' },
                                                ].map(({ key, label }) => (
                                                    <div key={key}>
                                                        <label className="text-3xs text-fg-5 block mb-1">{label}</label>
                                                        <input
                                                            type="number" step="0.001" min="0.001" max="0.5"
                                                            value={rlTrainConfig[key]}
                                                            onChange={(e) => setRlTrainConfig({...rlTrainConfig, [key]: parseFloat(e.target.value)})}
                                                            className="w-full bg-slate-900 border border-line rounded p-1.5 text-xs focus:border-indigo-500 outline-none"
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                            <p className="text-3xs text-fg-5 mt-1">Higher values = more exploration (random actions). Decays across phases: P1→P2→P3. Raise P1 Start if model collapses to Hold-only.</p>
                                        </div>

                                        {/* Curriculum */}
                                        <div>
                                            <label htmlFor="aimanager-curriculum-split-p1-p2-p3-22" className="text-xs text-fg-4 font-semibold block mb-1">Curriculum Split (P1/P2/P3 %)
                                                <span className="ml-1 text-3xs text-fg-6 font-normal">must sum to 100</span>
                                            </label>
                                            <select id="aimanager-curriculum-split-p1-p2-p3-22" value={rlTrainConfig.curriculum} onChange={(e) => setRlTrainConfig({...rlTrainConfig, curriculum: e.target.value})} className="w-full bg-slate-900 border border-line rounded p-2 text-sm focus:border-indigo-500 outline-none">
                                                <option value="20/20/60">20/20/60 — Max final-phase (best for long datasets)</option>
                                                <option value="20/30/50">20/30/50 — More recent data emphasis</option>
                                                <option value="30/30/40">30/30/40 — Default ✓ · balanced</option>
                                                <option value="33/33/34">33/33/34 — Equal phases</option>
                                                <option value="40/30/30">40/30/30 — More historical (crash/recovery learning)</option>
                                                <option value="50/25/25">50/25/25 — Heavy historical emphasis</option>
                                            </select>
                                            <p className="text-3xs text-fg-5 mt-1">
                                                P1 = oldest {rlTrainConfig.curriculum.split('/')[0]}% of training rows (historical patterns).
                                                P2 = oldest {parseInt(rlTrainConfig.curriculum.split('/')[0]) + parseInt(rlTrainConfig.curriculum.split('/')[1])}% (expanding window).
                                                P3 = full training set (all regimes).
                                            </p>
                                        </div>

                                        {/* Batch Size — options differ by engine because pool sizes differ */}
                                        <div>
                                            <label className="text-xs text-fg-4 font-semibold block mb-1">
                                                {rlTrainConfig.engineMode === 'NITRO' ? 'Minibatch Size' : 'Batch Size'}
                                                <span className="ml-1 text-3xs text-fg-6 font-normal">gradient step size (0 = auto)</span>
                                            </label>
                                            {rlTrainConfig.engineMode === 'NITRO' ? (
                                                <select value={rlTrainConfig.batchSize} onChange={(e) => setRlTrainConfig({...rlTrainConfig, batchSize: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-amber-700/50 rounded p-2 text-sm focus:border-amber-500 outline-none">
                                                    <option value={0}>0 — Auto (pool ÷ 64)</option>
                                                    <option value={512}>512 — Small · many gradient steps</option>
                                                    <option value={1024}>1024 — Default ✓ · JAX optimal</option>
                                                    <option value={2048}>2048 — Large · stable, fewer steps</option>
                                                    <option value={4096}>4096 — Very large · best for 8-GPU</option>
                                                    <option value={8192}>8192 — Max (≈ ¼ of default pool)</option>
                                                </select>
                                            ) : (
                                                <select value={rlTrainConfig.batchSize} onChange={(e) => setRlTrainConfig({...rlTrainConfig, batchSize: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-line rounded p-2 text-sm focus:border-indigo-500 outline-none">
                                                    <option value={0}>0 — Auto (recommended: 512)</option>
                                                    <option value={256}>256 — Smaller · noisier gradients, more updates</option>
                                                    <option value={512}>512 — Gold Standard ✓ · good bias-variance balance</option>
                                                    <option value={1024}>1024 — Larger · stable but slower to improve</option>
                                                    <option value={2048}>2048 — Max (= full rollout, no mini-batching)</option>
                                                </select>
                                            )}
                                            <p className="text-3xs text-fg-5 mt-1">
                                                {rlTrainConfig.engineMode === 'NITRO'
                                                    ? `Pool = ${rlTrainConfig.nitroNEnvs} envs × ${rlTrainConfig.nitroNSteps} steps = ${(rlTrainConfig.nitroNEnvs * rlTrainConfig.nitroNSteps).toLocaleString()} transitions. Minibatch must divide evenly into pool.`
                                                    : 'Pool = n_envs × n_steps (auto-sized per hardware). Batch must divide evenly into pool.'}
                                            </p>
                                        </div>

                                    </div>
                                </details>

                                {/* v6.18 — Exit Cooldown */}
                                <div>
                                    <label htmlFor="aimanager-exit-cooldown-23" className="text-xs text-fg-4 uppercase tracking-wider font-bold block mb-1">
                                        Exit Cooldown <span className="text-fg-5 font-normal normal-case">(bars after exit before re-entry)</span>
                                    </label>
                                    <select id="aimanager-exit-cooldown-23" value={rlTrainConfig.exitCooldown} onChange={(e) => setRlTrainConfig({...rlTrainConfig, exitCooldown: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-line rounded p-2 text-sm focus:border-indigo-500 outline-none">
                                        <option value={0}>0 — Disabled (no cooldown)</option>
                                        <option value={3}>3 — Light (15 min on 5m bars)</option>
                                        <option value={5}>5 — Moderate ✓ (25 min)</option>
                                        <option value={7}>7 — Standard (35 min)</option>
                                        <option value={10}>10 — Aggressive (50 min)</option>
                                    </select>
                                    <p className="text-3xs text-fg-5 mt-1">Prevents rapid exit/re-entry spam. Adds proportional penalty for re-entering within cooldown window.</p>
                                </div>

                                {/* v6.18 — Exogenous CSV */}
                                <div>
                                    <label htmlFor="aimanager-exo-csv-path-24" className="text-xs text-fg-4 uppercase tracking-wider font-bold block mb-1">
                                        Exo CSV Path <span className="text-fg-5 font-normal normal-case">(optional leading indicator)</span>
                                    </label>
                                    <input id="aimanager-exo-csv-path-24"
                                        type="text"
                                        placeholder="/data/XAUUSD_5m.csv"
                                        value={rlTrainConfig.exoCsv}
                                        onChange={(e) => setRlTrainConfig({...rlTrainConfig, exoCsv: e.target.value})}
                                        className="w-full bg-slate-900 border border-line rounded p-2 text-sm focus:border-indigo-500 outline-none font-mono"
                                    />
                                    <p className="text-3xs text-fg-5 mt-1">Path to exogenous CSV (e.g. XAUUSD spot) inside the training container. Must have datetime index + close column. Merged as <code className="text-fg-4">exo_close_norm</code>.</p>
                                </div>

                                {/* Base model (continual learning) */}
                                <div>
                                    <label htmlFor="aimanager-base-model-25" className="text-xs text-fg-4 uppercase tracking-wider font-bold block mb-1">Base Model <span className="text-fg-6 font-normal normal-case">(continual learning)</span></label>
                                    <select id="aimanager-base-model-25" value={rlTrainConfig.baseModel} onChange={(e) => setRlTrainConfig({...rlTrainConfig, baseModel: e.target.value})} className="w-full bg-slate-900 border border-line rounded p-2 text-sm focus:border-indigo-500 outline-none">
                                        <option value="">-- None (Train from scratch) --</option>
                                        {availableRlModels.flatMap((model, idx) => {
                                            const finalFile = model.model_file || `${model.symbol}_ppo_final.zip`;
                                            const date = model.trained_at || model.timestamp ? new Date(model.timestamp || model.trained_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : 'Unknown';
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
                                <p className="text-3xs text-fg-5 text-center">You can launch multiple jobs simultaneously — each runs in its own process.</p>

                                {/* Model registry */}
                                <div className="mt-4 border-t border-line pt-6">
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="text-sm font-bold text-fg-3 flex items-center gap-2">
                                            <FaBrain className="text-indigo-400" /> Saved RL Models
                                        </h3>
                                        <div className="flex gap-2 items-center">
                                            {/* The file button was the Tailwind-docs pale chip (bg-indigo-50 +
                                                text-indigo-700), which inverts catastrophically: shades 50/100
                                                sit in the accent INK band on light themes (L 0.28), so the chip
                                                became dark-indigo-on-dark-indigo (1.95:1). Re-roled onto the
                                                solid band, which is exactly the Upload button beside it — 5.7:1
                                                or better in all 12 themes, and the two controls now match. */}
                                            <input type="file" accept=".zip" onChange={(e) => setUploadFile(e.target.files[0])} className="text-xs text-fg-4 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-500" />
                                            <button onClick={handleUploadModel} disabled={!uploadFile || uploadingModel} className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-xs px-3 py-1.5 rounded transition-colors">
                                                {uploadingModel ? 'Uploading...' : 'Upload'}
                                            </button>
                                        </div>
                                    </div>
                                    {availableRlModels.length === 0 ? (
                                        <div className="text-center py-6 bg-slate-800/50 rounded-lg border border-line/50">
                                            <p className="text-sm text-fg-4">No trained PPO models found in registry.</p>
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto rounded-lg border border-line">
                                            <table className="w-full text-left text-xs whitespace-nowrap">
                                                <thead className="bg-slate-800 text-fg-4 uppercase tracking-wider">
                                                    <tr>
                                                        <th className="px-4 py-3 font-semibold">Symbol / Name</th>
                                                        <th className="px-4 py-3 font-semibold">Data Range</th>
                                                        <th className="px-4 py-3 font-semibold">Action Bias</th>
                                                        <th className="px-4 py-3 font-semibold text-right">Size/Action</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-line/50 bg-slate-900/50">
                                                    {availableRlModels.map((model, idx) => (
                                                        <tr key={idx} className="hover:bg-slate-800/50 transition-colors">
                                                            <td className="px-4 py-3">
                                                                <div className="font-bold text-indigo-300 flex items-center gap-2">
                                                                    {model.model_name ? `${model.model_name} (${model.symbol})` : model.symbol}
                                                                    {model.profile && model.profile !== 'base' && (
                                                                        <span className="text-4xs px-1.5 py-0.5 rounded bg-indigo-900/60 text-indigo-300 border border-indigo-700/50 font-semibold uppercase tracking-wide">{model.profile}</span>
                                                                    )}
                                                                </div>
                                                                <div className="text-fg-5 mt-1 flex gap-2">
                                                                    <span>{new Date(model.timestamp || model.trained_at).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                                                    <span>•</span>
                                                                    <span>{model.timesteps?.toLocaleString() || 0} steps</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 text-fg-3">
                                                                <div>{model.data_length ? `${model.data_length.toLocaleString()} candles` : (model.description || 'N/A')}</div>
                                                                <div className="text-fg-5 mt-1">{model.start_date && model.start_date !== 'N/A' ? `${model.start_date} → ${model.end_date}` : 'Custom / Uploaded'}</div>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                {model.action_distribution ? (
                                                                    <div className="flex flex-col gap-1">
                                                                        {[['Hold','slate'], ['Buy','emerald'], ['Sell','rose'], ['Exit_Long','amber'], ['Exit_Short','orange']].map(([k, c]) =>
                                                                            model.action_distribution[k] !== undefined && (
                                                                                <div key={k} className="flex items-center gap-1.5 text-3xs font-medium">
                                                                                    <span className={`w-2 h-2 rounded-full bg-${c}-${c==='slate'?'400':'500'}`}></span>
                                                                                    <span className="text-fg-3 w-10">{k.replace('_',' ')}</span>
                                                                                    <span className={`text-${c}-${c==='slate'?'400':'400'}`}>{model.action_distribution[k]}%</span>
                                                                                </div>
                                                                            )
                                                                        )}
                                                                    </div>
                                                                ) : <span className="text-fg-5 italic">No Data</span>}
                                                            </td>
                                                            <td className="px-4 py-3 text-right text-fg-4 font-mono">
                                                                <div className="flex flex-col items-end gap-1.5">
                                                                    <span className="text-xs">{model.file_size_kb ? `${model.file_size_kb} KB` : '...'}</span>
                                                                    <button onClick={() => downloadFile(model.model_file || `${model.model_name || model.symbol}_ppo_final.zip`)} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">↓ Final</button>
                                                                    {model.best_model && (
                                                                        <button onClick={() => downloadFile(model.best_model)} className="text-xs text-violet-400 hover:text-violet-300 transition-colors">↓ Best ({model.best_model_size_kb ? `${model.best_model_size_kb} KB` : '...'})</button>
                                                                    )}
                                                                    <button onClick={() => downloadFile(model._metadata_file || (model.model_file || '').replace(/_ppo_final\.zip$/, '_metadata.json').replace(/\.zip$/, '_metadata.json'))} className="text-xs text-fg-4 hover:text-fg-3 transition-colors">↓ Meta</button>
                                                                    <button onClick={() => handleDeleteModel(model.model_file || `${model.symbol}_ppo_final.zip`)} className="text-xs text-rose-400 hover:text-rose-400 transition-colors">Delete</button>
                                                                    {/* OOS Evaluate buttons */}
                                                                    <div className="border-t border-line/50 pt-1.5 mt-0.5 flex flex-col items-end gap-1">
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
                                                                                    className="text-3xs text-amber-400 hover:text-amber-300 disabled:text-fg-6 transition-colors"
                                                                                >{isFinalEval ? '⏳ Evaluating...' : 'Eval Final'}</button>
                                                                                {model.best_model && (
                                                                                    <button
                                                                                        onClick={() => handleEvaluateModel(model, 'best')}
                                                                                        disabled={!!evaluatingKey}
                                                                                        className="text-3xs text-emerald-400 hover:text-emerald-300 disabled:text-fg-6 transition-colors"
                                                                                    >{isBestEval ? '⏳ Evaluating...' : 'Eval Best'}</button>
                                                                                )}
                                                                                {(finalResult || bestResult) && (
                                                                                    <div className="mt-1 text-4xs text-left w-full space-y-0.5 border border-line/50 rounded p-1.5 bg-slate-800/60">
                                                                                        {[['final', finalResult, 'text-amber-300'], ['best', bestResult, 'text-emerald-300']].map(([label, r, cls]) =>
                                                                                            r && (
                                                                                                <div key={label}>
                                                                                                    <span className={`font-bold uppercase ${cls}`}>{label}</span>
                                                                                                    <span className="text-fg-4"> · {r.n_trades}T · WR </span>
                                                                                                    <span className={r.win_rate >= 0.5 ? 'text-emerald-400' : 'text-rose-400'}>{(r.win_rate * 100).toFixed(1)}%</span>
                                                                                                    <span className="text-fg-4"> · </span>
                                                                                                    <span className={r.total_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{r.total_pnl > 0 ? '+' : ''}{r.total_pnl}</span>
                                                                                                    <span className="text-fg-5"> · S:{r.sharpe?.toFixed(2)}</span>
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
                    <div className="bg-slate-800/50 border border-line rounded-xl p-6">
                        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                            <FaChartLine className="text-emerald-400" /> AI Backtest
                        </h2>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <label className={`cursor-pointer p-3 rounded border transition-all ${backtestConfig.strategy === 'ai_adaptive' ? 'bg-indigo-500/20 border-indigo-500' : 'bg-slate-900 border-line'}`}>
                                    <input type="radio" name="strategy" className="hidden" checked={backtestConfig.strategy === 'ai_adaptive'} onChange={() => setBacktestConfig(c => ({...c, strategy: 'ai_adaptive'}))} />
                                    <div className="font-bold text-sm">Adaptive Risk</div>
                                    <div className="text-xs text-fg-4 mt-1">Dynamic TP/SL based on confidence</div>
                                </label>
                                <label className={`cursor-pointer p-3 rounded border transition-all ${backtestConfig.strategy === 'ai_prediction' ? 'bg-indigo-500/20 border-indigo-500' : 'bg-slate-900 border-line'}`}>
                                    <input type="radio" name="strategy" className="hidden" checked={backtestConfig.strategy === 'ai_prediction'} onChange={() => setBacktestConfig(c => ({...c, strategy: 'ai_prediction'}))} />
                                    <div className="font-bold text-sm">Standard AI</div>
                                    <div className="text-xs text-fg-4 mt-1">Fixed Risk with AI Filtering</div>
                                </label>
                            </div>
                            <div className="p-4 bg-slate-900 rounded-lg space-y-3">
                                <div className="flex justify-between items-center">
                                    <label className="text-sm text-fg-3">Confidence Threshold</label>
                                    <span className="text-indigo-400 font-mono font-bold">{backtestConfig.params.confidence_threshold}</span>
                                </div>
                                <input type="range" min="0.5" max="0.9" step="0.05" value={backtestConfig.params.confidence_threshold}
                                    onChange={(e) => setBacktestConfig(c => ({ ...c, params: { ...c.params, confidence_threshold: parseFloat(e.target.value) } }))}
                                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500" />
                                {backtestConfig.strategy === 'ai_adaptive' && (
                                    <div className="flex items-center gap-2 mt-2">
                                        <input type="checkbox" checked={backtestConfig.params.use_adaptive_risk}
                                            onChange={(e) => setBacktestConfig(c => ({ ...c, params: { ...c.params, use_adaptive_risk: e.target.checked } }))}
                                            className="w-4 h-4 rounded border-line-2 bg-slate-800 text-indigo-400 focus:ring-indigo-500" />
                                        <label className="text-sm text-fg-3">Enable Dynamic TP/SL Scaling</label>
                                    </div>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="aimanager-start-date-26" className="text-xs text-fg-4 uppercase tracking-wider font-bold">Start Date</label>
                                    <input id="aimanager-start-date-26" type="date" value={backtestConfig.start_date} onChange={(e) => setBacktestConfig({...backtestConfig, start_date: e.target.value})} className="w-full bg-slate-900 border border-line rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" />
                                </div>
                                <div>
                                    <label htmlFor="aimanager-end-date-27" className="text-xs text-fg-4 uppercase tracking-wider font-bold">End Date</label>
                                    <input id="aimanager-end-date-27" type="date" value={backtestConfig.end_date} onChange={(e) => setBacktestConfig({...backtestConfig, end_date: e.target.value})} className="w-full bg-slate-900 border border-line rounded p-2 mt-1 text-sm focus:border-indigo-500 outline-none" />
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
                        <h2 className="text-base font-bold text-fg-3 flex items-center gap-2">
                            <FaRobot className="text-indigo-400" />
                            Training Jobs
                            <span className="text-xs text-fg-5 font-normal">({rlJobs.length} total · {rlJobs.filter(j => isActive(j.status)).length} running)</span>
                        </h2>
                        <button onClick={fetchRlStatus} className="text-xs text-fg-4 hover:text-fg-2 flex items-center gap-1.5 transition-colors">
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

            {/* ── Resumable Checkpoints ── */}
            {activeTab === 'rl' && checkpoints.length > 0 && (
                <div className="mt-6">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-base font-bold text-fg-3 flex items-center gap-2">
                            <FaSync className="text-amber-400" />
                            Resumable Training
                            <span className="text-xs text-fg-5 font-normal">({checkpoints.length} interrupted)</span>
                        </h2>
                        <button onClick={fetchCheckpoints} className="text-xs text-fg-4 hover:text-fg-2 flex items-center gap-1.5 transition-colors">
                            <FaSync className="w-3 h-3" /> Refresh
                        </button>
                    </div>
                    <div className="space-y-2">
                        {checkpoints.map(ckpt => (
                            <div key={ckpt.model_name} className="flex items-center gap-4 bg-slate-800/60 border border-amber-500/20 rounded-xl px-4 py-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-semibold text-sm text-fg truncate">{ckpt.model_name}</span>
                                        <span className="text-xs text-amber-400 font-mono">{ckpt.pct_complete}%</span>
                                    </div>
                                    <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-amber-500 rounded-full transition-all"
                                            style={{ width: `${ckpt.pct_complete}%` }}
                                        />
                                    </div>
                                    <div className="flex gap-3 mt-1 text-xs text-fg-5">
                                        <span>Step {ckpt.step.toLocaleString()} / {ckpt.total_timesteps.toLocaleString()}</span>
                                        <span>{new Date(ckpt.timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleResumeTraining(ckpt)}
                                    disabled={resumingModel === ckpt.model_name}
                                    className="shrink-0 px-4 py-1.5 rounded-lg text-sm font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {resumingModel === ckpt.model_name ? 'Resuming…' : 'Resume'}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Backtest Results ── */}
            {backtestResult && (
                <div className="mt-8 bg-slate-800/50 border border-line rounded-xl p-6">
                    <h2 className="text-xl font-bold mb-6">Backtest Performance</h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                        <ResultCard label="Total Return"  value={`₹${backtestResult.total_pnl?.toFixed(2)}`}    color={backtestResult.total_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'} />
                        <ResultCard label="Win Rate"      value={`${(backtestResult.win_rate * 100).toFixed(1)}%`} color="text-blue-400" />
                        <ResultCard label="Trades"        value={backtestResult.total_trades}                    color="text-fg" />
                        <ResultCard label="Drawdown"      value={`₹${backtestResult.max_drawdown?.toFixed(2)}`}  color="text-rose-400" />
                    </div>
                    <div className="h-64 w-full bg-slate-900 rounded-lg p-4">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={backtestResult.equity_curve}>
                                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                                <XAxis dataKey="timestamp" hide />
                                <YAxis stroke={ct.axis} tick={{ fill: ct.text.secondary }} />
                                <Tooltip contentStyle={ct.tooltipStyle({ borderRadius: 8 })} itemStyle={{ color: ct.tooltip.text }} />
                                <Line type="monotone" dataKey="equity" stroke={ct.categorical[0]} strokeWidth={2} dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}
        </div>
    );
};

const ResultCard = ({ label, value, color }) => (
    <div className="bg-slate-900 p-4 rounded-lg border border-line">
        <div className="text-fg-5 text-xs uppercase tracking-wider font-bold mb-1">{label}</div>
        <div className={`text-2xl font-mono font-bold ${color}`}>{value}</div>
    </div>
);

export default AiManager;
