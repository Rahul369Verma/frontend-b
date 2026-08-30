// CollapsibleCard — a reusable surface card whose body collapses behind its
// header. The open/closed state is persisted to localStorage by `storageKey`
// so the user's layout preference survives reloads. Used across the Dashboard
// to keep the long single-page view manageable (Global Defaults, Live Market
// Data, etc. all fold away).
import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export default function CollapsibleCard({
    title,
    icon: Icon,
    defaultOpen = true,
    storageKey,
    right = null,        // node rendered on the right of the header (e.g. a summary chip when collapsed)
    summary = null,      // node shown in the header ONLY while collapsed (a one-line preview)
    children,
    className = '',
    bodyClassName = 'px-6 pb-6 pt-0',
}) {
    const [open, setOpen] = useState(() => {
        if (!storageKey) return defaultOpen;
        try {
            const v = localStorage.getItem(storageKey);
            return v === null ? defaultOpen : v === '1';
        } catch { return defaultOpen; }
    });

    const toggle = () => setOpen(prev => {
        const next = !prev;
        if (storageKey) { try { localStorage.setItem(storageKey, next ? '1' : '0'); } catch { /* localStorage unavailable (private mode / blocked cookies) — the preference just does not persist */ } }
        return next;
    });

    return (
        <div className={`bg-surface rounded-xl border border-line ${className}`}>
            <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                className="w-full flex items-center justify-between gap-3 p-4 text-left rounded-xl hover:bg-slate-800/40 transition-colors"
            >
                <span className="flex items-center gap-2 min-w-0">
                    {open
                        ? <ChevronDown className="w-4 h-4 text-fg-4 flex-shrink-0" />
                        : <ChevronRight className="w-4 h-4 text-fg-4 flex-shrink-0" />}
                    {Icon && <Icon className="w-5 h-5 text-primary flex-shrink-0" />}
                    <span className="text-lg font-bold text-fg truncate">{title}</span>
                    {!open && summary && (
                        <span className="text-xs font-normal text-fg-5 truncate hidden sm:inline">{summary}</span>
                    )}
                </span>
                {right && <span className="flex items-center gap-2 flex-shrink-0">{right}</span>}
            </button>
            {open && <div className={bodyClassName}>{children}</div>}
        </div>
    );
}
