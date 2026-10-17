'use strict';
/**
 * tradeOverlay — this desk's trades on a price chart, readable at any density.
 *
 * ── WHY NOT THE LIBRARY'S MARKERS ───────────────────────────────────────────
 * lightweight-charts markers carry their text on the canvas with no collision
 * handling, so 87 trades over five days drew 168 sentences on top of each other
 * — a chart nobody could read (user, 17-Oct-2026). The standard way trading
 * platforms show executions (TradingView's own execution marks, MetaTrader's
 * trade history, journal tools) is followed here instead:
 *
 *   • small marks, NO text — ▲ CE (bullish) entry, ▼ PE (bearish) entry,
 *     ■ structure entry, ● exit coloured by the result;
 *   • a thin dotted line from each entry to its exit, coloured by the result,
 *     so a round trip reads as one object;
 *   • marks closer than a few pixels merge into a bubble with a count —
 *     hover lists them, a click zooms in until they separate — or, when they
 *     share one bar and zoom never could, lists them to pick from;
 *   • the words live in a tooltip (hover) and the trade panel (click);
 *   • the SELECTED trade alone gets the full picture: a shaded position box
 *     from entry to exit (green made money, red lost), bigger marks and two
 *     short labels — the TradingView "position" drawing, for one trade.
 *
 * ── PLACEMENT ───────────────────────────────────────────────────────────────
 * A trade at 10:18 sits between the 10:15 and 10:20 bars, and timeToCoordinate
 * only answers for a bar's exact time — so the x is a FRACTIONAL bar index,
 * interpolated between the two whole bars around it (logicalToCoordinate itself
 * returns 0 for a fraction), capped at one bar so a 15:29 exit never drifts into
 * the overnight gap. The y is the fill price; a mark with no price (a structure with
 * no recorded spot) sits just above/below its candle, as the library would.
 */

const MARK = 5;            // px half-size of a mark
const MARK_SEL = 7;        // selected / hovered
const CLUSTER_PX = 10;     // marks closer than this merge
const HIT_PX = 9;          // how close the pointer must be to a mark

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * The drawable trades, from the /chart/overlays answer.
 * Times stay in UTC seconds here; the chart shifts them to IST with its candles.
 * @returns {{id, kind, label, strategy, net, won, open, reason, entry:{t,p,shape,anchor}|null, exit:{t,p,anchor}|null}[]}
 */
/** What the filters and the marks need to know about one trade row. */
export function tradeFacts(t) {
    const net = num(t.net);
    return {
        id: String(t.id), kind: t.kind || 'single', label: t.label || '',
        strategy: t.kind === 'multileg' ? (t.label || '').replace(/\s*\(OPEN\)$/, '') : String(t.label || '').split(' · ')[0],
        side: t.kind === 'multileg' ? 'structure' : (/·\s*PE\b/.test(t.label || '') ? 'PE' : 'CE'),
        net, won: net != null ? net > 0 : null, open: !!t.open, reason: t.reason || null,
        entryAt: t.entryAt || null, exitAt: t.exitAt || null,
    };
}

export function buildTradeShapes(overlays) {
    if (!overlays) return [];
    const byId = new Map();
    for (const t of overlays.trades || []) byId.set(String(t.id), { ...tradeFacts(t), entry: null, exit: null });
    for (const m of overlays.markers || []) {
        const id = String(m.tradeId || '');
        if (!id) continue;
        let s = byId.get(id);
        if (!s) { s = { id, kind: 'single', label: '', strategy: '', side: 'CE', net: null, won: null, open: false, reason: null, entry: null, exit: null }; byId.set(id, s); }
        const pt = { t: Number(m.time), p: num(m.price), anchor: m.position || 'aboveBar', shape: m.shape || 'circle' };
        if (!Number.isFinite(pt.t)) continue;
        if (m.kind === 'entry') s.entry = pt;
        else if (m.kind === 'exit') s.exit = pt;
    }
    return [...byId.values()].filter((s) => s.entry || s.exit);
}

/** Typical bar length in seconds (the median gap), so sessions and gaps do not skew it. */
export function barSeconds(times) {
    if (!times || times.length < 2) return 60;
    const gaps = [];
    for (let i = 1; i < times.length && gaps.length < 400; i++) gaps.push(times[i] - times[i - 1]);
    gaps.sort((a, b) => a - b);
    return Math.max(1, gaps[Math.floor(gaps.length / 2)]);
}

/**
 * The fractional bar index of time `t` in ascending `times` — or null when it is
 * outside the loaded bars. Within a bar the fraction is capped at one bar, so a
 * time in an overnight gap stays on the session's last bar.
 */
export function fractionalIndex(times, t, barSec = barSeconds(times)) {
    if (!times || !times.length || !Number.isFinite(t)) return null;
    if (t < times[0] - barSec) return null;
    if (t < times[0]) return 0;
    const last = times.length - 1;
    if (t >= times[last]) return t - times[last] > barSec ? null : last + Math.min(0.95, (t - times[last]) / barSec);
    let lo = 0, hi = last;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (times[mid] <= t) lo = mid; else hi = mid - 1; }
    const gap = times[lo + 1] - times[lo];
    const into = Math.max(0, t - times[lo]);
    // a session gap (overnight, lunch on MCX): stay on this bar, never slide into the next session
    return gap > barSec * 1.5 ? lo + Math.min(0.95, into / barSec) : lo + Math.min(1, into / gap);
}

/**
 * Merge marks closer than `px` into clusters (greedy, in x order). Each mark
 * joins the first cluster whose centre is within `px`.
 * @param marks [{x, y, ...}]
 * @returns [{x, y, items:[mark]}]
 */
export function clusterMarks(marks, px = CLUSTER_PX) {
    const sorted = [...marks].sort((a, b) => a.x - b.x);
    const clusters = [];
    for (const m of sorted) {
        let hit = null;
        for (let i = clusters.length - 1; i >= 0; i--) {
            const c = clusters[i];
            if (m.x - c.x > px) break;
            if (Math.hypot(m.x - c.x, m.y - c.y) <= px) { hit = c; break; }
        }
        if (hit) {
            hit.items.push(m);
            hit.x = hit.items.reduce((a, it) => a + it.x, 0) / hit.items.length;
            hit.y = hit.items.reduce((a, it) => a + it.y, 0) / hit.items.length;
        } else clusters.push({ x: m.x, y: m.y, items: [m] });
    }
    return clusters;
}

function triangle(ctx, x, y, r, up) {
    ctx.beginPath();
    if (up) { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r * 0.8); ctx.lineTo(x - r, y + r * 0.8); }
    else { ctx.moveTo(x, y + r); ctx.lineTo(x + r, y - r * 0.8); ctx.lineTo(x - r, y - r * 0.8); }
    ctx.closePath();
}

function drawMark(ctx, m, r, colors) {
    ctx.fillStyle = m.color;
    ctx.strokeStyle = colors.surface;
    ctx.lineWidth = 1.25;
    if (m.kind === 'entry' && (m.shape === 'arrowUp' || m.shape === 'arrowDown')) triangle(ctx, m.x, m.y, r, m.shape === 'arrowUp');
    else if (m.kind === 'entry') { ctx.beginPath(); ctx.rect(m.x - r * 0.85, m.y - r * 0.85, r * 1.7, r * 1.7); }
    else { ctx.beginPath(); ctx.arc(m.x, m.y, r * 0.85, 0, Math.PI * 2); }
    ctx.fill();
    ctx.stroke();
}

function pill(ctx, text, x, y, { bg, fg, border, font, align = 'left', pad = 4, h = 16, gap = 10, width = Infinity }) {
    ctx.font = font;
    const w = ctx.measureText(text).width + pad * 2;
    // beside the mark (x is the mark), on the asked side — flipped when it would leave the pane
    let left = align === 'right' ? x - gap - w : x + gap;
    if (left < 2) left = x + gap;
    if (left + w > width - 2) left = Math.max(2, x - gap - w);
    ctx.fillStyle = bg;
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(left, y - h / 2, w, h, 3); else ctx.rect(left, y - h / 2, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + pad, y + 0.5);
}

// Fallback only — the chart passes the theme's own alpha() (any colour format) in colors.alpha.
const hexAlpha = (hex, a) => {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/**
 * The series primitive. `getState()` is read at paint time:
 *   { shapes (IST-shifted times), times (IST bar times), barSec, barsByIndex,
 *     selectedId, hoverIds:Set, connectors:boolean, colors, font, labelFor(shape) }
 */
export function createTradeOverlayPrimitive(getState) {
    let chart = null, series = null, requestUpdate = null;
    let lastHits = { marks: [], clusters: [] };

    const xOf = (st, t) => {
        const li = fractionalIndex(st.times, t, st.barSec);
        if (li == null) return null;
        // logicalToCoordinate answers 0 for a FRACTIONAL index (5.2.1 checks
        // isInteger), which piled every between-bar fill on the left edge — so
        // project the two whole bars around it and interpolate.
        const ts = chart.timeScale();
        const i0 = Math.floor(li), f = li - i0;
        const x0 = ts.logicalToCoordinate(i0);
        if (x0 == null || f === 0) return x0 == null ? null : x0;
        const x1 = ts.logicalToCoordinate(i0 + 1);
        return x1 == null ? x0 : x0 + f * (x1 - x0);
    };
    const yOf = (st, pt) => {
        if (pt.p != null) { const y = series.priceToCoordinate(pt.p); return y == null ? null : y; }
        // no fill price: hug the candle, as a bar-anchored marker would
        const li = fractionalIndex(st.times, pt.t, st.barSec);
        const bar = li == null ? null : st.barsByIndex[Math.floor(li)];
        if (!bar) return null;
        const above = pt.anchor !== 'belowBar';
        const y = series.priceToCoordinate(above ? bar.high : bar.low);
        return y == null ? null : y + (above ? -12 : 12);
    };

    const renderer = {
        draw(target) {
            const st = getState() || {};
            const shapes = st.shapes || [];
            if (!chart || !series || !shapes.length) { lastHits = { marks: [], clusters: [] }; return; }
            const c = st.colors || {};
            const alpha = typeof c.alpha === 'function' ? c.alpha : hexAlpha;
            target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
                ctx.save();
                const W = mediaSize.width;
                const marks = [];
                const geo = new Map();
                for (const s of shapes) {
                    const e = s.entry ? (() => { const x = xOf(st, s.entry.t); const y = x == null ? null : yOf(st, s.entry); return x != null && y != null ? { x, y } : null; })() : null;
                    const x2 = s.exit ? xOf(st, s.exit.t) : null;
                    const xx = s.exit && x2 != null ? { x: x2, y: yOf(st, s.exit) } : null;
                    const ex = xx && xx.y != null ? xx : null;
                    geo.set(s.id, { e, x: ex });
                    const result = s.won == null ? c.neutral : s.won ? c.win : c.loss;
                    const sel = s.id === st.selectedId;
                    const hov = st.hoverIds && st.hoverIds.has(s.id);
                    // entry → exit, one object per round trip
                    if (st.connectors !== false && e && ex && !sel) {
                        ctx.beginPath();
                        ctx.setLineDash(hov ? [] : [2, 3]);
                        ctx.lineWidth = hov ? 1.75 : 1;
                        ctx.strokeStyle = alpha(result, hov ? 0.95 : 0.55);
                        ctx.moveTo(e.x, e.y); ctx.lineTo(ex.x, ex.y); ctx.stroke();
                    }
                    if (sel || hov) continue;   // drawn last, on top, never clustered
                    const entryColor = s.side === 'PE' ? c.short : s.side === 'structure' ? c.structure : c.long;
                    if (e && e.x > -20 && e.x < W + 20) marks.push({ x: e.x, y: e.y, kind: 'entry', shape: s.entry.shape, color: entryColor, tradeId: s.id, t: s.entry.t });
                    if (ex && ex.x > -20 && ex.x < W + 20) marks.push({ x: ex.x, y: ex.y, kind: 'exit', color: result, tradeId: s.id, t: s.exit.t });
                }
                ctx.setLineDash([]);

                // ── crowded marks merge into a numbered bubble ──
                const clusters = clusterMarks(marks, CLUSTER_PX);
                const hitMarks = [], hitClusters = [];
                for (const cl of clusters) {
                    if (cl.items.length === 1) {
                        drawMark(ctx, cl.items[0], MARK, c);
                        hitMarks.push(cl.items[0]);
                        continue;
                    }
                    const ids = [...new Set(cl.items.map((m) => m.tradeId))];
                    const r = Math.min(13, 7 + Math.log2(cl.items.length) * 2);
                    ctx.beginPath();
                    ctx.arc(cl.x, cl.y, r, 0, Math.PI * 2);
                    ctx.fillStyle = c.cluster; ctx.fill();
                    ctx.lineWidth = 1.5; ctx.strokeStyle = c.surface; ctx.stroke();
                    ctx.fillStyle = c.clusterText;
                    ctx.font = c.fontSmall;
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillText(String(ids.length), cl.x, cl.y + 0.5);
                    ctx.textAlign = 'left';
                    const tFrom = Math.min(...cl.items.map((m) => m.t)), tTo = Math.max(...cl.items.map((m) => m.t));
                    // all in one bar (structures entering on the same tick): zooming can never separate them
                    hitClusters.push({ x: cl.x, y: cl.y, r, tradeIds: ids, tFrom, tTo, sameBar: tTo - tFrom < (st.barSec || 60) });
                }

                // ── hovered and selected trades: on top, bigger ──
                const top = shapes.filter((s) => s.id === st.selectedId || (st.hoverIds && st.hoverIds.has(s.id)));
                for (const s of top) {
                    const g = geo.get(s.id) || {};
                    const sel = s.id === st.selectedId;
                    const result = s.won == null ? c.neutral : s.won ? c.win : c.loss;
                    const entryColor = s.side === 'PE' ? c.short : s.side === 'structure' ? c.structure : c.long;
                    if (sel && g.e) {
                        // the position box: entry → exit (or the right edge while open)
                        const xEnd = g.x ? g.x.x : W - 4;
                        const yEnd = g.x ? g.x.y : g.e.y;
                        const left = Math.min(g.e.x, xEnd), right = Math.max(g.e.x, xEnd);
                        const top_ = Math.min(g.e.y, yEnd), bottom = Math.max(g.e.y, yEnd);
                        ctx.fillStyle = alpha(result, 0.14);
                        ctx.fillRect(left, top_, Math.max(2, right - left), Math.max(2, bottom - top_));
                        ctx.strokeStyle = alpha(result, 0.7); ctx.lineWidth = 1;
                        ctx.strokeRect(left, top_, Math.max(2, right - left), Math.max(2, bottom - top_));
                        if (g.x) { ctx.beginPath(); ctx.strokeStyle = result; ctx.lineWidth = 2; ctx.moveTo(g.e.x, g.e.y); ctx.lineTo(g.x.x, g.x.y); ctx.stroke(); }
                    }
                    const r = sel ? MARK_SEL : MARK + 1;
                    if (g.e) drawMark(ctx, { x: g.e.x, y: g.e.y, kind: 'entry', shape: s.entry.shape, color: entryColor }, r, c);
                    if (g.x) drawMark(ctx, { x: g.x.x, y: g.x.y, kind: 'exit', color: result }, r, c);
                    if (g.e) hitMarks.push({ x: g.e.x, y: g.e.y, kind: 'entry', tradeId: s.id, t: s.entry.t });
                    if (g.x) hitMarks.push({ x: g.x.x, y: g.x.y, kind: 'exit', tradeId: s.id, t: s.exit.t });
                    if (sel && st.labelFor) {
                        const L = st.labelFor(s) || {};
                        const pillStyle = { bg: c.labelBg, fg: c.labelText, border: c.labelBorder, font: c.fontSmall };
                        if (g.e && L.entry) pill(ctx, L.entry, g.e.x, g.e.y + (s.entry.shape === 'arrowDown' ? -16 : 16), { ...pillStyle, align: 'right', width: W });
                        if (g.x && L.exit) pill(ctx, L.exit, g.x.x, g.x.y + (g.e && g.x.y < g.e.y ? -16 : 16), { ...pillStyle, border: result, width: W });
                    }
                }
                lastHits = { marks: hitMarks, clusters: hitClusters };
                ctx.restore();
            });
        },
    };

    const paneView = { zOrder: () => 'top', renderer: () => renderer };

    return {
        attached(param) { chart = param.chart; series = param.series; requestUpdate = param.requestUpdate; },
        detached() { chart = null; series = null; requestUpdate = null; lastHits = { marks: [], clusters: [] }; },
        updateAllViews() { /* reads live state via getState() */ },
        paneViews: () => [paneView],
        repaint() { if (requestUpdate) requestUpdate(); },
        /**
         * What is under the pointer (media px): a single trade's mark, or a bubble
         * of several. Uses the last painted frame, so it matches what was drawn.
         * @returns {{type:'trade', tradeId, kind}|{type:'cluster', tradeIds, tFrom, tTo, sameBar}|null}
         */
        hitTest(x, y) {
            let best = null, bestD = Infinity;
            for (const cl of lastHits.clusters) {
                const d = Math.hypot(x - cl.x, y - cl.y);
                if (d <= cl.r + 2 && d < bestD) { best = { type: 'cluster', tradeIds: cl.tradeIds, tFrom: cl.tFrom, tTo: cl.tTo, sameBar: cl.sameBar }; bestD = d; }
            }
            for (const m of lastHits.marks) {
                const d = Math.hypot(x - m.x, y - m.y);
                if (d <= HIT_PX && d < bestD) { best = { type: 'trade', tradeId: m.tradeId, kind: m.kind }; bestD = d; }
            }
            return best;
        },
    };
}
