'use strict';
/**
 * useChartZoom — the index-window zoom behind every recharts chart (see ZoomableChart).
 *
 * WHY INDEX SLICING RATHER THAN AXIS DOMAINS
 * The obvious implementation is to hold an x-domain and hand it to <XAxis
 * domain={...} allowDataOverflow />. That only works on a NUMERIC axis. Half
 * the charts here are categorical — the equity curve is keyed on trade index
 * and the results curve on a date string — and a numeric domain silently does
 * nothing on those. Slicing the DATA array instead works identically for both,
 * needs no per-chart configuration, and keeps every existing axis prop intact.
 * (Charts whose series carry their OWN arrays — a scatter — use ZoomableChart's
 * `mode="xy"`, which zooms the axis domains instead.)
 *
 * Recharts hands us `activeTooltipIndex` on its mouse events, which is the
 * index into whatever array we passed — so the same three handlers drive a
 * price axis, a trade counter and a date axis without knowing the difference.
 * ⚠️ In recharts 3 that index is a STRING ("3"). It is coerced here: before
 * 31-Oct-2026 a second zoom inside a zoomed chart computed `5 + "3"` = "53" and
 * jumped to the wrong window on every chart.
 *
 * USAGE
 *   const z = useChartZoom(data);
 *   <LineChart data={z.view} {...z.chartProps}>
 *     ...
 *     {z.selection}
 *   </LineChart>
 *
 * A zoomed chart keeps at least MIN_POINTS points so it can never collapse to
 * a single sample, and every operation clamps into range — a chart that zooms
 * itself into an empty array renders blank with no way back.
 */
import { useState, useCallback, useMemo } from 'react';
import { ReferenceArea } from 'recharts';
import { useChartTheme } from '../../theme/chartTheme.js';

export const MIN_POINTS = 4;

/** recharts 3 index (string | number | null) → a finite integer, or null. */
export function indexOf(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * The window [start, end] for a request, kept inside [0, n-1] and at least MIN_POINTS
 * wide; null when it covers everything (= not zoomed). Pure, exported for tests.
 */
export function clampWindow(s, e, n, min = MIN_POINTS) {
    if (!n) return null;
    let start = Math.max(0, Math.min(s, e));
    let end = Math.min(n - 1, Math.max(s, e));
    if (end - start + 1 < min) {
        const mid = Math.round((start + end) / 2);
        start = Math.max(0, mid - Math.floor(min / 2));
        end = Math.min(n - 1, start + min - 1);
        start = Math.max(0, end - min + 1);
    }
    return (start <= 0 && end >= n - 1) ? null : [start, end];
}

/** Zoom a window by `factor` (<1 in, >1 out) keeping the point at `frac` (0..1 across it) still. Pure. */
export function zoomWindow(range, n, factor, frac = 0.5) {
    const [s, e] = range || [0, n - 1];
    const width = e - s + 1;
    const f = Math.min(1, Math.max(0, Number.isFinite(frac) ? frac : 0.5));
    const anchor = s + (width - 1) * f;
    const next = Math.max(MIN_POINTS, Math.round(width * factor));
    const ns = Math.round(anchor - (next - 1) * f);
    return clampWindow(ns, ns + next - 1, n);
}

/** Shift a window by `delta` points, sliding against either end. Pure. */
export function panWindow(range, n, delta) {
    if (!range || !n) return range;
    const [s, e] = range;
    let ns = s + delta, ne = e + delta;
    if (ns < 0) { ne -= ns; ns = 0; }
    if (ne > n - 1) { ns -= (ne - (n - 1)); ne = n - 1; }
    return [Math.max(0, ns), Math.min(n - 1, ne)];
}

export function useChartZoom(data, { enabled = true } = {}) {
    // The drag rectangle is a recharts <ReferenceArea>, i.e. an SVG `fill`
    // attribute, so it cannot be a CSS variable. Calling the theme hook from
    // inside this hook is the whole reason ZoomableChart works in a .map(): the
    // colour arrives with the selection element instead of every chart having
    // to thread it in.
    const ct = useChartTheme();
    const all = useMemo(() => (Array.isArray(data) ? data : []), [data]);
    const n = all.length;
    // The zoom carries the fingerprint of the data it was taken against, so a
    // stale zoom is DERIVED away rather than cleared by an effect or a ref
    // comparison — both of which either flash the old slice for one commit or
    // trip the render-purity rules. See `range` below.
    const [zoom, setZoom] = useState({ print: null, range: null });
    const [drag, setDrag] = useState(null);            // {from, to} while selecting

    // A new dataset invalidates any zoom: index i in the old series has nothing
    // to do with index i in the new one. Keyed on length + endpoints rather than
    // identity, because these arrays are rebuilt on every poll.
    const fingerprint = useMemo(() => {
        if (!n) return '0';
        const f = all[0], l = all[n - 1];
        return `${n}|${JSON.stringify(f)?.slice(0, 40)}|${JSON.stringify(l)?.slice(0, 40)}`;
    }, [n, all]);
    const range = zoom.print === fingerprint ? zoom.range : null;
    const setRange = useCallback((r) => setZoom({ print: fingerprint, range: r }), [fingerprint]);

    const view = useMemo(() => (range ? all.slice(range[0], range[1] + 1) : all), [all, range]);

    const onMouseDown = useCallback((e) => {
        const i = indexOf(e && (e.activeTooltipIndex ?? e.activeIndex));
        if (!enabled || i == null) return;
        setDrag({ from: i, to: i, fromLabel: e.activeLabel, toLabel: e.activeLabel });
    }, [enabled]);

    const onMouseMove = useCallback((e) => {
        if (!drag) return;
        const i = indexOf(e && (e.activeTooltipIndex ?? e.activeIndex));
        if (i == null) return;
        setDrag(d => (d ? { ...d, to: i, toLabel: e.activeLabel } : d));
    }, [drag]);

    const onMouseUp = useCallback(() => {
        if (!drag) return;
        const base = range ? range[0] : 0;
        // a click (no movement) is not a zoom — it would trap the user in a
        // 4-point window every time they tapped the chart
        if (Math.abs(drag.to - drag.from) >= 1) setRange(clampWindow(base + drag.from, base + drag.to, n));
        setDrag(null);
    }, [drag, range, n, setRange]);

    const reset = useCallback(() => { setRange(null); setDrag(null); }, [setRange]);
    const setWindow = useCallback((s, e) => setRange(clampWindow(Math.round(s), Math.round(e), n)), [n, setRange]);
    const zoomAt = useCallback((factor, frac = 0.5) => { if (n) setRange(zoomWindow(range, n, factor, frac)); }, [n, range, setRange]);
    const panBy = useCallback((points) => { if (range) setRange(panWindow(range, n, Math.round(points))); }, [range, n, setRange]);

    const selection = (drag && Math.abs(drag.to - drag.from) >= 1 && drag.fromLabel != null && drag.toLabel != null)
        ? <ReferenceArea x1={drag.fromLabel} x2={drag.toLabel} strokeOpacity={0.3} fill={ct.mark.live} fillOpacity={0.15} />
        : null;

    const width = range ? range[1] - range[0] + 1 : n;
    return {
        view, selection,
        chartProps: enabled ? { onMouseDown, onMouseMove, onMouseUp, onMouseLeave: onMouseUp } : {},
        isZoomed: !!range,
        range, total: n,
        shown: view.length,
        reset, setWindow, zoomAt, panBy,
        zoomIn: () => zoomAt(0.6), zoomOut: () => zoomAt(1.6),
        panLeft: () => panBy(-Math.max(1, Math.round(width * 0.35))), panRight: () => panBy(Math.max(1, Math.round(width * 0.35))),
        canPan: !!range,
    };
}

export default useChartZoom;
