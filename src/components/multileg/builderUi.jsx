import React, { useState } from 'react';
import { HELP } from '../../data/multilegHelp';

// ── SHARED UI BITS (same idiom as MultiLeg.jsx) ──────────────────────────────
// Components ONLY in this module — helpers live in builderFormat.js so Fast
// Refresh keeps working for both.

export function Help({ k, className = '' }) {
    const [open, setOpen] = useState(false);
    const h = HELP[k];
    if (!h) return null;                       // unknown key renders nothing, never a broken '?'
    return (
        <span className={`relative inline-block align-middle ${className}`}>
            <button type="button"
                onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
                onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
                aria-label={`What does "${h.label}" mean?`}
                aria-expanded={open}
                className="ml-1 w-3.5 h-3.5 rounded-full border border-line-2 text-fg-5 hover:text-sky-300 hover:border-sky-500 text-4xs leading-none align-middle">?</button>
            {open && (
                <>
                    <span className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
                    <span role="tooltip"
                        className="absolute z-50 left-0 top-5 w-72 rounded-lg border border-line-2 bg-slate-900 p-2.5 shadow-xl text-left normal-case font-normal tracking-normal block">
                        <span className="block text-2xs font-semibold text-sky-200 mb-1">{h.label}</span>
                        <span className="block text-2xs text-fg-2 mb-1.5">{h.short}</span>
                        <span className="block text-3xs text-fg-4 leading-relaxed">{h.detail}</span>
                        {h.gotcha && (
                            <span className="block text-3xs text-amber-300/90 leading-relaxed mt-1.5 pt-1.5 border-t border-line">
                                <span className="font-semibold">Watch out: </span>{h.gotcha}
                            </span>
                        )}
                    </span>
                </>
            )}
        </span>
    );
}

export function Tile({ label, value, sub, good, bad, warn, help, title }) {
    return (
        <div className="bg-slate-800/60 border border-line rounded p-2" title={title}>
            <div className="text-3xs text-fg-5">{label}{help ? <Help k={help} /> : null}</div>
            <div className={`text-sm font-semibold ${good ? 'text-emerald-300' : bad ? 'text-red-300' : warn ? 'text-amber-300' : 'text-fg-2'}`}>{value}</div>
            {sub ? <div className="text-4xs text-fg-5 font-mono mt-0.5">{sub}</div> : null}
        </div>
    );
}
