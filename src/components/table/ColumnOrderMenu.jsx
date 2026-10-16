/**
 * ColumnOrderMenu — the "Columns" button beside a re-orderable table: every
 * column in its current order with ← / → to move it, and Reset. It is the way
 * to re-order on a touch screen (no HTML5 drag there) and a quicker one for long
 * moves than dragging across a wide, scrolled table.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Columns3, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey.js';

export default function ColumnOrderMenu({ columns, onStep, onReset, isCustom }) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);
    useEscapeKey(() => setOpen(false), open);

    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    return (
        <div ref={wrapRef} className="relative">
            <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="true"
                title="Re-order the columns (you can also drag a column header)"
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border text-xs ${isCustom ? 'border-primary/50 text-primary-ink' : 'border-line-2 text-fg-4 hover:text-fg'}`}>
                <Columns3 className="w-3.5 h-3.5" aria-hidden="true" /> Columns{isCustom ? ' •' : ''}
            </button>
            {open && (
                <div role="dialog" aria-label="Column order"
                    className="absolute right-0 mt-1 z-30 w-64 max-h-[24rem] overflow-y-auto rounded-lg border border-line bg-surface shadow-2xl p-2">
                    <p className="text-3xs text-fg-5 px-1 pb-1.5">Left to right as shown in the table. Tip: you can also drag a column header.</p>
                    <ol className="space-y-0.5">
                        {columns.map((c, i) => (
                            <li key={c.key} className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-card-2/60 text-xs">
                                <span className="w-5 text-right text-fg-5 tabular-nums">{i + 1}</span>
                                <span className="flex-1 text-fg-3 truncate">{c.label}</span>
                                <button type="button" onClick={() => onStep(c.key, -1)} disabled={i === 0}
                                    aria-label={`Move ${c.label} left`} title="Move left"
                                    className="p-0.5 rounded text-fg-4 hover:text-fg disabled:opacity-25">
                                    <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                                <button type="button" onClick={() => onStep(c.key, 1)} disabled={i === columns.length - 1}
                                    aria-label={`Move ${c.label} right`} title="Move right"
                                    className="p-0.5 rounded text-fg-4 hover:text-fg disabled:opacity-25">
                                    <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                            </li>
                        ))}
                    </ol>
                    <button type="button" onClick={onReset} disabled={!isCustom}
                        className="mt-2 w-full inline-flex items-center justify-center gap-1 px-2 py-1 rounded border border-line-2 text-xs text-fg-3 hover:text-fg disabled:opacity-40">
                        <RotateCcw className="w-3 h-3" aria-hidden="true" /> Reset to default order
                    </button>
                </div>
            )}
        </div>
    );
}
