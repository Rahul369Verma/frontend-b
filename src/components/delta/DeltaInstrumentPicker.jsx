/**
 * Delta Exchange contract picker — searches every listed contract (perpetuals,
 * options, move options, INR spot) through /api/delta/instruments.
 *
 * An accessible combobox: type to search, ↑/↓ to move, Enter to pick, Esc to
 * close. The kind filter narrows the search; the count of matches is always
 * shown, including how many were not displayed.
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../../config/api.js';
import { Segmented, Chip } from '../viz/primitives';
import { KIND_FILTERS, KIND_LABEL, describeInstrument, feePct } from './deltaFormat.js';

export default function DeltaInstrumentPicker({ value, onChange, id, label = 'Delta contract', defaultKinds = 'perpetual,future', className = '' }) {
    const autoId = useId();
    const inputId = id || `delta-picker-${autoId}`;
    const listId = `${inputId}-list`;
    const [q, setQ] = useState('');
    const [kinds, setKinds] = useState(defaultKinds);
    const [open, setOpen] = useState(false);
    const [res, setRes] = useState({ total: 0, shown: 0, results: [] });
    const [active, setActive] = useState(0);
    const [error, setError] = useState(null);
    const boxRef = useRef(null);

    useEffect(() => {
        let alive = true;
        const t = setTimeout(async () => {
            try {
                const r = await axios.get(`${API_URL}/delta/instruments`, { params: { q, kind: kinds || undefined, limit: 60 } });
                if (alive) { setRes(r.data && Array.isArray(r.data.results) ? r.data : { total: 0, shown: 0, results: [] }); setError(null); setActive(0); }
            } catch (e) { if (alive) setError(e?.response?.data?.error || e.message); }
        }, 200);
        return () => { alive = false; clearTimeout(t); };
    }, [q, kinds]);

    useEffect(() => {
        const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, []);

    const pick = (inst) => {
        if (!inst) return;
        onChange?.(inst.symbol, inst);
        setOpen(false);
        setQ('');
    };

    const onKey = (e) => {
        const n = res.results.length;
        if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(n - 1, a + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
        else if (e.key === 'Enter') { if (open && n) { e.preventDefault(); pick(res.results[active]); } }
        else if (e.key === 'Escape') setOpen(false);
    };

    return (
        <div ref={boxRef} className={`space-y-1.5 ${className}`}>
            <label htmlFor={inputId} className="block text-sm font-medium text-fg-4">{label}</label>
            <Segmented size="sm" options={KIND_FILTERS} value={kinds} onChange={setKinds} />
            <div className="relative">
                <input
                    id={inputId}
                    role="combobox"
                    aria-expanded={open}
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-activedescendant={open && res.results[active] ? `${listId}-${active}` : undefined}
                    value={q}
                    placeholder={value ? `${String(value).replace(/^DELTA:/, '')} — type to change` : 'Search: BTC, ETHUSD, XAUT, C-BTC…'}
                    onChange={(e) => { setQ(e.target.value); setOpen(true); }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={onKey}
                    className="w-full bg-slate-900 border border-line rounded p-2 text-fg text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                {open && (
                    <ul id={listId} role="listbox" aria-label="Delta contracts"
                        className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded border border-line bg-surface shadow-lg">
                        {res.results.map((i, k) => (
                            <li key={i.symbol} id={`${listId}-${k}`} role="option" aria-selected={k === active}
                                onMouseDown={(e) => { e.preventDefault(); pick(i); }}
                                onMouseEnter={() => setActive(k)}
                                className={`px-2 py-1.5 cursor-pointer text-xs flex items-center gap-2 ${k === active ? 'bg-primary/15' : ''}`}>
                                <span className="font-mono text-fg-2 shrink-0">{i.deltaSymbol}</span>
                                <span className="text-fg-5 truncate flex-1 min-w-0">{describeInstrument(i)}</span>
                                <Chip tone="muted">{KIND_LABEL[i.kind] || i.kind}</Chip>
                                <span className="text-3xs text-fg-5 shrink-0" title="Taker fee">{feePct(i.takerRate)}</span>
                            </li>
                        ))}
                        {!res.results.length && <li className="px-2 py-2 text-xs text-fg-5">{error ? `Search failed: ${error}` : 'No listed contract matches.'}</li>}
                        {res.total > res.shown && <li className="px-2 py-1 text-3xs text-fg-5 border-t border-line/60">Showing {res.shown} of {res.total} — type more to narrow.</li>}
                    </ul>
                )}
            </div>
            {value && <div className="text-2xs text-fg-5">Selected: <span className="font-mono text-fg-3">{value}</span></div>}
        </div>
    );
}
