'use strict';
/**
 * ZoomControls — the button strip for a chart driven by useChartZoom.
 *
 * Separate file so each module exports one kind of thing: a hook file that also
 * exports a component breaks Fast Refresh (react-refresh/only-export-components).
 */
import React from 'react';

/** Compact control strip. Renders nothing useful for an empty series. */
export default function ZoomControls({ z, label = null, className = '' }) {
    if (!z || !z.total) return null;
    // `gap-1.5` on the row above is load-bearing, not cosmetic: WCAG 2.5.8's
    // spacing exception needs target CENTRES >= 24px apart, and at gap-1 these
    // 19px buttons were 23px apart — the only pair in the app that failed it.
    // `hit-target` (index.css): these are 19-23px glyph buttons and the strip is
    // deliberately compact, so the pointer target is grown to the 24x24 WCAG
    // 2.5.8 minimum without changing the painted size or the strip's layout.
    const btn = 'hit-target px-1.5 py-0.5 rounded border border-line bg-slate-800 text-fg-4 hover:text-fg hover:border-line-3 disabled:opacity-30 disabled:hover:text-fg-4';
    return (
        <div className={`flex items-center gap-1.5 text-4xs ${className}`}>
            {label && <span className="text-fg-5 mr-0.5">{label}</span>}
            <button type="button" className={btn} onClick={z.panLeft} disabled={!z.canPan} title="Pan left">←</button>
            <button type="button" className={btn} onClick={z.zoomOut} title="Zoom out">−</button>
            <button type="button" className={btn} onClick={z.zoomIn} title="Zoom in">+</button>
            <button type="button" className={btn} onClick={z.panRight} disabled={!z.canPan} title="Pan right">→</button>
            <button type="button" className={btn} onClick={z.reset} disabled={!z.isZoomed} title="Reset zoom">reset</button>
            <span className="text-fg-5 ml-0.5">
                {z.isZoomed ? `${z.shown}/${z.total}` : `${z.total} pts`}
            </span>
            <span className="text-fg-5 ml-0.5 hidden sm:inline" title="Drag across the chart to zoom into a range. Ctrl/Shift + wheel zooms at the cursor.">drag to zoom</span>
        </div>
    );
}

