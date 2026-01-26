
import React, { useState, useEffect } from 'react';
import { FaRobot, FaTrash, FaPlus, FaSync } from 'react-icons/fa';

const AiManager = () => {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showTrainModal, setShowTrainModal] = useState(false);
  
  // Training Form State
  const [trainSymbol, setTrainSymbol] = useState('NSE:NIFTYBANK-INDEX');
  const [trainModelName, setTrainModelName] = useState(''); // NEW: Custom Model Name
  const [trainSource, setTrainSource] = useState('FUTURES'); // FUTURES or SPOT
  const [epochs, setEpochs] = useState(20);
  const [ignoreVolume, setIgnoreVolume] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [trainStatus, setTrainStatus] = useState(null); // 'training', 'success', 'error'

  const [instrumentConfig, setInstrumentConfig] = useState({});

  useEffect(() => {
    fetchModels();
    fetchInstruments();
  }, []);

  const fetchInstruments = async () => {
       try {
           const res = await fetch('http://localhost:5000/api/config/instruments');
           const data = await res.json();
           setInstrumentConfig(data);
       } catch (err) {
           console.error("Failed to fetch instruments", err);
       }
  };

  const fetchModels = async () => {
    try {
      setLoading(true);
      const res = await fetch('http://localhost:5000/api/ai/models');
      const data = await res.json();
      setModels(data);
    } catch (err) {
      console.error("Failed to fetch models", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (symbol) => {
    if (!confirm(`Are you sure you want to delete the model for ${symbol}?`)) return;
    try {
      const res = await fetch(`http://localhost:5000/api/ai/model/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.status === 'success') {
        fetchModels();
      } else {
        alert("Error: " + data.error);
      }
    } catch (err) {
      alert("Delete Failed");
    }
  };

  const handleTrain = async () => {
    setTrainStatus('training');
    try {
      const res = await fetch('http://localhost:5000/api/ai/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            symbol: trainSymbol,
            modelName: trainModelName || null, // Pass Name
            dataSource: trainSource,
            epochs: parseInt(epochs),
            startDate: startDate || null, 
            endDate: endDate || null,
            ignoreVolume: ignoreVolume
        })
      });
      const data = await res.json();
      
      if (data.status === 'success') {
        setTrainStatus('success');
        setTimeout(() => {
             setShowTrainModal(false);
             setTrainStatus(null);
             fetchModels();
        }, 1500);
      } else {
        alert("Training Failed: " + data.error);
        setTrainStatus('error');
      }
    } catch (err) {
      alert("Training Request Failed");
      setTrainStatus('error');
    }
  };

  return (
    <div className="p-6 bg-gray-900 min-h-screen text-white">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
            <FaRobot className="text-purple-400" /> AI Model Manager
        </h1>
        <div className='flex gap-2'>
            <button onClick={fetchModels} className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded flex items-center gap-2">
                <FaSync className={loading ? "animate-spin" : ""} /> Refresh
            </button>
            <button onClick={() => setShowTrainModal(true)} className="bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-2 rounded flex items-center gap-2 font-bold hover:scale-105 transition">
                <FaPlus /> Train New Model
            </button>
        </div>
      </div>

      {/* Model Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {models.length === 0 && !loading && (
            <div className="col-span-3 text-center text-gray-400 py-10 border border-dashed border-gray-700 rounded-lg">
                No Custom Models Found. Train one to get started!
            </div>
        )}
        
        {models.map((model, idx) => (
            <div key={idx} className="bg-gray-800 rounded-xl p-5 border border-gray-700 shadow-lg hover:border-purple-500 transition">
                <div className="flex justify-between items-start mb-4">
                    <div className="w-3/4">
                       <h3 className="text-lg font-bold text-white truncate">{model.name || model.symbol}</h3>
                       <div className="text-xs text-blue-400 font-mono">{model.symbol}</div>
                    </div>
                    <button onClick={() => handleDelete(model.name || model.symbol)} className="text-red-400 hover:text-red-200 p-1">
                        <FaTrash />
                    </button>
                </div>
                
                <div className="space-y-2 text-sm text-gray-300">
                    <div className="flex justify-between">
                        <span>Last Trained:</span>
                        <span className="text-gray-400">{model.last_trained}</span>
                    </div>
                    
                     <div className="flex justify-between text-xs text-gray-500">
                        <span>Epochs: {model.epochs || 20}</span>
                        <span>Source: {model.dataSource || 'Auto'}</span>
                    </div>

                     {model.range && model.range.start ? (
                        <div className="text-xs text-gray-500 text-center border-t border-gray-700 pt-1 mt-1">
                             {model.range.start} ➝ {model.range.end}
                        </div>
                     ) : (
                         <div className="text-xs text-gray-500 text-center border-t border-gray-700 pt-1 mt-1 italic">
                             Automated Range
                        </div>
                     )}

                    <div className="grid grid-cols-2 gap-2 mt-3">
                        <div className="bg-green-900/30 p-2 rounded text-center border border-green-800">
                            <div className="text-xs text-green-400">Long Acc</div>
                            <div className="text-lg font-bold text-green-300">{(model.accuracy.long * 100).toFixed(1)}%</div>
                        </div>
                        <div className="bg-red-900/30 p-2 rounded text-center border border-red-800">
                            <div className="text-xs text-red-400">Short Acc</div>
                            <div className="text-lg font-bold text-red-300">{(model.accuracy.short * 100).toFixed(1)}%</div>
                        </div>
                    </div>
                    
                    <div className="mt-3 text-xs text-gray-500">
                        Features: {model.features ? model.features.join(', ') : 'Unknown'}
                    </div>
                </div>
            </div>
        ))}
      </div>
      {showTrainModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm">
            <div className="bg-gray-800 p-6 rounded-xl w-full max-w-md border border-gray-600 shadow-2xl">
                <h2 className="text-xl font-bold mb-4">Train New Model</h2>
                
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm text-gray-400 mb-1">Model Name (Optional)</label>
                        <input 
                            type="text" 
                            placeholder="e.g. BankNifty_Aggressive_2024" 
                            className="w-full bg-gray-900 border border-gray-700 p-2 rounded text-white text-sm"
                            value={trainModelName}
                            onChange={(e) => setTrainModelName(e.target.value)}
                        />
                        <div className="text-[10px] text-gray-500 mt-1">Leave blank to use Symbol name</div>
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-1">Select Symbol</label>
                        <select 
                            value={trainSymbol}
                            onChange={(e) => setTrainSymbol(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-700 p-2 rounded text-white"
                        >
                            {Object.keys(instrumentConfig).length === 0 && <option>Loading...</option>}
                            
                            <optgroup label="Indices">
                                {Object.entries(instrumentConfig)
                                    .filter(([k]) => !k.includes('-EQ') && !k.startsWith('MCX:'))
                                    .map(([key, config]) => (
                                        <option key={key} value={key}>{config.underlying}</option>
                                    ))}
                            </optgroup>

                            <optgroup label="Commodities (MCX)">
                                {Object.entries(instrumentConfig)
                                    .filter(([k]) => k.startsWith('MCX:'))
                                    .map(([key, config]) => (
                                        <option key={key} value={key}>{config.underlying}</option>
                                    ))}
                            </optgroup>

                            <optgroup label="Stocks">
                                {Object.entries(instrumentConfig)
                                    .filter(([k]) => k.includes('-EQ'))
                                    .map(([key, config]) => (
                                        <option key={key} value={key}>{config.underlying}</option>
                                    ))}
                            </optgroup>
                        </select>
                        <input 
                            type="text" 
                            placeholder="Or Custom Symbol..." 
                            className="w-full bg-gray-900 border border-gray-700 p-2 rounded mt-2 text-xs"
                            onChange={(e) => setTrainSymbol(e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Start Date</label>
                            <input 
                                type="date" 
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="w-full bg-gray-900 border border-gray-700 p-2 rounded text-white text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">End Date</label>
                            <input 
                                type="date" 
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="w-full bg-gray-900 border border-gray-700 p-2 rounded text-white text-sm"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-1">Data Source</label>
                        <div className="flex gap-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="radio" checked={trainSource === 'FUTURES'} onChange={() => setTrainSource('FUTURES')} />
                                Futures (Auto-Monthly)
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="radio" checked={trainSource === 'SPOT'} onChange={() => setTrainSource('SPOT')} />
                                Spot Data
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="radio" checked={trainSource === 'ARCHIVE'} onChange={() => setTrainSource('ARCHIVE')} />
                                Local Archive (5m)
                            </label>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-1">Epochs (Training Speed)</label>
                        <input 
                            type="number" 
                            value={epochs}
                            onChange={(e) => setEpochs(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-700 p-2 rounded"
                            min="5" max="100"
                        />
                    </div>

                     <div>
                        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
                             <input 
                                type="checkbox" 
                                checked={ignoreVolume} 
                                onChange={(e) => setIgnoreVolume(e.target.checked)} 
                            />
                            Ignore Volume (Price Action Only)
                        </label>
                    </div>
                </div>

                <div className="mt-6 flex justify-end gap-3">
                    <button 
                        onClick={() => setShowTrainModal(false)}
                        className="px-4 py-2 text-gray-400 hover:text-white"
                        disabled={trainStatus === 'training'}
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={handleTrain}
                        disabled={trainStatus === 'training'}
                        className={`px-6 py-2 rounded font-bold transition flex items-center gap-2 ${
                            trainStatus === 'training' ? 'bg-yellow-600 cursor-wait' : 
                            trainStatus === 'success' ? 'bg-green-600' : 
                            'bg-blue-600 hover:bg-blue-500'
                        }`}
                    >
                        {trainStatus === 'training' ? <><FaSync className="animate-spin" /> Training...</> : 
                         trainStatus === 'success' ? 'Success!' : 
                         'Start Training'}
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default AiManager;
