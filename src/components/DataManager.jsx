import React, { useState, useEffect, useRef } from 'react';
import { FaDatabase, FaCloudDownloadAlt, FaSpinner, FaFolderOpen, FaCheck, FaChevronDown, FaTimes, FaSearch } from 'react-icons/fa';

// --- MultiSelect Component ---
const MultiSelect = ({ options, selectedValues, onChange, placeholder = "Select...", label = "Items" }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const wrapperRef = useRef(null);

    // Close on click outside
    useEffect(() => {
        function handleClickOutside(event) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [wrapperRef]);

    const filteredOptions = options.filter(opt => 
        opt.label.toLowerCase().includes(searchTerm.toLowerCase()) || 
        opt.value.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const toggleOption = (value) => {
        const newSelected = selectedValues.includes(value)
            ? selectedValues.filter(v => v !== value)
            : [...selectedValues, value];
        onChange(newSelected);
    };

    const handleSelectAll = () => {
        if (selectedValues.length === filteredOptions.length) {
            // Deselect all visible
            const visibleValues = filteredOptions.map(o => o.value);
            onChange(selectedValues.filter(v => !visibleValues.includes(v)));
        } else {
            // Select all visible
            const newValues = [...new Set([...selectedValues, ...filteredOptions.map(o => o.value)])];
            onChange(newValues);
        }
    };

    const handleClear = () => {
        onChange([]);
    };

    return (
        <div className="relative" ref={wrapperRef}>
            <label className="block text-sm text-gray-400 mb-1">{label}</label>
            <div 
                className="w-full bg-gray-900 border border-gray-700 p-2 rounded text-white cursor-pointer flex justify-between items-center"
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="truncate">
                    {selectedValues.length === 0 ? (
                        <span className="text-gray-500">{placeholder}</span>
                    ) : (
                        <span>{selectedValues.length} selected</span>
                    )}
                </div>
                <FaChevronDown className={`text-xs transition ${isOpen ? 'rotate-180' : ''}`} />
            </div>

            {isOpen && (
                <div className="absolute z-50 w-full mt-1 bg-gray-800 border border-gray-700 rounded-md shadow-xl max-h-64 flex flex-col">
                    <div className="p-2 border-b border-gray-700">
                        <div className="relative">
                            <FaSearch className="absolute left-2 top-2.5 text-gray-500 text-xs" />
                            <input 
                                type="text"
                                placeholder="Search..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-gray-900 border border-gray-700 rounded pl-7 pr-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
                                autoFocus
                            />
                        </div>
                        <div className="flex justify-between mt-2 text-xs">
                            <button onClick={handleSelectAll} className="text-blue-400 hover:text-blue-300">
                                {selectedValues.length === filteredOptions.length && filteredOptions.length > 0 ? "Deselect All" : "Select All"}
                            </button>
                            <button onClick={handleClear} className="text-red-400 hover:text-red-300">Clear</button>
                        </div>
                    </div>
                    
                    <div className="overflow-y-auto flex-1 p-1">
                        {filteredOptions.length === 0 ? (
                            <div className="p-2 text-center text-gray-500 text-xs">No matches</div>
                        ) : (
                            filteredOptions.map(opt => (
                                <div 
                                    key={opt.value} 
                                    onClick={() => toggleOption(opt.value)}
                                    className="flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer text-sm"
                                >
                                    <div className={`w-4 h-4 rounded border flex items-center justify-center ${selectedValues.includes(opt.value) ? 'bg-blue-600 border-blue-600' : 'border-gray-500'}`}>
                                        {selectedValues.includes(opt.value) && <FaCheck className="text-[10px] text-white" />}
                                    </div>
                                    <span className="truncate">{opt.label}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const DataManager = () => {
    const [instruments, setInstruments] = useState({});
    const [archives, setArchives] = useState({});
    const [loading, setLoading] = useState(false);
    const [archiveStatus, setArchiveStatus] = useState(null);

    // Form - Futures
    const [selectedSymbols, setSelectedSymbols] = useState(['NSE:NIFTYBANK-INDEX']);
    const [resolution, setResolution] = useState('5');

    // Dates for SPOT
    const todayStr = new Date().toISOString().split('T')[0];
    const pastStr = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Form - SPOT
    const [spotSymbols, setSpotSymbols] = useState(['NSE:NIFTYBANK-INDEX']);
    const [spotResolution, setSpotResolution] = useState('5');
    const [spotFromDate, setSpotFromDate] = useState(pastStr);
    const [spotToDate, setSpotToDate] = useState(todayStr);
    const [spotLoading, setSpotLoading] = useState(false);
    const [spotStatus, setSpotStatus] = useState(null);

    // Form - Options
    const [optRange, setOptRange] = useState(10);
    const [optLoading, setOptLoading] = useState(false);
    const [optStatus, setOptStatus] = useState(null);
    const [expiryDates, setExpiryDates] = useState([]);
    const [selectedExpiry, setSelectedExpiry] = useState('');

    const API_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;

    useEffect(() => {
        fetchInstruments();
        fetchArchives();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Fetch Expiries when SINGLE symbol selected
    useEffect(() => {
        const fetchExpiries = async () => {
            if (selectedSymbols.length !== 1) {
                setExpiryDates([]);
                setSelectedExpiry('');
                return;
            }
            
            const symbol = selectedSymbols[0];
            try {
                const res = await fetch(`${API_URL}/cal/expiries?symbol=${symbol}`);
                const data = await res.json();
                if (data.expiries && data.expiries.length > 0) {
                    setExpiryDates(data.expiries);
                    setSelectedExpiry(data.expiries[0].date);
                }
            } catch (e) {
                console.error("Failed to fetch expiries", e);
            }
        };
        fetchExpiries();
    }, [selectedSymbols, API_URL]);

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

    // --- Handlers ---

    const handleArchive = async () => {
        if (selectedSymbols.length === 0) {
            setArchiveStatus("Error: No symbols selected.");
            setTimeout(() => setArchiveStatus(null), 3000);
            return;
        }

        setLoading(true);
        let successes = 0;
        let errors = 0;

        for (let i = 0; i < selectedSymbols.length; i++) {
            const sym = selectedSymbols[i];
            setArchiveStatus(`Archiving ${i + 1}/${selectedSymbols.length}: ${sym}...`);
            
            try {
                const res = await fetch(`${API_URL}/data/archive`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symbol: sym, resolution: resolution })
                });
                const data = await res.json();
                if (data.status === 'success' || data.batch) successes++;
                else errors++;
            } catch (e) {
                console.error(e);
                errors++;
            }
        }

        setLoading(false);
        setArchiveStatus(`Batch Complete! Success: ${successes}, Failed: ${errors}`);
        setTimeout(() => setArchiveStatus(null), 5000);
        fetchArchives();
    };

    const handleSpotArchive = async () => {
        if (spotSymbols.length === 0) {
            setSpotStatus("Error: No symbols selected.");
            setTimeout(() => setSpotStatus(null), 3000);
            return;
        }

        // Validation
        const start = new Date(spotFromDate);
        const end = new Date(spotToDate);
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];

        if (start > end) {
            setSpotStatus('Error: From Date cannot be after To Date');
            setTimeout(() => setSpotStatus(null), 3000);
            return;
        }
        if (spotFromDate > todayStr) {
             setSpotStatus('Error: From Date cannot be in the future');
             setTimeout(() => setSpotStatus(null), 3000);
             return;
        }

        setSpotLoading(true);
        let successes = 0;
        let errors = 0;

        for (let i = 0; i < spotSymbols.length; i++) {
            const sym = spotSymbols[i];
            setSpotStatus(`Archiving ${i + 1}/${spotSymbols.length}: ${sym} (${spotFromDate} to ${spotToDate})...`);
            
            try {
                const res = await fetch(`${API_URL}/data/archive/spot`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        symbol: sym,
                        resolution: spotResolution,
                        fromDate: spotFromDate,
                        toDate: spotToDate
                    })
                });
                const data = await res.json();
                if (data.status === 'success' || data.batch) successes++;
                else errors++;
            } catch (e) {
                console.error(e);
                errors++;
            }
        }

        setSpotLoading(false);
        setSpotStatus(`Batch Complete! Success: ${successes}, Failed: ${errors}`);
        setTimeout(() => setSpotStatus(null), 5000);
        fetchArchives(); // Refresh list
    };

    const handleOptionsArchive = async () => {
        if (selectedSymbols.length === 0) {
            setOptStatus("Error: No symbols selected.");
            setTimeout(() => setOptStatus(null), 3000);
            return;
        }

        setOptLoading(true);
        let totalFiles = 0;
        let errors = 0;

        for (let i = 0; i < selectedSymbols.length; i++) {
            const sym = selectedSymbols[i];
            setOptStatus(`Archiving ${i + 1}/${selectedSymbols.length}: ${sym}...`);

            // If multiple symbols, force usage of default/current expiry
            const shouldUseDefaultExpiry = selectedSymbols.length > 1;
            const expiryToSend = shouldUseDefaultExpiry ? null : selectedExpiry;

            try {
                const res = await fetch(`${API_URL}/data/archive/options`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        symbol: sym,
                        range: parseInt(optRange),
                        expiryStr: expiryToSend
                    })
                });
                const data = await res.json();
                
                if (data.status === 'success') {
                    totalFiles += (data.stats?.fetched || 0);
                } else {
                    errors++;
                }
            } catch (e) {
                console.error(e);
                errors++;
            }
        }

        setOptLoading(false);
        setOptStatus(selectedSymbols.length > 1 
            ? `Batch Complete! Fetched ~${totalFiles} files. Failed: ${errors}`
            : `Success! Archived ${totalFiles} files.`
        );
        setTimeout(() => setOptStatus(null), 5000);
        // fetchArchives(); // Skipped as it might check too many files
    };

    // Transform instruments for MultiSelect
    const instrumentOptions = Object.keys(instruments).map(k => ({
        value: k,
        label: instruments[k].underlying
    }));

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
                                <MultiSelect 
                                    options={instrumentOptions}
                                    selectedValues={selectedSymbols}
                                    onChange={setSelectedSymbols}
                                    label="Symbols (Index/Future)"
                                    placeholder="Select Symbols..."
                                />
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

                    {/* B. SPOT Archiver (New) */}
                    <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg h-fit text-orange-100 border-orange-900/50">
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                             <FaDatabase className="text-orange-400" /> SPOT Data Archiver
                        </h2>
                        <p className="text-sm text-gray-400 mb-4">
                             Archive actual Index/Equity data for specific custom ranges.
                        </p>

                         <div className="space-y-4">
                             <div>
                                <MultiSelect 
                                    options={instrumentOptions}
                                    selectedValues={spotSymbols}
                                    onChange={setSpotSymbols}
                                    label="Symbols"
                                    placeholder="Select Symbols..."
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                 <div>
                                    <label className="block text-sm text-gray-400 mb-1">From Date</label>
                                    <input 
                                        type="date" 
                                        value={spotFromDate}
                                        onChange={(e) => setSpotFromDate(e.target.value)}
                                        className="w-full bg-gray-900 border border-gray-700 p-2 rounded text-white text-sm"
                                    />
                                th
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">To Date</label>
                                    <input 
                                        type="date" 
                                        value={spotToDate}
                                        onChange={(e) => setSpotToDate(e.target.value)}
                                        className="w-full bg-gray-900 border border-gray-700 p-2 rounded text-white text-sm"
                                    />
                                </div>
                            </div>
                            
                             <div>
                                <label className="block text-sm text-gray-400 mb-1">Resolution</label>
                                <select 
                                    value={spotResolution}
                                    onChange={(e) => setSpotResolution(e.target.value)}
                                    className="w-full bg-gray-900 border border-gray-700 p-2 rounded text-white"
                                >
                                    <option value="1">1 Minute</option>
                                    <option value="5">5 Minute</option>
                                    <option value="15">15 Minute</option>
                                    <option value="60">1 Hour</option>
                                    <option value="D">Daily</option>
                                    <option value="ALL">All Timeframes</option>
                                </select>
                            </div>

                            <button 
                                onClick={handleSpotArchive}
                                disabled={spotLoading}
                                className={`w-full py-3 rounded font-bold transition flex justify-center items-center gap-2 ${
                                    spotLoading ? 'bg-gray-600 cursor-wait' : 'bg-gradient-to-r from-orange-600 to-red-600 hover:scale-[1.02]'
                                }`}
                            >
                                {spotLoading && <FaSpinner className="animate-spin" />}
                                {spotLoading ? 'Archiving...' : 'Archive SPOT Data'}
                            </button>

                             {spotStatus && (
                                <div className={`p-2 rounded text-center text-sm ${spotStatus.includes('Error') ? 'bg-red-900/30 text-red-300' : 'bg-orange-900/30 text-orange-300'}`}>
                                    {spotStatus}
                                </div>
                            )}
                        </div>
                    </div>

                   {/* C. Options Archiver */}
                    <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg h-fit text-purple-100 border-purple-900/50">
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                            <FaDatabase className="text-purple-400" /> Options Archiver
                        </h2>
                         <p className="text-sm text-gray-400 mb-4">
                             Fetches 1-minute history for <b>Current Month</b> Options (CE/PE) around the ATM.
                            <br/><span className="text-xs text-orange-400">⚠️ Rate Limited: Takes ~30s for 20 strikes.</span>
                        </p>

                        <div className="space-y-4">
                            {/* Reuses Selected Futures Symbols if not separated */}
                             <div>
                                <label className="block text-sm text-gray-400 mb-1">Target Symbols</label>
                                <div className="text-sm text-gray-300 bg-gray-900 p-2 rounded border border-gray-700">
                                    {selectedSymbols.length === 0 ? "None Selected (Use Futures Panel)" : 
                                     selectedSymbols.length === 1 ? instruments[selectedSymbols[0]]?.underlying || selectedSymbols[0] : 
                                     `${selectedSymbols.length} Symbols Selected`}
                                </div>
                             </div>

                             <div>
                                <label className="block text-sm text-gray-400 mb-1">Expiry Date</label>
                                {selectedSymbols.length > 1 ? (
                                    <div className="w-full bg-gray-900 border border-gray-700 p-2 rounded text-gray-500 italic text-sm">
                                        Auto-Select (Current Month) for Batch
                                    </div>
                                ) : (
                                    <select 
                                        value={selectedExpiry}
                                        onChange={(e) => setSelectedExpiry(e.target.value)}
                                        className="w-full bg-gray-900 border border-gray-700 p-2 rounded text-white"
                                        disabled={selectedSymbols.length === 0}
                                    >
                                        {expiryDates.map((exp) => (
                                            <option key={exp.date} value={exp.date}>{exp.label}</option>
                                        ))}
                                    </select>
                                )}
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
                                const isSpot = sym.startsWith('SPOT:');
                                const displaySym = (isOption || isSpot) ? sym.split(':')[1] : sym;
                                
                                let borderClass = 'border-gray-800';
                                let textClass = 'text-blue-300';
                                let tagBg = 'bg-blue-900';
                                let tagText = 'text-blue-200';
                                let tagLabel = 'FUT';

                                if (isOption) {
                                    borderClass = 'border-purple-800';
                                    textClass = 'text-purple-300';
                                    tagBg = 'bg-purple-900';
                                    tagText = 'text-purple-200';
                                    tagLabel = 'OPT';
                                } else if (isSpot) {
                                    borderClass = 'border-orange-800';
                                    textClass = 'text-orange-300';
                                    tagBg = 'bg-orange-900';
                                    tagText = 'text-orange-200';
                                    tagLabel = 'SPOT';
                                }

                                return (
                                <div key={sym} className={`bg-gray-900 p-3 rounded border ${borderClass}`}>
                                    <div className={`font-bold ${textClass} mb-2 truncate flex items-center gap-2`} title={sym}>
                                        <span className={`text-xs ${tagBg} ${tagText} px-1 rounded`}>{tagLabel}</span>
                                        {displaySym}
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {files.map((f, i) => (
                                            <div key={i} className="px-2 py-1 bg-gray-800 rounded text-xs border border-gray-700 text-gray-300 flex items-center gap-1">
                                                <span className={`${isOption ? 'text-purple-400' : (isSpot ? 'text-orange-400' : 'text-green-400')} font-mono`}>
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
