import React, { useState, useEffect } from 'react';
import { FaDatabase, FaCloudDownloadAlt, FaSpinner, FaFolderOpen } from 'react-icons/fa';

const DataManager = () => {
    const [instruments, setInstruments] = useState({});
    const [archives, setArchives] = useState({});
    const [loading, setLoading] = useState(false);
    const [archiveStatus, setArchiveStatus] = useState(null);

    // Form
    const [selectedSymbol, setSelectedSymbol] = useState('NSE:NIFTYBANK-INDEX');
    const [resolution, setResolution] = useState('5');
    // const [days, setDays] = useState(30); // Removed

    const API_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;

    useEffect(() => {
        fetchInstruments();
        fetchArchives();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchInstruments = async () => {
        try {
            const res = await fetch(`${API_URL}/config/instruments`);
            const data = await res.json();
            setInstruments(data);
        } catch (e) {
            console.error("Failed to fetch instruments", e);
        }
    };

    const fetchArchives = async () => {
        try {
            const res = await fetch(`${API_URL}/data/archives`);
            const data = await res.json();
            setArchives(data);
        } catch (e) {
            console.error("Failed to fetch archives", e);
        }
    };

    const handleArchive = async () => {
        setLoading(true);
        setArchiveStatus('Archiving...');
        try {
            const res = await fetch(`${API_URL}/data/archive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: selectedSymbol,
                    resolution: resolution
                })
            });
            const data = await res.json();
            
            if (data.status === 'success') {
                if (data.batch) {
                    const successCount = data.results.filter(r => r.status === 'success').length;
                    setArchiveStatus(`Batch Success! Archived ${successCount} files.`);
                } else {
                    setArchiveStatus(`Success! Saved to ${data.file.split('/').pop()}`);
                }
                fetchArchives();
            } else {
                setArchiveStatus(`Error: ${data.error}`);
            }
        } catch (e) {
            setArchiveStatus(`Request Failed: ${e.message}`);
        } finally {
            setLoading(false);
            setTimeout(() => setArchiveStatus(null), 3000);
        }
    };

    // Options Archival Logic
    const [optRange, setOptRange] = useState(10);
    const [optLoading, setOptLoading] = useState(false);
    const [optStatus, setOptStatus] = useState(null);
    const [expiryDates, setExpiryDates] = useState([]);
    const [selectedExpiry, setSelectedExpiry] = useState('');

    useEffect(() => {
        const fetchExpiries = async () => {
            if (!selectedSymbol) return;
            try {
                const res = await fetch(`${API_URL}/cal/expiries?symbol=${selectedSymbol}`);
                const data = await res.json();
                if (data.expiries && data.expiries.length > 0) {
                    setExpiryDates(data.expiries);
                    setSelectedExpiry(data.expiries[0].date); // Default to first (current/next)
                }
            } catch (e) {
                console.error("Failed to fetch expiries", e);
            }
        };
        fetchExpiries();
    }, [selectedSymbol, API_URL]);

    const handleOptionsArchive = async () => {
        setOptLoading(true);
        setOptStatus('Archiving Options...');
        try {
            const res = await fetch(`${API_URL}/data/archive/options`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: selectedSymbol,
                    range: parseInt(optRange),
                    expiryStr: selectedExpiry
                })
            });
            const data = await res.json();
            
            if (data.status === 'success') {
                setOptStatus(`Success! Archived ${data.stats.fetched} files.`);
                // fetchArchives(); // Might be too many to list all options files in main list
            } else {
                setOptStatus(`Error: ${data.error}`);
            }
        } catch (e) {
            setOptStatus(`Request Failed: ${e.message}`);
        } finally {
            setOptLoading(false);
            setTimeout(() => setOptStatus(null), 5000);
        }
    };

    return (
        <div className="p-6 bg-gray-900 min-h-screen text-white">
            <h1 className="text-2xl font-bold flex items-center gap-2 mb-6">
                <FaDatabase className="text-blue-400" /> Data Archivist
            </h1>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                {/* 1. Archive Control Panel */}
                <div className="space-y-6">
                
                    {/* A. Futures Archiver */}
                    <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg h-fit">
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                            <FaCloudDownloadAlt className="text-green-400" /> Futures & AI Dataset
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Symbol (Index/Future)</label>
                                <select 
                                    value={selectedSymbol}
                                    onChange={(e) => setSelectedSymbol(e.target.value)}
                                    className="w-full bg-gray-900 border border-gray-700 p-2 rounded text-white"
                                >
                                    {Object.keys(instruments).map(k => (
                                        <option key={k} value={k}>{instruments[k].underlying}</option>
                                    ))}
                                </select>
                            </div>
                            
                            <div className="grid grid-cols-1 gap-4">
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">Resolution (min)</label>
                                    <select 
                                        value={resolution}
                                        onChange={(e) => setResolution(e.target.value)}
                                        className="w-full bg-gray-900 border border-gray-700 p-2 rounded text-white"
                                    >
                                        <option value="1">1 Minute</option>
                                        <option value="5">5 Minute (Recommended)</option>
                                        <option value="15">15 Minute</option>
                                        <option value="60">1 Hour</option>
                                        <option value="D">Daily</option>
                                        <option value="ALL">All Timeframes (Batch)</option>
                                    </select>
                                </div>
                                <div className="text-xs text-gray-500 italic">
                                    * Archives active futures (~100 days). Use 'All Timeframes' for full AI training set.
                                </div>
                            </div>

                            <button 
                                onClick={handleArchive}
                                disabled={loading}
                                className={`w-full py-3 rounded font-bold transition flex justify-center items-center gap-2 ${
                                    loading ? 'bg-gray-600 cursor-wait' : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:scale-[1.02]'
                                }`}
                            >
                                {loading && <FaSpinner className="animate-spin" />}
                                {loading && archiveStatus?.includes('Archiving') ? 'Working...' : 'Archive Futures'}
                            </button>
                            
                            {archiveStatus && (
                                <div className={`p-2 rounded text-center text-sm ${archiveStatus.includes('Error') ? 'bg-red-900/30 text-red-300' : 'bg-green-900/30 text-green-300'}`}>
                                    {archiveStatus}
                                </div>
                            )}
                        </div>
                    </div>

                   {/* B. Options Archiver (New) */}
                    <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg h-fit text-purple-100 border-purple-900/50">
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                            <FaDatabase className="text-purple-400" /> Options Archiver
                        </h2>
                         <p className="text-sm text-gray-400 mb-4">
                             Fetches 1-minute history for <b>Current Month</b> Options (CE/PE) around the ATM.
                            <br/><span className="text-xs text-orange-400">⚠️ Rate Limited: Takes ~30s for 20 strikes.</span>
                        </p>

                        <div className="space-y-4">
                             <div>
                                <label className="block text-sm text-gray-400 mb-1">Expiry Date</label>
                                <select 
                                    value={selectedExpiry}
                                    onChange={(e) => setSelectedExpiry(e.target.value)}
                                    className="w-full bg-gray-900 border border-gray-700 p-2 rounded text-white"
                                >
                                    {expiryDates.map((exp) => (
                                        <option key={exp.date} value={exp.date}>{exp.label}</option>
                                    ))}
                                </select>
                            </div>
                             <div>
                                <label className="block text-sm text-gray-400 mb-1">Strike Range (+/-)</label>
                                <select 
                                    value={optRange}
                                    onChange={(e) => setOptRange(e.target.value)}
                                    className="w-full bg-gray-900 border border-gray-700 p-2 rounded text-white"
                                >
                                    <option value="5">5 Strikes (Narrow)</option>
                                    <option value="10">10 Strikes (Standard)</option>
                                    <option value="20">20 Strikes (Wide)</option>
                                </select>
                            </div>

                            <button 
                                onClick={handleOptionsArchive}
                                disabled={optLoading}
                                className={`w-full py-3 rounded font-bold transition flex justify-center items-center gap-2 ${
                                    optLoading ? 'bg-gray-600 cursor-wait' : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:scale-[1.02]'
                                }`}
                            >
                                {optLoading && <FaSpinner className="animate-spin" />}
                                {optLoading ? 'Archiving Options...' : 'Archive Option Chain'}
                            </button>

                             {optStatus && (
                                <div className={`p-2 rounded text-center text-sm ${optStatus.includes('Error') ? 'bg-red-900/30 text-red-300' : 'bg-purple-900/30 text-purple-300'}`}>
                                    {optStatus}
                                </div>
                            )}
                        </div>
                     </div>
                </div>

                {/* 2. Existing Archives List */}
                <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg">
                    <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                        <FaFolderOpen className="text-yellow-400" /> Local Archives
                    </h2>
                    
                    {Object.keys(archives).length === 0 ? (
                        <div className="text-center text-gray-500 py-10 italic">
                            No archives found.
                        </div>
                    ) : (
                        <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                            {Object.entries(archives).map(([sym, files]) => {
                                const isOption = sym.startsWith('OPTIONS:');
                                const displaySym = isOption ? sym.split(':')[1] : sym;
                                const borderClass = isOption ? 'border-purple-800' : 'border-gray-800';
                                const textClass = isOption ? 'text-purple-300' : 'text-blue-300';

                                return (
                                <div key={sym} className={`bg-gray-900 p-3 rounded border ${borderClass}`}>
                                    <div className={`font-bold ${textClass} mb-2 truncate flex items-center gap-2`} title={sym}>
                                        {isOption && <span className="text-xs bg-purple-900 text-purple-200 px-1 rounded">OPT</span>}
                                        {displaySym}
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {files.map((f, i) => (
                                            <div key={i} className="px-2 py-1 bg-gray-800 rounded text-xs border border-gray-700 text-gray-300 flex items-center gap-1">
                                                <span className={`${isOption ? 'text-purple-400' : 'text-green-400'} font-mono`}>
                                                    {isOption ? f.label : `${f.resolution}m`}
                                                </span>
                                                {!isOption && <span className="opacity-50">CSV</span>}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DataManager;
