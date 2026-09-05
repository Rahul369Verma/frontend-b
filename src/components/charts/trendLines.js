'use strict';
/**
 * trendLines — drawing tools for PriceChart.
 *
 * lightweight-charts ships NO drawing tools; what it does ship (v5) is a
 * primitive API: attach an object to a series, be handed the canvas each frame,
 * draw whatever you like. This is that object, plus the small amount of state a
 * two-click drawing interaction needs.
 *
 * ── ANCHORED IN DATA, NEVER IN PIXELS ───────────────────────────────────────
 * Every line is stored as two {time, price} pairs and converted to pixels at
 * paint time. Storing screen coordinates instead would be far simpler and
 * completely wrong: the line would slide off its candles the moment you zoom,
 * pan, resize the window, or switch resolution — and it would silently claim a
 * level the market never touched, which on a trading chart is worse than having
 * no tool at all.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
 * No fibs, channels, or free text. One tool that is correct under every zoom
 * beats five that drift.
 */

const HANDLE_R = 4;          // px radius of the endpoint grab handles
const HIT_PX = 6;            // how close the pointer must be to select a line

/** Distance from point P to segment AB, in pixels. */
export function distanceToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    // A degenerate "segment" (both clicks on one spot) is a point, not a line —
    // dividing by len2 here would be NaN and make hit-testing silently fail.
    if (len2 === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * The primitive handed to `series.attachPrimitive()`.
 *
 * @param getState  () => ({ lines, draft, selectedId, colors })
 *                  A getter, not a snapshot: the primitive is attached once and
 *                  must render whatever the component's state is at paint time.
 */
export function createTrendLinePrimitive(getState) {
    let chart = null;
    let series = null;
    let requestUpdate = null;

    const project = (pt) => {
        if (!chart || !series) return null;
        const x = chart.timeScale().timeToCoordinate(pt.time);
        const y = series.priceToCoordinate(pt.price);
        return (x == null || y == null) ? null : { x, y };
    };

    const renderer = {
        draw(target) {
            const st = getState() || {};
            const lines = st.lines || [];
            const draft = st.draft || null;
            const colors = st.colors || {};
            target.useMediaCoordinateSpace(({ context: ctx }) => {
                ctx.save();
                const paint = (line, active) => {
                    const a = project(line.a), b = project(line.b);
                    // A point off the visible range projects to null. Skipping is
                    // correct: clamping would draw a line to an edge the user
                    // never placed, inventing a level.
                    if (!a || !b) return;
                    ctx.beginPath();
                    ctx.strokeStyle = line.color || colors.line || '#f0a202';
                    ctx.lineWidth = active ? 2 : 1.5;
                    if (line.dashed) ctx.setLineDash([5, 4]); else ctx.setLineDash([]);
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                    ctx.stroke();
                    if (active) {
                        ctx.setLineDash([]);
                        ctx.fillStyle = line.color || colors.line || '#f0a202';
                        for (const p of [a, b]) {
                            ctx.beginPath();
                            ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2);
                            ctx.fill();
                        }
                    }
                };
                for (const l of lines) paint(l, l.id === st.selectedId);
                // The draft is the line being placed: first click down, pointer
                // moving. Dashed so it is obviously not yet committed.
                if (draft?.a && draft?.b) paint({ ...draft, dashed: true }, true);
                ctx.restore();
            });
        },
    };

    const paneView = {
        zOrder: () => 'top',
        renderer: () => renderer,
    };

    return {
        attached(param) {
            chart = param.chart;
            series = param.series;
            requestUpdate = param.requestUpdate;
        },
        detached() { chart = null; series = null; requestUpdate = null; },
        updateAllViews() { /* views read live state via getState() */ },
        paneViews: () => [paneView],
        /** Ask the chart to repaint — call after any state change. */
        repaint() { if (requestUpdate) requestUpdate(); },
        /** Screen position of a stored point, for hit-testing. Null when off-screen. */
        project,
    };
}

// ── persistence ─────────────────────────────────────────────────────────────
// Drawings are per (symbol, resolution): a trend line drawn on 5m NIFTY means
// nothing on 1m BANKNIFTY. Kept in localStorage because they are one reader's
// private annotations on their own machine, not shared desk state.

const KEY = 'algobot:trendlines';

export function storageKeyFor(symbol, resolution) { return `${symbol}::${resolution}`; }

export function loadLines(symbol, resolution) {
    try {
        const all = JSON.parse(localStorage.getItem(KEY) || '{}');
        const rows = all[storageKeyFor(symbol, resolution)];
        return Array.isArray(rows) ? rows.filter(isValidLine) : [];
    } catch { return []; }        // private window, quota, corrupt JSON — never break the chart
}

export function saveLines(symbol, resolution, lines) {
    try {
        const all = JSON.parse(localStorage.getItem(KEY) || '{}');
        const k = storageKeyFor(symbol, resolution);
        if (!lines || !lines.length) delete all[k]; else all[k] = lines.filter(isValidLine);
        localStorage.setItem(KEY, JSON.stringify(all));
        return true;
    } catch { return false; }
}

/** A line is only usable if both endpoints are finite time+price. */
export function isValidLine(l) {
    // Two traps, both silent:
    //  1. `!!p`, not `p` — a bare `p &&` returns undefined for a missing point,
    //     leaking a non-boolean out of a predicate.
    //  2. `Number(null) === 0`, so `Number.isFinite(Number(null))` is TRUE. A
    //     point with a null price would validate, then paint at price 0 — a line
    //     pinned to the bottom of the chart claiming a level that never existed.
    //     Reject null/undefined/'' explicitly before coercing.
    const finite = (v) => v != null && v !== '' && Number.isFinite(Number(v));
    const ok = (p) => !!p && finite(p.time) && finite(p.price);
    return !!l && ok(l.a) && ok(l.b);
}

export const TREND_LINE_STORAGE_KEY = KEY;
