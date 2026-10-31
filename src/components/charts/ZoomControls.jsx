'use strict';
/**
 * ZoomControls — the toolbar under every chart (ZoomableChart), and RangeBar, the
 * navigator that shows which part of the series a zoomed chart is showing.
 *
 * Separate file so each module exports one kind of thing: a hook file that also
 * exports a component breaks Fast Refresh (react-refresh/only-export-components).
 */
import React, { useRef } from 'react';
import { Maximize2, Minimize2, Hand, ImageDown, FileDown, HelpCircle, Eye } from 'lucide-react';
import { CHART_HELP } from './chartFrameMath.js';

// `hit-target` (index.css): these are 19-23px glyph buttons and the strip is
// deliberately compact, so the pointer target is grown to the 24x24 WCAG 2.5.8
// minimum without changing the painted size; `gap-1.5` keeps target centres
// >= 24px apart (at gap-1 they were 23px — the only pair in the app that failed).
const BTN = 'hit-target inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-line bg-slate-800 text-fg-4 hover:text-fg hover:border-line-3 disabled:opacity-30 disabled:hover:text-fg-4';
const ON = 'border-primary/60 text-primary-ink bg-primary/10';


/**
 * The strip. `z` is the frame's view of the zoom (both modes):
 *   { total, shown, isZoomed, canPan, zoomIn, zoomOut, panLeft, panRight, reset, countText }
 */
export default function ZoomControls({ z, label = null, className = '', panMode = false, onPanMode, full = false, onFull, onPng, onCsv, hidden = 0, onShowAll, compact = false }) {
    if (!z) return null;
    return (
        <div className={`flex flex-wrap items-center gap-1.5 text-4xs ${className}`} role="toolbar" aria-label="Chart controls">
            {label && <span className="text-fg-5 mr-0.5">{label}</span>}
            <button type="button" className={BTN} onClick={z.panLeft} disabled={!z.canPan} title="Pan left (←)" aria-label="Pan left">←</button>
            <button type="button" className={BTN} onClick={z.zoomOut} disabled={!z.isZoomed} title="Zoom out (−)" aria-label="Zoom out">−</button>
            <button type="button" className={BTN} onClick={z.zoomIn} title="Zoom in (+)" aria-label="Zoom in">+</button>
            <button type="button" className={BTN} onClick={z.panRight} disabled={!z.canPan} title="Pan right (→)" aria-label="Pan right">→</button>
            <button type="button" className={BTN} onClick={z.reset} disabled={!z.isZoomed} title="Reset zoom (0, or double-click the chart)" aria-label="Reset zoom">reset</button>
            {onPanMode && (
                <button type="button" className={`${BTN} ${panMode ? ON : ''}`} onClick={onPanMode} aria-pressed={panMode}
                    title={panMode ? 'Pan mode on: dragging moves the zoomed view. Click to go back to drag-to-zoom.' : 'Pan mode: drag to move a zoomed view (or hold Shift while dragging)'}>
                    <Hand className="w-3 h-3" aria-hidden="true" /><span className="sr-only">Pan mode</span>
                </button>
            )}
            {onFull && (
                <button type="button" className={`${BTN} ${full ? ON : ''}`} onClick={onFull} aria-pressed={full} title={full ? 'Leave full screen (Esc)' : 'Full screen (F)'}>
                    {full ? <Minimize2 className="w-3 h-3" aria-hidden="true" /> : <Maximize2 className="w-3 h-3" aria-hidden="true" />}
                    <span className="sr-only">{full ? 'Leave full screen' : 'Full screen'}</span>
                </button>
            )}
            {onPng && (
                <button type="button" className={BTN} onClick={onPng} title="Download the chart as a PNG image">
                    <ImageDown className="w-3 h-3" aria-hidden="true" />{!compact && <span>PNG</span>}<span className="sr-only">Download PNG</span>
                </button>
            )}
            {onCsv && (
                <button type="button" className={BTN} onClick={onCsv} title="Download the points shown as CSV">
                    <FileDown className="w-3 h-3" aria-hidden="true" />{!compact && <span>CSV</span>}<span className="sr-only">Download CSV</span>
                </button>
            )}
            {hidden > 0 && onShowAll && (
                <button type="button" className={BTN} onClick={onShowAll} title="Show every line again">
                    <Eye className="w-3 h-3" aria-hidden="true" /><span>{hidden} hidden</span>
                </button>
            )}
            <span className="text-fg-5 ml-0.5 tabular-nums">{z.countText}</span>
            <span className="text-fg-5 ml-0.5 inline-flex items-center gap-0.5 cursor-help" title={CHART_HELP}>
                <HelpCircle className="w-3 h-3" aria-hidden="true" /><span className="hidden sm:inline">drag to zoom</span>
                <span className="sr-only">{CHART_HELP}</span>
            </span>
        </div>
    );
}

/**
 * The navigator: the whole series as a track, the visible window as a handle. Drag the
 * handle to move the view; click the track to centre the view there. Index mode only.
 */
export function RangeBar({ total, range, onWindow }) {
    const track = useRef(null);
    const drag = useRef(null);
    if (!range || !total) return null;
    const [s, e] = range;
    const width = e - s + 1;
    const left = (s / total) * 100;
    const w = Math.max(1.5, (width / total) * 100);
    const toIndex = (clientX) => {
        const r = track.current.getBoundingClientRect();
        return ((clientX - r.left) / Math.max(1, r.width)) * total;
    };
    const onDown = (ev) => {
        ev.stopPropagation();
        ev.currentTarget.setPointerCapture?.(ev.pointerId);
        drag.current = { x: ev.clientX, s };
    };
    const onMove = (ev) => {
        if (!drag.current) return;
        const r = track.current.getBoundingClientRect();
        const delta = Math.round(((ev.clientX - drag.current.x) / Math.max(1, r.width)) * total);
        let ns = drag.current.s + delta;
        ns = Math.max(0, Math.min(total - width, ns));
        onWindow(ns, ns + width - 1);
    };
    const onUp = () => { drag.current = null; };
    const onTrack = (ev) => {
        if (ev.target !== track.current) return;
        const c = Math.round(toIndex(ev.clientX));
        let ns = Math.round(c - width / 2);
        ns = Math.max(0, Math.min(total - width, ns));
        onWindow(ns, ns + width - 1);
    };
    const onKey = (ev) => {
        const step = Math.max(1, Math.round(width * 0.25));
        if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
            ev.preventDefault();
            let ns = s + (ev.key === 'ArrowLeft' ? -step : step);
            ns = Math.max(0, Math.min(total - width, ns));
            onWindow(ns, ns + width - 1);
        }
    };
    return (
        <div ref={track} onPointerDown={onTrack} className="relative h-2.5 mt-1 rounded bg-slate-800 border border-line-0 cursor-pointer" data-testid="chart-navigator"
            title={`Showing points ${s + 1}–${e + 1} of ${total}. Drag the bar to move, click the track to jump.`}>
            <div role="slider" tabIndex={0} aria-label="Visible part of the chart" aria-valuemin={0} aria-valuemax={Math.max(0, total - width)} aria-valuenow={s}
                aria-valuetext={`points ${s + 1} to ${e + 1} of ${total}`}
                onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}
                className="absolute top-0 bottom-0 rounded bg-primary/40 border border-primary/70 cursor-grab active:cursor-grabbing"
                style={{ left: `${left}%`, width: `${w}%` }} />
        </div>
    );
}
