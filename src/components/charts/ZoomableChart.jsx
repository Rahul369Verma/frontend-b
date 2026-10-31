'use strict';
/**
 * ZoomableChart — THE chart frame. Every recharts chart in the app sits in one, so
 * every chart has the same tools (user, 31-Oct-2026: "common chart functions used
 * everywhere … some charts have zoom, some don't"):
 *
 *   zoom     drag across the chart to zoom into a range · Ctrl/⌘ + wheel or a trackpad
 *            pinch zooms at the cursor · + / − buttons and keys
 *   pan      Shift + drag, or the hand (pan mode) · sideways scroll · ← / → · the navigator
 *            bar under a zoomed chart (drag it, or click the track)
 *   reset    double-click the chart, the reset button, or 0
 *   series   click a legend entry to hide / show that line (the toolbar counts what is hidden)
 *   full     full screen (F, the ⤢ button); the zoom carries over
 *   export   PNG of the chart (legend included) and CSV of the points shown
 *
 *   <ZoomableChart data={series} height={230} title="Equity">
 *     <LineChart margin={...}>...</LineChart>
 *   </ZoomableChart>
 *
 * TWO WAYS TO ZOOM
 *   mode="index" (default) — the chart has ONE data array; zoom slices it (useChartZoom).
 *     Works on categorical and numeric x axes alike; this frame injects `data`.
 *   mode="xy" — series carry their OWN arrays (a scatter). Zoom sets the numeric x and y
 *     axis domains instead (a box drag zooms both). The chart keeps its own data; pass
 *     `csvRows` for the CSV.
 * Both read the plot area and axis domains from inside the chart (recharts 3 hooks, in
 * PlotProbe), so a wheel zooms about the point under the cursor, not the middle.
 *
 * WHY A COMPONENT AND NOT A HOOK AT THE CALL SITE
 * Charts are rendered inside .map() loops, where a hook cannot be called.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ResponsiveContainer, Legend, Line, Area, Bar, Scatter, XAxis, YAxis,
    usePlotArea, useXAxisDomain, useYAxisDomain,
} from 'recharts';
import useChartZoom from './useChartZoom';
import ZoomControls, { RangeBar } from './ZoomControls';
import { Modal } from '../viz/primitives';
import useStableCallback from '../../hooks/useStableCallback.js';
import { toast } from '../toastStore.js';
import {
    numericDomain, zoomDomain, panDomain, pxToValue, fracAcross, rowsToCsv, fileStem, saveBlob, chartToPng, niceTicks,
} from './chartFrameMath.js';

const SERIES = new Set([Line, Area, Bar, Scatter]);
const NONE = Object.freeze([]);

/** Reports the plot area and the current axis domains from INSIDE the chart. Renders nothing. */
function PlotProbe({ onPlot, xAxisId, yAxisId }) {
    const plot = usePlotArea();
    const xd = useXAxisDomain(xAxisId);
    const yd = useYAxisDomain(yAxisId);
    useEffect(() => { onPlot({ plot, xd, yd }); });
    return null;
}

const seriesKeys = (p) => [p && p.dataKey, p && p.name].filter((k) => typeof k === 'string' || typeof k === 'number').map(String);
const legendKey = (entry) => String((entry && (entry.dataKey ?? entry.value)) ?? '');

/** The chart's children with the frame's changes: hidden series, legend toggles, xy domains. */
function decorate(children, ctx) {
    return React.Children.map(children, (el) => {
        if (!React.isValidElement(el)) return el;
        if (el.type === React.Fragment) return React.cloneElement(el, {}, decorate(el.props.children, ctx));
        if (SERIES.has(el.type)) return seriesKeys(el.props).some((k) => ctx.hidden.has(k)) ? React.cloneElement(el, { hide: true }) : el;
        if (el.type === Legend && ctx.toggle && !el.props.content) {
            const { onClick, formatter } = el.props;
            return React.cloneElement(el, {
                onClick: (entry, i, ev) => { ctx.toggle(legendKey(entry)); if (onClick) onClick(entry, i, ev); },
                formatter: (value, entry, i) => {
                    const off = ctx.hidden.has(legendKey(entry));
                    const inner = formatter ? formatter(value, entry, i) : value;
                    return <span style={{ cursor: 'pointer', opacity: off ? 0.45 : 1, textDecoration: off ? 'line-through' : undefined }} title={off ? 'Hidden — click to show' : 'Click to hide this line'}>{inner}</span>;
                },
            });
        }
        // a zoomed axis gets the zoomed domain AND round ticks inside it (the caller's own
        // ticks were chosen for the full range — hourly ticks leave a 20-minute zoom bare)
        if (ctx.xDom && el.type === XAxis && String(el.props.xAxisId ?? 0) === String(ctx.xAxisId ?? 0)) {
            return React.cloneElement(el, { domain: ctx.xDom, allowDataOverflow: true, ticks: niceTicks(ctx.xDom, { time: el.props.scale === 'time' }) });
        }
        if (ctx.yDom && el.type === YAxis && String(el.props.yAxisId ?? 0) === String(ctx.yAxisId ?? 0)) {
            return React.cloneElement(el, { domain: ctx.yDom, allowDataOverflow: true, ticks: niceTicks(ctx.yDom) });
        }
        return el;
    });
}

/** The page colour behind the chart, for a PNG that looks like the screen. */
function backgroundOf(el) {
    for (let n = el; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && c !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(c)) return c;
    }
    return '#111';
}

export default function ZoomableChart({
    data, height = 220, children, label = null, controls = true, className = '', enabled = true,
    mode = 'index', xAxisId = 0, yAxisId = 0, title = null, csvRows = null, navigator = true,
}) {
    const xy = mode === 'xy';
    const [panMode, setPanMode] = useState(false);
    const [full, setFull] = useState(null);              // null | { height }
    const [hidden, setHidden] = useState(() => new Set());
    const [box, setBox] = useState(null);                // xy drag-box / pan, in px inside the wrapper
    const wrapRef = useRef(null);
    const plotRef = useRef(null);
    const gesture = useRef(null);

    // ── index mode: one data array, sliced ───────────────────────────────────
    const z = useChartZoom(xy ? NONE : data, { enabled: enabled && !xy && !panMode });

    // ── xy mode: numeric domains, reset when the data changes ────────────────
    const print = useMemo(() => {
        const rows = Array.isArray(csvRows) ? csvRows : Array.isArray(data) ? data : [];
        return `${rows.length}|${JSON.stringify(rows[0] ?? null)?.slice(0, 40)}`;
    }, [csvRows, data]);
    const [domState, setDomState] = useState({ print: null, x: null, y: null });
    const dom = xy && domState.print === print ? domState : { x: null, y: null };
    const setDom = useCallback((x, y) => setDomState({ print, x, y }), [print]);
    const fullDom = useRef({ x: null, y: null });
    const onPlot = useCallback((info) => {
        plotRef.current = info;
        if (!dom.x && !dom.y) fullDom.current = { x: numericDomain(info.xd), y: numericDomain(info.yd) };
    }, [dom.x, dom.y]);

    const isZoomed = xy ? !!(dom.x || dom.y) : z.isZoomed;
    const reset = useCallback(() => { if (xy) setDom(null, null); else z.reset(); }, [xy, setDom, z]);

    /** Zoom by `factor` about (fx, fy) — fractions across the plot. */
    const zoomAt = useStableCallback((factor, fx = 0.5, fy = 0.5) => {
        if (!xy) { z.zoomAt(factor, fx); return; }
        const p = plotRef.current;
        const cx = dom.x || numericDomain(p && p.xd), cy = dom.y || numericDomain(p && p.yd);
        const f = fullDom.current;
        setDom(zoomDomain(cx, factor, fx, f.x), zoomDomain(cy, factor, 1 - fy, f.y));
    });
    const panFrac = useStableCallback((fx, fy = 0) => {
        if (!isZoomed) return;
        if (!xy) { const w = z.range ? z.range[1] - z.range[0] + 1 : z.total; z.panBy(Math.round(fx * w)); return; }
        const f = fullDom.current;
        setDom(dom.x ? panDomain(dom.x, fx, f.x) : null, dom.y ? panDomain(dom.y, fy, f.y) : null);
    });

    // ── wheel: Ctrl/⌘/Shift + wheel (and a pinch) zooms at the cursor; sideways pans ──
    const onWheel = useStableCallback((e) => {
        const el = wrapRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const P = plotRef.current && plotRef.current.plot;
        const fx = P ? fracAcross(e.clientX - rect.left, P.x, P.width) : fracAcross(e.clientX - rect.left, 0, rect.width);
        const fy = P ? fracAcross(e.clientY - rect.top, P.y, P.height) : 0.5;
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
            const d = e.deltaY || e.deltaX;
            if (!d) return;
            e.preventDefault();
            zoomAt(d > 0 ? 1.25 : 0.8, fx, fy);
            return;
        }
        if (isZoomed && Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 1) {
            e.preventDefault();
            panFrac(e.deltaX / Math.max(1, P ? P.width : rect.width));
        }
    });
    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return undefined;
        const h = (e) => onWheel(e);
        el.addEventListener('wheel', h, { passive: false });
        return () => el.removeEventListener('wheel', h);
    }, [onWheel, full]);

    // ── pointer: Shift-drag / pan mode pans; in xy mode a plain drag draws a zoom box ──
    const local = (ev) => { const r = wrapRef.current.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    const onPointerDown = (ev) => {
        if (ev.button !== 0 || !enabled) return;
        const pan = (panMode || ev.shiftKey) && isZoomed;
        if (!pan && !xy) return;                            // index zoom-select is recharts' own mouse handlers
        const P = plotRef.current && plotRef.current.plot;
        const at = local(ev);
        if (P && !pan && (at.x < P.x || at.x > P.x + P.width || at.y < P.y || at.y > P.y + P.height)) return;
        ev.currentTarget.setPointerCapture?.(ev.pointerId);
        gesture.current = { pan, at, range: z.range, dom: { x: dom.x || numericDomain(plotRef.current?.xd), y: dom.y || numericDomain(plotRef.current?.yd) } };
        if (!pan) setBox({ x0: at.x, y0: at.y, x1: at.x, y1: at.y });
    };
    const onPointerMove = (ev) => {
        const g = gesture.current;
        if (!g) return;
        const at = local(ev);
        const P = (plotRef.current && plotRef.current.plot) || { width: wrapRef.current.clientWidth, height: height };
        if (g.pan) {
            const dx = (at.x - g.at.x) / Math.max(1, P.width), dy = (at.y - g.at.y) / Math.max(1, P.height);
            if (xy) {
                const f = fullDom.current;
                setDom(dom.x ? panDomain(g.dom.x, -dx, f.x) : null, dom.y ? panDomain(g.dom.y, dy, f.y) : null);
            } else if (g.range) {
                const w = g.range[1] - g.range[0] + 1;
                const delta = Math.round(-dx * w);
                let s = g.range[0] + delta;
                s = Math.max(0, Math.min(z.total - w, s));
                z.setWindow(s, s + w - 1);
            }
            return;
        }
        setBox((b) => (b ? { ...b, x1: at.x, y1: at.y } : b));
    };
    const onPointerUp = () => {
        const g = gesture.current;
        gesture.current = null;
        if (!g || g.pan || !box) { setBox(null); return; }
        const P = plotRef.current && plotRef.current.plot;
        const { x0, x1, y0, y1 } = box;
        setBox(null);
        if (!P) return;
        const wide = Math.abs(x1 - x0) >= 6, tall = Math.abs(y1 - y0) >= 6;
        if (!wide && !tall) return;
        const nx = wide && g.dom.x ? [pxToValue(Math.min(x0, x1), P.x, P.width, g.dom.x), pxToValue(Math.max(x0, x1), P.x, P.width, g.dom.x)] : dom.x;
        const ny = tall && g.dom.y ? [pxToValue(Math.max(y0, y1), P.y, P.height, g.dom.y, true), pxToValue(Math.min(y0, y1), P.y, P.height, g.dom.y, true)] : dom.y;
        setDom(nx, ny);
    };

    // ── series visibility ─────────────────────────────────────────────────────
    const toggle = useCallback((k) => setHidden((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; }), []);
    const showAll = useCallback(() => setHidden(new Set()), []);

    // ── exports ───────────────────────────────────────────────────────────────
    const stem = fileStem(title || label);
    const onPng = async () => {
        try {
            const el = wrapRef.current;
            const blob = await chartToPng(el, { background: backgroundOf(el), font: getComputedStyle(el).fontFamily || 'sans-serif' });
            saveBlob(blob, `${stem}.png`);
        } catch (e) { toast.error(`Could not save the chart image: ${e.message}`); }
    };
    const csvSource = xy ? csvRows : z.view;
    const onCsv = Array.isArray(csvSource) && csvSource.length
        ? () => saveBlob(new Blob([rowsToCsv(csvSource)], { type: 'text/csv;charset=utf-8' }), `${stem}${isZoomed ? '-zoomed' : ''}.csv`)
        : null;

    const openFull = () => setFull({ height: Math.max(320, Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.72)) });
    const onKeyDown = (ev) => {
        if (ev.target !== ev.currentTarget) return;
        const k = ev.key;
        if (k === '+' || k === '=') { ev.preventDefault(); zoomAt(0.6); }
        else if (k === '-' || k === '_') { ev.preventDefault(); zoomAt(1.6); }
        else if (k === 'ArrowLeft' && isZoomed) { ev.preventDefault(); panFrac(-0.25); }
        else if (k === 'ArrowRight' && isZoomed) { ev.preventDefault(); panFrac(0.25); }
        else if (k === '0' || (k === 'Escape' && !full && isZoomed)) { ev.preventDefault(); reset(); }
        else if (k === 'f' || k === 'F') { ev.preventDefault(); if (full) setFull(null); else openFull(); }
    };

    const ctrl = {
        isZoomed,
        canPan: isZoomed,
        zoomIn: () => zoomAt(0.6), zoomOut: () => zoomAt(1.6),
        panLeft: () => panFrac(-0.35), panRight: () => panFrac(0.35),
        reset,
        countText: xy ? (isZoomed ? 'zoomed' : 'full view') : (z.isZoomed ? `${z.shown}/${z.total}` : `${z.total} pts`),
    };

    // ── the chart ─────────────────────────────────────────────────────────────
    const child = React.Children.only(children);
    const kids = decorate(child.props.children, {
        hidden, toggle, xAxisId, yAxisId,
        xDom: xy ? dom.x : null, yDom: xy ? dom.y : null,
    }) || [];
    kids.push(<PlotProbe key="__probe" onPlot={onPlot} xAxisId={xAxisId} yAxisId={yAxisId} />);
    if (!xy && z.selection) kids.push(React.cloneElement(z.selection, { key: '__zoomsel' }));
    // recharts 3 hands mouse handlers (state, event): Shift starts a PAN, never a zoom-select
    const chartProps = xy ? {} : Object.fromEntries(Object.entries(z.chartProps).map(([k, fn]) => [k, (st, ev) => { if (k === 'onMouseDown' && ev && ev.shiftKey) return; fn(st, ev); }]));
    const chart = React.cloneElement(child, { ...(xy ? {} : { data: z.view }), ...chartProps, children: kids });
    const hiddenCount = hidden.size;

    const frame = (h) => (
        <>
            {/* role="application": it takes its own keys (+ − ← → 0 F) and gestures, which its label lists */}
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
            <div ref={wrapRef} role="application" aria-roledescription="chart" aria-label={`${title || label || 'Chart'} — ${isZoomed ? 'zoomed' : 'full view'}. Drag to zoom, + and − keys zoom, arrows pan, 0 resets, F full screen.`}
                tabIndex={0} onKeyDown={onKeyDown} onDoubleClick={() => isZoomed && reset()}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
                className={`relative select-none rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${panMode && isZoomed ? 'cursor-grab' : ''}`}
                data-testid="chart-frame">
                {/* a CSS height ('12rem') keeps a chart in step with the Text Size setting */}
                {typeof h === 'string'
                    ? <div style={{ height: h }}><ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer></div>
                    : <ResponsiveContainer width="100%" height={h}>{chart}</ResponsiveContainer>}
                {box && (
                    <div className="absolute pointer-events-none border border-primary/70 bg-primary/15"
                        style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />
                )}
            </div>
            {navigator && !xy && z.isZoomed && <RangeBar total={z.total} range={z.range} onWindow={z.setWindow} />}
            {controls && (
                <ZoomControls z={ctrl} label={label} className="justify-end mt-0.5" panMode={panMode} onPanMode={() => setPanMode((v) => !v)}
                    full={!!full} onFull={() => (full ? setFull(null) : openFull())} onPng={onPng} onCsv={onCsv}
                    hidden={hiddenCount} onShowAll={showAll} />
            )}
        </>
    );

    return (
        <div className={className}>
            {full ? (
                <>
                    <div className="flex items-center justify-center rounded border border-dashed border-line text-2xs text-fg-5" style={{ height }}>
                        Shown in full screen — press Esc or the ✕ to bring it back here.
                    </div>
                    <Modal open onClose={() => setFull(null)} title={title || label || 'Chart'} width="max-w-[96rem]">
                        {frame(full.height)}
                    </Modal>
                </>
            ) : frame(height)}
        </div>
    );
}
