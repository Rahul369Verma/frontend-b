/**
 * vixOverlay — India VIX beside each day's P&L. PURE: no React, no I/O, no clock.
 *
 * WHY. These books BUY options (single-leg) or SELL premium (multileg), so a
 * day's P&L carries a vega term: a VIX rise lifts every premium, a VIX crush
 * deflates them, whatever the underlying did. Putting the day's VIX path under
 * its P&L curve lets the reader separate "the market moved my way" from "vol
 * moved my way". This module does the arithmetic; DayEquityCurves draws it.
 *
 * TWO VIX NUMBERS, ON PURPOSE (both from /api/market/vix-days):
 *   day level  — close − prevClose, the OFFICIAL daily closes. This is what the
 *                rows, the correlation and the CSV use.
 *   intraday   — 1-minute bar CLOSES, each stamped at its bar's END (09:15 bar
 *                → 09:16): a bar is known only once it has closed, the same
 *                causal convention as backend/src/domain/market/vix.js. Bar
 *                OPENS are never used — Fyers reprints the previous session's
 *                close as the first bar's open (measured 3/3 days), so a 09:15
 *                "open" is yesterday's number.
 * The official close and the last bar close can differ by a few paise (29-Sep:
 * 13.41 vs 13.34). The two are labelled where both appear, never reconciled.
 *
 * ABSENT IS NOT ZERO. A VIX value the feed did not give is null all the way to
 * the screen and to the CSV (an empty cell): before the first bar of a day the
 * overlay has NO value (never back-filled from the first bar), and a day with
 * no change is excluded from the correlation and COUNTED, never read as 0.
 */
import { dayIsUnknown, dayPnlPartial } from './dayCurves.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** `+ 0` folds -0 into 0 so a flat move never prints "-0.00". */
const round2 = (x) => Math.round(x * 100) / 100 + 0;
const round3 = (x) => Math.round(x * 1000) / 1000 + 0;

/** Finite {ms, v} points, ascending. Input order is not trusted. */
function cleanVix(vixPoints) {
    if (!Array.isArray(vixPoints)) return [];
    const out = vixPoints.filter((p) => p && isNum(p.ms) && isNum(p.v));
    for (let i = 1; i < out.length; i++) {
        if (out[i].ms < out[i - 1].ms) return out.slice().sort((a, b) => a.ms - b.ms);
    }
    return out;
}

/** Index of the last point with ms <= t, or -1 (points ascending). */
function lastAtOrBefore(points, t) {
    let lo = 0, hi = points.length - 1, best = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (points[mid].ms <= t) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return best;
}

/**
 * India VIX as known at instant `ms`: the close of the last bar that had ENDED
 * by then, or null before the day's first bar has closed. Never back-filled.
 */
export function vixAt(vixPoints, ms) {
    if (!isNum(ms)) return null;
    const pts = cleanVix(vixPoints);
    const i = lastAtOrBefore(pts, ms);
    return i >= 0 ? pts[i].v : null;
}

/**
 * One ascending row array for recharts over the UNION of the P&L sample times
 * and the VIX bar times: { ms, pnl, vix }.
 *   pnl — the step value (last P&L point at or before ms; the first point's
 *         value before any, which is how the curve already starts its day).
 *   vix — the last VIX point at or before ms, or null before the first bar.
 * A shared row is what lets one tooltip report both series at the hovered time.
 */
export function mergeDayWithVix(points, vixPoints) {
    let P = Array.isArray(points) ? points.filter((p) => p && isNum(p.ms) && isNum(p.pnl)) : [];
    for (let i = 1; i < P.length; i++) {
        if (P[i].ms < P[i - 1].ms) { P = P.slice().sort((a, b) => a.ms - b.ms); break; }
    }
    const V = cleanVix(vixPoints);
    const out = [];
    let i = 0, j = 0;
    let pnl = P.length ? P[0].pnl : null;
    let vix = null;
    while (i < P.length || j < V.length) {
        const t = Math.min(i < P.length ? P[i].ms : Infinity, j < V.length ? V[j].ms : Infinity);
        while (i < P.length && P[i].ms === t) pnl = P[i++].pnl;
        while (j < V.length && V[j].ms === t) vix = V[j++].v;
        out.push({ ms: t, pnl, vix });
    }
    return out;
}

/** VIX at `fromMs` and at `toMs`, and the move between: null when either end is unknown. */
export function vixMoveOver(vixPoints, fromMs, toMs) {
    if (!isNum(fromMs) || !isNum(toMs) || toMs < fromMs) return null;
    const from = vixAt(vixPoints, fromMs);
    const to = vixAt(vixPoints, toMs);
    if (from == null || to == null) return null;
    return { from, to, change: round2(to - from) };
}

/**
 * What VIX did while a trade was held ON THIS DAY: from the later of its entry
 * and the day's first VIX bar, to the earlier of its exit and the day's end.
 * A carried position therefore gets only this day's slice — the same rule its
 * P&L contribution follows — and the overnight VIX gap is NOT in it (that gap
 * is the day row's close-to-close change).
 * → { move: {from,to,change}|null, reason: string|null, code: string|null }
 *   code: 'noBars' | 'badTime' | 'beforeFirstBar' | 'unknown' when move is null.
 */
export function vixWhileHeld(trade, vixPoints, dayEndMs) {
    const V = cleanVix(vixPoints);
    const none = (code, reason) => ({ move: null, reason, code });
    if (!V.length) return none('noBars', 'no intraday VIX for this day');
    if (!trade || !isNum(trade.entryMs)) return none('badTime', 'unreadable entry time');
    const end = isNum(trade.exitMs) ? trade.exitMs : dayEndMs;
    const to = isNum(dayEndMs) && isNum(end) ? Math.min(end, dayEndMs) : end;
    if (!isNum(to)) return none('badTime', 'unreadable exit time');
    if (to < V[0].ms) return none('beforeFirstBar', 'closed before the day\'s first 1-minute VIX bar had closed');
    const move = vixMoveOver(V, Math.max(trade.entryMs, V[0].ms), to);
    return move ? { move, reason: null, code: null } : none('unknown', 'VIX unknown at entry or exit');
}

/** Pearson r of two equal-length series, or null when either has no variation. */
function pearson(x, y) {
    const n = x.length;
    if (n < 2) return null;
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
    mx /= n; my /= n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
        const dx = x[i] - mx, dy = y[i] - my;
        sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

const allEqual = (a) => a.every((v) => v === a[0]);

/** Below this many days a correlation is not reported at all. */
export const MIN_DAYS_FOR_R = 5;
/** The significance line's threshold, and the fewest days whose rotation test
 *  can get under it at all (p >= 1/n, and 1/20 is not < 0.05). */
export const P_ALPHA = 0.05;
export const MIN_DAYS_FOR_ALPHA = Math.floor(1 / P_ALPHA) + 1;

/**
 * A p-value for the page. Two decimals printed 1/21 (0.048, significant) as
 * "0.05" beside a "stronger than chance" verdict, and 1/250 as "0.00", a p this
 * test cannot produce. So: two significant figures, more where needed to stay
 * on the same side of P_ALPHA as the exact value, and "< 0.001" below that.
 */
export function formatP(p) {
    if (!isNum(p)) return '—';
    if (p < 0.001) return '< 0.001';
    for (let digits = 2; digits <= 6; digits++) {
        const shown = Number(p.toPrecision(digits));
        if ((shown < P_ALPHA) === (p < P_ALPHA)) return String(shown);
    }
    return String(p);
}

/**
 * Day P&L against the day's VIX change, across the days that have BOTH.
 *
 * Each day lands in exactly one bucket, checked in this order, and every
 * excluded day is COUNTED:
 *   unknownPnl  — no known day total (dayIsUnknown: every trade carried out
 *                 unmarked — the same rule the rows use to print "—")
 *   partialPnl  — a total that is not the day's own P&L (dayPnlPartial): a
 *                 position unmarked across a close is missing from it, or its
 *                 exit day carries the earlier day's move too. Pairing either
 *                 with ONE day's close-to-close VIX change mismatches the spans.
 *   provisional — today, session still open: its close is a running value
 *   noVix       — no VIX change for the day (no summary, or a null change)
 *
 * SIGNIFICANCE is a deterministic ROTATION null, not a shuffle. VIX regimes
 * cluster in time (a calm fortnight, then a nervous one), and so does a
 * strategy's P&L; a shuffle destroys both clusterings and makes chance
 * alignment look rare — a shuffle null produced a false positive on this
 * project before. Rotating the VIX series
 * against the chronologically ordered P&L keeps each series' own clustering
 * and randomises only their ALIGNMENT:
 *   r_k = r(P&L, VIX change rotated by k), k = 1..n-1
 *   p   = (1 + #{ |r_k| >= |r_obs| }) / n      (two-sided; minP = 1/n)
 * With n days p can never go below 1/n, which is why minP is returned and
 * shown: with 12 days even a perfect correlation cannot reach p < 0.05.
 */
export function pnlVsVix(days, vixDays) {
    const excluded = { noVix: 0, unknownPnl: 0, partialPnl: 0, provisional: 0 };
    const rows = [];
    for (const d of Array.isArray(days) ? days : []) {
        if (!d || typeof d.day !== 'string' || dayIsUnknown(d) || !isNum(d.total)) { excluded.unknownPnl++; continue; }
        if (dayPnlPartial(d)) { excluded.partialPnl++; continue; }
        const v = vixDays && typeof vixDays === 'object' ? vixDays[d.day] : null;
        if (v && v.provisional === true) { excluded.provisional++; continue; }
        if (!v || !isNum(v.change)) { excluded.noVix++; continue; }
        rows.push({ day: d.day, pnl: d.total, dv: v.change });
    }
    rows.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

    const n = rows.length;
    const bucket = (pred) => {
        const sel = rows.filter(pred);
        return { n: sel.length, avgPnl: sel.length ? round2(sel.reduce((a, r) => a + r.pnl, 0) / sel.length) : null };
    };
    const out = {
        n,
        r: null,
        pRotation: null,
        minP: null,
        rReason: null,
        up: bucket((r) => r.dv > 0),
        down: bucket((r) => r.dv < 0),
        flat: { n: rows.filter((r) => r.dv === 0).length },
        excluded,
    };
    if (n < MIN_DAYS_FOR_R) { out.rReason = `too few days (need ${MIN_DAYS_FOR_R})`; return out; }

    const x = rows.map((r) => r.dv);
    const y = rows.map((r) => r.pnl);
    if (allEqual(x)) { out.rReason = 'VIX change was the same every day'; return out; }
    if (allEqual(y)) { out.rReason = 'day P&L was the same every day'; return out; }
    const rObs = pearson(x, y);
    if (rObs == null) { out.rReason = 'no variation to correlate'; return out; }

    // Rotation keeps x's mean and variance, so only the cross term moves; a
    // tolerance stops float noise from turning an exact tie into a miss.
    const target = Math.abs(rObs) - 1e-12;
    let hits = 0;
    const xr = new Array(n);
    for (let k = 1; k < n; k++) {
        for (let i = 0; i < n; i++) xr[i] = x[(i + k) % n];
        const rk = pearson(xr, y);
        if (rk != null && Math.abs(rk) >= target) hits++;
    }
    out.r = round3(rObs);
    out.pRotation = (1 + hits) / n;
    out.minP = 1 / n;
    return out;
}

const CSV_HEAD = ['day', 'day P&L', 'trades', 'VIX prev close', 'VIX close', 'VIX change', 'VIX change %', 'provisional', 'note'];

/** RFC-4180 cell: null/undefined → EMPTY (never 0); quoted only when needed. */
function csvCell(v) {
    if (v == null) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * One row per day, oldest first (the order a spreadsheet wants for a time
 * series). A value the page does not know is an empty cell, and the `note`
 * column says why — the same reasons the page shows.
 */
export function toCsv(days, vixDays) {
    const list = (Array.isArray(days) ? days : []).filter((d) => d && typeof d.day === 'string');
    list.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    const lines = [CSV_HEAD.join(',')];
    for (const d of list) {
        const unknown = dayIsUnknown(d) || !isNum(d.total);
        const v = vixDays && typeof vixDays === 'object' ? vixDays[d.day] : null;
        const num = (x) => (isNum(x) ? x : null);
        const notes = [];
        if (unknown) notes.push('day P&L unknown: every trade was still open at the close with no marks that day');
        const partial = unknown ? null : dayPnlPartial(d);
        if (partial && partial.missing) notes.push(`day P&L partial: ${partial.missing} position(s) open at the close with no marks that day are not in it`);
        if (partial && partial.spanning) notes.push(`day P&L partial: ${partial.spanning} position(s) carried in unmarked bring earlier days' moves into it`);
        if (!v) notes.push('VIX not loaded');
        else if (v.reason) notes.push(v.reason);
        if (v && v.provisional === true) notes.push('VIX is a running value: session still open');
        lines.push([
            d.day,
            unknown ? null : round2(d.total),
            Array.isArray(d.trades) ? d.trades.length : null,
            num(v?.prevClose),
            num(v?.close),
            num(v?.change),
            num(v?.changePct),
            v ? (v.provisional === true ? 'yes' : 'no') : null,
            notes.length ? notes.join('; ') : null,
        ].map(csvCell).join(','));
    }
    return `${lines.join('\n')}\n`;
}
