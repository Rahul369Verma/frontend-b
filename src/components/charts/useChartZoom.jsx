'use strict';
/**
 * useChartZoom — drag-to-zoom, wheel-zoom and pan for any recharts chart.
 *
 * WHY INDEX SLICING RATHER THAN AXIS DOMAINS
 * The obvious implementation is to hold an x-domain and hand it to <XAxis
 * domain={...} allowDataOverflow />. That only works on a NUMERIC axis. Half
 * the charts here are categorical — the equity curve is keyed on trade index
 * and the results curve on a date string — and a numeric domain silently does
 * nothing on those. Slicing the DATA array instead works identically for both,
 * needs no per-chart configuration, and keeps every existing axis prop intact.
 *
 * Recharts hands us `activeTooltipIndex` on its mouse events, which is the
 * index into whatever array we passed — so the same three handlers drive a
 * price axis, a trade counter and a date axis without knowing the difference.
 *
 * USAGE
 *   const z = useChartZoom(data);
 *   <LineChart data={z.view} {...z.chartProps}>
 *     ...
 *     {z.selection}
 *   </LineChart>
 *   <ZoomControls z={z} />
 *
 * A zoomed chart keeps at least MIN_POINTS points so it can never collapse to
 * a single sample, and every operation clamps into range — a chart that zooms
 * itself into an empty array renders blank with no way back.
 */
import { useState, useCallback, useMemo } from 'react';
import { ReferenceArea } from 'recharts';
import { useChartTheme } from '../../theme/chartTheme.js';

const MIN_POINTS = 4;

export function useChartZoom(data, { enabled = true } = {}) {
    // The drag rectangle is a recharts <ReferenceArea>, i.e. an SVG `fill`
    // attribute, so it cannot be a CSS variable. Calling the theme hook from
    // inside this hook is the whole reason ZoomableChart works in a .map(): the
    // colour arrives with the selection element instead of every one of the 8
    // charts having to thread it in.
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
    // Adjusted DURING RENDER, not in an effect: an effect would commit the
    // stale zoom once before clearing it, which flashes a slice of the OLD
    // series against the new data. This is React's documented pattern for
    // "reset state when a prop changes".
    // A zoom taken against a different dataset is meaningless: index i in the
    // old series has nothing to do with index i in the new one. Ignoring it here
    // means a refresh silently returns to the full view instead of showing a
    // slice of something that no longer exists.
    const range = zoom.print === fingerprint ? zoom.range : null;
    const setRange = useCallback((r) => setZoom({ print: fingerprint, range: r }), [fingerprint]);

    const clamp = useCallback((s, e) => {
        if (!n) return null;
        let start = Math.max(0, Math.min(s, e));
        let end = Math.min(n - 1, Math.max(s, e));
        if (end - start + 1 < MIN_POINTS) {
            const mid = Math.round((start + end) / 2);
            start = Math.max(0, mid - Math.floor(MIN_POINTS / 2));
            end = Math.min(n - 1, start + MIN_POINTS - 1);
            start = Math.max(0, end - MIN_POINTS + 1);
        }
        return (start <= 0 && end >= n - 1) ? null : [start, end];
    }, [n]);

    const view = useMemo(() => (range ? all.slice(range[0], range[1] + 1) : all), [all, range]);

    const onMouseDown = useCallback((e) => {
        if (!enabled || !e || e.activeTooltipIndex == null) return;
        setDrag({ from: e.activeTooltipIndex, to: e.activeTooltipIndex, fromLabel: e.activeLabel, toLabel: e.activeLabel });
    }, [enabled]);

    const onMouseMove = useCallback((e) => {
        if (!drag || !e || e.activeTooltipIndex == null) return;
        setDrag(d => (d ? { ...d, to: e.activeTooltipIndex, toLabel: e.activeLabel } : d));
    }, [drag]);

    const onMouseUp = useCallback(() => {
        if (!drag) return;
        const base = range ? range[0] : 0;
        // a click (no movement) is not a zoom — it would trap the user in a
        // 4-point window every time they tapped the chart
        if (Math.abs(drag.to - drag.from) >= 1) setRange(clamp(base + drag.from, base + drag.to));
        setDrag(null);
    }, [drag, range, clamp, setRange]);

    const reset = useCallback(() => { setRange(null); setDrag(null); }, [setRange]);

    const zoomBy = useCallback((factor, anchorFrac = 0.5) => {
        if (!n) return;
        const [s, e] = range || [0, n - 1];
        const width = e - s + 1;
        const next = Math.round(width * factor);
        const anchor = s + Math.round(width * anchorFrac);
        const half = Math.max(MIN_POINTS, next) / 2;
        setRange(clamp(Math.round(anchor - half), Math.round(anchor + half)));
    }, [n, range, clamp, setRange]);

    const pan = useCallback((fracOfWidth) => {
        if (!range || !n) return;
        const [s, e] = range;
        const width = e - s + 1;
        const shift = Math.round(width * fracOfWidth);
        let ns = s + shift, ne = e + shift;
        if (ns < 0) { ne -= ns; ns = 0; }
        if (ne > n - 1) { ns -= (ne - (n - 1)); ne = n - 1; }
        setRange([Math.max(0, ns), Math.min(n - 1, ne)]);
    }, [range, n, setRange]);

    // NO WHEEL ZOOM, deliberately. Doing it properly needs a non-passive
    // 'wheel' listener, which needs a ref to the container — and returning
    // anything ref-derived from this hook makes the React compiler treat every
    // property read on the result as a render-time ref access, failing lint at
    // each call site. Drag-to-select plus the +/-/pan buttons cover the same
    // ground, so the complexity buys nothing.

    const selection = (drag && Math.abs(drag.to - drag.from) >= 1 && drag.fromLabel != null && drag.toLabel != null)
        ? <ReferenceArea x1={drag.fromLabel} x2={drag.toLabel} strokeOpacity={0.3} fill={ct.mark.live} fillOpacity={0.15} />
        : null;

    return {
        view, selection,
        chartProps: enabled ? { onMouseDown, onMouseMove, onMouseUp, onMouseLeave: onMouseUp } : {},
        isZoomed: !!range,
        range, total: n,
        shown: view.length,
        reset, zoomIn: () => zoomBy(0.6), zoomOut: () => zoomBy(1.6),
        panLeft: () => pan(-0.35), panRight: () => pan(0.35),
        canPan: !!range,
    };
}

export default useChartZoom;
