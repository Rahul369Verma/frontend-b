// CollapsibleCard — a reusable surface card whose body collapses behind its
// header. The open/closed state is persisted to localStorage by `storageKey`
// so the user's layout preference survives reloads. Used across the Dashboard
// to keep the long single-page view manageable (Global Defaults, Live Market
// Data, etc. all fold away). State lives in hooks/useCollapse.js — the same
// one Card/Panel use — so "Collapse all / Expand all" reaches it too.
import React, { useId } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import DocLink from './DocLink.jsx';
import useCollapse from '../hooks/useCollapse.js';

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
    docs = null,         // documentation target ("page#section") — 📖 link beside the header
}) {
    const { open, toggle } = useCollapse({ storageKey: storageKey || null, defaultOpen });
    const bodyId = useId();

    return (
        <div className={`bg-surface rounded-xl border border-line ${className}`}>
            {/* The docs link sits BESIDE the toggle — a link inside a button is invalid. */}
            <div className="flex items-center">
            <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                aria-controls={bodyId}
                className="flex-1 min-w-0 flex items-center justify-between gap-3 p-4 text-left rounded-xl hover:bg-slate-800/40 transition-colors"
            >
                <span className="flex items-center gap-2 min-w-0">
                    {open
                        ? <ChevronDown className="w-4 h-4 text-fg-4 flex-shrink-0" />
                        : <ChevronRight className="w-4 h-4 text-fg-4 flex-shrink-0" />}
                    {Icon && <Icon className="w-5 h-5 text-primary-ink flex-shrink-0" />}
                    <span className="text-lg font-bold text-fg truncate"
                          title={typeof title === 'string' ? title : undefined}>{title}</span>
                    {!open && summary && (
                        <span className="text-xs font-normal text-fg-5 truncate hidden sm:inline">{summary}</span>
                    )}
                </span>
                {right && <span className="flex items-center gap-2 flex-shrink-0">{right}</span>}
            </button>
            {docs && <DocLink to={docs} className="pr-4" />}
            </div>
            {open && <div id={bodyId} className={bodyClassName}>{children}</div>}
        </div>
    );
}
